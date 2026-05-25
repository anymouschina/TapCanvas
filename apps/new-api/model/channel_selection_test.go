package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func uintPtrForTest(value uint) *uint {
	return &value
}

func int64PtrForTest(value int64) *int64 {
	return &value
}

func TestGetRandomSatisfiedChannelKeepsExplicitAliasStrict(t *testing.T) {
	previousMemoryCacheEnabled := common.MemoryCacheEnabled
	previousGroup2Model2Channels := group2model2channels
	previousChannelsIDM := channelsIDM
	t.Cleanup(func() {
		common.MemoryCacheEnabled = previousMemoryCacheEnabled
		group2model2channels = previousGroup2Model2Channels
		channelsIDM = previousChannelsIDM
	})

	common.MemoryCacheEnabled = true
	channelsIDM = map[int]*Channel{
		45: &Channel{Id: 45, Priority: int64PtrForTest(10), Weight: uintPtrForTest(100)},
		9:  &Channel{Id: 9, Priority: int64PtrForTest(1), Weight: uintPtrForTest(100)},
	}
	group2model2channels = map[string]map[string][]int{
		"default": {
			"gpt-image-2":     {45},
			"gpt-image-2-all": {9},
		},
	}

	channel, err := GetRandomSatisfiedChannel("default", "gpt-image-2-all", 0, nil)
	if err != nil {
		t.Fatalf("GetRandomSatisfiedChannel returned error: %v", err)
	}
	if channel == nil || channel.Id != 9 {
		t.Fatalf("GetRandomSatisfiedChannel(gpt-image-2-all) channel = %#v, want channel 9", channel)
	}
}

func TestGetRandomSatisfiedChannelExpandsCanonicalModel(t *testing.T) {
	previousMemoryCacheEnabled := common.MemoryCacheEnabled
	previousGroup2Model2Channels := group2model2channels
	previousChannelsIDM := channelsIDM
	t.Cleanup(func() {
		common.MemoryCacheEnabled = previousMemoryCacheEnabled
		group2model2channels = previousGroup2Model2Channels
		channelsIDM = previousChannelsIDM
	})

	common.MemoryCacheEnabled = true
	channelsIDM = map[int]*Channel{
		45: &Channel{Id: 45, Priority: int64PtrForTest(10), Weight: uintPtrForTest(100)},
		9:  &Channel{Id: 9, Priority: int64PtrForTest(1), Weight: uintPtrForTest(100)},
	}
	group2model2channels = map[string]map[string][]int{
		"default": {
			"gpt-image-2-all": {9},
			"gpt-image-2-vip": {45},
		},
	}

	channel, err := GetRandomSatisfiedChannel("default", "gpt-image-2", 0, nil)
	if err != nil {
		t.Fatalf("GetRandomSatisfiedChannel returned error: %v", err)
	}
	if channel == nil || channel.Id != 45 {
		t.Fatalf("GetRandomSatisfiedChannel(gpt-image-2) channel = %#v, want channel 45", channel)
	}
}
