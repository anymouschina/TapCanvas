package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestHandlerMultiKeyUpdateWithIndexDoesNotFallbackToFirstKey(t *testing.T) {
	channel := &Channel{
		Id:  91002,
		Key: "account-a\naccount-b",
		ChannelInfo: ChannelInfo{
			IsMultiKey:         true,
			MultiKeySize:       2,
			MultiKeyStatusList: make(map[int]int),
		},
	}

	if updated := handlerMultiKeyUpdateWithIndex(channel, "stale-account", nil, common.ChannelStatusAutoDisabled, "upstream error"); updated {
		t.Fatal("expected an unknown raw key to leave channel state unchanged")
	}
	if len(channel.ChannelInfo.MultiKeyStatusList) != 0 {
		t.Fatalf("unexpected status update for unknown raw key: %#v", channel.ChannelInfo.MultiKeyStatusList)
	}

	invalidIndex := 99
	if updated := handlerMultiKeyUpdateWithIndex(channel, "account-a", &invalidIndex, common.ChannelStatusAutoDisabled, "stale index"); updated {
		t.Fatal("expected an invalid explicit index to leave channel state unchanged")
	}
	if len(channel.ChannelInfo.MultiKeyStatusList) != 0 {
		t.Fatalf("invalid explicit index fell back to raw key: %#v", channel.ChannelInfo.MultiKeyStatusList)
	}

	selectedIndex := 1
	if updated := handlerMultiKeyUpdateWithIndex(channel, "refreshed-account-b", &selectedIndex, common.ChannelStatusAutoDisabled, "account b failed"); !updated {
		t.Fatal("expected the explicit account index to be updated")
	}
	if got := channel.ChannelInfo.MultiKeyStatusList[selectedIndex]; got != common.ChannelStatusAutoDisabled {
		t.Fatalf("account %d status = %d, want auto-disabled", selectedIndex, got)
	}
	if _, exists := channel.ChannelInfo.MultiKeyStatusList[0]; exists {
		t.Fatalf("account 0 was updated unexpectedly: %#v", channel.ChannelInfo.MultiKeyStatusList)
	}
}
