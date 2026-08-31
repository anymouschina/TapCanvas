package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

func TestChannelForExactKeyTest(t *testing.T) {
	original := &model.Channel{
		Id:  42,
		Key: "account-a\naccount-b",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:         true,
			MultiKeyStatusList: map[int]int{0: common.ChannelStatusEnabled, 1: common.ChannelStatusEnabled},
		},
	}

	selected, err := channelForExactKeyTest(original, 1)
	if err != nil {
		t.Fatalf("select exact key: %v", err)
	}
	if selected.Key != "account-b" {
		t.Fatalf("selected key = %q, want account-b", selected.Key)
	}
	if selected.ChannelInfo.IsMultiKey {
		t.Fatal("selected test channel must disable multi-key routing")
	}
	if !original.ChannelInfo.IsMultiKey || original.Key != "account-a\naccount-b" {
		t.Fatal("selecting a test account mutated the original channel")
	}
}

func TestChannelForExactKeyTestRejectsDisabledAndOutOfRange(t *testing.T) {
	channel := &model.Channel{
		Key: "account-a",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:         true,
			MultiKeyStatusList: map[int]int{0: common.ChannelStatusManuallyDisabled},
		},
	}
	if _, err := channelForExactKeyTest(channel, 0); err == nil {
		t.Fatal("disabled account must fail explicitly")
	}
	if _, err := channelForExactKeyTest(channel, 1); err == nil {
		t.Fatal("out-of-range account must fail explicitly")
	}
}

func TestBuildTestRequestUsesProvidedPrompt(t *testing.T) {
	request := buildTestRequest("gpt-4o-mini", "", &model.Channel{}, false, "指定账号测试")
	chatRequest, ok := request.(*dto.GeneralOpenAIRequest)
	if !ok {
		t.Fatalf("request type = %T, want *dto.GeneralOpenAIRequest", request)
	}
	if len(chatRequest.Messages) != 1 || chatRequest.Messages[0].Content != "指定账号测试" {
		t.Fatalf("messages = %#v", chatRequest.Messages)
	}
}
