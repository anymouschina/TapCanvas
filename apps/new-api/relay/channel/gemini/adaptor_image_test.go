package gemini

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestConvertImageRequestIncludesReferenceImagesAndNormalizes1080p(t *testing.T) {
	t.Parallel()

	const imageDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQImWP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

	request := dto.ImageRequest{
		Model:  "nanobanana2",
		Prompt: "keep the detail-page layout",
		Extra: map[string]json.RawMessage{
			"image_urls": json.RawMessage(`["` + imageDataURL + `","` + imageDataURL + `"]`),
			"image_size": json.RawMessage(`"1080p"`),
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "nanobanana2",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3.1-flash-image-preview",
		},
	}

	adaptor := &Adaptor{}
	got, err := adaptor.ConvertImageRequest(gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()), info, request)
	require.NoError(t, err)

	geminiRequest, ok := got.(dto.GeminiChatRequest)
	require.True(t, ok)
	require.Len(t, geminiRequest.Contents, 1)
	require.Len(t, geminiRequest.Contents[0].Parts, 3)
	require.NotNil(t, geminiRequest.Contents[0].Parts[0].InlineData)
	require.NotNil(t, geminiRequest.Contents[0].Parts[1].InlineData)
	require.Equal(t, "keep the detail-page layout", geminiRequest.Contents[0].Parts[2].Text)

	imageConfig := map[string]string{}
	require.NoError(t, common.Unmarshal(geminiRequest.GenerationConfig.ImageConfig, &imageConfig))
	require.Equal(t, "1K", imageConfig["imageSize"])
}

func TestConvertImageRequestSupportsProductionProImageModel(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gemini-3-pro-image-preview",
		Prompt: "create a coherent six-panel street-style buyer showcase",
		Size:   "5:4",
		Extra: map[string]json.RawMessage{
			"image_size": json.RawMessage(`"4K"`),
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-pro-image-preview",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-pro-image",
		},
	}

	got, err := (&Adaptor{}).ConvertImageRequest(
		gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()),
		info,
		request,
	)
	require.NoError(t, err)

	geminiRequest, ok := got.(dto.GeminiChatRequest)
	require.True(t, ok)
	require.Len(t, geminiRequest.Contents, 1)
	require.Len(t, geminiRequest.Contents[0].Parts, 1)
	require.Equal(t, request.Prompt, geminiRequest.Contents[0].Parts[0].Text)
	require.Equal(t, []string{"TEXT", "IMAGE"}, geminiRequest.GenerationConfig.ResponseModalities)

	imageConfig := map[string]string{}
	require.NoError(t, common.Unmarshal(geminiRequest.GenerationConfig.ImageConfig, &imageConfig))
	require.Equal(t, "5:4", imageConfig["aspectRatio"])
	require.Equal(t, "4K", imageConfig["imageSize"])
}

func TestConvertImageRequestOmitsAutoAspectRatio(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gemini-3-pro-image-preview-334",
		Prompt: "let the model choose the aspect ratio",
		Size:   "auto",
		Extra: map[string]json.RawMessage{
			"image_size": json.RawMessage(`"2K"`),
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-pro-image-preview-334",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3-pro-image-preview",
		},
	}

	got, err := (&Adaptor{}).ConvertImageRequest(
		gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()),
		info,
		request,
	)
	require.NoError(t, err)

	geminiRequest, ok := got.(dto.GeminiChatRequest)
	require.True(t, ok)
	imageConfig := map[string]string{}
	require.NoError(t, common.Unmarshal(geminiRequest.GenerationConfig.ImageConfig, &imageConfig))
	require.NotContains(t, imageConfig, "aspectRatio")
	require.Equal(t, "2K", imageConfig["imageSize"])
}

func TestConvertImageRequestWrapsCodeAssistOAuthPayload(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:  "gemini-2.5-flash-image",
		Prompt: "a bright orange persimmon",
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:            `{"access_token":"test-access-token","oauth_type":"antigravity","project_id":"test-project"}`,
			UpstreamModelName: "gemini-2.5-flash-image",
		},
	}

	adaptor := &Adaptor{}
	got, err := adaptor.ConvertImageRequest(gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()), info, request)
	require.NoError(t, err)

	wrapped, ok := got.(geminiCodeAssistRequest)
	require.True(t, ok)
	require.Equal(t, "gemini-2.5-flash-image", wrapped.Model)
	require.Equal(t, "test-project", wrapped.Project)
	require.NotNil(t, wrapped.Request)
	require.Len(t, wrapped.Request.Contents, 1)
	require.Equal(t, "a bright orange persimmon", wrapped.Request.Contents[0].Parts[0].Text)
}

func TestGetRequestURLUsesConfiguredChannelBaseURLForCodeAssist(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl:    "https://daily-cloudcode-pa.beqlee.icu/",
			ApiKey:            `{"access_token":"test-access-token","oauth_type":"antigravity","project_id":"test-project"}`,
			UpstreamModelName: "gemini-3.1-flash-image",
		},
	}

	url, err := (&Adaptor{}).GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://daily-cloudcode-pa.beqlee.icu/v1internal:generateContent", url)
}

func TestSetupRequestHeaderPreservesAntigravityClientIdentity(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey: `{"access_token":"test-access-token","oauth_type":"antigravity","project_id":"test-project"}`,
		},
	}
	headers := make(http.Header)
	headers.Set("x-goog-api-key", "should-be-removed")
	context := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
	context.Request = httptest.NewRequest(http.MethodPost, "/v1internal:generateContent", nil)
	context.Request.Header.Set("Content-Type", "application/json")

	err := (&Adaptor{}).SetupRequestHeader(
		context,
		&headers,
		info,
	)

	require.NoError(t, err)
	require.Equal(t, "Bearer test-access-token", headers.Get("Authorization"))
	require.Empty(t, headers.Get("x-goog-api-key"))
	require.Equal(t, antigravityRelayUserAgent, headers.Get("User-Agent"))
	require.Equal(t, antigravityRelayGoogleAPIClient, headers.Get("X-Goog-Api-Client"))
}
