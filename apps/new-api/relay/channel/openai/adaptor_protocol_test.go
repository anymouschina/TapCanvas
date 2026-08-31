package openai

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newProtocolTestContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("Content-Type", "application/json")
	return ctx
}

func TestAzureWireSemanticsFollowProtocolOnCustomChannel(t *testing.T) {
	info := &relaycommon.RelayInfo{
		RelayMode:      relayconstant.RelayModeChatCompletions,
		RequestURLPath: "/v1/chat/completions",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeCustom,
			ChannelBaseUrl:    "https://example.openai.azure.com",
			ProtocolID:        constant.ProtocolAzureOpenAI,
			ApiVersion:        "2025-06-01-preview",
			ApiKey:            "azure-key",
			UpstreamModelName: "deployment-a",
		},
	}
	adaptor := &Adaptor{}

	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(
		t,
		"https://example.openai.azure.com/openai/deployments/deployment-a/chat/completions?api-version=2025-06-01-preview",
		requestURL,
	)

	header := http.Header{}
	err = adaptor.SetupRequestHeader(newProtocolTestContext(), &header, info)
	require.NoError(t, err)
	require.Equal(t, "azure-key", header.Get("api-key"))
	require.Empty(t, header.Get("Authorization"))
}

func TestOpenAIWireSemanticsIgnoreAzureChannelIdentity(t *testing.T) {
	info := &relaycommon.RelayInfo{
		RelayMode:      relayconstant.RelayModeChatCompletions,
		RequestURLPath: "/v1/chat/completions",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeAzure,
			ChannelBaseUrl:    "https://compatible.example.com",
			ProtocolID:        constant.ProtocolOpenAI,
			ApiKey:            "openai-key",
			UpstreamModelName: "gpt-test",
		},
	}
	adaptor := &Adaptor{}

	requestURL, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	require.Equal(t, "https://compatible.example.com/v1/chat/completions", requestURL)

	header := http.Header{}
	err = adaptor.SetupRequestHeader(newProtocolTestContext(), &header, info)
	require.NoError(t, err)
	require.Empty(t, header.Get("api-key"))
	require.Equal(t, "Bearer openai-key", header.Get("Authorization"))
}
