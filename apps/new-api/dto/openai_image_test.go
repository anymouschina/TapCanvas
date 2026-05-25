package dto

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestImageRequestMarshalJSONPreservesExtraImageFields(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"model":"nanobanana2",
		"prompt":"restore product detail image",
		"image_urls":["https://example.com/a.png","https://example.com/b.png"],
		"image_size":"1080p"
	}`)

	var request ImageRequest
	require.NoError(t, common.Unmarshal(raw, &request))

	encoded, err := common.Marshal(request)
	require.NoError(t, err)

	var payload map[string]json.RawMessage
	require.NoError(t, common.Unmarshal(encoded, &payload))

	require.Contains(t, payload, "image_urls")
	require.Contains(t, payload, "image_size")

	var imageURLs []string
	require.NoError(t, common.Unmarshal(payload["image_urls"], &imageURLs))
	require.Equal(t, []string{"https://example.com/a.png", "https://example.com/b.png"}, imageURLs)

	var imageSize string
	require.NoError(t, common.Unmarshal(payload["image_size"], &imageSize))
	require.Equal(t, "1080p", imageSize)
}
