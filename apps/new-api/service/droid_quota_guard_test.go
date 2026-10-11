package service

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func droidWindow(scope, window string, used float64, reset *int64) model.ChannelQuotaWindow {
	return model.ChannelQuotaWindow{Scope: scope, Window: window, UsedPercent: &used, ResetAt: reset}
}

func ptr64(v int64) *int64 { return &v }

// Account 1 of channel #329 on 2026-10-08: standard weekly spent, core idle.
func spentStandardUsage(now int64) model.ChannelKeyUsage {
	allowed, balance := true, int64(0)
	return model.ChannelKeyUsage{
		QuotaSource: DroidQuotaSource, QuotaWindowsCheckedAt: now,
		ExtraUsageAllowed: &allowed, ExtraUsageBalanceCents: &balance,
		QuotaWindows: []model.ChannelQuotaWindow{
			droidWindow("core", "weekly", 1, ptr64(now+7*86400)),
			droidWindow("standard", "fiveHour", 0, nil),
			droidWindow("standard", "monthly", 51, ptr64(now+28*86400)),
			droidWindow("standard", "weekly", 100, ptr64(now+4*86400)),
		},
	}
}

func TestDroidScopeFollowsWireProtocol(t *testing.T) {
	require.Equal(t, DroidScopeCore, DroidQuotaScope(constant.ProtocolDroidChat))
	for _, protocol := range []string{constant.ProtocolDroidAnthropic, constant.ProtocolDroidResponses, constant.ProtocolDroidGemini} {
		require.Equal(t, DroidScopeStandard, DroidQuotaScope(protocol))
	}
}

func TestDroidSpentScopeBlocksUntilReset(t *testing.T) {
	const now = int64(1_791_465_000)
	usage := spentStandardUsage(now)
	until, blocked := droidScopeBlockedUntil(usage, DroidScopeStandard, now)
	require.True(t, blocked)
	require.Equal(t, now+4*86400, until)
	_, blocked = droidScopeBlockedUntil(usage, DroidScopeCore, now)
	require.False(t, blocked, "core models keep using the account")
	_, blocked = droidScopeBlockedUntil(usage, DroidScopeStandard, until)
	require.False(t, blocked, "the account comes back at the window reset")

	balance := int64(500)
	usage.ExtraUsageBalanceCents = &balance
	_, blocked = droidScopeBlockedUntil(usage, DroidScopeStandard, now)
	require.False(t, blocked, "a funded extra-usage balance keeps serving")
}

func TestDroidSpentWindowWithoutResetIsRecheckedNextInterval(t *testing.T) {
	const now = int64(1_791_465_000)
	usage := model.ChannelKeyUsage{QuotaSource: DroidQuotaSource, QuotaWindowsCheckedAt: now,
		QuotaWindows: []model.ChannelQuotaWindow{droidWindow("standard", "fiveHour", 100, nil)}}
	until, blocked := droidScopeBlockedUntil(usage, DroidScopeStandard, now)
	require.True(t, blocked)
	require.Equal(t, now+droidQuotaUnknownResetRetry, until)
}

func TestDroidSpentKeysOnlyForDroidMultiKey(t *testing.T) {
	const now = int64(1_791_465_000)
	healthy := spentStandardUsage(now)
	healthy.QuotaWindows[3] = droidWindow("standard", "weekly", 35, ptr64(now+86400))
	channel := &model.Channel{Type: constant.ChannelTypeDroid, ChannelInfo: model.ChannelInfo{
		IsMultiKey: true, MultiKeySize: 2,
		MultiKeyUsage: map[int]model.ChannelKeyUsage{0: spentStandardUsage(now), 1: healthy},
	}}
	spent, scope, until := DroidSpentKeys(channel, constant.ProtocolDroidAnthropic, now)
	require.Equal(t, map[int]bool{0: true}, spent)
	require.Equal(t, DroidScopeStandard, scope)
	require.Equal(t, now+4*86400, until)

	spent, _, _ = DroidSpentKeys(channel, constant.ProtocolDroidChat, now)
	require.Empty(t, spent)

	channel.Type = constant.ChannelTypeCodex
	spent, _, _ = DroidSpentKeys(channel, constant.ProtocolDroidAnthropic, now)
	require.Empty(t, spent)
}
