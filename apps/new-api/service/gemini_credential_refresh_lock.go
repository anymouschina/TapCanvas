package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/geminiauth"

	"github.com/go-redis/redis/v8"
)

const (
	geminiCredentialRefreshLockTTL  = 30 * time.Second
	geminiCredentialRefreshLockWait = 5 * time.Second
	geminiCredentialFreshnessBuffer = 2 * time.Minute
)

var geminiCredentialRefreshUnlockScript = redis.NewScript(`
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
end
return 0
`)

// withGeminiCredentialRefreshLease serializes refreshes for one account across
// new-api instances when Redis is enabled. The channel polling mutex still
// serializes local channel writes; this lease covers the cross-instance gap.
func withGeminiCredentialRefreshLease(ctx context.Context, channelID int, keyIndex int, key *geminiauth.OAuthKey, fn func() error) error {
	if fn == nil {
		return fmt.Errorf("Gemini credential refresh callback is nil")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	lockKey := geminiCredentialRefreshLockKey(channelID, keyIndex, key)
	if !common.RedisEnabled || common.RDB == nil {
		return fn()
	}

	lockToken := common.GetRandomString(32)
	deadline := time.Now().Add(geminiCredentialRefreshLockWait)
	for {
		locked, err := common.RDB.SetNX(ctx, lockKey, lockToken, geminiCredentialRefreshLockTTL).Result()
		if err != nil {
			return fmt.Errorf("acquire Gemini credential refresh lock: %w", err)
		}
		if locked {
			break
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("Gemini credential refresh is already in progress: channel_id=%d key_index=%d", channelID, keyIndex)
		}
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return ctx.Err()
		case <-timer.C:
		}
	}

	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := geminiCredentialRefreshUnlockScript.Run(releaseCtx, common.RDB, []string{lockKey}, lockToken).Err(); err != nil {
			common.SysError(fmt.Sprintf("release Gemini credential refresh lock failed: channel_id=%d key_index=%d error=%v", channelID, keyIndex, err))
		}
	}()
	return fn()
}

func geminiCredentialRefreshLockKey(channelID int, keyIndex int, key *geminiauth.OAuthKey) string {
	identity := ""
	if key != nil {
		if accountID := strings.TrimSpace(key.AccountID); accountID != "" {
			identity = "account_id:" + accountID
		} else if email := strings.TrimSpace(key.Email); email != "" {
			identity = "email:" + strings.ToLower(email)
		}
	}
	if identity == "" {
		identity = fmt.Sprintf("key_index:%d", keyIndex)
	}
	digest := sha256.Sum256([]byte(identity))
	return fmt.Sprintf("new-api:gemini:credential-refresh:%d:%s", channelID, hex.EncodeToString(digest[:]))
}

func geminiCredentialStableIdentity(key *geminiauth.OAuthKey) string {
	if key == nil {
		return ""
	}
	if accountID := strings.TrimSpace(key.AccountID); accountID != "" {
		return "account_id:" + accountID
	}
	if email := strings.TrimSpace(key.Email); email != "" {
		return "email:" + strings.ToLower(email)
	}
	return ""
}

func findGeminiCredentialIndex(keys []string, preferredIndex int, stableIdentity string) int {
	if preferredIndex >= 0 && preferredIndex < len(keys) {
		if stableIdentity == "" {
			return preferredIndex
		}
		if current, err := parseGeminiOAuthKey(keys[preferredIndex]); err == nil && geminiCredentialStableIdentity(current) == stableIdentity {
			return preferredIndex
		}
	}
	if stableIdentity == "" {
		return -1
	}
	for index, rawKey := range keys {
		current, err := parseGeminiOAuthKey(rawKey)
		if err == nil && geminiCredentialStableIdentity(current) == stableIdentity {
			return index
		}
	}
	return -1
}

func geminiCredentialHasFreshAccessToken(key *geminiauth.OAuthKey, now time.Time) bool {
	if key == nil || strings.TrimSpace(key.AccessToken) == "" {
		return false
	}
	expiry, ok := key.ExpiryTime()
	return ok && expiry.After(now.Add(geminiCredentialFreshnessBuffer))
}
