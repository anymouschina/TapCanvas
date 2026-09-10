package openai

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/require"
)

func TestNormalizeImageResponseBodyAggregatesCompletedSSEEvent(t *testing.T) {
	response := &http.Response{
		Header: http.Header{"Content-Type": []string{"text/event-stream; charset=utf-8"}},
		Body:   io.NopCloser(strings.NewReader("event: started\ndata: {\"id\":\"req-1\"}\n\n" + "event: heartbeat\ndata: {\"status\":\"processing\"}\n\n" + "event: completed\ndata: {\"created\":1700000000,\"model\":\"gpt-image-2\",\"data\":[{\"url\":\"https://heyroute.ai/image.png\"}]}\n\n" + "event: done\ndata: [DONE]\n\n")),
	}
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	normalized, err := normalizeImageResponseBody(response, body)
	require.NoError(t, err)
	require.Equal(t, "application/json", response.Header.Get("Content-Type"))
	var imageResponse dto.ImageResponse
	require.NoError(t, common.Unmarshal(normalized, &imageResponse))
	require.Equal(t, int64(1700000000), imageResponse.Created)
	require.Equal(t, []dto.ImageData{{Url: "https://heyroute.ai/image.png"}}, imageResponse.Data)
}

func TestNormalizeImageResponseBodyLeavesJSONUntouched(t *testing.T) {
	response := &http.Response{Header: http.Header{"Content-Type": []string{"application/json"}}}
	body := []byte(`{"created":1700000000,"data":[{"url":"https://example.com/image.png"}]}`)
	normalized, err := normalizeImageResponseBody(response, body)
	require.NoError(t, err)
	require.Equal(t, body, normalized)
}

func TestNormalizeImageResponseBodyPreservesUsageAndMetadata(t *testing.T) {
	payload := `{"data":[{"url":"https://example.com/image.png"}],"usage":{"input_tokens":42},"request_id":"test"}`
	response := &http.Response{Header: http.Header{"Content-Type": []string{"text/event-stream"}, "Content-Length": []string{"999"}}}
	normalized, err := normalizeImageResponseBody(response, []byte("data: "+payload+"\n\ndata: [DONE]\n\n"))
	require.NoError(t, err)
	require.JSONEq(t, payload, string(normalized))
	require.Empty(t, response.Header.Get("Content-Length"))
}

func TestNormalizeImageResponseBodyFailsWithoutImages(t *testing.T) {
	for _, body := range []string{"data: [DONE]\n\n", "data: {invalid}\n\n", "data: {\"error\":{\"message\":\"failed\"}}\n\n"} {
		response := &http.Response{Header: http.Header{"Content-Type": []string{"text/event-stream"}}}
		_, err := normalizeImageResponseBody(response, []byte(body))
		require.Error(t, err)
	}
}

func TestNormalizeImageResponseBodySupportsMultilineAndFinalUnterminatedEvent(t *testing.T) {
	response := &http.Response{Header: http.Header{"Content-Type": []string{"text/event-stream"}}}
	body := ": keepalive\r\nevent: completed\r\ndata: {\r\ndata: \"data\":[{\"b64_json\":\"aW1hZ2U=\"}]}"
	normalized, err := normalizeImageResponseBody(response, []byte(body))
	require.NoError(t, err)
	require.JSONEq(t, `{"data":[{"b64_json":"aW1hZ2U="}]}`, string(normalized))
}

func TestImageSSELargeImageAndProviderError(t *testing.T) {
	resp := &http.Response{Header: http.Header{"Content-Type": []string{"text/event-stream"}}}
	encoded := strings.Repeat("a", 5*1024*1024)
	body := []byte("data: {\"data\":[{\"b64_json\":\"" + encoded + "\"}]}\n\n")
	normalized, err := normalizeImageResponseBody(resp, body)
	if err != nil || !strings.Contains(string(normalized), encoded) {
		t.Fatalf("large image lost: %v", err)
	}
	resp.Header.Set("Content-Type", "text/event-stream")
	_, err = normalizeImageResponseBody(resp, []byte("data: {\"error\":{\"code\":\"provider_rejected\",\"message\":\"quota unavailable\"}}\n\n"))
	if err == nil || !strings.Contains(err.Error(), "quota unavailable") {
		t.Fatalf("provider error lost: %v", err)
	}
}
