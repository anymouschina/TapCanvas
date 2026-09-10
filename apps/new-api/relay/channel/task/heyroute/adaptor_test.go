package heyroute

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

func TestPayloadPreservesExplicitOptionsAndBillingSpec(t *testing.T) {
	payload, req, err := NormalizePayload([]byte(`{"model":"seedance-2.5","prompt":"test","duration":8,"size":"16:9","resolution":"1080p","metadata":{"generate_audio":false,"seed":0},"first_frame_url":"https://example.org/first.png"}`))
	if err != nil {
		t.Fatal(err)
	}
	if req.Duration != 8 || req.Resolution != "1080p" || payload.Seconds != "8" || payload.Ratio != "16:9" {
		t.Fatalf("incorrect normalized contract: %+v", payload)
	}
	body, err := common.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"generate_audio":false`, `"seed":0`, `"role":"first_frame"`} {
		if !strings.Contains(string(body), field) {
			t.Fatalf("lost explicit option %s: %s", field, body)
		}
	}
}

func TestPayloadRejectsUnsupportedResolutionAndDuration(t *testing.T) {
	for _, body := range []string{
		`{"model":"grok-imagine-video","prompt":"test","duration":8,"resolution":"1080p"}`,
		`{"model":"seedance-2.0","prompt":"test","duration":8}`,
		`{"model":"grok-video","prompt":"test","duration":7}`,
		`{"model":"seedance-2.5","prompt":"test","duration":8,"seconds":"15"}`,
	} {
		if _, _, err := NormalizePayload([]byte(body)); err == nil {
			t.Fatalf("accepted unsupported contract: %s", body)
		}
	}
}

func TestPayloadAcceptsArrayReferences(t *testing.T) {
	payload, _, err := NormalizePayload([]byte(`{"model":"seedance-2.5","prompt":"test","seconds":"8","input_reference":["https://example.org/one.png","https://example.org/two.png"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payload.InputReference), "two.png") {
		t.Fatal("reference lost")
	}
}

func TestPollPreservesSignedVideoURLAndFailure(t *testing.T) {
	a := TaskAdaptor{}
	result, err := a.ParseTaskResult([]byte(`{"task_id":"upstream-id","status":"completed","video_url":"https://heyroute.ai/v1/videos/upstream-id/content?signature=test"}`))
	if err != nil || result.Status != model.TaskStatusSuccess || !strings.Contains(result.Url, "signature=test") {
		t.Fatalf("missing result: %+v %v", result, err)
	}
	result, err = a.ParseTaskResult([]byte(`{"status":"failed","error":{"message":"provider rejected","code":"rejected"}}`))
	if err != nil || result.Status != model.TaskStatusFailure || result.Reason != "provider rejected" {
		t.Fatalf("lost failure: %+v %v", result, err)
	}
}

func TestCommunityReferenceContract(t *testing.T) {
	p, _, err := NormalizePayload([]byte(`{"model":"seedance-2.5","prompt":"test","duration":8,"start_frame":"https://example.org/start.png","end_frame":"https://example.org/end.png","reference_videos":["https://example.org/ref.mp4"],"reference_audios":["https://example.org/ref.mp3"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Images) != 2 || p.Images[1].Role != "last_frame" || len(p.Videos) != 1 || len(p.Audios) != 1 {
		t.Fatalf("references lost: %+v", p)
	}
	_, _, err = NormalizePayload([]byte(`{"model":"seedance-2.5","prompt":"test","duration":8,"videos":[{"url":"https://example.org/ref.mp4","start_seconds":0}]}`))
	if err == nil {
		t.Fatal("unsupported reference trim silently discarded")
	}
}
