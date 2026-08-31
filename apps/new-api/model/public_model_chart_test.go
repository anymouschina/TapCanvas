package model

import "testing"

func TestPublicObservedSpecUsesEffectiveGptImageQuality(t *testing.T) {
	spec := publicObservedSpecFromBody(
		"gpt-image-2",
		"image",
		`{"model":"gpt-image-2","size":"16:9","resolution":"1K"}`,
	)
	if spec.key != "image:1k:low" {
		t.Fatalf("spec key = %q, want image:1k:low", spec.key)
	}
	if spec.label != "1K · low" {
		t.Fatalf("spec label = %q, want 1K · low", spec.label)
	}
}

func TestPublicObservedSpecUsesVideoResolutionAndDuration(t *testing.T) {
	spec := publicObservedSpecFromBody(
		"video-model",
		"video",
		`{"model":"video-model","resolution":"720p","duration":5}`,
	)
	if spec.key != "video:720p:5s" {
		t.Fatalf("spec key = %q, want video:720p:5s", spec.key)
	}
	if spec.label != "720P · 5s" {
		t.Fatalf("spec label = %q, want 720P · 5s", spec.label)
	}
}

func TestPublicObservedSpecReadsTopLevelImageSize(t *testing.T) {
	spec := publicObservedSpecFromBody(
		"gemini-3-pro-image-preview",
		"image",
		`{"model":"gemini-3-pro-image-preview","image_size":"4K"}`,
	)
	if spec.key != "image:4k" || spec.label != "4K" {
		t.Fatalf("spec = %#v, want image:4k / 4K", spec)
	}
}

func TestPublicObservedSpecReadsGeminiNativeImageSize(t *testing.T) {
	spec := publicObservedSpecFromBody(
		"gemini-3-pro-image-preview",
		"image",
		`{"generationConfig":{"imageConfig":{"imageSize":"4K"}}}`,
	)
	if spec.key != "image:4k" || spec.label != "4K" {
		t.Fatalf("spec = %#v, want image:4k / 4K", spec)
	}
}

func TestPublicObservedSpecReadsOpenAIExtraBodyImageSize(t *testing.T) {
	spec := publicObservedSpecFromBody(
		"gemini-3-pro-image-preview",
		"image",
		`{"extra_body":{"google":{"image_config":{"image_size":"4K"}}}}`,
	)
	if spec.key != "image:4k" || spec.label != "4K" {
		t.Fatalf("spec = %#v, want image:4k / 4K", spec)
	}
}

func TestPublicObservedSpecMarksTextAsStandard(t *testing.T) {
	spec := publicObservedSpecFromBody("chat-model", "chat", `{"model":"chat-model"}`)
	if spec.key != publicSpecKeyStandard || spec.label != "标准调用" {
		t.Fatalf("spec = %#v, want standard call", spec)
	}
}

func TestPublicObservedSpecSurfacesInvalidTrace(t *testing.T) {
	spec := publicObservedSpecFromBody("image-model", "image", `{invalid`)
	if spec.key != publicSpecKeyInvalid || spec.label != "规格记录无效" {
		t.Fatalf("spec = %#v, want invalid trace", spec)
	}
}
