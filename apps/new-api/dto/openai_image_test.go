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

func TestImageRequestMarshalJSONPreservesGaiscEditReferences(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"model":"gpt-image-2",
		"prompt":"make the background white",
		"images":[{"image_url":"https://example.com/input.png"}],
		"mask":{"image_url":"https://example.com/mask.png"},
		"size":"2048x2048",
		"response_format":"url",
		"stream":false
	}`)

	var request ImageRequest
	require.NoError(t, common.Unmarshal(raw, &request))
	require.Len(t, request.Images, 1)
	require.Equal(t, "https://example.com/input.png", request.Images[0].ImageURL)
	require.NotNil(t, request.Mask)
	require.Equal(t, "https://example.com/mask.png", request.Mask.ImageURL)

	encoded, err := common.Marshal(request)
	require.NoError(t, err)

	var payload map[string]json.RawMessage
	require.NoError(t, common.Unmarshal(encoded, &payload))
	require.Contains(t, payload, "images")
	require.Contains(t, payload, "mask")
	require.Contains(t, payload, "stream")
}

func TestImageRequestAcceptsStringEditReferencesAndMarshalsCanonicalShape(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"model":"gpt-image-2",
		"prompt":"keep the product and change the background",
		"images":["https://example.com/input.png"],
		"mask":"https://example.com/mask.png"
	}`)

	var request ImageRequest
	require.NoError(t, common.Unmarshal(raw, &request))
	require.Equal(t, []ImageURLReference{{ImageURL: "https://example.com/input.png"}}, request.Images)
	require.Equal(t, &ImageURLReference{ImageURL: "https://example.com/mask.png"}, request.Mask)

	encoded, err := common.Marshal(request)
	require.NoError(t, err)

	var payload map[string]json.RawMessage
	require.NoError(t, common.Unmarshal(encoded, &payload))
	require.JSONEq(t, `[{"image_url":"https://example.com/input.png"}]`, string(payload["images"]))
	require.JSONEq(t, `{"image_url":"https://example.com/mask.png"}`, string(payload["mask"]))
}

func TestValidateGptImage2Size(t *testing.T) {
	t.Parallel()

	valid := []string{"", "auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "1024x1024", "1536x1024", "2048x2048", "3840x2160", "2160x3840"}
	for _, size := range valid {
		size := size
		t.Run("valid_"+size, func(t *testing.T) {
			t.Parallel()
			require.NoError(t, ValidateGptImage2Size(size))
		})
	}

	invalid := []string{"1K", "0:1", "1:0", "1:4", "1024x1025", "256x256", "2048x512", "4000x2080", "2048*2048", "1024×1024"}
	for _, size := range invalid {
		size := size
		t.Run("invalid_"+size, func(t *testing.T) {
			t.Parallel()
			require.Error(t, ValidateGptImage2Size(size))
		})
	}
}

func TestNormalizeGptImage2SizeUsesFrontendRatioAndResolution(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name       string
		aspect     string
		resolution string
		want       string
	}{
		{name: "square_1k", aspect: "1:1", resolution: "1K", want: "1024x1024"},
		{name: "landscape_2k", aspect: "16:9", resolution: "2K", want: "2048x1152"},
		{name: "portrait_4k", aspect: "9:16", resolution: "4K", want: "2160x3840"},
		{name: "portrait_three_four_1k", aspect: "3:4", resolution: "1K", want: "864x1152"},
		{name: "landscape_four_three_2k", aspect: "4:3", resolution: "2K", want: "2048x1536"},
		{name: "portrait_four_five_4k", aspect: "4:5", resolution: "4K", want: "2560x3200"},
		{name: "ultrawide_twenty_one_nine_4k", aspect: "21:9", resolution: "4K", want: "3696x1584"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := ImageRequest{
				Size: test.aspect,
				Extra: map[string]json.RawMessage{
					"imageSize": json.RawMessage(`"` + test.resolution + `"`),
				},
			}
			resolved, err := NormalizeGptImage2Size(request)
			require.NoError(t, err)
			require.Equal(t, test.want, resolved.Size)
		})
	}
}

func TestCanonicalizeGptImage2SizeAliases(t *testing.T) {
	t.Parallel()

	request := ImageRequest{
		Extra: map[string]json.RawMessage{
			"aspect_ratio": json.RawMessage(`"3:4"`),
			"resolution":   json.RawMessage(`"2K"`),
		},
	}

	canonical := CanonicalizeGptImage2SizeAliases(request)
	require.Equal(t, "3:4", canonical.Size)

	resolved, err := NormalizeGptImage2Size(canonical)
	require.NoError(t, err)
	require.Equal(t, "1536x2048", resolved.Size)
}
