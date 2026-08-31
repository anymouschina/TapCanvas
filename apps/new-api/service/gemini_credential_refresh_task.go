package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	geminiCredentialRefreshTickInterval = 10 * time.Minute
	geminiCredentialRefreshThreshold    = 15 * time.Minute
	geminiCredentialRefreshBatchSize    = 200
	geminiCredentialRefreshTimeout      = 15 * time.Second
)

type geminiCredentialRefreshBackoffEntry struct {
	Failures    int
	NextAttempt time.Time
}

var (
	geminiCredentialRefreshOnce    sync.Once
	geminiCredentialRefreshRunning atomic.Bool
	geminiCredentialRefreshBackoff = struct {
		sync.Mutex
		entries map[string]geminiCredentialRefreshBackoffEntry
	}{entries: make(map[string]geminiCredentialRefreshBackoffEntry)}
)

// StartGeminiCredentialAutoRefreshTask refreshes near-expiry Gemini OAuth
// accounts. API Key rows and OAuth rows without refresh_token are skipped and
// remain visible in the account management page as-is.
func StartGeminiCredentialAutoRefreshTask() {
	geminiCredentialRefreshOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("gemini credential auto-refresh task started: tick=%s threshold=%s", geminiCredentialRefreshTickInterval, geminiCredentialRefreshThreshold))
			ticker := time.NewTicker(geminiCredentialRefreshTickInterval)
			defer ticker.Stop()
			runGeminiCredentialAutoRefreshOnce()
			for range ticker.C {
				runGeminiCredentialAutoRefreshOnce()
			}
		})
	})
}

func runGeminiCredentialAutoRefreshOnce() {
	if !geminiCredentialRefreshRunning.CompareAndSwap(false, true) {
		return
	}
	defer geminiCredentialRefreshRunning.Store(false)

	ctx := context.Background()
	now := time.Now()
	refreshed := 0
	scanned := 0
	offset := 0
	for {
		var channels []*model.Channel
		err := model.DB.Select("id", "name", "key", "status", "channel_info").
			Where("type = ? AND status = 1", constant.ChannelTypeGemini).
			Order("id asc").Limit(geminiCredentialRefreshBatchSize).Offset(offset).Find(&channels).Error
		if err != nil {
			logger.LogError(ctx, fmt.Sprintf("gemini credential auto-refresh: query channels failed: %v", err))
			return
		}
		if len(channels) == 0 {
			break
		}
		offset += geminiCredentialRefreshBatchSize

		for _, channel := range channels {
			if channel == nil {
				continue
			}
			scanned++
			if channel.ChannelInfo.IsMultiKey {
				count, refreshErr := RefreshGeminiChannelMultiKeyCredentials(ctx, channel.Id, geminiCredentialRefreshThreshold, now)
				if refreshErr != nil {
					logger.LogWarn(ctx, fmt.Sprintf("gemini credential auto-refresh: channel_id=%d name=%s multi-key refresh failed: %v", channel.Id, channel.Name, refreshErr))
				}
				refreshed += count
				continue
			}

			oauthKey, parseErr := parseGeminiOAuthKey(strings.TrimSpace(channel.Key))
			if parseErr != nil || strings.TrimSpace(oauthKey.RefreshToken) == "" {
				continue
			}
			if expiry, ok := oauthKey.ExpiryTime(); ok && expiry.Sub(now) > geminiCredentialRefreshThreshold {
				continue
			}
			if !allowGeminiBackgroundRefresh(channel.Id, 0, now) {
				continue
			}

			refreshCtx, cancel := context.WithTimeout(ctx, geminiCredentialRefreshTimeout)
			_, _, refreshErr := RefreshGeminiChannelCredential(refreshCtx, channel.Id, GeminiCredentialRefreshOptions{ResetCaches: false})
			cancel()
			if refreshErr != nil {
				recordGeminiBackgroundRefreshFailure(channel.Id, 0, now)
				logger.LogWarn(ctx, fmt.Sprintf("gemini credential auto-refresh: channel_id=%d name=%s refresh failed: %v", channel.Id, channel.Name, refreshErr))
				if IsGeminiPermanentCredentialRefreshError(refreshErr) {
					DisableGeminiChannelKey(channel.Id, 0, "Gemini OAuth credential is permanently invalid: "+refreshErr.Error())
				}
				continue
			}
			clearGeminiBackgroundRefreshFailure(channel.Id, 0)
			refreshed++
		}
	}

	if refreshed > 0 {
		ResetProxyClientCache()
		if err := model.RefreshChannelCache(); err != nil {
			logger.LogWarn(ctx, "gemini credential auto-refresh: credentials saved but channel cache refresh failed: "+err.Error())
		}
	}
	if common.DebugEnabled {
		logger.LogDebug(ctx, "gemini credential auto-refresh: scanned=%d refreshed=%d", scanned, refreshed)
	}
}

func allowGeminiBackgroundRefresh(channelID int, keyIndex int, now time.Time) bool {
	key := fmt.Sprintf("%d:%d", channelID, keyIndex)
	geminiCredentialRefreshBackoff.Lock()
	defer geminiCredentialRefreshBackoff.Unlock()
	entry, exists := geminiCredentialRefreshBackoff.entries[key]
	return !exists || !entry.NextAttempt.After(now)
}

func recordGeminiBackgroundRefreshFailure(channelID int, keyIndex int, now time.Time) {
	key := fmt.Sprintf("%d:%d", channelID, keyIndex)
	geminiCredentialRefreshBackoff.Lock()
	defer geminiCredentialRefreshBackoff.Unlock()
	entry := geminiCredentialRefreshBackoff.entries[key]
	entry.Failures++
	delay := 10 * time.Minute
	for index := 1; index < entry.Failures && delay < 4*time.Hour; index++ {
		delay *= 2
	}
	if delay > 4*time.Hour {
		delay = 4 * time.Hour
	}
	entry.NextAttempt = now.Add(delay)
	geminiCredentialRefreshBackoff.entries[key] = entry
}

func clearGeminiBackgroundRefreshFailure(channelID int, keyIndex int) {
	key := fmt.Sprintf("%d:%d", channelID, keyIndex)
	geminiCredentialRefreshBackoff.Lock()
	delete(geminiCredentialRefreshBackoff.entries, key)
	geminiCredentialRefreshBackoff.Unlock()
}
