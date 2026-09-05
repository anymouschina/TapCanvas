package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
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
	if got[1].ModelName != "veo-3.1" {
		t.Fatalf("second model_name = %q", got[1].ModelName)
	}
}

func TestBuildCanonicalModelListPublishesAuthoritativeRoutingAliases(t *testing.T) {
	t.Parallel()

	rows := []model.Model{{
		Id:        21,
		ModelName: "doubao-seedance-2.0",
		Kind:      "video",
	}}

	got := buildCanonicalModelList(rows)
	if len(got) != 1 {
		t.Fatalf("buildCanonicalModelList len = %d, want 1", len(got))
	}
	wantAlias := "doubao-seedance-2-0-260128"
	found := false
	for _, alias := range got[0].RoutingAliases {
		if alias == wantAlias {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("routing_aliases = %v, missing %q", got[0].RoutingAliases, wantAlias)
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
	if _, ok := got["veo-3.1"]; !ok {
		t.Fatal("missing veo-3.1 entry")
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

func TestBuildCanonicalModelParamsCatalogPreservesExtendedConstraints(t *testing.T) {
	t.Parallel()

	rows := []model.Model{{
		ModelName:    "constraint-model",
		Kind:         "video",
		Capabilities: `["reference_images"]`,
		ParamsDef:    `[{"key":"images","type":"array","item_type":"object","aliases":["reference_images"],"min_items":1,"max_items":8,"recommended_max_items":4,"required_when":{"all":[{"field":"mode","operator":"eq","value":"reference"}]},"forbidden_when":{"all":[{"field":"mode","operator":"eq","value":"text"}]},"items":{"type":"object","required":["url"]},"item_properties":[{"key":"url","type":"string","required":true}],"constraints":[{"type":"combined_max_items","fields":["images","audios"],"max_items":12}],"limit_status":"documented","sources":[{"name":"provider docs","url":"https://example.com/docs","checked_at":"2026-09-05"}]}]`,
	}}

	entry := buildCanonicalModelParamsCatalog(rows)["constraint-model"]
	require.Len(t, entry.Params, 1)
	param := entry.Params[0]
	require.Equal(t, "object", param.ItemType)
	require.Equal(t, []string{"reference_images"}, param.Aliases)
	require.NotNil(t, param.MinItems)
	require.Equal(t, 1, *param.MinItems)
	require.NotNil(t, param.MaxItems)
	require.Equal(t, 8, *param.MaxItems)
	require.NotEmpty(t, param.RequiredWhen)
	require.NotEmpty(t, param.ForbiddenWhen)
	require.NotEmpty(t, param.Items)
	require.Len(t, param.ItemProperties, 1)
	require.Len(t, param.Constraints, 1)
	require.Equal(t, "documented", param.LimitStatus)
	require.Equal(t, []dto.ModelParamSource{{Name: "provider docs", URL: "https://example.com/docs", CheckedAt: "2026-09-05"}}, entry.Sources)
}
