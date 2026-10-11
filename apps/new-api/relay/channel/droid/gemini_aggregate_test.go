package droid

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/require"
)

func TestGeminiDoRequestPreservesClientStreamIntent(t *testing.T) {
	service.InitHttpClient()
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream_%t", stream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "/api/llm/g/v1/generate", r.URL.Path)
				require.Empty(t, r.URL.RawQuery)
				var body struct {
					Model  string `json:"model"`
					Stream *bool  `json:"stream"`
				}
				require.NoError(t, common.DecodeJson(r.Body, &body))
				require.Equal(t, "gemini-3.8-flash", body.Model)
				require.Nil(t, body.Stream)
				w.Header().Set("Content-Type", "text/event-stream")
				_, err := io.WriteString(w, "data: "+`{"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":7,"totalTokenCount":19}}`+"\n\n")
				require.NoError(t, err)
			}))
			defer server.Close()
			info := testInfo(constant.ProtocolDroidGemini)
			info.ChannelBaseUrl = server.URL
			info.UpstreamModelName = "gemini-3.8-flash"
			info.IsStream = stream
			converted, err := NewAdaptor(constant.ProtocolDroidGemini).ConvertGeminiRequest(testContext(), info, &dto.GeminiChatRequest{})
			require.NoError(t, err)
			body, err := common.Marshal(converted)
			require.NoError(t, err)
			result, err := NewAdaptor(constant.ProtocolDroidGemini).DoRequest(testContext(), info, strings.NewReader(string(body)))
			require.NoError(t, err)
			response := result.(*http.Response)
			defer response.Body.Close()
			require.Equal(t, stream, info.IsStream)
			if stream {
				require.Equal(t, "text/event-stream", response.Header.Get("Content-Type"))
			} else {
				require.Equal(t, "application/json", response.Header.Get("Content-Type"))
				var parsed dto.GeminiChatResponse
				require.NoError(t, common.DecodeJson(response.Body, &parsed))
				require.Equal(t, "OK", parsed.Candidates[0].Content.Parts[0].Text)
				require.Equal(t, 19, parsed.UsageMetadata.TotalTokenCount)
			}
		})
	}
}

func geminiFixtureResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}
}

func TestGeminiAggregateRetainsTextToolsSignaturesAndFinalUsage(t *testing.T) {
	body := "data: " + `{"responseId":"real_fixture_id","modelVersion":"gemini-3.8-flash","candidates":[{"index":0,"content":{"role":"model","parts":[{"text":"Hello "}]}}]}` + "\n\n" +
		"data: " + `{"candidates":[{"index":0,"content":{"role":"model","parts":[{"text":"world"},{"functionCall":{"name":"read","args":{"file":"a"}},"thoughtSignature":"b3BhcXVlLWZpeHR1cmU=","futurePartField":{"keep":true}}]},"finishReason":"STOP","futureCandidateField":"keep"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":7,"thoughtsTokenCount":3,"totalTokenCount":22}}` + "\n\n"
	response, err := aggregateGeminiStream(geminiFixtureResponse(body))
	require.NoError(t, err)
	require.Equal(t, "application/json", response.Header.Get("Content-Type"))
	data, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	var parsed dto.GeminiChatResponse
	require.NoError(t, common.Unmarshal(data, &parsed))
	require.Len(t, parsed.Candidates, 1)
	require.Len(t, parsed.Candidates[0].Content.Parts, 3)
	require.Equal(t, "Hello ", parsed.Candidates[0].Content.Parts[0].Text)
	require.Equal(t, "world", parsed.Candidates[0].Content.Parts[1].Text)
	require.Equal(t, "read", parsed.Candidates[0].Content.Parts[2].FunctionCall.FunctionName)
	require.Equal(t, `"b3BhcXVlLWZpeHR1cmU="`, string(parsed.Candidates[0].Content.Parts[2].ThoughtSignature))
	require.Equal(t, 3, parsed.UsageMetadata.ThoughtsTokenCount)
	require.Equal(t, 22, parsed.UsageMetadata.TotalTokenCount)
	require.Contains(t, string(data), `"futurePartField":{"keep":true}`)
	require.Contains(t, string(data), `"futureCandidateField":"keep"`)
}

func TestGeminiAggregateRejectsTruncationMalformedFramesAndUpstreamError(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"truncated", `data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}` + "\n\n", "without finishReason"},
		{"malformed", "data: {broken}\n\n", "invalid Gemini SSE JSON"},
		{"upstream_failure", `data: {"error":{"code":429,"message":"quota exceeded"}}` + "\n\n", "quota exceeded"},
		{"empty", "data: [DONE]\n\n", "no completed candidates"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response, err := aggregateGeminiStream(geminiFixtureResponse(tc.body))
			require.Nil(t, response)
			require.ErrorContains(t, err, tc.want)
		})
	}
}

func TestGeminiAggregateSignedToolCallReplaysWithoutEmptyTerminalParts(t *testing.T) {
	const signedCall = `{"functionCall":{"name":"ReadFixture","args":{},"id":"call_49031"},"thoughtSignature":"b3BhcXVlLXNpZ25hdHVyZQ=="}`
	body := "data: " + `{"candidates":[{"content":{"role":"model","parts":[` + signedCall + `]}}]}` + "\n\n" +
		"data: " + `{"candidates":[{"content":{"role":"model","parts":[{"text":""},{}]},"finishReason":"STOP"}]}` + "\n\n"
	response, err := aggregateGeminiStream(geminiFixtureResponse(body))
	require.NoError(t, err)
	defer response.Body.Close()
	var parsed dto.GeminiChatResponse
	require.NoError(t, common.DecodeJson(response.Body, &parsed))
	require.Len(t, parsed.Candidates[0].Content.Parts, 1)
	var fixtureResponse dto.GeminiFunctionResponse
	require.NoError(t, common.Unmarshal([]byte(`{"name":"ReadFixture","id":"call_49031","response":{"result":"fixture nonce"}}`), &fixtureResponse))
	request := &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{
		parsed.Candidates[0].Content,
		{Role: "user", Parts: []dto.GeminiPart{{FunctionResponse: &fixtureResponse}}},
	}}
	converted, err := NewAdaptor(constant.ProtocolDroidGemini).ConvertGeminiRequest(testContext(), testInfo(constant.ProtocolDroidGemini), request)
	require.NoError(t, err)
	replayed, err := common.Marshal(converted.(*GeminiRequest).Contents[0].Parts)
	require.NoError(t, err)
	require.JSONEq(t, "["+signedCall+"]", string(replayed))
}

func TestGeminiAggregatePreservesEmptyTextWithMetadataAndUnknownParts(t *testing.T) {
	const parts = `[{"text":"","thoughtSignature":"signed-empty-text"},{"text":"","futurePartField":{"keep":true}},{"futurePartField":{"keep":true}},{"text":" "}]`
	body := "data: " + `{"candidates":[{"content":{"role":"model","parts":` + parts + `},"finishReason":"STOP"}]}` + "\n\n"
	response, err := aggregateGeminiStream(geminiFixtureResponse(body))
	require.NoError(t, err)
	defer response.Body.Close()
	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts json.RawMessage `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	require.NoError(t, common.DecodeJson(response.Body, &parsed))
	require.JSONEq(t, parts, string(parsed.Candidates[0].Content.Parts))
}

func TestGeminiAggregateRejectsMalformedPartShapes(t *testing.T) {
	for _, part := range []string{`null`, `[]`, `"text"`, `42`, `{"text":null}`, `{"text":false}`, `{"text":0,"thoughtSignature":"signed"}`} {
		t.Run(part, func(t *testing.T) {
			body := "data: " + `{"candidates":[{"content":{"parts":[` + part + `]},"finishReason":"STOP"}]}` + "\n\n"
			response, err := aggregateGeminiStream(geminiFixtureResponse(body))
			require.Nil(t, response)
			require.ErrorContains(t, err, "invalid Gemini content part")
		})
	}
}
