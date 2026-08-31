package openai

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestResolveFlow2APIImageModelCoversAllFifteenVariants(t *testing.T) {
	t.Parallel()

	modelMapping := flow2APITestModelMapping(t)
	tests := []struct {
		aspectRatio string
		resolution  string
		want        string
	}{
		{aspectRatio: "16:9", resolution: "1K", want: "gemini-3.0-pro-image-landscape"},
		{aspectRatio: "9:16", resolution: "1K", want: "gemini-3.0-pro-image-portrait"},
		{aspectRatio: "1:1", resolution: "1K", want: "gemini-3.0-pro-image-square"},
		{aspectRatio: "4:3", resolution: "1K", want: "gemini-3.0-pro-image-four-three"},
		{aspectRatio: "3:4", resolution: "1K", want: "gemini-3.0-pro-image-three-four"},
		{aspectRatio: "16:9", resolution: "2K", want: "gemini-3.0-pro-image-landscape-2k"},
		{aspectRatio: "9:16", resolution: "2K", want: "gemini-3.0-pro-image-portrait-2k"},
		{aspectRatio: "1:1", resolution: "2K", want: "gemini-3.0-pro-image-square-2k"},
		{aspectRatio: "4:3", resolution: "2K", want: "gemini-3.0-pro-image-four-three-2k"},
		{aspectRatio: "3:4", resolution: "2K", want: "gemini-3.0-pro-image-three-four-2k"},
		{aspectRatio: "16:9", resolution: "4K", want: "gemini-3.0-pro-image-landscape-4k"},
		{aspectRatio: "9:16", resolution: "4K", want: "gemini-3.0-pro-image-portrait-4k"},
		{aspectRatio: "1:1", resolution: "4K", want: "gemini-3.0-pro-image-square-4k"},
		{aspectRatio: "4:3", resolution: "4K", want: "gemini-3.0-pro-image-four-three-4k"},
		{aspectRatio: "3:4", resolution: "4K", want: "gemini-3.0-pro-image-three-four-4k"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.aspectRatio+"-"+test.resolution, func(t *testing.T) {
			t.Parallel()
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Set("model_mapping", modelMapping)
			info := flow2APITestRelayInfo()

			got, err := resolveFlow2APIImageModel(context, info, test.aspectRatio, test.resolution)
			require.NoError(t, err)
			require.Equal(t, test.want, got)
			require.Equal(t, test.want, info.UpstreamModelName)
			require.True(t, info.IsModelMapped)
		})
	}
}

func TestConvertFlow2APIImageRequestUsesSizeAndResolution(t *testing.T) {
	t.Parallel()

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Set("model_mapping", flow2APITestModelMapping(t))
	resolution, err := json.Marshal("4K")
	require.NoError(t, err)
	one := uint(1)
	request := dto.ImageRequest{
		Model:  "gemini-3-pro-image-lluban-test",
		Prompt: "one orange cat",
		N:      &one,
		Size:   "3:4",
		Extra:  map[string]json.RawMessage{"resolution": resolution},
	}
	info := flow2APITestRelayInfo()

	converted, err := convertFlow2APIImageRequest(context, info, request)
	require.NoError(t, err)
	require.Equal(t, "gemini-3.0-pro-image-three-four-4k", converted.Model)
	require.False(t, converted.Stream)
	require.Equal(t, []flow2APIChatMessage{{Role: "user", Content: "one orange cat"}}, converted.Messages)
}

func TestApplyFlow2APIChatModelReadsGoogleImageConfig(t *testing.T) {
	t.Parallel()

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Set("model_mapping", flow2APITestModelMapping(t))
	request := &dto.GeneralOpenAIRequest{
		Model: "gemini-3-pro-image-lluban-test",
		ExtraBody: json.RawMessage(`{
			"google":{"image_config":{"aspect_ratio":"1:1","image_size":"2K"}}
		}`),
	}
	info := flow2APITestRelayInfo()

	require.NoError(t, applyFlow2APIChatModel(context, info, request))
	require.Equal(t, "gemini-3.0-pro-image-square-2k", request.Model)
}

func TestResolveFlow2APIImageModelRejectsUnsupportedSpecsAndMissingMapping(t *testing.T) {
	t.Parallel()

	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Set("model_mapping", flow2APITestModelMapping(t))

	_, err := resolveFlow2APIImageModel(context, flow2APITestRelayInfo(), "21:9", "1K")
	require.ErrorContains(t, err, "unsupported image aspect ratio")

	_, err = resolveFlow2APIImageModel(context, flow2APITestRelayInfo(), "16:9", "8K")
	require.ErrorContains(t, err, "unsupported image resolution")

	context.Set("model_mapping", `{}`)
	_, err = resolveFlow2APIImageModel(context, flow2APITestRelayInfo(), "16:9", "1K")
	require.ErrorContains(t, err, "model_mapping is missing image variant")
}

func TestFlow2APIImageGenerationUsesChatURLAndConvertsResponse(t *testing.T) {
	t.Parallel()

	adaptor := &Adaptor{}
	info := flow2APITestRelayInfo()
	info.ChannelBaseUrl = "https://flow.example.com"
	info.RelayMode = relayconstant.RelayModeImagesGenerations
	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://flow.example.com/v1/chat/completions", requestURL)

	const upstreamBody = `{
		"id":"flow-test",
		"model":"flow2api",
		"choices":[{"index":0,"message":{"role":"assistant","content":"![generated](https://assets.example.com/flow-result.png?signature=test)"},"finish_reason":"stop"}]
	}`
	upstreamResponse := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}
	recorder := httptest.NewRecorder()
	context := gin.CreateTestContextOnly(recorder, gin.New())

	usage, handlerErr := flow2APIImageHandler(context, info, upstreamResponse)
	require.Nil(t, handlerErr)
	require.Equal(t, 258, usage.TotalTokens)
	require.Equal(t, http.StatusOK, recorder.Code)

	var imageResponse dto.ImageResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &imageResponse))
	require.Equal(t, []dto.ImageData{{Url: "https://assets.example.com/flow-result.png?signature=test"}}, imageResponse.Data)
}

func flow2APITestRelayInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-pro-image-lluban-test",
		ChannelMeta: &relaycommon.ChannelMeta{
			ProtocolID: "flow2api",
			ProtocolOptions: map[string]string{
				"image_variant_model": "gemini-3-pro-image",
			},
			UpstreamModelName: "gemini-3.0-pro-image-landscape",
		},
	}
}

func flow2APITestModelMapping(t *testing.T) string {
	t.Helper()
	mapping := map[string]string{
		"gemini-3-pro-image-landscape":    "gemini-3.0-pro-image-landscape",
		"gemini-3-pro-image-portrait":     "gemini-3.0-pro-image-portrait",
		"gemini-3-pro-image-square":       "gemini-3.0-pro-image-square",
		"gemini-3-pro-image-4x3":          "gemini-3.0-pro-image-four-three",
		"gemini-3-pro-image-3x4":          "gemini-3.0-pro-image-three-four",
		"gemini-3-pro-image-landscape-2k": "gemini-3.0-pro-image-landscape-2k",
		"gemini-3-pro-image-portrait-2k":  "gemini-3.0-pro-image-portrait-2k",
		"gemini-3-pro-image-square-2k":    "gemini-3.0-pro-image-square-2k",
		"gemini-3-pro-image-4x3-2k":       "gemini-3.0-pro-image-four-three-2k",
		"gemini-3-pro-image-3x4-2k":       "gemini-3.0-pro-image-three-four-2k",
		"gemini-3-pro-image-landscape-4k": "gemini-3.0-pro-image-landscape-4k",
		"gemini-3-pro-image-portrait-4k":  "gemini-3.0-pro-image-portrait-4k",
		"gemini-3-pro-image-square-4k":    "gemini-3.0-pro-image-square-4k",
		"gemini-3-pro-image-4x3-4k":       "gemini-3.0-pro-image-four-three-4k",
		"gemini-3-pro-image-3x4-4k":       "gemini-3.0-pro-image-three-four-4k",
	}
	encoded, err := json.Marshal(mapping)
	require.NoError(t, err)
	return string(encoded)
}
