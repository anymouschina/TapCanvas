package service

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestAccountQuotaRotationRequiresAnExplicitUpstreamRejection(t *testing.T) {
	local := types.NewErrorWithStatusCode(errors.New("wallet is empty"), types.ErrorCodeInsufficientUserQuota, http.StatusPaymentRequired)
	require.False(t, IsUpstreamAccountQuotaRejection(local))
	rejected := types.NewErrorWithStatusCode(errors.New("account quota exhausted"), types.ErrorCodeBadResponseStatusCode, http.StatusPaymentRequired)
	rejected.UpstreamStatusCode = http.StatusPaymentRequired
	require.True(t, IsUpstreamAccountQuotaRejection(rejected))
	ResetStatusCode(rejected, `{"402":"503"}`)
	require.True(t, IsUpstreamAccountQuotaRejection(rejected), "status mapping cannot hide the actual upstream rejection")
	accepted := types.NewErrorWithStatusCode(errors.New("failed after HTTP 200"), types.ErrorCodeBadResponseBody, http.StatusPaymentRequired)
	accepted.UpstreamStatusCode = http.StatusOK
	require.False(t, IsUpstreamAccountQuotaRejection(accepted))
	for _, status := range []int{400, 429, 200} {
		typed := types.NewErrorWithStatusCode(errors.New("quota limit"), types.ErrorCodeUsageLimitReached, status)
		typed.UpstreamStatusCode = status
		require.Equal(t, status != 200, IsUpstreamAccountQuotaRejection(typed))
	}
}
