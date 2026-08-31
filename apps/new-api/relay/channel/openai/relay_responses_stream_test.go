package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
)

func newResponsesStreamTestContext(t *testing.T) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	oldStreamingTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() {
		constant.StreamingTimeout = oldStreamingTimeout
	})
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	return context, recorder
}

func newResponsesStreamTestResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{
			"Content-Type": []string{"text/event-stream"},
		},
		Body: io.NopCloser(strings.NewReader(body)),
	}
}

func TestOaiResponsesStreamHandlerRequiresCompletedTerminalEvent(t *testing.T) {
	context, _ := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	response := newResponsesStreamTestResponse("data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")

	usage, relayError := OaiResponsesStreamHandler(context, info, response)

	if usage != nil {
		t.Fatalf("expected no usage for an incomplete stream, got %+v", usage)
	}
	if relayError == nil {
		t.Fatal("expected a missing response.completed event to fail")
	}
	if relayError.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected status %d, got %d", http.StatusBadGateway, relayError.StatusCode)
	}
	if !strings.Contains(relayError.Error(), "without response.completed") {
		t.Fatalf("unexpected error: %v", relayError)
	}
}

func TestOaiResponsesStreamHandlerReturnsUpstreamFailure(t *testing.T) {
	context, _ := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	response := newResponsesStreamTestResponse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"type\":\"upstream_error\",\"message\":\"vision request rejected\",\"code\":\"vision_rejected\"}}}\n\n")

	usage, relayError := OaiResponsesStreamHandler(context, info, response)

	if usage != nil {
		t.Fatalf("expected no usage for a failed stream, got %+v", usage)
	}
	if relayError == nil {
		t.Fatal("expected response.failed to fail")
	}
	if relayError.Error() != "vision request rejected" {
		t.Fatalf("unexpected error: %v", relayError)
	}
	if relayError.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected status %d, got %d", http.StatusBadGateway, relayError.StatusCode)
	}
}

func TestOaiResponsesStreamHandlerReturnsTopLevelEventError(t *testing.T) {
	context, _ := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	response := newResponsesStreamTestResponse("data: {\"type\":\"response.error\",\"error\":{\"type\":\"upstream_error\",\"message\":\"provider unavailable\",\"code\":\"provider_unavailable\"}}\n\n")

	usage, relayError := OaiResponsesStreamHandler(context, info, response)

	if usage != nil {
		t.Fatalf("expected no usage for an errored stream, got %+v", usage)
	}
	if relayError == nil || relayError.Error() != "provider unavailable" {
		t.Fatalf("expected top-level SSE error details, got %v", relayError)
	}
}

func TestOaiResponsesStreamHandlerPreservesIncompleteUsage(t *testing.T) {
	context, _ := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	response := newResponsesStreamTestResponse("data: {\"type\":\"response.incomplete\",\"response\":{\"incomplete_details\":{\"reasoning\":\"max_output_tokens\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":7,\"total_tokens\":18}}}\n\n")

	usage, relayError := OaiResponsesStreamHandler(context, info, response)

	if relayError != nil {
		t.Fatalf("expected response.incomplete to remain a billable terminal response, got %v", relayError)
	}
	if usage == nil || usage.PromptTokens != 11 || usage.CompletionTokens != 7 || usage.TotalTokens != 18 {
		t.Fatalf("unexpected incomplete usage: %+v", usage)
	}
}

func TestOaiResponsesStreamHandlerUsesCompletedUsage(t *testing.T) {
	context, _ := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	response := newResponsesStreamTestResponse("data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\n" +
		"data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":11,\"output_tokens\":7,\"total_tokens\":18}}}\n\n")

	usage, relayError := OaiResponsesStreamHandler(context, info, response)

	if relayError != nil {
		t.Fatalf("expected completed stream to succeed, got %v", relayError)
	}
	if usage == nil || usage.PromptTokens != 11 || usage.CompletionTokens != 7 || usage.TotalTokens != 18 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
}

func TestOaiResponsesAggregateStreamHandlerRejectsFailedTerminalEvent(t *testing.T) {
	context, _ := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	response := newResponsesStreamTestResponse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"type\":\"upstream_error\",\"message\":\"request rejected\",\"code\":\"request_rejected\"}}}\n\n")

	usage, relayError := OaiResponsesAggregateStreamHandler(context, info, response)

	if usage != nil {
		t.Fatalf("expected no usage for a failed aggregate stream, got %+v", usage)
	}
	if relayError == nil || relayError.Error() != "request rejected" {
		t.Fatalf("expected aggregate failure details, got %v", relayError)
	}
}

func TestOaiResponsesAggregateStreamHandlerPreservesIncompleteResponse(t *testing.T) {
	context, recorder := newResponsesStreamTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-5.6-luna"}}
	response := newResponsesStreamTestResponse("data: {\"type\":\"response.incomplete\",\"response\":{\"id\":\"resp_partial\",\"status\":\"incomplete\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2,\"total_tokens\":7}}}\n\n")

	usage, relayError := OaiResponsesAggregateStreamHandler(context, info, response)

	if relayError != nil {
		t.Fatalf("expected incomplete aggregate response to be returned, got %v", relayError)
	}
	if usage == nil || usage.TotalTokens != 7 {
		t.Fatalf("unexpected aggregate usage: %+v", usage)
	}
	if !strings.Contains(recorder.Body.String(), "resp_partial") || !strings.Contains(recorder.Body.String(), "incomplete") {
		t.Fatalf("incomplete response body was not preserved: %s", recorder.Body.String())
	}
}
