package middleware

import "testing"

func TestNormalizeRequestedModelNamePreservesProviderSpecificKey(t *testing.T) {
	t.Parallel()

	original, routing := normalizeRequestedModelName("nanobanana2-suchuang")
	if original != "nanobanana2-suchuang" {
		t.Fatalf("original = %q, want %q", original, "nanobanana2-suchuang")
	}
	if routing != "nanobanana2" {
		t.Fatalf("routing = %q, want %q", routing, "nanobanana2")
	}
}

func TestNormalizeRequestedModelNameKeepsCanonicalAliasStable(t *testing.T) {
	t.Parallel()

	original, routing := normalizeRequestedModelName("nanobanana2")
	if original != "nanobanana2" {
		t.Fatalf("original = %q, want %q", original, "nanobanana2")
	}
	if routing != "nanobanana2" {
		t.Fatalf("routing = %q, want %q", routing, "nanobanana2")
	}
}
