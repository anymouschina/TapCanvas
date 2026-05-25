package wuyinkeji

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestBuildPayloadMapsImageSizeAliasForNanoBanana2(t *testing.T) {
	t.Parallel()

	payloadValue, err := BuildPayload("nanobanana2-suchuang", &relaycommon.TaskSubmitReq{
		Prompt: "recreate the same product detail layout",
		Images: []string{"https://example.com/ref-a.png", "https://example.com/ref-b.png"},
		Metadata: map[string]any{
			"image_size": "1080p",
		},
	})
	require.NoError(t, err)

	payload, ok := payloadValue.(nanoBananaProPayload)
	require.True(t, ok)
	require.Equal(t, "1K", payload.Size)
	require.Equal(t, []string{"https://example.com/ref-a.png", "https://example.com/ref-b.png"}, payload.Urls)
}
