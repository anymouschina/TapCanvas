package service

import (
	"net/http"

	"github.com/QuantumNous/new-api/types"
)

// IsUpstreamAccountQuotaRejection requires an actual upstream rejection. A
// local wallet/payment error, or a failure after an accepted HTTP 200, does
// not authorize issuing the request against another account.
func IsUpstreamAccountQuotaRejection(err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	if err.UpstreamStatusCode == http.StatusPaymentRequired {
		return true
	}
	return err.UpstreamStatusCode >= 400 && err.UpstreamStatusCode < 500 &&
		err.GetErrorCode() == types.ErrorCodeUsageLimitReached
}
