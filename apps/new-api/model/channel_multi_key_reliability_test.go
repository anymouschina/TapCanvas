package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestMultiKeyReceiptUsesCredentialAfterReindex(t *testing.T) {
	channel := &Channel{Key: "account-b\naccount-c", Status: common.ChannelStatusEnabled,
		ChannelInfo: ChannelInfo{IsMultiKey: true, MultiKeySize: 2}}
	previousIndex := 1
	require.True(t, handlerMultiKeyUpdateWithIndex(channel, "account-b", &previousIndex, common.ChannelStatusAutoDisabled, "auth rejected"))
	require.Equal(t, common.ChannelStatusAutoDisabled, channel.ChannelInfo.MultiKeyStatusList[0])
	require.NotContains(t, channel.ChannelInfo.MultiKeyStatusList, 1)
	require.Equal(t, common.ChannelStatusEnabled, channel.Status)
	// The failed credential was removed; a surviving account at its old index
	// must never inherit that failure.
	require.False(t, handlerMultiKeyUpdateWithIndex(channel, "account-a", &previousIndex, common.ChannelStatusAutoDisabled, "stale receipt"))
	require.NotContains(t, channel.ChannelInfo.MultiKeyStatusList, 1)
}

func TestMultiKeyReceiptDoesNotDisableRefreshedCredential(t *testing.T) {
	channel := &Channel{Key: "new-credential", Status: common.ChannelStatusEnabled,
		ChannelInfo: ChannelInfo{IsMultiKey: true, MultiKeySize: 1}}
	index := 0
	require.False(t, handlerMultiKeyUpdateWithIndex(channel, "old-credential", &index, common.ChannelStatusAutoDisabled, "expired request"))
	require.Empty(t, channel.ChannelInfo.MultiKeyStatusList)
	require.Equal(t, common.ChannelStatusEnabled, channel.Status)
}

func TestMultiKeyReceiptPreservesManualChannelDisableAndEnabledSibling(t *testing.T) {
	for _, channelStatus := range []int{common.ChannelStatusEnabled, common.ChannelStatusManuallyDisabled} {
		channel := &Channel{Key: "account-a\naccount-b", Status: channelStatus,
			ChannelInfo: ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyStatusList: map[int]int{1: common.ChannelStatusEnabled}}}
		index := 0
		require.True(t, handlerMultiKeyUpdateWithIndex(channel, "account-a", &index, common.ChannelStatusAutoDisabled, "rejected"))
		require.Equal(t, channelStatus, channel.Status)
	}
}

func TestRestoreAutoDisabledMultiKeyRequiresEnabledAccount(t *testing.T) {
	for _, test := range []struct {
		name      string
		status    int
		keys      string
		keyStatus map[int]int
		restored  bool
	}{
		{"automatic", common.ChannelStatusAutoDisabled, "account-a", nil, true},
		{"manual", common.ChannelStatusManuallyDisabled, "account-a", nil, false},
		{"all-disabled", common.ChannelStatusAutoDisabled, "account-a", map[int]int{0: common.ChannelStatusAutoDisabled}, false},
		{"empty", common.ChannelStatusAutoDisabled, "", nil, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			channel := &Channel{Key: test.keys, Status: test.status, OtherInfo: `{"status_reason":"all disabled","other":"preserved"}`,
				ChannelInfo: ChannelInfo{IsMultiKey: true, MultiKeyStatusList: test.keyStatus}}
			require.Equal(t, test.restored, channel.RestoreAutoDisabledMultiKey())
			if test.restored {
				require.Equal(t, common.ChannelStatusEnabled, channel.Status)
				require.NotContains(t, channel.GetOtherInfo(), "status_reason")
				require.Equal(t, "preserved", channel.GetOtherInfo()["other"])
			} else {
				require.Equal(t, test.status, channel.Status)
			}
		})
	}
}

func TestRetainMultiKeysReindexesEveryAccountField(t *testing.T) {
	channel := &Channel{Key: "account-a\naccount-b\naccount-c", Keys: []string{"account-a", "account-b", "account-c"},
		ChannelInfo: ChannelInfo{
			IsMultiKey: true, MultiKeySize: 3, MultiKeyPollingIndex: 2,
			MultiKeyStatusList:     map[int]int{0: 3, 1: 2},
			MultiKeyDisabledReason: map[int]string{1: "manual"},
			MultiKeyDisabledTime:   map[int]int64{1: 123},
			MultiKeyCooldownUntil:  map[int]int64{2: 456},
			MultiKeyUsage:          map[int]ChannelKeyUsage{0: {PlanType: "a"}, 1: {PlanType: "b"}, 2: {PlanType: "c"}},
			MultiKeyEmail:          map[int]string{0: "a@example.com", 1: "b@example.com", 2: "c@example.com"},
		}}
	channel.RetainMultiKeys([]int{1, 2})
	require.Equal(t, []string{"account-b", "account-c"}, channel.GetKeys())
	require.Equal(t, 2, channel.ChannelInfo.MultiKeySize)
	require.Equal(t, 0, channel.ChannelInfo.MultiKeyPollingIndex)
	require.Equal(t, map[int]int{0: 2}, channel.ChannelInfo.MultiKeyStatusList)
	require.Equal(t, map[int]string{0: "manual"}, channel.ChannelInfo.MultiKeyDisabledReason)
	require.Equal(t, map[int]int64{0: 123}, channel.ChannelInfo.MultiKeyDisabledTime)
	require.Equal(t, map[int]int64{1: 456}, channel.ChannelInfo.MultiKeyCooldownUntil)
	require.Equal(t, "b", channel.ChannelInfo.MultiKeyUsage[0].PlanType)
	require.Equal(t, "c", channel.ChannelInfo.MultiKeyUsage[1].PlanType)
	require.Len(t, channel.ChannelInfo.MultiKeyUsage, 2)
	require.Equal(t, map[int]string{0: "b@example.com", 1: "c@example.com"}, channel.ChannelInfo.MultiKeyEmail)
}

func TestReconcileMultiKeyMetadataPreservesCredentialIdentity(t *testing.T) {
	channel := &Channel{Key: "account-c\nnew-account\naccount-b", ChannelInfo: ChannelInfo{
		IsMultiKey: true, MultiKeySize: 3, MultiKeyPollingIndex: 2,
		MultiKeyStatusList:     map[int]int{0: 3, 1: 2},
		MultiKeyDisabledReason: map[int]string{1: "manual"},
		MultiKeyDisabledTime:   map[int]int64{1: 123},
		MultiKeyCooldownUntil:  map[int]int64{2: 456},
		MultiKeyUsage:          map[int]ChannelKeyUsage{0: {PlanType: "a"}, 1: {PlanType: "b"}, 2: {PlanType: "c"}},
		MultiKeyEmail:          map[int]string{0: "a@example.com", 1: "b@example.com", 2: "c@example.com"},
	}}
	channel.ReconcileMultiKeyMetadata([]string{"account-a", "account-b", "account-c"})
	require.Equal(t, "c", channel.ChannelInfo.MultiKeyUsage[0].PlanType)
	require.Equal(t, "b", channel.ChannelInfo.MultiKeyUsage[2].PlanType)
	_, exists := channel.ChannelInfo.MultiKeyUsage[1]
	require.False(t, exists)
	require.Equal(t, map[int]string{0: "c@example.com", 2: "b@example.com"}, channel.ChannelInfo.MultiKeyEmail)
	require.Equal(t, map[int]int{2: 2}, channel.ChannelInfo.MultiKeyStatusList)
	require.Equal(t, map[int]string{2: "manual"}, channel.ChannelInfo.MultiKeyDisabledReason)
	require.Equal(t, map[int]int64{2: 123}, channel.ChannelInfo.MultiKeyDisabledTime)
	require.Equal(t, map[int]int64{0: 456}, channel.ChannelInfo.MultiKeyCooldownUntil)
	require.Equal(t, 0, channel.ChannelInfo.MultiKeyPollingIndex)
}

func TestMultiKeyReceiptResolvesCredentialWhenPreviousIndexIsOutOfRange(t *testing.T) {
	channel := &Channel{Key: "account-c", Status: common.ChannelStatusEnabled, ChannelInfo: ChannelInfo{IsMultiKey: true, MultiKeySize: 1}}
	previousIndex := 2
	require.True(t, handlerMultiKeyUpdateWithIndex(channel, "account-c", &previousIndex, common.ChannelStatusAutoDisabled, "rejected"))
	require.Equal(t, common.ChannelStatusAutoDisabled, channel.ChannelInfo.MultiKeyStatusList[0])
	require.False(t, handlerMultiKeyUpdateWithIndex(channel, "removed-account", &previousIndex, common.ChannelStatusAutoDisabled, "stale receipt"))
}
