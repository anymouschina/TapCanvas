package model

import (
	"encoding/json"
	"testing"
)

func TestCanonicalModelKey(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input string
		want  string
	}{
		{input: "gpt-image-2-apimart", want: "gpt-image-2"},
		{input: "gpt-image-2-suchuang", want: "gpt-image-2"},
		{input: "gpt-image-2-all", want: "gpt-image-2"},
		{input: "gemini-2.5-pro-apimart", want: "gemini-2.5-pro"},
		{input: "nano-banana-pro-suchuang", want: "nano-banana-pro"},
		{input: "veo_3_1-fast", want: "veo-3.1"},
		{input: "veo_3_1", want: "veo-3.1"},
		{input: "veo3.1-fast", want: "veo-3.1"},
		{input: "veo-3.1", want: "veo-3.1"},
		{input: "sora-2", want: "sora2"},
		{input: "sora-2-8s", want: "sora2"},
		{input: "sora-2-12s", want: "sora2"},
		{input: "sora-2-oai", want: "sora2"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.input, func(t *testing.T) {
			t.Parallel()
			if got := CanonicalModelKey(tt.input); got != tt.want {
				t.Fatalf("CanonicalModelKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestRoutingModelCandidates(t *testing.T) {
	t.Parallel()

	got := RoutingModelCandidates("gpt-image-2")
	expected := map[string]bool{
		"gpt-image-2":          true,
		"gpt-image-2-apimart":  true,
		"gpt-image-2-suchuang": true,
		"gpt-image-2-all":      true,
	}
	for _, candidate := range got {
		delete(expected, candidate)
	}
	if len(expected) != 0 {
		t.Fatalf("RoutingModelCandidates missing candidates: %+v, got=%v", expected, got)
	}
}

func TestRoutingModelCandidatesFromCanonicalizedAlias(t *testing.T) {
	t.Parallel()

	got := RoutingModelCandidates("gemini-2.5-pro-apimart")
	expected := map[string]bool{
		"gemini-2.5-pro":         true,
		"gemini-2.5-pro-apimart": true,
	}
	for _, candidate := range got {
		delete(expected, candidate)
	}
	if len(expected) != 0 {
		t.Fatalf("RoutingModelCandidates missing candidates: %+v, got=%v", expected, got)
	}
}

func TestRoutingModelSelectionCandidatesKeepsExplicitAliasStrict(t *testing.T) {
	t.Parallel()

	got := RoutingModelSelectionCandidates("gpt-image-2-all")
	if len(got) != 1 || got[0] != "gpt-image-2-all" {
		t.Fatalf("RoutingModelSelectionCandidates(gpt-image-2-all) = %v", got)
	}
}

func TestRoutingModelSelectionCandidatesExpandsCanonicalModel(t *testing.T) {
	t.Parallel()

	got := RoutingModelSelectionCandidates("gpt-image-2")
	expected := map[string]bool{
		"gpt-image-2":     true,
		"gpt-image-2-all": true,
		"gpt-image-2-vip": true,
	}
	for _, candidate := range got {
		delete(expected, candidate)
	}
	if len(expected) != 0 {
		t.Fatalf("RoutingModelSelectionCandidates(gpt-image-2) missing %+v, got=%v", expected, got)
	}
}

func TestRoutingModelSelectionCandidatesKeepsVeo31Strict(t *testing.T) {
	t.Parallel()

	got := RoutingModelSelectionCandidates("veo-3.1")
	if len(got) != 1 || got[0] != "veo-3.1" {
		t.Fatalf("RoutingModelSelectionCandidates(veo-3.1) = %v", got)
	}
}

func TestRoutingModelSelectionCandidatesKeepsSora2Strict(t *testing.T) {
	t.Parallel()

	got := RoutingModelSelectionCandidates("sora2")
	if len(got) != 1 || got[0] != "sora2" {
		t.Fatalf("RoutingModelSelectionCandidates(sora2) = %v", got)
	}
}

func TestBuildImplicitModelMapping(t *testing.T) {
	t.Parallel()

	channel := &Channel{Models: "gpt-image-2-suchuang,veo3.1-fast-suchuang"}
	raw := BuildImplicitModelMapping(channel)
	if raw == "" {
		t.Fatal("BuildImplicitModelMapping returned empty mapping")
	}

	var mapping map[string]string
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		t.Fatalf("unmarshal mapping failed: %v", err)
	}
	if got := mapping["gpt-image-2"]; got != "gpt-image-2-suchuang" {
		t.Fatalf("mapping[gpt-image-2] = %q", got)
	}
	if got := mapping["gpt-image-2-apimart"]; got != "gpt-image-2-suchuang" {
		t.Fatalf("mapping[gpt-image-2-apimart] = %q", got)
	}
	if got, exists := mapping["veo-3.1"]; exists {
		t.Fatalf("unexpected mapping[veo-3.1] = %q", got)
	}
	if got, exists := mapping["veo_3_1-fast"]; exists {
		t.Fatalf("unexpected mapping[veo_3_1-fast] = %q", got)
	}
}

func TestBuildImplicitModelMappingSkipsCanonicalWhenChannelAlreadyHasIt(t *testing.T) {
	t.Parallel()

	explicit := `{"gpt-image-2-apimart":"gpt-image-2"}`
	channel := &Channel{
		Models:       "gpt-image-2,gpt-image-2-apimart",
		ModelMapping: &explicit,
	}
	raw := BuildImplicitModelMapping(channel)

	var mapping map[string]string
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		t.Fatalf("unmarshal mapping failed: %v", err)
	}
	if got, exists := mapping["gpt-image-2"]; exists {
		t.Fatalf("unexpected reverse mapping for canonical model: %q", got)
	}
	if got := mapping["gpt-image-2-apimart"]; got != "gpt-image-2" {
		t.Fatalf("mapping[gpt-image-2-apimart] = %q", got)
	}
}

func TestBuildImplicitModelMappingResolvesCrossVendorAliasToSupportedChannelKey(t *testing.T) {
	t.Parallel()

	channel := &Channel{Models: "nanobanana2-suchuang"}
	raw := BuildImplicitModelMapping(channel)
	if raw == "" {
		t.Fatal("BuildImplicitModelMapping returned empty mapping")
	}

	var mapping map[string]string
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		t.Fatalf("unmarshal mapping failed: %v", err)
	}
	if got := mapping["nanobanana2"]; got != "nanobanana2-suchuang" {
		t.Fatalf("mapping[nanobanana2] = %q", got)
	}
}
