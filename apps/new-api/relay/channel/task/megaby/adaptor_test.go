package megaby

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestPublicModelsRetainIndependentPricingIdentity(t *testing.T) {
	for _, publicModel := range ModelList {
		if canonical := model.CanonicalModelKey(publicModel); canonical != publicModel {
			t.Fatalf("public model %q collapsed into canonical model %q", publicModel, canonical)
		}
	}
}

func TestParseTaskResultMatchesLiveCompletedShape(t *testing.T) {
	adaptor := &TaskAdaptor{}
	result, err := adaptor.ParseTaskResult([]byte(`{
		"id":"task_live","task_id":"task_live","model":"sd-mini-480p",
		"status":"completed","progress":100,
		"url":"https://newapi.megabyai.cc/v1/videos/task_live/content.mp4",
		"video_url":"https://newapi.megabyai.cc/v1/videos/task_live/content.mp4",
		"metadata":{"content_url":"https://newapi.megabyai.cc/v1/videos/task_live/content.mp4"}
	}`))
	if err != nil {
		t.Fatalf("ParseTaskResult: %v", err)
	}
	if result.Status != model.TaskStatusSuccess || result.Progress != "100%" {
		t.Fatalf("unexpected status: %+v", result)
	}
	if result.Url != "https://newapi.megabyai.cc/v1/videos/task_live/content.mp4" {
		t.Fatalf("url = %q", result.Url)
	}
}

func TestParseTaskResultReadsMetadataContentURL(t *testing.T) {
	result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"task_id":"task_metadata","status":"completed","progress":100,
		"metadata":{"content_url":"https://cdn.example/result.mp4"}
	}`))
	if err != nil {
		t.Fatalf("ParseTaskResult: %v", err)
	}
	if result.Url != "https://cdn.example/result.mp4" {
		t.Fatalf("url = %q", result.Url)
	}
}

func TestParseTaskResultPreservesProviderFailure(t *testing.T) {
	result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"task_id":"task_failed","status":"failed","progress":100,
		"error":{"code":"unsupported_material","message":"素材格式不被支持"}
	}`))
	if err != nil {
		t.Fatalf("ParseTaskResult: %v", err)
	}
	if result.Status != model.TaskStatusFailure || result.Reason != "素材格式不被支持" {
		t.Fatalf("unexpected failure: %+v", result)
	}
}

func TestParseTaskResultRejectsCompletedWithoutAsset(t *testing.T) {
	if _, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"task_id":"task_missing","status":"completed","progress":100
	}`)); err == nil {
		t.Fatal("expected missing asset error")
	}
}

func TestParseTaskResultRejectsUnknownStatus(t *testing.T) {
	if _, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"task_id":"task_unknown","status":"mystery","progress":42
	}`)); err == nil {
		t.Fatal("expected unknown status error")
	}
}
