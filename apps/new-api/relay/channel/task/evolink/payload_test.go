package evolink

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func mustMarshal(t *testing.T, p *SubmitPayload) map[string]any {
	t.Helper()
	data, err := common.Marshal(p)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var m map[string]any
	if err := common.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	return m
}

func TestSeedanceReferencePayload(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:      "seedance-2.0-reference-to-video",
		Prompt:     "a fox in the snow",
		Resolution: "1080p",
		Duration:   8,
		Images:     []string{"https://x/img1.jpg"},
		Metadata: map[string]any{
			"video_urls": []any{"https://x/ref.mp4"},
			"audio_urls": []any{"https://x/bgm.mp3"},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	m := mustMarshal(t, p)
	if m["quality"] != "1080p" {
		t.Errorf("quality = %v, want 1080p", m["quality"])
	}
	if m["aspect_ratio"] != "16:9" {
		t.Errorf("aspect_ratio = %v, want default 16:9", m["aspect_ratio"])
	}
	if m["generate_audio"] != true || m["content_filter"] != true {
		t.Errorf("generate_audio/content_filter should default true, got %v/%v", m["generate_audio"], m["content_filter"])
	}
	if _, ok := m["resolution"]; ok {
		t.Errorf("seedance must use `quality`, not `resolution`: %v", m["resolution"])
	}
	if imgs, _ := m["image_urls"].([]any); len(imgs) != 1 {
		t.Errorf("image_urls = %v", m["image_urls"])
	}
	if vids, _ := m["video_urls"].([]any); len(vids) != 1 {
		t.Errorf("video_urls = %v", m["video_urls"])
	}
	if auds, _ := m["audio_urls"].([]any); len(auds) != 1 {
		t.Errorf("audio_urls = %v", m["audio_urls"])
	}
}

func TestSeedanceGenerateAudioOverride(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:    "seedance-2.0-fast-image-to-video",
		Prompt:   "p",
		Images:   []string{"https://x/a.jpg"},
		Metadata: map[string]any{"generate_audio": false},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	m := mustMarshal(t, p)
	if m["generate_audio"] != false {
		t.Errorf("generate_audio override = %v, want false", m["generate_audio"])
	}
}

func TestSeedanceImageToVideoRequiresImage(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{Model: "seedance-2.0-fast-image-to-video", Prompt: "p"}
	if _, err := BuildSubmitPayload(req); err == nil {
		t.Fatal("expected error when image-to-video has no image")
	}
}

func TestKlingImageToVideoFrames(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:    "kling-o3-image-to-video",
		Prompt:   "turn head",
		Duration: 5,
		Metadata: map[string]any{
			"first_frame_url": "https://x/start.jpg",
			"last_frame_url":  "https://x/end.jpg",
			"sound":           "on",
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	m := mustMarshal(t, p)
	if m["image_start"] != "https://x/start.jpg" {
		t.Errorf("image_start = %v", m["image_start"])
	}
	if m["image_end"] != "https://x/end.jpg" {
		t.Errorf("image_end = %v", m["image_end"])
	}
	if m["sound"] != "on" {
		t.Errorf("sound = %v, want on", m["sound"])
	}
	if _, ok := m["keep_original_sound"]; ok {
		t.Errorf("image-to-video must not send keep_original_sound")
	}
}

func TestKlingImageStartFallsBackToImages(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-o3-image-to-video",
		Prompt: "p",
		Images: []string{"https://x/only.jpg"},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	m := mustMarshal(t, p)
	if m["image_start"] != "https://x/only.jpg" {
		t.Errorf("image_start fallback = %v", m["image_start"])
	}
}

func TestKlingVideoEditRequiresVideo(t *testing.T) {
	if _, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{Model: "kling-o3-video-edit", Prompt: "edit"}); err == nil {
		t.Fatal("expected error when video-edit has no video_url")
	}
	req := &relaycommon.TaskSubmitReq{
		Model:    "kling-o3-video-edit",
		Prompt:   "warm tones",
		Metadata: map[string]any{"video_url": "https://x/src.mp4"},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	m := mustMarshal(t, p)
	if m["video_url"] != "https://x/src.mp4" {
		t.Errorf("video_url = %v", m["video_url"])
	}
	if m["keep_original_sound"] != true {
		t.Errorf("keep_original_sound should default true, got %v", m["keep_original_sound"])
	}
}

func TestKlingReferenceRequiresPrompt(t *testing.T) {
	if _, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{Model: "kling-o3-reference-to-video"}); err == nil {
		t.Fatal("expected error when reference-to-video has no prompt")
	}
}

func TestModelNeverOverriddenByExtras(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:    "seedance-2.0-reference-to-video",
		Prompt:   "p",
		Images:   []string{"https://x/a.jpg"},
		Metadata: map[string]any{"model": "evil-model", "custom_param": 7},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	m := mustMarshal(t, p)
	if m["model"] != "seedance-2.0-reference-to-video" {
		t.Errorf("model was overridden: %v", m["model"])
	}
	if m["custom_param"] != float64(7) {
		t.Errorf("passthrough extra custom_param = %v", m["custom_param"])
	}
}

func TestContentArrayCollection(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:  "seedance-2.0-reference-to-video",
		Prompt: "p",
		Metadata: map[string]any{
			"content": []any{
				map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://x/i.jpg"}},
				map[string]any{"type": "video_url", "video_url": map[string]any{"url": "https://x/v.mp4"}},
			},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	m := mustMarshal(t, p)
	imgs, _ := m["image_urls"].([]any)
	vids, _ := m["video_urls"].([]any)
	if len(imgs) != 1 || len(vids) != 1 {
		t.Errorf("content[] not collected: imgs=%v vids=%v", imgs, vids)
	}
	// content itself must not leak upstream
	if _, ok := m["content"]; ok {
		t.Error("internal `content` key leaked to upstream payload")
	}
}
