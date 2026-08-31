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
	claudeCredentialRefreshTickInterval = 10 * time.Minute
	claudeCredentialRefreshThreshold    = 24 * time.Hour
	claudeCredentialRefreshBatchSize    = 200
	claudeCredentialRefreshTimeout      = 15 * time.Second
)

var (
	claudeCredentialRefreshOnce    sync.Once
	claudeCredentialRefreshRunning atomic.Bool
)

// StartClaudeCredentialAutoRefreshTask 每 10 分钟扫描 claude(Anthropic)类型且 key 为
// OAuth JSON 的渠道,临近过期的触发刷新。对照 StartCodexCredentialAutoRefreshTask。
func StartClaudeCredentialAutoRefreshTask() {
	claudeCredentialRefreshOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}

		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("claude credential auto-refresh task started: tick=%s threshold=%s", claudeCredentialRefreshTickInterval, claudeCredentialRefreshThreshold))

			ticker := time.NewTicker(claudeCredentialRefreshTickInterval)
			defer ticker.Stop()

			runClaudeCredentialAutoRefreshOnce()
			for range ticker.C {
				runClaudeCredentialAutoRefreshOnce()
			}
		})
	})
}

func runClaudeCredentialAutoRefreshOnce() {
	if !claudeCredentialRefreshRunning.CompareAndSwap(false, true) {
		return
	}
	defer claudeCredentialRefreshRunning.Store(false)

	ctx := context.Background()
	now := time.Now()

	var refreshed int
	var scanned int

	offset := 0
	for {
		var channels []*model.Channel
		err := model.DB.
			Select("id", "name", "key", "status", "channel_info").
			Where("type = ? AND status = 1", constant.ChannelTypeAnthropic).
			Order("id asc").
			Limit(claudeCredentialRefreshBatchSize).
			Offset(offset).
			Find(&channels).Error
		if err != nil {
			logger.LogError(ctx, fmt.Sprintf("claude credential auto-refresh: query channels failed: %v", err))
			return
		}
		if len(channels) == 0 {
			break
		}
		offset += claudeCredentialRefreshBatchSize

		for _, ch := range channels {
			if ch == nil {
				continue
			}
			scanned++
			if ch.ChannelInfo.IsMultiKey {
				// 多 key 渠道:逐 key 续期(单 key 整条刷新的逻辑不适用)。
				n, mErr := RefreshClaudeChannelMultiKeyCredentials(ctx, ch.Id, claudeCredentialRefreshThreshold, now)
				if mErr != nil {
					logger.LogWarn(ctx, fmt.Sprintf("claude credential auto-refresh: channel_id=%d name=%s multi-key refresh failed: %v", ch.Id, ch.Name, mErr))
				}
				refreshed += n
				continue
			}

			rawKey := strings.TrimSpace(ch.Key)
			if rawKey == "" {
				continue
			}

			oauthKey, err := parseClaudeOAuthKey(rawKey)
			if err != nil {
				continue
			}

			refreshToken := strings.TrimSpace(oauthKey.RefreshToken)
			if refreshToken == "" {
				continue
			}

			expiredAtRaw := strings.TrimSpace(oauthKey.Expired)
			expiredAt, err := time.Parse(time.RFC3339, expiredAtRaw)
			if err == nil && !expiredAt.IsZero() && expiredAt.Sub(now) > claudeCredentialRefreshThreshold {
				continue
			}

			refreshCtx, cancel := context.WithTimeout(ctx, claudeCredentialRefreshTimeout)
			newKey, _, err := RefreshClaudeChannelCredential(refreshCtx, ch.Id, ClaudeCredentialRefreshOptions{ResetCaches: false})
			cancel()
			if err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("claude credential auto-refresh: channel_id=%d name=%s refresh failed: %v", ch.Id, ch.Name, err))
				continue
			}

			refreshed++
			logger.LogInfo(ctx, fmt.Sprintf("claude credential auto-refresh: channel_id=%d name=%s refreshed, expires_at=%s", ch.Id, ch.Name, newKey.Expired))
		}
	}

	if refreshed > 0 {
		ResetProxyClientCache()
		if err := model.RefreshChannelCache(); err != nil {
			logger.LogWarn(ctx, "claude credential auto-refresh: credentials saved but channel cache refresh failed: "+err.Error())
		}
	}

	if common.DebugEnabled {
		logger.LogDebug(ctx, "claude credential auto-refresh: scanned=%d refreshed=%d", scanned, refreshed)
	}
}
