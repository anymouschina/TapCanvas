package apimart

import (
	"encoding/json"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestBuildWan27VideoEditPayloadUsesDocumentedProviderShape(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:      "wan2.7-videoedit",
		Prompt:     "移除画面右下角字幕，并保持背景纹理连续。",
		Resolution: "1080P",
		Metadata: map[string]interface{}{
			"video_url":       "https://assets.example.com/source.mp4",
			"edit_operation":  "subtitle_remove",
			"edit_selections": []interface{}{map[string]interface{}{"x": 0.7, "y": 0.8, "width": 0.25, "height": 0.12}},
		},
	}

	payload, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}

	if got := body["model"]; got != "wan2.7-videoedit" {
		t.Fatalf("model = %v, want wan2.7-videoedit", got)
	}
	if got := body["video_urls"]; got == nil {
		t.Fatal("video_urls is missing")
	}
	if got := body["prompt"]; got != req.Prompt {
		t.Fatalf("prompt = %v, want %q", got, req.Prompt)
	}
	if got := body["resolution"]; got != "1080P" {
		t.Fatalf("resolution = %v, want 1080P", got)
	}
	if _, ok := body["edit_operation"]; ok {
		t.Fatal("internal edit_operation must not cross the APIMart provider boundary")
	}
	if _, ok := body["edit_selections"]; ok {
		t.Fatal("internal edit_selections must not cross the APIMart provider boundary")
	}
}
