package openai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newImageEditJSONTestContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", nil)
	context.Request.Header.Set("Content-Type", "application/json")
	return context
}

func newImageRelayInfo(channelType int, relayMode int) *relaycommon.RelayInfo {
	requestURLPath := "/v1/images/generations"
	if relayMode == relayconstant.RelayModeImagesEdits {
		requestURLPath = "/v1/images/edits"
	}
	return &relaycommon.RelayInfo{
		RelayMode:      relayMode,
		RequestURLPath: requestURLPath,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       channelType,
			ChannelBaseUrl:    "https://sub.g-aisc.com",
			ProtocolID:        constant.ProtocolOpenAI,
			ApiKey:            "test-key",
			UpstreamModelName: "gpt-image-2",
		},
	}
}

func TestConvertImageRequestPreservesGaiscJSONEditShape(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:          "gpt-image-2",
		Prompt:         "make the background white",
		Images:         []dto.ImageURLReference{{ImageURL: "https://example.com/input.png"}},
		Mask:           &dto.ImageURLReference{ImageURL: "https://example.com/mask.png"},
		Size:           "2048x2048",
		Quality:        "auto",
		ResponseFormat: "url",
	}
	context := newImageEditJSONTestContext()

	converted, err := (&Adaptor{}).ConvertImageRequest(
		context,
		newImageRelayInfo(constant.ChannelTypeGaiscImage, relayconstant.RelayModeImagesEdits),
		request,
	)
	require.NoError(t, err)
	convertedRequest, ok := converted.(dto.ImageRequest)
	require.True(t, ok)
	require.Equal(t, request.Model, convertedRequest.Model)
	require.Equal(t, request.Prompt, convertedRequest.Prompt)
	require.Equal(t, request.Images, convertedRequest.Images)
	require.Equal(t, request.Mask, convertedRequest.Mask)
	require.Equal(t, "application/json", context.Request.Header.Get("Content-Type"))
}

func TestConvertImageRequestNormalizesGptImage2RatioForGeneration(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gpt-image-2",
		Prompt: "test",
		Size:   "16:9",
		Extra:  map[string]json.RawMessage{"imageSize": json.RawMessage(`"2K"`)},
	}
	context := newImageEditJSONTestContext()
	context.Request.URL.Path = "/v1/images/generations"
	info := newImageRelayInfo(constant.ChannelTypeOpenAI, relayconstant.RelayModeImagesGenerations)

	converted, err := (&Adaptor{}).ConvertImageRequest(context, info, request)
	require.NoError(t, err)
	convertedRequest, ok := converted.(dto.ImageRequest)
	require.True(t, ok)
	require.Equal(t, "2048x1152", convertedRequest.Size)
}

func TestConvertImageRequestNormalizesGptImage2RatioForJSONEdit(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gpt-image-2",
		Prompt: "make the background white",
		Images: []dto.ImageURLReference{{ImageURL: "https://example.com/input.png"}},
		Size:   "1:1",
		Extra:  map[string]json.RawMessage{"resolution": json.RawMessage(`"1K"`)},
	}

	converted, err := (&Adaptor{}).ConvertImageRequest(
		newImageEditJSONTestContext(),
		newImageRelayInfo(constant.ChannelTypeOpenAI, relayconstant.RelayModeImagesEdits),
		request,
	)
	require.NoError(t, err)
	convertedRequest, ok := converted.(dto.ImageRequest)
	require.True(t, ok)
	require.Equal(t, "1024x1024", convertedRequest.Size)
	require.Equal(t, request.Images, convertedRequest.Images)
}

func TestConvertGaiscGenerationCanonicalizesRatioAliases(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gpt-image-2",
		Prompt: "test G-AISC ratio mapping",
		Extra: map[string]json.RawMessage{
			"aspect_ratio": json.RawMessage(`"3:4"`),
			"resolution":   json.RawMessage(`"2K"`),
		},
	}
	context := newImageEditJSONTestContext()
	context.Request.URL.Path = "/v1/images/generations"
	info := newImageRelayInfo(constant.ChannelTypeGaiscImage, relayconstant.RelayModeImagesGenerations)

	converted, err := (&Adaptor{}).ConvertImageRequest(context, info, request)
	require.NoError(t, err)
	convertedRequest, ok := converted.(dto.ImageRequest)
	require.True(t, ok)
	require.Equal(t, "1536x2048", convertedRequest.Size)
	require.Equal(t, relayconstant.RelayModeImagesGenerations, info.RelayMode)
	require.Equal(t, "/v1/images/generations", info.RequestURLPath)
	require.NotContains(t, convertedRequest.Extra, "aspect_ratio")
	require.NotContains(t, convertedRequest.Extra, "resolution")
}

func TestConvertGaiscGenerationRoutesReferenceImagesToJSONEdit(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gpt-image-2",
		Prompt: "preserve the reference subject",
		Extra: map[string]json.RawMessage{
			"aspect_ratio": json.RawMessage(`"1:1"`),
			"image_size":   json.RawMessage(`"4K"`),
			"image_urls":   json.RawMessage(`["https://example.com/reference.png"]`),
		},
	}
	context := newImageEditJSONTestContext()
	context.Request.URL.Path = "/v1/images/generations"
	info := newImageRelayInfo(constant.ChannelTypeGaiscImage, relayconstant.RelayModeImagesGenerations)

	converted, err := (&Adaptor{}).ConvertImageRequest(context, info, request)
	require.NoError(t, err)
	convertedRequest, ok := converted.(dto.ImageRequest)
	require.True(t, ok)
	require.Equal(t, "2880x2880", convertedRequest.Size)
	require.Equal(t, []dto.ImageURLReference{{ImageURL: "https://example.com/reference.png"}}, convertedRequest.Images)
	require.Equal(t, "url", convertedRequest.ResponseFormat)
	require.Equal(t, relayconstant.RelayModeImagesEdits, info.RelayMode)
	require.Equal(t, "/v1/images/edits", info.RequestURLPath)
	require.NotContains(t, convertedRequest.Extra, "image_urls")
	require.Equal(t, "application/json", context.Request.Header.Get("Content-Type"))

	requestURL, err := (&Adaptor{}).GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://sub.g-aisc.com/v1/images/edits", requestURL)
}

func TestConvertNonGaiscGenerationDoesNotRewriteTransportAliases(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gpt-image-2",
		Prompt: "working provider must remain unchanged",
		Extra: map[string]json.RawMessage{
			"aspect_ratio": json.RawMessage(`"1:1"`),
			"resolution":   json.RawMessage(`"2K"`),
			"image_urls":   json.RawMessage(`["https://example.com/reference.png"]`),
		},
	}
	context := newImageEditJSONTestContext()
	context.Request.URL.Path = "/v1/images/generations"
	info := newImageRelayInfo(constant.ChannelTypeOpenAI, relayconstant.RelayModeImagesGenerations)

	converted, err := (&Adaptor{}).ConvertImageRequest(context, info, request)
	require.NoError(t, err)
	convertedRequest, ok := converted.(dto.ImageRequest)
	require.True(t, ok)
	require.Empty(t, convertedRequest.Size)
	require.Contains(t, convertedRequest.Extra, "aspect_ratio")
	require.Contains(t, convertedRequest.Extra, "resolution")
	require.Contains(t, convertedRequest.Extra, "image_urls")
	require.Equal(t, relayconstant.RelayModeImagesGenerations, info.RelayMode)
	require.Equal(t, "/v1/images/generations", info.RequestURLPath)
}
