package funai

import (
	"slices"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestModelListExposesOnlyFunAISuffixedModels(t *testing.T) {
	want := []string{"seedance-2.0-funai", "kling-o3-funai", "kling-v3-funai"}
	if !slices.Equal(ModelList, want) {
		t.Fatalf("ModelList = %v, want %v", ModelList, want)
	}
}

func TestBuildSeedance20PayloadPreservesExplicitAudioFalse(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model:       modelSeedance20,
		Prompt:      "ocean sunrise",
		Resolution:  "720p",
		AspectRatio: "16:9",
		Duration:    8,
		Metadata: map[string]any{
			"audio":            false,
			"reference_images": []any{"https://x/subject.png"},
		},
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Model != modelSeedance20 || payload.Audio == nil || *payload.Audio {
		t.Fatalf("unexpected model/audio: model=%q audio=%v", payload.Model, payload.Audio)
	}
	if payload.Quantity == nil || *payload.Quantity != 1 {
		t.Fatalf("quantity = %v, want 1", payload.Quantity)
	}
	if len(payload.ReferenceImages) != 1 {
		t.Fatalf("reference_images = %v", payload.ReferenceImages)
	}
}

func TestBuildSeedance20RejectsNon720P(t *testing.T) {
	_, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelSeedance20, Resolution: "1080p", Duration: 8,
	})
	if err == nil {
		t.Fatal("expected 1080P rejection")
	}
}

func TestBuildKlingV3SelectsBaseForTextAndFrames(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingV3, Duration: 5, Images: []string{"https://x/first.png", "https://x/last.png"},
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Model != modelKlingV3 {
		t.Fatalf("model = %q", payload.Model)
	}
	if payload.StartFrame != "https://x/first.png" || payload.EndFrame != "https://x/last.png" {
		t.Fatalf("frames = %q / %q", payload.StartFrame, payload.EndFrame)
	}
}

func TestBuildKlingV3BaseRejectsMoreThanTwoFrameInputs(t *testing.T) {
	_, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingV3, Duration: 5,
		Images: []string{"https://x/one.png", "https://x/two.png", "https://x/three.png"},
	})
	if err == nil {
		t.Fatal("expected frame-count error")
	}
}

func TestBuildKlingV3SelectsOmniForStructuredV2V(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingV3, Resolution: "720P", AspectRatio: "16:9", Duration: 8,
		Metadata: map[string]any{
			"input_video":       "https://x/source.mp4",
			"style_references":  []any{"https://x/style.png"},
			"elementReferences": []any{"https://x/subject.png"},
		},
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Model != modelKlingV3OmniV2V {
		t.Fatalf("model = %q, want %q", payload.Model, modelKlingV3OmniV2V)
	}
	if payload.InputVideo == "" || len(payload.StyleReferences) != 1 || len(payload.ElementReferences) != 1 {
		t.Fatalf("unexpected V2V inputs: %+v", payload)
	}
}

func TestBuildKlingV3OmniRejectsAmbiguousUntypedImages(t *testing.T) {
	_, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingV3, Resolution: "720P", Duration: 8,
		Images:   []string{"https://x/subject.png"},
		Metadata: map[string]any{"input_video": "https://x/source.mp4"},
	})
	if err == nil {
		t.Fatal("expected ambiguous reference error")
	}
}

func TestBuildKlingV3OmniFeatureTreatsGenericImagesAsElements(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingV3, Resolution: "720P", Duration: 8,
		Images: []string{"https://x/subject.png"},
		Metadata: map[string]any{
			"input_video":      "https://x/source.mp4",
			"video_refer_type": "feature",
		},
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if len(payload.ElementReferences) != 1 || payload.ElementReferences[0] != "https://x/subject.png" {
		t.Fatalf("element_references = %v", payload.ElementReferences)
	}
}

func TestBuildKlingO3SelectsStandardForBasicV2V(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingO3, Resolution: "720P", Duration: 8,
		Metadata: map[string]any{
			"input_video":     "https://x/source.mp4",
			"referenceImages": []any{"https://x/frame.png"},
		},
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Model != modelKlingO3StandardV2V {
		t.Fatalf("model = %q, want standard V2V", payload.Model)
	}
	if len(payload.Images) != 1 || len(payload.ReferenceImages) != 0 {
		t.Fatalf("images = %v, reference_images = %v", payload.Images, payload.ReferenceImages)
	}
}

func TestBuildKlingO3SelectsProForTypedReferences(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingO3, Resolution: "720P", Duration: 8,
		Metadata: map[string]any{
			"input_video":        "https://x/source.mp4",
			"element_references": []any{"https://x/product.png"},
		},
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Model != modelKlingO3ProV2V {
		t.Fatalf("model = %q, want pro V2V", payload.Model)
	}
}

func TestBuildKlingO3KeepsOrdinaryReferencesOnBaseModel(t *testing.T) {
	payload, err := BuildSubmitPayload(&relaycommon.TaskSubmitReq{
		Model: modelKlingO3, Resolution: "1080P", Duration: 5,
		ReferenceImages: []string{"https://x/a.png", "https://x/b.png"},
	})
	if err != nil {
		t.Fatalf("BuildSubmitPayload: %v", err)
	}
	if payload.Model != modelKlingO3 || len(payload.ReferenceImages) != 2 {
		t.Fatalf("unexpected base payload: %+v", payload)
	}
}
