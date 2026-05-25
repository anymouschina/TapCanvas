package controller

import (
	"reflect"
	"testing"
)

func TestBuildModelsChainPreservesOfficialModelKeys(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		model string
		want  []string
	}{
		{
			name:  "gpt image official",
			model: "gpt-image-2-official",
			want:  []string{"gpt-image-2-official"},
		},
		{
			name:  "gemini image official",
			model: "gemini-3-pro-image-preview-official",
			want:  []string{"gemini-3-pro-image-preview-official"},
		},
		{
			name:  "base model",
			model: "gpt-image-2",
			want:  []string{"gpt-image-2"},
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := buildModelsChain(tt.model)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("buildModelsChain(%q) = %#v, want %#v", tt.model, got, tt.want)
			}
		})
	}
}
