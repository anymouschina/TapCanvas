package hailuo

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
)

func TestV2BuildRequestURL(t *testing.T) {
	adaptor := &V2TaskAdaptor{}
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: "https://metaso.cn/api/minimax/"}})
	got, err := adaptor.BuildRequestURL(nil)
	if err != nil {
		t.Fatalf("BuildRequestURL: %v", err)
	}
	want := "https://metaso.cn/api/minimax/v2/video_generation"
	if got != want {
		t.Fatalf("url = %q, want %q", got, want)
	}
}

func TestV2FetchTaskUsesPathEndpoint(t *testing.T) {
	service.InitHttpClient()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/query/video_generation/task-123" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		_, _ = io.WriteString(w, `{"task":{"id":"task-123","status":"queued"}}`)
	}))
	defer server.Close()

	resp, err := (&V2TaskAdaptor{}).FetchTask(server.URL, "test-key", map[string]any{"task_id": "task-123"}, "")
	if err != nil {
		t.Fatalf("FetchTask: %v", err)
	}
	_ = resp.Body.Close()
}

func TestV2ParseTaskResultSuccess(t *testing.T) {
	body := []byte(`{
		"task": {
			"id": "task-123",
			"model": "MiniMax-H3",
			"status": "succeeded",
			"content": {"url": "https://assets.example/output.mp4"},
			"resolution": "2K",
			"usage": {"input_seconds": 6, "output_seconds": 5, "input_image_count": 2, "total_tokens": 100, "completion_tokens": 80}
		}
	}`)
	result, err := (&V2TaskAdaptor{}).ParseTaskResult(body)
	if err != nil {
		t.Fatalf("ParseTaskResult: %v", err)
	}
	if result.Status != model.TaskStatusSuccess || result.Url != "https://assets.example/output.mp4" {
		t.Fatalf("result = %+v", result)
	}
	if result.InputSeconds != 6 || result.OutputSeconds != 5 || result.InputImageCount != 2 || result.Resolution != V2Resolution2K {
		t.Fatalf("usage = %+v", result)
	}
}

func TestV2ParseTaskResultRejectsUnknownStatus(t *testing.T) {
	_, err := (&V2TaskAdaptor{}).ParseTaskResult([]byte(`{"task":{"id":"task-123","status":"mystery"}}`))
	if err == nil || !strings.Contains(err.Error(), "unknown status") {
		t.Fatalf("error = %v", err)
	}
}
