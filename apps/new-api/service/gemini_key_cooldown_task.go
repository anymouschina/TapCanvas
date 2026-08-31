package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	geminiKeyCooldownRecoveryTickInterval = time.Minute
	// DefaultGeminiOAuthKeyCooldownSeconds is the fallback cooldown when the
	// upstream does not expose a retry/reset duration to the relay layer.
	DefaultGeminiOAuthKeyCooldownSeconds = 1800
)

var (
	geminiKeyCooldownRecoveryOnce    sync.Once
	geminiKeyCooldownRecoveryRunning atomic.Bool
)

// CooldownGeminiChannelKey asynchronously places one Gemini OAuth account into
// a temporary quota cooldown. A valid provider retry time takes priority over
// the channel's fallback duration. A negative setting disables this
// provider-specific cooldown; callers are expected to check that before
// invoking this function.
func CooldownGeminiChannelKey(channelID int, keyIndex int, fallbackSeconds int, apiErr *types.NewAPIError) {
	until, source := resolveGeminiKeyCooldown(time.Now(), fallbackSeconds, apiErr)
	reason := "upstream returned HTTP 429"
	if apiErr != nil && apiErr.Error() != "" {
		reason = apiErr.Error()
	}
	gopool.Go(func() {
		ctx := context.Background()
		fullReason := fmt.Sprintf("Gemini rate limited, cooldown until %s (%s); %s", time.Unix(until, 0).UTC().Format(time.RFC3339), source, reason)
		if err := model.CooldownChannelKey(channelID, keyIndex, until, fullReason); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("Gemini key cooldown: channel_id=%d key_index=%d failed: %v", channelID, keyIndex, err))
			return
		}
		logger.LogInfo(ctx, fmt.Sprintf("Gemini key cooldown: channel_id=%d key_index=%d cooldown until %s source=%s", channelID, keyIndex, time.Unix(until, 0).UTC().Format(time.RFC3339), source))
	})
}

func resolveGeminiKeyCooldown(now time.Time, fallbackSeconds int, apiErr *types.NewAPIError) (until int64, source string) {
	if apiErr != nil {
		if retryAt, retrySource, ok := apiErr.GetRetryAt(); ok && retryAt > now.Unix() {
			return retryAt, retrySource
		}
	}
	if fallbackSeconds <= 0 {
		fallbackSeconds = DefaultGeminiOAuthKeyCooldownSeconds
		return now.Unix() + int64(fallbackSeconds), "gemini.default-cooldown"
	}
	return now.Unix() + int64(fallbackSeconds), "channel.oauth_key_cooldown_seconds"
}

// DisableGeminiChannelKey permanently isolates one Gemini account after a
// provider-confirmed credential failure. It does not disable sibling accounts
// in the same channel.
func DisableGeminiChannelKey(channelID int, keyIndex int, reason string) {
	gopool.Go(func() {
		if success := model.UpdateChannelStatusByKeyIndex(channelID, keyIndex, common.ChannelStatusAutoDisabled, reason); !success {
			logger.LogWarn(context.Background(), fmt.Sprintf("Gemini key disable failed: channel_id=%d key_index=%d", channelID, keyIndex))
			return
		}
		logger.LogWarn(context.Background(), fmt.Sprintf("Gemini OAuth account disabled: channel_id=%d key_index=%d reason=%s", channelID, keyIndex, reason))
	})
}

// StartGeminiKeyCooldownRecoveryTask re-enables Gemini accounts whose quota
// cooldown has expired. Only the master node performs the scan.
func StartGeminiKeyCooldownRecoveryTask() {
	geminiKeyCooldownRecoveryOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("Gemini key cooldown recovery task started: tick=%s", geminiKeyCooldownRecoveryTickInterval))
			ticker := time.NewTicker(geminiKeyCooldownRecoveryTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				runGeminiKeyCooldownRecoveryOnce()
			}
		})
	})
}

func runGeminiKeyCooldownRecoveryOnce() {
	if !geminiKeyCooldownRecoveryRunning.CompareAndSwap(false, true) {
		return
	}
	defer geminiKeyCooldownRecoveryRunning.Store(false)

	recovered, err := model.RecoverCooledChannelKeysForType(constant.ChannelTypeGemini, time.Now().Unix())
	if err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("Gemini key cooldown recovery failed: %v", err))
		return
	}
	if recovered > 0 {
		logger.LogInfo(context.Background(), fmt.Sprintf("Gemini key cooldown recovery: re-enabled %d account(s)", recovered))
	}
}
