package vertex

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestConvertImageRequestSupportsGeminiImageModel(t *testing.T) {
	t.Parallel()

	request := dto.ImageRequest{
		Model:   "gemini-3-pro-image",
		Prompt:  "a cat sitting by a sunlit window",
		Size:    "1:1",
		Quality: "2K",
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: request.Model,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: request.Model,
		},
	}

	adaptor := &Adaptor{}
	adaptor.Init(info)
	converted, err := adaptor.ConvertImageRequest(
		gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()),
		info,
		request,
	)
	require.NoError(t, err)

	geminiRequest, ok := converted.(dto.GeminiChatRequest)
	require.True(t, ok)
	require.Equal(t, []string{"TEXT", "IMAGE"}, geminiRequest.GenerationConfig.ResponseModalities)
	require.Len(t, geminiRequest.Contents, 1)
	require.Equal(t, request.Prompt, geminiRequest.Contents[0].Parts[0].Text)
}

func TestGetRequestURLUsesVertexExpressAPIKey(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-pro-image",
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:            "vertex-api-key-a",
			ApiVersion:        `{"default":"global"}`,
			UpstreamModelName: "gemini-3-pro-image",
			ChannelOtherSettings: dto.ChannelOtherSettings{
				VertexKeyType: dto.VertexKeyTypeAPIKey,
			},
		},
	}

	adaptor := &Adaptor{}
	adaptor.Init(info)
	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(
		t,
		"https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3-pro-image:generateContent?key=vertex-api-key-a",
		requestURL,
	)
}

func TestGetRequestURLUsesOfficialVertexServiceAccountProjectPath(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{
		OriginModelName: "gemini-3-pro-image",
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:            `{"project_id":"project-a"}`,
			ApiVersion:        `{"default":"global"}`,
			UpstreamModelName: "gemini-3-pro-image",
			ChannelOtherSettings: dto.ChannelOtherSettings{
				VertexKeyType: dto.VertexKeyTypeJSON,
			},
		},
	}

	adaptor := &Adaptor{}
	adaptor.Init(info)
	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(
		t,
		"https://aiplatform.googleapis.com/v1/projects/project-a/locations/global/publishers/google/models/gemini-3-pro-image:generateContent",
		requestURL,
	)
}
