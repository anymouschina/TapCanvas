package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	claudeKeyCooldownRecoveryTickInterval = time.Minute
	// DefaultClaudeOAuthKeyCooldownSeconds 是账号触发上游 429 限额后的兜底冷却时长
	// (实时查订阅用量拿不到 resets_at 时生效)。渠道 setting oauth_key_cooldown_seconds
	// 为 0/缺省时用本值;-1 关闭冷却;>0 自定义兜底秒数。
	DefaultClaudeOAuthKeyCooldownSeconds = 1800
	// claudeKeyCooldownResetBuffer 是按 resets_at 解封时额外附加的缓冲，避免踩线再 429。
	claudeKeyCooldownResetBuffer = 60
	// claudeKeyCooldownMaxResetAhead 防御异常遥远的 resets_at(解析错/时钟漂移):超过即弃用。
	claudeKeyCooldownMaxResetAhead = 8 * 24 * time.Hour
)

var (
	claudeKeyCooldownRecoveryOnce    sync.Once
	claudeKeyCooldownRecoveryRunning atomic.Bool
)

// CooldownClaudeChannelKey 异步把渠道内指定账号(key)置入限额冷却。冷却时长优先取该
// 账号订阅用量里最饱和窗口的 resets_at(上游真实解禁时刻+缓冲),拿不到才用
// fallbackSeconds(<=0 时用默认值)。
func CooldownClaudeChannelKey(channelId int, keyIndex int, fallbackSeconds int, reason string) {
	if fallbackSeconds <= 0 {
		fallbackSeconds = DefaultClaudeOAuthKeyCooldownSeconds
	}
	gopool.Go(func() {
		ctx := context.Background()
		until := time.Now().Unix() + int64(fallbackSeconds)
		source := "fallback"
		if resetAt, ok := probeClaudeKeyRateLimitReset(ctx, channelId, keyIndex); ok {
			until = resetAt + claudeKeyCooldownResetBuffer
			source = "resets_at"
		}
		fullReason := fmt.Sprintf("rate limited, cooldown until %s (%s); %s", time.Unix(until, 0).Format(time.RFC3339), source, reason)
		if err := model.CooldownChannelKey(channelId, keyIndex, until, fullReason); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("claude key cooldown: channel_id=%d key_index=%d failed: %v", channelId, keyIndex, err))
			return
		}
		logger.LogInfo(ctx, fmt.Sprintf("claude key cooldown: channel_id=%d key_index=%d cooldown until %s (%s)", channelId, keyIndex, time.Unix(until, 0).Format(time.RFC3339), source))
	})
}

// probeClaudeKeyRateLimitReset 实时查指定账号的订阅用量,返回最饱和窗口的 resets_at
// (unix 秒)。access_token 过期、网络失败、resets_at 缺失/异常时返回 (0, false)。
func probeClaudeKeyRateLimitReset(ctx context.Context, channelId int, keyIndex int) (int64, bool) {
	ch, err := model.GetChannelById(channelId, true)
	if err != nil || ch == nil {
		return 0, false
	}
	keys := ch.GetKeys()
	if keyIndex < 0 || keyIndex >= len(keys) {
		return 0, false
	}
	oauthKey, err := parseClaudeOAuthKey(strings.TrimSpace(keys[keyIndex]))
	if err != nil || strings.TrimSpace(oauthKey.AccessToken) == "" {
		return 0, false
	}

	fetchCtx, cancel := context.WithTimeout(ctx, claudeUsageHTTPTimeout)
	defer cancel()
	statusCode, _, usage, err := FetchClaudeUsage(fetchCtx, oauthKey.AccessToken, ch.GetBaseURL(), ch.GetSetting().Proxy)
	if err != nil || statusCode < 200 || statusCode >= 300 || usage == nil {
		return 0, false
	}

	best := usage.FiveHour
	for _, w := range []ClaudeUsageWindow{usage.SevenDay, usage.SevenDaySonnet} {
		if w.Utilization > best.Utilization {
			best = w
		}
	}
	resetsAt := strings.TrimSpace(best.ResetsAt)
	if resetsAt == "" {
		return 0, false
	}
	t, err := time.Parse(time.RFC3339, resetsAt)
	if err != nil {
		return 0, false
	}
	now := time.Now()
	if !t.After(now) || t.Sub(now) > claudeKeyCooldownMaxResetAhead {
		return 0, false
	}
	return t.Unix(), true
}

// StartClaudeKeyCooldownRecoveryTask 每分钟扫描限额冷却中的账号，到点自动解禁。
// 对照 StartClaudeCredentialAutoRefreshTask 的结构。
func StartClaudeKeyCooldownRecoveryTask() {
	claudeKeyCooldownRecoveryOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}

		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("claude key cooldown recovery task started: tick=%s", claudeKeyCooldownRecoveryTickInterval))

			ticker := time.NewTicker(claudeKeyCooldownRecoveryTickInterval)
			defer ticker.Stop()

			for range ticker.C {
				runClaudeKeyCooldownRecoveryOnce()
			}
		})
	})
}

func runClaudeKeyCooldownRecoveryOnce() {
	if !claudeKeyCooldownRecoveryRunning.CompareAndSwap(false, true) {
		return
	}
	defer claudeKeyCooldownRecoveryRunning.Store(false)

	recovered, err := model.RecoverCooledChannelKeys(time.Now().Unix())
	if err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("claude key cooldown recovery failed: %v", err))
		return
	}
	if recovered > 0 {
		logger.LogInfo(context.Background(), fmt.Sprintf("claude key cooldown recovery: re-enabled %d account(s)", recovered))
	}
}
