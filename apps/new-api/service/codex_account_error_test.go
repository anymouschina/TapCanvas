package service

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/types"
)

func TestRelayErrorHandlerPreservesDeactivatedWorkspaceCode(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusPaymentRequired,
		Body:       io.NopCloser(strings.NewReader(`{"detail":{"code":"deactivated_workspace"}}`)),
	}
	err := RelayErrorHandler(t.Context(), resp, false)

	if err.GetErrorCode() != types.ErrorCodeDeactivatedWorkspace {
		t.Fatalf("expected deactivated workspace code, got %q", err.GetErrorCode())
	}
	if !ShouldDisableChannel(err) {
		t.Fatal("a deactivated workspace must be removed from multi-key scheduling")
	}
}

func TestRelayErrorHandlerPreservesUsageLimitCode(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusTooManyRequests,
		Body:       io.NopCloser(strings.NewReader(`{"detail":{"code":"usage_limit_reached"}}`)),
	}
	err := RelayErrorHandler(t.Context(), resp, false)

	if err.GetErrorCode() != types.ErrorCodeUsageLimitReached {
		t.Fatalf("expected usage limit code, got %q", err.GetErrorCode())
	}
	if !ShouldDisableChannel(err) {
		t.Fatal("a usage-limited account must leave active scheduling")
	}
}
