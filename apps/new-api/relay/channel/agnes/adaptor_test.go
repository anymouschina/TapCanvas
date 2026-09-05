package agnes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func imageContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	context.Request.Header.Set("Content-Type", "application/json")
	return context
}

func imageInfo(mode int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayMode: mode,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl:    "https://api.agnes-ai.cn",
			UpstreamModelName: ModelImage25Flash,
		},
	}
}

func TestConvertImageRequestMovesReferencesAndResponseFormatIntoExtraBody(t *testing.T) {
	t.Parallel()
	request := dto.ImageRequest{
		Model:          ModelImage25Flash,
		Prompt:         "combine the references",
		Size:           "16:9",
		ResponseFormat: "url",
		Images: []dto.ImageURLReference{
			{ImageURL: "https://example.com/a.png"},
			{ImageURL: "https://example.com/b.png"},
		},
		Extra: map[string]json.RawMessage{
			"resolution": json.RawMessage(`"3K"`),
		},
	}

	converted, err := (&Adaptor{}).ConvertImageRequest(
		imageContext(),
		imageInfo(relayconstant.RelayModeImagesGenerations),
		request,
	)
	require.NoError(t, err)
	payload := converted.(imagePayload)
	require.Equal(t, "3K", payload.Size)
	require.Equal(t, "16:9", payload.Ratio)
	require.NotNil(t, payload.ExtraBody)
	require.Equal(t, []string{"https://example.com/a.png", "https://example.com/b.png"}, payload.ExtraBody.Image)
	require.Equal(t, "url", payload.ExtraBody.ResponseFormat)
	require.Nil(t, payload.ReturnBase64)

	encoded, err := common.Marshal(payload)
	require.NoError(t, err)
	var raw map[string]json.RawMessage
	require.NoError(t, common.Unmarshal(encoded, &raw))
	require.NotContains(t, raw, "response_format")
	require.NotContains(t, raw, "image")
}

func TestConvertImageRequestUsesReturnBase64ForTextToImage(t *testing.T) {
	t.Parallel()
	request := dto.ImageRequest{
		Model:          ModelImage25Flash,
		Prompt:         "a luminous city",
		Size:           "2K",
		ResponseFormat: "b64_json",
	}
	converted, err := (&Adaptor{}).ConvertImageRequest(
		imageContext(),
		imageInfo(relayconstant.RelayModeImagesGenerations),
		request,
	)
	require.NoError(t, err)
	payload := converted.(imagePayload)
	require.NotNil(t, payload.ReturnBase64)
	require.True(t, *payload.ReturnBase64)
	require.Nil(t, payload.ExtraBody)
}

func TestConvertImageRequestAcceptsOpenAIExtraBodyInput(t *testing.T) {
	t.Parallel()
	request := dto.ImageRequest{
		Model:  ModelImage25Flash,
		Prompt: "edit from SDK extra body",
		Size:   "1K",
		Extra: map[string]json.RawMessage{
			"extra_body": json.RawMessage(`{
				"image":["https://example.com/reference.png"],
				"response_format":"b64_json"
			}`),
		},
	}
	converted, err := (&Adaptor{}).ConvertImageRequest(
		imageContext(),
		imageInfo(relayconstant.RelayModeImagesGenerations),
		request,
	)
	require.NoError(t, err)
	payload := converted.(imagePayload)
	require.NotNil(t, payload.ExtraBody)
	require.Equal(t, []string{"https://example.com/reference.png"}, payload.ExtraBody.Image)
	require.Equal(t, "b64_json", payload.ExtraBody.ResponseFormat)
}

func TestConvertImageRequestPreservesExplicitFalseReturnBase64(t *testing.T) {
	t.Parallel()
	request := dto.ImageRequest{
		Model:  ModelImage25Flash,
		Prompt: "a product photo",
		Extra: map[string]json.RawMessage{
			"return_base64": json.RawMessage(`false`),
		},
	}
	converted, err := (&Adaptor{}).ConvertImageRequest(
		imageContext(),
		imageInfo(relayconstant.RelayModeImagesGenerations),
		request,
	)
	require.NoError(t, err)
	encoded, err := common.Marshal(converted)
	require.NoError(t, err)
	var raw map[string]json.RawMessage
	require.NoError(t, common.Unmarshal(encoded, &raw))
	require.JSONEq(t, `false`, string(raw["return_base64"]))
}

func TestAgnesImageEditsUseGenerationEndpoint(t *testing.T) {
	t.Parallel()
	adaptor := &Adaptor{}
	info := imageInfo(relayconstant.RelayModeImagesEdits)
	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://api.agnes-ai.cn/v1/images/generations", requestURL)

	_, err = adaptor.ConvertImageRequest(imageContext(), info, dto.ImageRequest{
		Model:  ModelImage25Flash,
		Prompt: "edit",
	})
	require.ErrorContains(t, err, "require at least one reference image")
}

func TestAgnesImageRejectsUnsupportedN(t *testing.T) {
	t.Parallel()
	n := uint(2)
	_, err := (&Adaptor{}).ConvertImageRequest(
		imageContext(),
		imageInfo(relayconstant.RelayModeImagesGenerations),
		dto.ImageRequest{Model: ModelImage25Flash, Prompt: "two images", N: &n},
	)
	require.ErrorContains(t, err, "n must be 1")
}
