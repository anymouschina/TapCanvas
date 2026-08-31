package deepseek

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestGetRequestURLUsesNativeResponsesEndpoint(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl: "https://api.deepseek.com/",
		},
		RelayMode:   relayconstant.RelayModeResponses,
		RelayFormat: types.RelayFormatOpenAIResponses,
	}

	url, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://api.deepseek.com/responses", url)
}

func TestConvertOpenAIResponsesRequestPreservesServerTools(t *testing.T) {
	adaptor := &Adaptor{}
	tools := json.RawMessage(`[
		{"type":"function","name":"read_canvas","parameters":{"type":"object"}},
		{"type":"web_search"}
	]`)
	input := json.RawMessage(`[{"type":"message","role":"user","content":[{"type":"input_text","text":"搜索最新资料"}]}]`)
	request := dto.OpenAIResponsesRequest{
		Model: "deepseek-v4-flash",
		Input: input,
		Tools: tools,
	}

	converted, err := adaptor.ConvertOpenAIResponsesRequest(nil, nil, request)
	require.NoError(t, err)
	native, ok := converted.(dto.OpenAIResponsesRequest)
	require.True(t, ok)
	require.JSONEq(t, string(tools), string(native.Tools))
	require.JSONEq(t, string(input), string(native.Input))
	require.Equal(t, "disabled", native.Thinking.Type)
}

func TestConvertOpenAIResponsesRequestDisablesThinkingBeforeForcedToolChoice(t *testing.T) {
	adaptor := &Adaptor{}
	request := dto.OpenAIResponsesRequest{
		Model:      "deepseek-v4-flash",
		ToolChoice: json.RawMessage(`"required"`),
	}

	converted, err := adaptor.ConvertOpenAIResponsesRequest(nil, nil, request)
	require.NoError(t, err)
	native := converted.(dto.OpenAIResponsesRequest)
	require.Equal(t, "disabled", native.Thinking.Type)
	require.JSONEq(t, `"required"`, string(native.ToolChoice))
}

func TestConvertOpenAIResponsesRequestRejectsExplicitThinkingWithForcedToolChoice(t *testing.T) {
	adaptor := &Adaptor{}
	request := dto.OpenAIResponsesRequest{
		Model:      "deepseek-v4-flash",
		Thinking:   &dto.ThinkingConfig{Type: "enabled"},
		ToolChoice: json.RawMessage(`"required"`),
	}

	_, err := adaptor.ConvertOpenAIResponsesRequest(nil, nil, request)
	require.EqualError(t, err, "deepseek responses: thinking mode cannot be combined with a forced tool_choice")
}
