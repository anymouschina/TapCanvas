package apimart

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestIsKlingV3FamilyModel(t *testing.T) {
	for _, name := range []string{"kling-v3-omni", "kling-v3-omni-apimart", "KLING-V3-OMNI", "kling-v3", "kling-v3-apimart"} {
		if !isKlingV3FamilyModel(name) {
			t.Errorf("expected %q to be kling v3 family", name)
		}
	}
	for _, name := range []string{"kling-v3-motion-control", "kling-v3-motion-control-apimart", "kling-v2-6", "pixverse-v6", "kling-video-o1"} {
		if isKlingV3FamilyModel(name) {
			t.Errorf("expected %q NOT to be kling v3 family", name)
		}
	}
	if !isKlingV3OmniModel("kling-v3-omni-apimart") {
		t.Errorf("expected omni alias to be detected")
	}
	if isKlingV3OmniModel("kling-v3") {
		t.Errorf("kling-v3 is not omni")
	}
}

func marshalKlingPayload(t *testing.T, p *SubmitPayload) map[string]any {
	t.Helper()
	data, err := common.Marshal(p)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	var out map[string]any
	if err := common.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	return out
}

func TestKlingV3OmniResolutionToMode(t *testing.T) {
	cases := []struct {
		resolution string
		wantMode   string
	}{
		{"720p", "std"},
		{"1080p", "pro"},
		{"4k", "4k"},
		{"2160p", "4k"},
	}
	for _, tc := range cases {
		req := &relaycommon.TaskSubmitReq{
			Model:      "kling-v3-omni",
			Prompt:     "p",
			Resolution: tc.resolution,
			Duration:   5,
		}
		p, err := BuildSubmitPayload(req)
		if err != nil {
			t.Fatalf("build payload (%s): %v", tc.resolution, err)
		}
		out := marshalKlingPayload(t, p)
		if got, _ := out["mode"].(string); got != tc.wantMode {
			t.Errorf("resolution %q: mode = %q, want %q", tc.resolution, out["mode"], tc.wantMode)
		}
		if _, ok := out["resolution"]; ok {
			t.Errorf("resolution %q must not be forwarded upstream (kling has no such field)", tc.resolution)
		}
	}
}

func TestKlingV3OmniExplicitModeWinsOverResolution(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:      "kling-v3-omni",
		Prompt:     "p",
		Resolution: "720p",
		Metadata:   map[string]any{"mode": "pro"},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	out := marshalKlingPayload(t, p)
	if got, _ := out["mode"].(string); got != "pro" {
		t.Errorf("mode = %q, want explicit metadata mode 'pro'", out["mode"])
	}
}

func TestKlingV3OmniFrameRolesBecomeImageWithRoles(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3-omni",
		Prompt: "p",
		Images: []string{"https://x/ref.png"},
		Metadata: map[string]any{
			"content": []any{
				map[string]any{
					"type":      "image_url",
					"image_url": map[string]any{"url": "https://x/first.png"},
					"role":      "first_frame",
				},
				map[string]any{
					"type":      "image_url",
					"image_url": map[string]any{"url": "https://x/last.png"},
					"role":      "last_frame",
				},
			},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if len(p.ImageUrls) != 0 {
		t.Fatalf("image_urls must be empty when image_with_roles is used (mutually exclusive), got %v", p.ImageUrls)
	}
	if len(p.ImageWithRoles) != 3 {
		t.Fatalf("image_with_roles len = %d, want 3", len(p.ImageWithRoles))
	}
	wantRoles := map[string]string{
		"https://x/first.png": "first_frame",
		"https://x/last.png":  "last_frame",
		"https://x/ref.png":   "reference",
	}
	for _, entry := range p.ImageWithRoles {
		url, _ := entry["url"].(string)
		role, _ := entry["role"].(string)
		if wantRoles[url] != role {
			t.Errorf("url %q role = %q, want %q", url, role, wantRoles[url])
		}
	}
}

func TestKlingV3OmniPlainReferencesStayImageUrls(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3-omni",
		Prompt: "p",
		Images: []string{"https://x/a.png", "https://x/b.png", "https://x/a.png"},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if len(p.ImageWithRoles) != 0 {
		t.Fatalf("no frame roles given, image_with_roles must be empty, got %v", p.ImageWithRoles)
	}
	if len(p.ImageUrls) != 2 {
		t.Fatalf("image_urls = %v, want deduped 2 entries", p.ImageUrls)
	}
}

func TestKlingV3OmniVideoListDropsAudio(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3-omni",
		Prompt: "p",
		Metadata: map[string]any{
			"audio": true,
			"content": []any{
				map[string]any{
					"type":      "video_url",
					"video_url": map[string]any{"url": "https://x/prev.mp4"},
				},
			},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if len(p.VideoList) != 1 || p.VideoList[0].VideoURL != "https://x/prev.mp4" {
		t.Fatalf("video_list = %+v, want the referenced video", p.VideoList)
	}
	out := marshalKlingPayload(t, p)
	if _, ok := out["audio"]; ok {
		t.Errorf("audio must be dropped when video_list is present (mutually exclusive upstream)")
	}
}

func TestKlingV3OmniAudioPassthrough(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:    "kling-v3-omni",
		Prompt:   "p",
		Metadata: map[string]any{"audio": true},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	out := marshalKlingPayload(t, p)
	if got, _ := out["audio"].(bool); !got {
		t.Errorf("audio = %v, want true", out["audio"])
	}
}

func TestKlingV3OmniDurationClampAndAspectFromSize(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:    "kling-v3-omni",
		Prompt:   "p",
		Duration: 30,
		Size:     "9:16",
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if p.Duration != 15 {
		t.Errorf("duration = %d, want clamped 15", p.Duration)
	}
	if p.AspectRatio != "9:16" {
		t.Errorf("aspect_ratio = %q, want translated from size", p.AspectRatio)
	}

	req.Duration = 2
	p, err = BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if p.Duration != 3 {
		t.Errorf("duration = %d, want clamped 3", p.Duration)
	}
}

func TestKlingV3BaseOrdersImageUrlsAndCapsAtTwo(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3",
		Prompt: "p",
		Images: []string{"https://x/ref1.png", "https://x/ref2.png"},
		Metadata: map[string]any{
			"first_frame_url": "https://x/first.png",
			"last_frame_url":  "https://x/last.png",
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if len(p.ImageWithRoles) != 0 {
		t.Fatalf("kling-v3 (non-omni) must not emit image_with_roles, got %v", p.ImageWithRoles)
	}
	want := []string{"https://x/first.png", "https://x/last.png"}
	if len(p.ImageUrls) != 2 || p.ImageUrls[0] != want[0] || p.ImageUrls[1] != want[1] {
		t.Fatalf("image_urls = %v, want %v (first frame first, end frame last, refs dropped)", p.ImageUrls, want)
	}
	out := marshalKlingPayload(t, p)
	for _, key := range []string{"first_frame_url", "last_frame_url"} {
		if _, ok := out[key]; ok {
			t.Errorf("flat key %q must not leak upstream", key)
		}
	}
}

func TestKlingV3NegativePromptTruncated(t *testing.T) {
	long := make([]rune, klingV3NegativePromptMaxChars+100)
	for i := range long {
		long[i] = '坏'
	}
	req := &relaycommon.TaskSubmitReq{
		Model:    "kling-v3-omni",
		Prompt:   "p",
		Metadata: map[string]any{"negative_prompt": string(long)},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	got, _ := p.Extras["negative_prompt"].(string)
	if runeLen := len([]rune(got)); runeLen != klingV3NegativePromptMaxChars {
		t.Errorf("negative_prompt rune len = %d, want %d", runeLen, klingV3NegativePromptMaxChars)
	}
}

func TestKlingV3OmniMotionTransferReferType(t *testing.T) {
	// 动作迁移：metadata.video_refer_type=feature 应落到 video_list[].refer_type，
	// 且 video_refer_type / keep_original_sound 本身不得泄漏为上游顶层字段。
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3-omni",
		Prompt: "p",
		Metadata: map[string]any{
			"video_refer_type":    "feature",
			"keep_original_sound": "yes",
			"content": []any{
				map[string]any{
					"type":      "video_url",
					"video_url": map[string]any{"url": "https://x/motion-ref.mp4"},
				},
			},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if len(p.VideoList) != 1 {
		t.Fatalf("video_list len = %d, want 1", len(p.VideoList))
	}
	if p.VideoList[0].ReferType != "feature" {
		t.Errorf("refer_type = %q, want feature", p.VideoList[0].ReferType)
	}
	if p.VideoList[0].KeepOriginalSound != "yes" {
		t.Errorf("keep_original_sound = %q, want yes", p.VideoList[0].KeepOriginalSound)
	}
	out := marshalKlingPayload(t, p)
	for _, key := range []string{"video_refer_type", "keep_original_sound"} {
		if _, ok := out[key]; ok {
			t.Errorf("flat key %q must not leak upstream", key)
		}
	}
}

func TestKlingV3OmniPerItemReferTypeOverride(t *testing.T) {
	// content[] 条目级 refer_type 覆盖 metadata 级默认值。
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3-omni",
		Prompt: "p",
		Metadata: map[string]any{
			"content": []any{
				map[string]any{
					"type":       "video_url",
					"video_url":  map[string]any{"url": "https://x/ref.mp4"},
					"refer_type": "feature",
				},
			},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if len(p.VideoList) != 1 || p.VideoList[0].ReferType != "feature" {
		t.Fatalf("video_list = %+v, want per-item refer_type feature", p.VideoList)
	}
}

func TestKlingV3OmniReferTypeDefaultsToBase(t *testing.T) {
	// 不带 video_refer_type 时维持旧行为：refer_type=base / keep_original_sound=no。
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3-omni",
		Prompt: "p",
		Metadata: map[string]any{
			"content": []any{
				map[string]any{
					"type":      "video_url",
					"video_url": map[string]any{"url": "https://x/prev.mp4"},
				},
			},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	if len(p.VideoList) != 1 || p.VideoList[0].ReferType != "base" || p.VideoList[0].KeepOriginalSound != "no" {
		t.Fatalf("video_list = %+v, want base/no defaults", p.VideoList)
	}
}

func TestKlingV3OmniMultiShotPassthrough(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{
		Model:  "kling-v3-omni",
		Prompt: "p",
		Metadata: map[string]any{
			"multi_shot": true,
			"shot_type":  "customize",
			"multi_prompt": []any{
				map[string]any{"index": 1, "prompt": "shot 1", "duration": 3},
				map[string]any{"index": 2, "prompt": "shot 2", "duration": 2},
			},
		},
	}
	p, err := BuildSubmitPayload(req)
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	out := marshalKlingPayload(t, p)
	if got, _ := out["multi_shot"].(bool); !got {
		t.Errorf("multi_shot must pass through")
	}
	if got, _ := out["shot_type"].(string); got != "customize" {
		t.Errorf("shot_type = %q, want customize", got)
	}
	if _, ok := out["multi_prompt"].([]any); !ok {
		t.Errorf("multi_prompt must pass through as array")
	}
}
