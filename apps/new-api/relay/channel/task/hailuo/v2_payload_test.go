package hailuo

import (
	"fmt"
	"math"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func TestBuildV2VideoRequestTextToVideo(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:       V2ModelMiniMaxH3,
		Prompt:      "epic space opera",
		Resolution:  V2Resolution2K,
		Duration:    5,
		AspectRatio: "16:9",
	}
	payload, mode, err := buildV2VideoRequest(req, V2ModelMiniMaxH3)
	if err != nil {
		t.Fatalf("buildV2VideoRequest: %v", err)
	}
	if mode != v2ModeText {
		t.Fatalf("mode = %q, want %q", mode, v2ModeText)
	}
	if payload.Model != V2ModelMiniMaxH3 || payload.Resolution != V2Resolution2K || payload.Duration != 5 || payload.Ratio != "16:9" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
	if len(payload.Content) != 1 || payload.Content[0].Type != "text" || payload.Content[0].Text != req.Prompt {
		t.Fatalf("content = %+v", payload.Content)
	}
}

func TestBuildV2VideoRequestMapsPublicModelAndResolution(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:       V2PublicModelMiniMaxH3,
		Prompt:      "epic space opera",
		Resolution:  "1440p",
		Duration:    5,
		AspectRatio: "16:9",
	}
	payload, _, err := buildV2VideoRequest(req, V2PublicModelMiniMaxH3)
	if err != nil {
		t.Fatalf("buildV2VideoRequest: %v", err)
	}
	if payload.Model != V2ModelMiniMaxH3 || payload.Resolution != V2Resolution2K {
		t.Fatalf("unexpected mapped payload: %+v", payload)
	}
}

func TestBuildV2VideoRequestInfersFirstAndLastFrames(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:       V2ModelMiniMaxH3,
		Prompt:      "move naturally",
		Images:      []string{"https://assets.example/first.png", "https://assets.example/last.png"},
		Resolution:  V2Resolution2K,
		Duration:    5,
		AspectRatio: "9:16",
	}
	payload, mode, err := buildV2VideoRequest(req, V2ModelMiniMaxH3)
	if err != nil {
		t.Fatalf("buildV2VideoRequest: %v", err)
	}
	if mode != v2ModeFrame {
		t.Fatalf("mode = %q, want %q", mode, v2ModeFrame)
	}
	if payload.Ratio != V2DefaultRatio {
		t.Fatalf("ratio = %q, want adaptive for frame mode", payload.Ratio)
	}
	if len(payload.Content) != 3 {
		t.Fatalf("content len = %d, want 3", len(payload.Content))
	}
	if payload.Content[1].Role != "first_frame" || payload.Content[2].Role != "last_frame" {
		t.Fatalf("frame roles = %q, %q", payload.Content[1].Role, payload.Content[2].Role)
	}
}

func TestBuildV2VideoRequestReferenceMedia(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:      V2ModelMiniMaxH3,
		Prompt:     "speak with the reference voice",
		Resolution: V2Resolution768P,
		Duration:   8,
		Metadata: map[string]any{
			"content": []any{
				map[string]any{"type": "video_url", "video_url": map[string]any{"url": "https://assets.example/reference.mp4"}},
				map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": "https://assets.example/voice.mp3"}},
			},
		},
	}
	payload, mode, err := buildV2VideoRequest(req, V2ModelMiniMaxH3)
	if err != nil {
		t.Fatalf("buildV2VideoRequest: %v", err)
	}
	if mode != v2ModeReference || payload.Ratio != V2DefaultRatio {
		t.Fatalf("mode=%q ratio=%q", mode, payload.Ratio)
	}
	if payload.Content[1].Role != "reference_video" || payload.Content[2].Role != "reference_audio" {
		t.Fatalf("reference roles = %q, %q", payload.Content[1].Role, payload.Content[2].Role)
	}
}

func TestBuildV2VideoRequestRejectsMixedFrameAndReferenceMedia(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:      V2ModelMiniMaxH3,
		Prompt:     "invalid mix",
		Resolution: V2Resolution2K,
		Duration:   5,
		Metadata: map[string]any{
			"content": []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://assets.example/first.png"}, "role": "first_frame"},
				map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": "https://assets.example/voice.mp3"}, "role": "reference_audio"},
			},
		},
	}
	if _, _, err := buildV2VideoRequest(req, V2ModelMiniMaxH3); err == nil {
		t.Fatal("expected mixed frame/reference media to fail")
	}
}

func TestBuildV2VideoRequestRejectsAudioOnlyReference(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:      V2ModelMiniMaxH3,
		Prompt:     "invalid audio-only reference",
		Resolution: V2Resolution768P,
		Duration:   5,
		Metadata: map[string]any{
			"content": []any{
				map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": "https://assets.example/voice.mp3"}},
			},
		},
	}
	if _, _, err := buildV2VideoRequest(req, V2ModelMiniMaxH3); err == nil {
		t.Fatal("expected audio-only reference media to fail")
	}
}

func TestBuildV2VideoRequestRejectsMoreThanTwelveReferenceMedia(t *testing.T) {
	content := make([]any, 0, 13)
	for index := 0; index < 9; index++ {
		content = append(content, map[string]any{
			"type":      "image_url",
			"image_url": map[string]any{"url": fmt.Sprintf("https://assets.example/image-%d.png", index)},
			"role":      "reference_image",
		})
	}
	for index := 0; index < 3; index++ {
		content = append(content, map[string]any{
			"type":      "video_url",
			"video_url": map[string]any{"url": fmt.Sprintf("https://assets.example/video-%d.mp4", index)},
			"role":      "reference_video",
		})
	}
	content = append(content, map[string]any{
		"type":      "audio_url",
		"audio_url": map[string]any{"url": "https://assets.example/audio.mp3"},
		"role":      "reference_audio",
	})
	req := &relaycommon.TaskSubmitReq{
		Model:      V2ModelMiniMaxH3,
		Prompt:     "too many references",
		Resolution: V2Resolution768P,
		Duration:   5,
		Metadata:   map[string]any{"content": content},
	}
	if _, _, err := buildV2VideoRequest(req, V2ModelMiniMaxH3); err == nil {
		t.Fatal("expected more than twelve reference media files to fail")
	}
}

func TestV2EstimateBillingUsesMetasoTimeAndReferencePrices(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	req := relaycommon.TaskSubmitReq{
		Model:      V2PublicModelMiniMaxH3,
		Prompt:     "reference montage",
		Resolution: V2Resolution768P,
		Duration:   5,
		ReferenceImages: []string{
			"https://assets.example/1.png", "https://assets.example/2.png", "https://assets.example/3.png",
			"https://assets.example/4.png", "https://assets.example/5.png", "https://assets.example/6.png",
		},
	}
	relaycommon.SetTaskRequest(context, req)
	info := &relaycommon.RelayInfo{
		OriginModelName: V2PublicModelMiniMaxH3,
		ChannelMeta:     &relaycommon.ChannelMeta{UpstreamModelName: V2ModelMiniMaxH3},
	}
	info.PriceData = types.PriceData{ModelPrice: 2.0, UsePrice: true}
	ratios := (&V2TaskAdaptor{}).EstimateBilling(context, info)
	wantPrice := 5*0.24 + 0.065
	wantRatio := wantPrice / 2.0
	if math.Abs(ratios["spec_price"]-wantRatio) > 1e-9 {
		t.Fatalf("spec_price = %.12f, want %.12f", ratios["spec_price"], wantRatio)
	}
}

func TestV2AdjustBillingOnCompleteUsesActualReferenceUsage(t *testing.T) {
	task := &model.Task{PrivateData: model.TaskPrivateData{BillingContext: &model.TaskBillingContext{
		OriginModelName: V2PublicModelMiniMaxH3,
		GroupRatio:      1,
		UserPriceRatio:  0.5,
		OtherRatios:     map[string]float64{"channel_price": 1},
	}}}
	result := &relaycommon.TaskInfo{
		Status:          string(model.TaskStatusSuccess),
		Resolution:      V2Resolution2K,
		InputSeconds:    6,
		OutputSeconds:   5,
		InputImageCount: 7,
	}
	got := (&V2TaskAdaptor{}).AdjustBillingOnComplete(task, result)
	wantPrice := 11*0.40 + 2*0.065
	want := int(wantPrice * common.QuotaPerUnit * 0.5)
	if got != want {
		t.Fatalf("quota = %d, want %d", got, want)
	}
}
