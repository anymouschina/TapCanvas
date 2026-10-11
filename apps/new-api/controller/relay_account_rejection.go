package controller

import (
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"net/http"
)

func isAccountRejectionStatus(status int) bool {
	switch status {
	case http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusForbidden, http.StatusTooManyRequests:
		return true
	}
	return false
}

func isUpstreamAccountRejection(err *types.NewAPIError) bool {
	return err != nil && (isAccountRejectionStatus(err.UpstreamStatusCode) || service.IsUpstreamAccountQuotaRejection(err))
}
