package relay

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestDroidResponsesWireRequirementOverridesPassthrough(t *testing.T) {
	for _, passThrough := range []bool{false, true} {
		for _, policySelected := range []bool{false, true} {
			require.True(t, shouldUseResponsesForChat(GetAdaptor(constant.APITypeOpenAI, constant.ProtocolDroidResponses), "exact-model", passThrough, policySelected))
			for _, protocol := range []string{constant.ProtocolOpenAI, constant.ProtocolDroidChat, constant.ProtocolDroidAnthropic, constant.ProtocolDroidGemini} {
				require.Equal(t, !passThrough && policySelected, shouldUseResponsesForChat(GetAdaptor(constant.APITypeOpenAI, protocol), "exact-model", passThrough, policySelected), protocol)
			}
		}
	}
}

func TestDroidConvertedResponseErrorRetainsOriginalError(t *testing.T) {
	source := errors.New("response parse failed")
	responseErr := types.NewError(source, types.ErrorCodeBadResponseBody)
	annotateAdaptorResponseError(GetAdaptor(constant.APITypeOpenAI, constant.ProtocolDroidResponses), &http.Response{StatusCode: http.StatusOK}, responseErr)
	require.ErrorIs(t, responseErr, source)
	require.Equal(t, http.StatusOK, responseErr.UpstreamStatusCode)
	require.True(t, types.IsSkipRetryError(responseErr))
	annotateAdaptorResponseError(GetAdaptor(constant.APITypeOpenAI, constant.ProtocolDroidResponses), nil, nil)
}
