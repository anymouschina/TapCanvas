package common

import (
	"net/http/httptest"
	"testing"

	appcommon "github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestRelayInfoGetFinalRequestRelayFormatPrefersExplicitFinal(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		RequestConversionChain:  []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
		FinalRequestRelayFormat: types.RelayFormatOpenAIResponses,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatOpenAIResponses), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToConversionChain(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:            types.RelayFormatOpenAI,
		RequestConversionChain: []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatClaude), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToRelayFormat(t *testing.T) {
	info := &RelayInfo{
		RelayFormat: types.RelayFormatGemini,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatGemini), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatNilReceiver(t *testing.T) {
	var info *RelayInfo
	require.Equal(t, types.RelayFormat(""), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoInitChannelMetaAppliesProtocolOptions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	protocol, ok := constant.GetProtocolDefinition(constant.ProtocolAzureOpenAI)
	require.True(t, ok)
	appcommon.SetContextKey(ctx, constant.ContextKeyChannelType, constant.ChannelTypeAzure)
	appcommon.SetContextKey(ctx, constant.ContextKeyChannelProtocol, protocol)
	appcommon.SetContextKey(ctx, constant.ContextKeyChannelProtocolBinding, dto.ProtocolBinding{
		Protocol: constant.ProtocolAzureOpenAI,
		Options: map[string]string{
			"api_version": "2025-04-01-preview",
		},
	})
	ctx.Set("api_version", "legacy-version")

	info := &RelayInfo{}
	info.InitChannelMeta(ctx)

	require.Equal(t, constant.ProtocolAzureOpenAI, info.ProtocolID)
	require.Equal(t, "2025-04-01-preview", info.ApiVersion)
	require.Equal(t, "2025-04-01-preview", info.ProtocolOptions["api_version"])
}

func TestRelayInfoInitChannelMetaDerivesAPIVersionFromProtocolNotChannelType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(
		"POST",
		"/v1/chat/completions?api-version=2025-06-01-preview",
		nil,
	)
	protocol, ok := constant.GetProtocolDefinition(constant.ProtocolAzureOpenAI)
	require.True(t, ok)
	appcommon.SetContextKey(ctx, constant.ContextKeyChannelType, constant.ChannelTypeCustom)
	appcommon.SetContextKey(ctx, constant.ContextKeyChannelProtocol, protocol)

	info := &RelayInfo{}
	info.InitChannelMeta(ctx)

	require.Equal(t, constant.ChannelTypeCustom, info.ChannelType)
	require.Equal(t, constant.ProtocolAzureOpenAI, info.ProtocolID)
	require.Equal(t, "2025-06-01-preview", info.ApiVersion)
}
