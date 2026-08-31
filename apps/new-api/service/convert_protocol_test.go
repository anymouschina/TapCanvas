package service

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/openrouter"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestClaudeToOpenAIRequestUsesOpenRouterSemanticsFromProtocol(t *testing.T) {
	budget := 4096
	request, err := ClaudeToOpenAIRequest(
		dto.ClaudeRequest{
			Model: "anthropic/claude-3.7-sonnet",
			Thinking: &dto.Thinking{
				Type:         "enabled",
				BudgetTokens: &budget,
			},
		},
		&relaycommon.RelayInfo{
			OriginModelName: "anthropic/claude-3.7-sonnet-thinking",
			ChannelMeta: &relaycommon.ChannelMeta{
				ChannelType: constant.ChannelTypeCustom,
				ProtocolID:  constant.ProtocolOpenRouter,
			},
		},
	)
	if err != nil {
		t.Fatalf("convert request failed: %v", err)
	}
	if request.Model != "anthropic/claude-3.7-sonnet" {
		t.Fatalf("OpenRouter protocol unexpectedly rewrote model to %q", request.Model)
	}

	var reasoning openrouter.RequestReasoning
	if err := json.Unmarshal(request.Reasoning, &reasoning); err != nil {
		t.Fatalf("OpenRouter reasoning is invalid: %v", err)
	}
	if !reasoning.Enabled || reasoning.MaxTokens != budget {
		t.Fatalf("OpenRouter reasoning = %#v", reasoning)
	}
}

func TestClaudeToOpenAIRequestIgnoresOpenRouterChannelIdentity(t *testing.T) {
	budget := 4096
	request, err := ClaudeToOpenAIRequest(
		dto.ClaudeRequest{
			Model: "claude-3.7-sonnet",
			Thinking: &dto.Thinking{
				Type:         "enabled",
				BudgetTokens: &budget,
			},
		},
		&relaycommon.RelayInfo{
			OriginModelName: "claude-3.7-sonnet-thinking",
			ChannelMeta: &relaycommon.ChannelMeta{
				ChannelType: constant.ChannelTypeOpenRouter,
				ProtocolID:  constant.ProtocolOpenAI,
			},
		},
	)
	if err != nil {
		t.Fatalf("convert request failed: %v", err)
	}
	if request.Model != "claude-3.7-sonnet-thinking" {
		t.Fatalf("OpenAI protocol model = %q, want thinking suffix", request.Model)
	}
	if len(request.Reasoning) != 0 {
		t.Fatalf("OpenAI protocol unexpectedly emitted OpenRouter reasoning: %s", request.Reasoning)
	}
}
