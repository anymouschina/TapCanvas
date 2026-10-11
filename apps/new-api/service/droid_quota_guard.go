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

	"github.com/bytedance/gopkg/util/gopool"
)

// Factory meters each account per scope: droid-chat models (Fireworks-hosted
// open models) draw on "core", every other wire on "standard" (measured on an
// account whose standard weekly window was spent while core still served).
// An account whose scope is spent is skipped for that scope until the
// window's reset time; its status is untouched, so the other scope keeps it.
const (
	DroidScopeCore     = "core"
	DroidScopeStandard = "standard"

	droidUsageLifecycleInterval = 5 * time.Minute
	droidUsageAfterLimitMinGap  = 30 * time.Second
	droidQuotaUnknownResetRetry = int64(droidUsageLifecycleInterval / time.Second)
)

var (
	droidUsageLifecycleOnce    sync.Once
	droidUsageLifecycleRunning atomic.Bool
	droidUsageAfterLimitLast   sync.Map // channel id -> unix nanos of last refresh start
)

func DroidQuotaScope(protocolID string) string {
	if protocolID == constant.ProtocolDroidChat {
		return DroidScopeCore
	}
	return DroidScopeStandard
}

// droidScopeBlockedUntil reports until when usage has no quota left in scope.
// A spent window stays blocking only until its reset time; a window without
// a reset time is re-checked after one refresh interval.
func droidScopeBlockedUntil(usage model.ChannelKeyUsage, scope string, now int64) (int64, bool) {
	if usage.QuotaSource != DroidQuotaSource {
		return 0, false
	}
	if usage.ExtraUsageAllowed != nil && *usage.ExtraUsageAllowed &&
		usage.ExtraUsageBalanceCents != nil && *usage.ExtraUsageBalanceCents > 0 {
		return 0, false
	}
	until := int64(0)
	for _, window := range usage.QuotaWindows {
		if window.Scope != scope || window.UsedPercent == nil || *window.UsedPercent < 100 {
			continue
		}
		reset := usage.QuotaWindowsCheckedAt + droidQuotaUnknownResetRetry
		if window.ResetAt != nil {
			reset = *window.ResetAt
		}
		if reset > until {
			until = reset
		}
	}
	return until, until > now
}

// DroidSpentKeys returns the accounts of a multi-key Droid channel whose quota
// for the request protocol's scope is spent, with the earliest time one comes back.
func DroidSpentKeys(channel *model.Channel, protocolID string, now int64) (map[int]bool, string, int64) {
	if channel == nil || channel.Type != constant.ChannelTypeDroid {
		return nil, "", 0
	}
	lock := model.GetChannelPollingLock(channel.Id)
	lock.Lock()
	defer lock.Unlock()
	if !channel.ChannelInfo.IsMultiKey || len(channel.ChannelInfo.MultiKeyUsage) == 0 {
		return nil, "", 0
	}
	scope := DroidQuotaScope(protocolID)
	var spent map[int]bool
	earliest := int64(0)
	for index, usage := range channel.ChannelInfo.MultiKeyUsage {
		until, blocked := droidScopeBlockedUntil(usage, scope, now)
		if !blocked {
			continue
		}
		if spent == nil {
			spent = make(map[int]bool)
		}
		spent[index] = true
		if earliest == 0 || until < earliest {
			earliest = until
		}
	}
	return spent, scope, earliest
}

func StartDroidUsageLifecycleTask() {
	droidUsageLifecycleOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			runDroidUsageLifecycleOnce()
			ticker := time.NewTicker(droidUsageLifecycleInterval)
			defer ticker.Stop()
			for range ticker.C {
				runDroidUsageLifecycleOnce()
			}
		})
	})
}

// RefreshDroidUsageAfterLimit refreshes quota windows after an upstream quota
// rejection so later requests skip the spent account. Concurrent rejections
// on one channel share a refresh.
func RefreshDroidUsageAfterLimit(channelID int) {
	now := time.Now().UnixNano()
	if last, loaded := droidUsageAfterLimitLast.LoadOrStore(channelID, now); loaded {
		if now-last.(int64) < int64(droidUsageAfterLimitMinGap) || !droidUsageAfterLimitLast.CompareAndSwap(channelID, last, now) {
			return
		}
	}
	gopool.Go(func() {
		if _, err := RefreshDroidChannelUsage(context.Background(), channelID); err != nil {
			logger.LogWarn(context.Background(), fmt.Sprintf("Droid post-limit usage refresh channel_id=%d: %v", channelID, err))
		}
	})
}

func runDroidUsageLifecycleOnce() {
	if !droidUsageLifecycleRunning.CompareAndSwap(false, true) {
		return
	}
	defer droidUsageLifecycleRunning.Store(false)
	var channels []model.Channel
	if err := model.DB.Select("id", "channel_info").Where("type = ?", constant.ChannelTypeDroid).Find(&channels).Error; err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("Droid usage lifecycle query failed: %v", err))
		return
	}
	for _, ch := range channels {
		if !ch.ChannelInfo.IsMultiKey {
			continue
		}
		if _, err := RefreshDroidChannelUsage(context.Background(), ch.Id); err != nil {
			logger.LogWarn(context.Background(), fmt.Sprintf("Droid usage lifecycle channel_id=%d: %v", ch.Id, err))
		}
	}
}
