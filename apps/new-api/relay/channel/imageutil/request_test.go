package imageutil

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
)

func TestExtractRequestedImageSizeSupportsResolutionAliases(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		extra map[string]json.RawMessage
		want  string
	}{
		{
			name:  "resolution",
			extra: map[string]json.RawMessage{"resolution": json.RawMessage(`"4K"`)},
			want:  "4K",
		},
		{
			name:  "image_size",
			extra: map[string]json.RawMessage{"image_size": json.RawMessage(`"2K"`)},
			want:  "2K",
		},
		{
			name:  "imageSize",
			extra: map[string]json.RawMessage{"imageSize": json.RawMessage(`"1K"`)},
			want:  "1K",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := ExtractRequestedImageSize(&dto.ImageRequest{Extra: test.extra})
			if got != test.want {
				t.Fatalf("ExtractRequestedImageSize() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestExtractRequestedImageSizePrefersExplicitResolution(t *testing.T) {
	t.Parallel()

	request := &dto.ImageRequest{Extra: map[string]json.RawMessage{
		"resolution": json.RawMessage(`"4K"`),
		"image_size": json.RawMessage(`"2K"`),
	}}
	if got := ExtractRequestedImageSize(request); got != "4K" {
		t.Fatalf("ExtractRequestedImageSize() = %q, want 4K", got)
	}
}
