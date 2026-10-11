package droid

import (
	"encoding/json"
	"github.com/QuantumNous/new-api/types"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func testInfo(protocol string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.factory.ai", ApiKey: "test-factory-key", ProtocolID: protocol, ProtocolOptions: map[string]string{}, UpstreamModelName: "explicit-model-id"},
		RelayMode:   relayconstant.RelayModeChatCompletions,
	}
}
func testContext() *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	return c
}
func TestExplicitWireProtocolsIgnoreModelNames(t *testing.T) {
	for _, tc := range []struct{ protocol, path, provider string }{
		{constant.ProtocolDroidAnthropic, "/api/llm/a/v1/messages", "anthropic"},
		{constant.ProtocolDroidResponses, "/api/llm/o/v1/responses", "openai"},
		{constant.ProtocolDroidChat, "/api/llm/o/v1/chat/completions", "fireworks"},
		{constant.ProtocolDroidGemini, "/api/llm/g/v1/generate", "google"},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			a := NewAdaptor(tc.protocol)
			info := testInfo(tc.protocol)
			url, err := a.GetRequestURL(info)
			require.NoError(t, err)
			require.Equal(t, "https://api.factory.ai"+tc.path, url)
			header := http.Header{}
			require.NoError(t, a.SetupRequestHeader(testContext(), &header, info))
			require.Equal(t, "Bearer test-factory-key", header.Get("Authorization"))
			require.Equal(t, tc.provider, header.Get("x-api-provider"))
			require.Equal(t, tc.protocol == constant.ProtocolDroidResponses, a.RequiresResponsesForChat("arbitrary-model"))
			require.Empty(t, a.GetModelList())
		})
	}
}
func TestClaudePreamblePreservesCallerDataAndExplicitZero(t *testing.T) {
	for _, source := range []string{
		`{"model":"exact-model","system":"caller instructions","metadata":{"user_id":"caller"},"tools":[{"name":"read","input_schema":{"type":"object"}}],"temperature":0,"stream":false}`,
		`{"model":"exact-model","system":[{"type":"text","text":"caller instructions","cache_control":{"type":"ephemeral"}}],"metadata":{"user_id":"caller"},"temperature":0,"stream":false}`,
	} {
		var request dto.ClaudeRequest
		require.NoError(t, common.Unmarshal([]byte(source), &request))
		body, err := NewAdaptor(constant.ProtocolDroidAnthropic).ConvertClaudeRequest(testContext(), testInfo(constant.ProtocolDroidAnthropic), &request)
		require.NoError(t, err)
		raw, err := common.Marshal(body)
		require.NoError(t, err)
		var result struct {
			Model  string `json:"model"`
			System []struct {
				Text  string          `json:"text"`
				Cache json.RawMessage `json:"cache_control"`
			} `json:"system"`
			Temperature *float64        `json:"temperature"`
			Stream      *bool           `json:"stream"`
			Metadata    json.RawMessage `json:"metadata"`
		}
		require.NoError(t, common.Unmarshal(raw, &result))
		require.Equal(t, "exact-model", result.Model)
		require.Len(t, result.System, 2)
		require.Equal(t, DroidLine, result.System[0].Text)
		require.Equal(t, "caller instructions", result.System[1].Text)
		require.NotNil(t, result.Temperature)
		require.Zero(t, *result.Temperature)
		require.NotNil(t, result.Stream)
		require.False(t, *result.Stream)
		require.JSONEq(t, `{"user_id":"caller"}`, string(result.Metadata))
	}
}
func TestRequestsPreserveExplicitModelAndReasoningSettings(t *testing.T) {
	a := NewAdaptor(constant.ProtocolDroidResponses)
	info := testInfo(a.ProtocolID)
	request := dto.OpenAIResponsesRequest{Model: "caller-exact-model", Instructions: json.RawMessage(`"caller instructions"`), Reasoning: &dto.Reasoning{Effort: "max"}, Store: json.RawMessage("true")}
	converted, err := a.ConvertOpenAIResponsesRequest(testContext(), info, request)
	require.NoError(t, err)
	body, ok := converted.(dto.OpenAIResponsesRequest)
	require.True(t, ok)
	require.Equal(t, request.Model, body.Model)
	require.Equal(t, "max", body.Reasoning.Effort)
	require.Equal(t, "true", string(body.Store))
	var instructions string
	require.NoError(t, common.Unmarshal(body.Instructions, &instructions))
	require.Equal(t, DroidPrompt+"caller instructions", instructions)
	require.Equal(t, `"caller instructions"`, string(request.Instructions))
	chat := dto.GeneralOpenAIRequest{Model: "arbitrary-model", ReasoningEffort: "max", Messages: []dto.Message{{Role: "system", Content: []json.RawMessage{json.RawMessage(`{"type":"text","text":"caller","cache_control":{"type":"ephemeral"}}`)}}}}
	result, err := NewAdaptor(constant.ProtocolDroidChat).ConvertOpenAIRequest(testContext(), testInfo(constant.ProtocolDroidChat), &chat)
	require.NoError(t, err)
	raw, err := common.Marshal(result)
	require.NoError(t, err)
	require.Contains(t, string(raw), `"cache_control":{"type":"ephemeral"}`)
	require.Contains(t, string(raw), `"reasoning_effort":"max"`)
	require.Contains(t, string(raw), DroidLine)
}
func TestInvalidChannelContractFails(t *testing.T) {
	a := NewAdaptor(constant.ProtocolDroidChat)
	info := testInfo(a.ProtocolID)
	info.ChannelBaseUrl = "https://api.factory.ai/path"
	_, err := a.GetRequestURL(info)
	require.Error(t, err)
	info.ChannelBaseUrl = "https://api.factory.ai"
	info.RelayMode = relayconstant.RelayModeResponses
	_, err = a.GetRequestURL(info)
	require.Error(t, err)
	info.ApiKey = ""
	headers := http.Header{}
	require.Error(t, a.SetupRequestHeader(testContext(), &headers, info))
	info.ApiKey = "test"
	info.ProtocolOptions["fast"] = "invalid"
	require.Error(t, a.SetupRequestHeader(testContext(), &headers, info))
}

func TestAcceptedResponseParseFailureDoesNotRetryGeneration(t *testing.T) {
	for _, protocol := range []string{constant.ProtocolDroidAnthropic, constant.ProtocolDroidResponses, constant.ProtocolDroidChat, constant.ProtocolDroidGemini} {
		t.Run(protocol, func(t *testing.T) {
			info := testInfo(protocol)
			if protocol == constant.ProtocolDroidResponses {
				info.RelayMode = relayconstant.RelayModeResponses
			}
			response := &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader("invalid-json"))}
			_, err := NewAdaptor(protocol).DoResponse(testContext(), response, info)
			require.NotNil(t, err)
			require.Equal(t, http.StatusOK, err.UpstreamStatusCode)
			require.True(t, types.IsSkipRetryError(err))
			require.NotNil(t, err.Unwrap())
		})
	}
}
