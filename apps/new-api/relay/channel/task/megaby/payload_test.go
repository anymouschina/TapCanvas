package megaby

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestBuildSubmitPayloadUsesVerifiedWireContract(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:       "sd2-mini",
		Prompt:      "a paper boat on a pond",
		Duration:    4,
		Resolution:  "480p",
		AspectRatio: "16:9",
		Images:      []string{"https://assets.example/one.jpg"},
		Metadata: map[string]any{
			"content": []any{
				map[string]any{
					"type":      "video_url",
					"video_url": map[string]any{"url": "https://assets.example/clip.mp4"},
				},
				map[string]any{
					"type":      "audio_url",
					"audio_url": map[string]any{"url": "https://assets.example/voice.mp3"},
				},
			},
		},
	}
	payload, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	encoded, err := common.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	var body map[string]any
	if err := common.Unmarshal(encoded, &body); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}

	if body["model"] != "sd-mini-480p" || body["resolution"] != "480p" || body["ratio"] != "16:9" {
		t.Fatalf("unexpected model contract: %v", body)
	}
	if body["duration"] != float64(4) {
		t.Fatalf("duration = %v, want 4", body["duration"])
	}
	for _, key := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		values, ok := body[key].([]any)
		if !ok || len(values) != 1 {
			t.Fatalf("%s = %v, want one reference", key, body[key])
		}
	}
	for _, unsupported := range []string{"first_image", "last_image", "first_frame_url", "last_frame_url"} {
		if _, exists := body[unsupported]; exists {
			t.Fatalf("unsupported field %q leaked into payload: %v", unsupported, body)
		}
	}
}

func TestBuildSubmitPayloadAppliesDocumentedDefaults(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model:  "sd2-mini",
		Prompt: "sunrise",
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Duration == nil || *payload.Duration != 5 {
		t.Fatalf("duration = %v, want explicit product default 5", payload.Duration)
	}
	if payload.Model != "sd2-mini" || payload.Ratio != "16:9" || payload.Resolution != "720p" {
		t.Fatalf("defaults = ratio %q resolution %q", payload.Ratio, payload.Resolution)
	}
}

func TestBuildSubmitPayloadRoutesPublicModelsByResolution(t *testing.T) {
	tests := []struct {
		publicModel    string
		resolution     string
		providerModel  string
		wireResolution string
	}{
		{publicModel: "sd2", resolution: "480P", providerModel: "sd2-pro-933-480", wireResolution: "480p"},
		{publicModel: "sd2", resolution: "720p", providerModel: "sd2-pro", wireResolution: "720p"},
		{publicModel: "sd2", resolution: "1080p", providerModel: "sd-2.0-1080p", wireResolution: "1080p"},
		{publicModel: "sd2", resolution: "4K", providerModel: "sd-2.0-4k", wireResolution: "4k"},
		{publicModel: "sd2-mini", resolution: "480p", providerModel: "sd-mini-480p", wireResolution: "480p"},
		{publicModel: "sd2-mini", resolution: "720p", providerModel: "sd2-mini", wireResolution: "720p"},
		{publicModel: "seedance-2.5", resolution: "480P", providerModel: "seedance-2-5", wireResolution: "480p"},
		{publicModel: "seedance-2.5", resolution: "720p", providerModel: "seedance-2-5", wireResolution: "720p"},
		{publicModel: "minimax-h3", resolution: "768P", providerModel: "minimax-h3-768p", wireResolution: "768p"},
		{publicModel: "minimax-h3", resolution: "1440P", providerModel: "minimax-h3-1440p", wireResolution: "1440p"},
	}
	for _, test := range tests {
		t.Run(test.publicModel+"/"+test.resolution, func(t *testing.T) {
			payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
				Model: test.publicModel, Prompt: "p", Resolution: test.resolution, Duration: 4,
			})
			if err != nil {
				t.Fatalf("BuildSubmitPayload: %v", err)
			}
			if payload.Model != test.providerModel || payload.Resolution != test.wireResolution {
				t.Fatalf("provider route = %s/%s, want %s/%s", payload.Model, payload.Resolution, test.providerModel, test.wireResolution)
			}
		})
	}
}

func TestBuildSubmitPayloadUsesSeedance25Defaults(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{Model: "seedance-2.5", Prompt: "p"})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Model != "seedance-2-5" || payload.Resolution != "720p" || payload.Duration == nil || *payload.Duration != 5 {
		t.Fatalf("unexpected defaults: %+v", payload)
	}
}

func TestBuildSubmitPayloadAppliesPerModelMediaLimits(t *testing.T) {
	urls := func(kind string, count int) []any {
		values := make([]any, 0, count)
		for index := 0; index < count; index++ {
			values = append(values, map[string]any{
				"type":        kind + "_url",
				kind + "_url": map[string]any{"url": fmt.Sprintf("https://assets.example/%s-%d", kind, index)},
			})
		}
		return values
	}
	content := append(urls("image", 30), urls("video", 10)...)
	content = append(content, urls("audio", 10)...)
	if _, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: "seedance-2.5", Prompt: "p", Metadata: map[string]any{"content": content},
	}); err != nil {
		t.Fatalf("seedance-2.5 documented limits should be accepted: %v", err)
	}
	tooManyImages := append(content, map[string]any{
		"type": "image_url", "image_url": map[string]any{"url": "https://assets.example/image-30"},
	})
	if _, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: "seedance-2.5", Prompt: "p", Metadata: map[string]any{"content": tooManyImages},
	}); err == nil {
		t.Fatal("expected seedance-2.5 image limit error")
	}
	if _, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: "sd2", Prompt: "p", Metadata: map[string]any{"content": urls("image", 10)},
	}); err == nil {
		t.Fatal("expected sd2 to retain its 9-image limit")
	}
}

func TestResolveBillingSpecSelectsReferenceVideoTier(t *testing.T) {
	request := &relaycommon.TaskSubmitReq{
		Model: "seedance-2.5", Resolution: "480p", Duration: 4,
		Metadata: map[string]any{"reference_videos": []any{"https://assets.example/reference.mp4"}},
	}
	resolution, duration, err := resolveBillingSpec(request)
	if err != nil {
		t.Fatalf("resolveBillingSpec: %v", err)
	}
	if resolution != "480p+video" || duration != 4 {
		t.Fatalf("billing spec = %s/%ds, want 480p+video/4s", resolution, duration)
	}
	request.Metadata = nil
	resolution, _, err = resolveBillingSpec(request)
	if err != nil || resolution != "480p" {
		t.Fatalf("base billing spec = %s, err %v", resolution, err)
	}
}

func TestBuildSubmitPayloadRejectsUnsupportedInputs(t *testing.T) {
	tests := []struct {
		name string
		req  relaycommon.TaskSubmitReq
	}{
		{
			name: "unknown model",
			req:  relaycommon.TaskSubmitReq{Model: "videos-mini", Prompt: "p"},
		},
		{
			name: "wrong resolution",
			req:  relaycommon.TaskSubmitReq{Model: "sd2-mini", Prompt: "p", Resolution: "1080p"},
		},
		{
			name: "duration too short",
			req:  relaycommon.TaskSubmitReq{Model: "sd2-mini", Prompt: "p", Duration: 3},
		},
		{
			name: "unsupported ratio",
			req:  relaycommon.TaskSubmitReq{Model: "sd2-mini", Prompt: "p", AspectRatio: "4:3"},
		},
		{
			name: "first frame",
			req: relaycommon.TaskSubmitReq{
				Model: "sd2-mini", Prompt: "p",
				Metadata: map[string]any{"first_frame_url": "https://assets.example/start.jpg"},
			},
		},
		{
			name: "first frame content role",
			req: relaycommon.TaskSubmitReq{
				Model: "sd2-mini", Prompt: "p",
				Metadata: map[string]any{
					"content": []any{map[string]any{
						"type": "image_url", "role": "first_frame",
						"image_url": map[string]any{"url": "https://assets.example/start.jpg"},
					}},
				},
			},
		},
		{
			name: "style reference role",
			req: relaycommon.TaskSubmitReq{
				Model: "sd2-mini", Prompt: "p",
				Metadata: map[string]any{"style_references": []any{"https://assets.example/style.jpg"}},
			},
		},
		{
			name: "non public reference",
			req: relaycommon.TaskSubmitReq{
				Model: "sd2-mini", Prompt: "p", Images: []string{"file:///tmp/start.jpg"},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := BuildSubmitPayload(&test.req); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestBuildSubmitPayloadDeduplicatesReferencesBeforeLimits(t *testing.T) {
	repeated := make([]string, 0, 10)
	for index := 0; index < 10; index++ {
		repeated = append(repeated, "https://assets.example/same.jpg")
	}
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model:  "sd2-mini",
		Prompt: "p",
		Images: repeated,
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if len(payload.ReferenceImages) != 1 {
		t.Fatalf("reference images = %v, want one unique URL", payload.ReferenceImages)
	}
}
