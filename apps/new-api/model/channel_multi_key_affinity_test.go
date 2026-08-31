package model

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
)

func TestGetNextEnabledKeyWithPreference(t *testing.T) {
	channel := &Channel{
		Id:  91001,
		Key: "account-a\naccount-b\naccount-c",
		ChannelInfo: ChannelInfo{
			IsMultiKey:         true,
			MultiKeyMode:       constant.MultiKeyModeRandom,
			MultiKeyStatusList: map[int]int{1: 1},
		},
	}
	key, index, apiErr := channel.GetNextEnabledKeyWithPreference(nil, 1)
	if apiErr != nil || key != "account-b" || index != 1 {
		t.Fatalf("preferred result = %q/%d/%v", key, index, apiErr)
	}

	key, index, apiErr = channel.GetNextEnabledKeyWithPreference(map[int]bool{1: true}, 1)
	if apiErr != nil {
		t.Fatalf("failover error = %v", apiErr)
	}
	if index == 1 || key == "account-b" {
		t.Fatalf("excluded preferred account selected: %q/%d", key, index)
	}
}
