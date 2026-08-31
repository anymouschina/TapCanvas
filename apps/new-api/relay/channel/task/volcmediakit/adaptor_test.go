package volcmediakit

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// TestEnhanceCreditsMatchesBackendTable verifies every cell reproduces the
// backend VOLC_ENHANCE_VIDEO_PRICING table exactly (credits.service.ts).
func TestEnhanceCreditsMatchesBackendTable(t *testing.T) {
	cases := []struct {
		version    string
		resolution string
		limit      int
		fps        int
		want       int
	}{
		{"standard", "720p", 0, 0, 90},
		{"standard", "720p", 0, 60, 180},
		{"standard", "1080p", 0, 0, 180},
		{"standard", "1080p", 0, 60, 360},
		{"standard", "4k", 0, 0, 720},
		{"standard", "4k", 0, 60, 1440},
		{"professional", "720p", 0, 0, 750},
		{"professional", "720p", 0, 60, 1500},
		{"professional", "1080p", 0, 0, 1500},
		{"professional", "4k", 0, 60, 12000},
		// 2K tier only reachable via resolution_limit (1080 < limit <= 1440).
		{"standard", "", 1440, 0, 360},
		{"professional", "", 1440, 60, 6000},
		// resolution_limit short-edge mapping.
		{"standard", "", 720, 0, 90},
		{"standard", "", 1080, 0, 180},
		{"standard", "", 2000, 0, 720},
		// Defaults: unknown version → standard; no resolution → 1080P; fps<=30 → lte30.
		{"", "", 0, 0, 180},
		{"weird", "", 0, 30, 180},
	}
	for _, tc := range cases {
		got := EnhanceCredits(tc.version, tc.resolution, tc.limit, tc.fps)
		if got != tc.want {
			t.Errorf("EnhanceCredits(%q,%q,limit=%d,fps=%d) = %d, want %d",
				tc.version, tc.resolution, tc.limit, tc.fps, got, tc.want)
		}
	}
}

func TestEnhanceRatioIsCreditsOverBaseline(t *testing.T) {
	// standard/720P/lte30 is the base cell → ratio 1.0 (skipped by the relay).
	if r := EnhanceRatio("standard", "720p", 0, 0); r != 1.0 {
		t.Errorf("base ratio = %v, want 1.0", r)
	}
	// professional/4K/gt30 = 12000 credits → 12000/90.
	if r := EnhanceRatio("professional", "4k", 0, 60); r != float64(12000)/90.0 {
		t.Errorf("pro/4k/gt30 ratio = %v, want %v", r, float64(12000)/90.0)
	}
}

func metaReq(meta map[string]interface{}) *relaycommon.TaskSubmitReq {
	return &relaycommon.TaskSubmitReq{Metadata: meta}
}

func TestBuildSubmitPayload(t *testing.T) {
	t.Run("missing video_url is rejected", func(t *testing.T) {
		if _, err := BuildSubmitPayload(metaReq(map[string]interface{}{"tool_version": "standard"})); err == nil {
			t.Fatal("expected error for missing video_url")
		}
	})

	t.Run("resolution and resolution_limit mutually exclusive", func(t *testing.T) {
		_, err := BuildSubmitPayload(metaReq(map[string]interface{}{
			"video_url":        "https://x/v.mp4",
			"resolution":       "1080p",
			"resolution_limit": float64(720),
		}))
		if err == nil {
			t.Fatal("expected mutual-exclusion error")
		}
	})

	t.Run("builds full body from metadata", func(t *testing.T) {
		p, err := BuildSubmitPayload(metaReq(map[string]interface{}{
			"video_url":    "https://x/v.mp4",
			"tool_version": "professional",
			"scene":        "old_film",
			"resolution":   "4K", // upstream wants lowercase
			"fps":          float64(60),
		}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.VideoURL != "https://x/v.mp4" || p.ToolVersion != "professional" ||
			p.Scene != "old_film" || p.Resolution != "4k" || p.FPS != 60 {
			t.Fatalf("unexpected payload: %+v", p)
		}
	})

	t.Run("accepts camelCase params_def keys (toolVersion / resolutionLimit / videoUrl)", func(t *testing.T) {
		p, err := BuildSubmitPayload(metaReq(map[string]interface{}{
			"videoUrl":        "https://x/v.mp4",
			"toolVersion":     "professional",
			"resolutionLimit": float64(1440),
		}))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.VideoURL != "https://x/v.mp4" || p.ToolVersion != "professional" || p.ResolutionLimit != 1440 {
			t.Fatalf("camelCase keys not honored: %+v", p)
		}
	})

	t.Run("video_url falls back to InputReference", func(t *testing.T) {
		req := &relaycommon.TaskSubmitReq{InputReference: "https://x/ref.mp4"}
		p, err := BuildSubmitPayload(req)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.VideoURL != "https://x/ref.mp4" || p.ToolVersion != "standard" {
			t.Fatalf("unexpected payload: %+v", p)
		}
	})
}

func TestBuildToolPayloadSubtitleAuto(t *testing.T) {
	payload, err := BuildToolPayload(metaReq(map[string]interface{}{
		"video_url": "https://assets.example.com/source.mp4",
	}), SubtitleModel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	subtitle, ok := payload.(*SubtitlePayload)
	if !ok {
		t.Fatalf("payload type = %T, want *SubtitlePayload", payload)
	}
	if subtitle.VideoURL != "https://assets.example.com/source.mp4" || subtitle.ModelVersion != "" {
		t.Fatalf("unexpected subtitle payload: %+v", subtitle)
	}
}

func TestBuildToolPayloadSubtitleBoxSelection(t *testing.T) {
	payload, err := BuildToolPayload(metaReq(map[string]interface{}{
		"video_url": "https://assets.example.com/source.mp4",
		"edit_selections": []interface{}{
			map[string]interface{}{"x": 0.1, "y": 0.8, "width": 0.8, "height": 0.15},
		},
	}), SubtitleProModel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	subtitle, ok := payload.(*SubtitlePayload)
	if !ok {
		t.Fatalf("payload type = %T, want *SubtitlePayload", payload)
	}
	if subtitle.Mode != "Text" || len(subtitle.EraseRatioLocation) != 1 {
		t.Fatalf("unexpected box-select payload: %+v", subtitle)
	}
	location := subtitle.EraseRatioLocation[0]
	if math.Abs(location.TopLeftX-0.1) > 1e-9 || math.Abs(location.TopLeftY-0.8) > 1e-9 ||
		math.Abs(location.BottomRightX-0.9) > 1e-9 || math.Abs(location.BottomRightY-0.95) > 1e-9 {
		t.Fatalf("unexpected normalized location: %+v", location)
	}
}

func TestBuildToolPayloadRejectsInvalidSubtitleSelection(t *testing.T) {
	_, err := BuildToolPayload(metaReq(map[string]interface{}{
		"video_url":       "https://assets.example.com/source.mp4",
		"edit_selections": []interface{}{map[string]interface{}{"x": 0.9, "y": 0.9, "width": 0.2, "height": 0.2}},
	}), SubtitleProModel)
	if err == nil {
		t.Fatal("expected normalized bounds error")
	}
}

func TestBuildToolPayloadRejectsInvalidSubtitleModeAndVersion(t *testing.T) {
	_, err := BuildToolPayload(metaReq(map[string]interface{}{
		"video_url":    "https://assets.example.com/source.mp4",
		"mode":         "Unknown",
		"modelVersion": "v5",
	}), SubtitleProModel)
	if err == nil {
		t.Fatal("expected invalid mode error")
	}

	_, err = BuildToolPayload(metaReq(map[string]interface{}{
		"video_url":     "https://assets.example.com/source.mp4",
		"mode":          "Text",
		"model_version": "v3",
	}), SubtitleProModel)
	if err == nil {
		t.Fatal("expected invalid model version error")
	}
}

func TestBuildToolPayloadMatting(t *testing.T) {
	payload, err := BuildToolPayload(metaReq(map[string]interface{}{
		"video_url": "https://assets.example.com/source.mp4",
		"format":    "mov",
	}), MattingModel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	matting, ok := payload.(*MattingPayload)
	if !ok {
		t.Fatalf("payload type = %T, want *MattingPayload", payload)
	}
	if matting.Format != "MOV" {
		t.Fatalf("format = %q, want MOV", matting.Format)
	}
}

func TestToolPathsAndModelList(t *testing.T) {
	adaptor := &TaskAdaptor{baseURL: "https://mediakit.example.com", model: SubtitleProModel}
	url, err := adaptor.BuildRequestURL(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if url != "https://mediakit.example.com/api/v1/tools/erase-video-subtitle-pro" {
		t.Fatalf("url = %q", url)
	}
	models := adaptor.GetModelList()
	if len(models) != 4 || models[0] != EnhanceModel || models[1] != SubtitleModel || models[2] != SubtitleProModel || models[3] != MattingModel {
		t.Fatalf("unexpected model list: %#v", models)
	}
}

func TestParseTaskResult(t *testing.T) {
	a := &TaskAdaptor{}

	t.Run("completed yields success + url", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"status":"completed","result":{"duration":5.9,"video_url":"https://x/out.mp4"}}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusSuccess || info.Url != "https://x/out.mp4" {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("failed yields failure + reason", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":false,"status":"failed","error":"boom"}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusFailure || info.Reason != "boom" {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("submitted yields queued", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"status":"submitted"}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusQueued {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("unknown in-flight status yields in-progress", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"status":"processing","result":{}}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusInProgress {
			t.Fatalf("unexpected: %+v", info)
		}
	})

	t.Run("result url without terminal status still completes", func(t *testing.T) {
		info, err := a.ParseTaskResult([]byte(`{"success":true,"result":{"video_url":"https://x/out.mp4"}}`))
		if err != nil {
			t.Fatal(err)
		}
		if info.Status != model.TaskStatusSuccess || info.Url != "https://x/out.mp4" {
			t.Fatalf("unexpected: %+v", info)
		}
	})
}

func TestConvertToOpenAIVideoPreservesFinishingOutputMetadata(t *testing.T) {
	a := &TaskAdaptor{}
	origin := &model.Task{
		TaskID:   "enhance-task-1",
		Status:   model.TaskStatusSuccess,
		Progress: "100%",
		Properties: model.Properties{
			OriginModelName: "volc-enhance-video",
		},
		Data: json.RawMessage(`{
			"success":true,
			"task_id":"enhance-task-1",
			"task_type":"enhance-video",
			"status":"completed",
			"result":{
				"duration":96.2,
				"fps":30,
				"resolution":"1080p",
				"tool_version":"professional",
				"video_url":"https://x/master.mp4"
			}
		}`),
	}
	body, err := a.ConvertToOpenAIVideo(origin)
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Metadata map[string]interface{} `json:"metadata"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatal(err)
	}
	if response.Metadata["url"] != "https://x/master.mp4" ||
		response.Metadata["resolution"] != "1080p" ||
		response.Metadata["tool_version"] != "professional" ||
		response.Metadata["task_type"] != "enhance-video" ||
		response.Metadata["duration"] != 96.2 ||
		response.Metadata["fps"] != float64(30) {
		t.Fatalf("finishing output metadata not preserved: %+v", response.Metadata)
	}
}
