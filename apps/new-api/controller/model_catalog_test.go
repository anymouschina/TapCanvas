package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestBuildCanonicalModelList(t *testing.T) {
	t.Parallel()

	rows := []model.Model{
		{
			Id:          11,
			ModelName:   "gpt-image-2-apimart",
			Description: "alias row",
			Kind:        "image",
		},
		{
			Id:          10,
			ModelName:   "gpt-image-2",
			Description: "canonical row",
			Kind:        "image",
		},
		{
			Id:          9,
			ModelName:   "veo_3_1-fast",
			Description: "underscore alias row",
			Kind:        "video",
		},
	}

	got := buildCanonicalModelList(rows)
	if len(got) != 2 {
		t.Fatalf("buildCanonicalModelList len = %d, want 2", len(got))
	}
	if got[0].ModelName != "gpt-image-2" {
		t.Fatalf("first model_name = %q", got[0].ModelName)
	}
	if got[0].Description != "canonical row" {
		t.Fatalf("first description = %q", got[0].Description)
	}
	if got[1].ModelName != "veo3.1-fast" {
		t.Fatalf("second model_name = %q", got[1].ModelName)
	}
}

func TestBuildCanonicalModelParamsCatalog(t *testing.T) {
	t.Parallel()

	rows := []model.Model{
		{
			ModelName:    "gpt-image-2-apimart",
			Kind:         "image",
			Capabilities: `["reference_images"]`,
			ParamsDef:    `[{"key":"size","type":"enum"}]`,
		},
		{
			ModelName:    "gpt-image-2-suchuang",
			Kind:         "image",
			Capabilities: `["reference_images","mask"]`,
		},
		{
			ModelName: "veo_3_1",
			Kind:      "video",
		},
	}

	got := buildCanonicalModelParamsCatalog(rows)
	if len(got) != 2 {
		t.Fatalf("buildCanonicalModelParamsCatalog len = %d, want 2", len(got))
	}
	gptEntry, ok := got["gpt-image-2"]
	if !ok {
		t.Fatal("missing gpt-image-2 entry")
	}
	if gptEntry.Kind != "image" {
		t.Fatalf("gpt-image-2 kind = %q", gptEntry.Kind)
	}
	if len(gptEntry.Params) != 1 {
		t.Fatalf("gpt-image-2 params len = %d", len(gptEntry.Params))
	}
	if len(gptEntry.Capabilities) != 2 {
		t.Fatalf("gpt-image-2 capabilities len = %d", len(gptEntry.Capabilities))
	}
	if _, ok := got["veo3.1-pro"]; !ok {
		t.Fatal("missing veo3.1-pro entry")
	}
}

func TestBuildCanonicalModelParamsCatalogKeepsCanonicalImageSizeKey(t *testing.T) {
	t.Parallel()

	rows := []model.Model{
		{
			ModelName:    "nanobanana2-suchuang",
			Kind:         "image",
			Capabilities: `["reference_images"]`,
			ParamsDef: `[
				{"key":"size","type":"enum"},
				{"key":"image_size","type":"enum"},
				{"key":"urls","type":"array","scope":"per_request"}
			]`,
		},
		{
			ModelName:    "nanobanana2",
			Kind:         "image",
			Capabilities: `[]`,
		},
	}

	got := buildCanonicalModelParamsCatalog(rows)
	entry, ok := got["nanobanana2"]
	if !ok {
		t.Fatal("missing nanobanana2 entry")
	}
	if len(entry.Params) != 3 {
		t.Fatalf("nanobanana2 params len = %d", len(entry.Params))
	}
	if entry.Params[1].Key != "image_size" {
		t.Fatalf("nanobanana2 second param key = %q, want image_size", entry.Params[1].Key)
	}
}

func TestBuildCanonicalModelParamsCatalogKeepsGeminiImageAspectRatio(t *testing.T) {
	t.Parallel()

	rows := []model.Model{
		{
			ModelName:    "gemini-3.1-flash-image-preview",
			Kind:         "image",
			Capabilities: `["reference_images"]`,
			ParamsDef: `[
				{"key":"size","type":"enum","default":"1:1","options":[{"value":"1:1","label":"1:1"},{"value":"16:9","label":"16:9"}]},
				{"key":"image_size","type":"enum","default":"1K","options":[{"value":"1K","label":"1K"},{"value":"2K","label":"2K"},{"value":"4K","label":"4K"}]}
			]`,
		},
	}

	got := buildCanonicalModelParamsCatalog(rows)
	entry, ok := got["gemini-3.1-flash-image-preview"]
	if !ok {
		t.Fatal("missing gemini-3.1-flash-image-preview entry")
	}
	if len(entry.Params) != 2 {
		t.Fatalf("gemini-3.1-flash-image-preview params len = %d", len(entry.Params))
	}
	if entry.Params[0].Key != "size" {
		t.Fatalf("first param key = %q, want size", entry.Params[0].Key)
	}
	if entry.Params[1].Key != "image_size" {
		t.Fatalf("second param key = %q, want image_size", entry.Params[1].Key)
	}
}
