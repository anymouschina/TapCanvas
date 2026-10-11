package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestDroidQuotaRejectionUsesOriginalUpstreamStatus(t *testing.T) {
	for _, fixture := range []struct {
		name   string
		status int
		body   string
		quota  bool
	}{
		{"payment required", http.StatusPaymentRequired, `{"error":{"message":"account exhausted","type":"quota","code":"account_limit"}}`, true},
		{"plain payment required", http.StatusPaymentRequired, "account exhausted", true},
		{"structured limit", http.StatusTooManyRequests, `{"detail":{"code":"usage_limit_reached"}}`, true},
		{"rate limit", http.StatusTooManyRequests, `{"error":{"message":"slow down","type":"rate_limit","code":"rate_limit"}}`, false},
		{"accepted response", http.StatusOK, `{"detail":{"code":"usage_limit_reached"}}`, false},
		{"server failure", http.StatusInternalServerError, `{"detail":{"code":"usage_limit_reached"}}`, false},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			response := &http.Response{StatusCode: fixture.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(fixture.body))}
			err := RelayErrorHandler(context.Background(), response, false)
			require.NotNil(t, err)
			require.Equal(t, fixture.status, err.UpstreamStatusCode)
			require.Equal(t, fixture.body, err.UpstreamResponseBody)
			// Operator-facing status mappings cannot turn a local/accepted failure
			// into evidence that replaying a paid request is safe.
			err.StatusCode = http.StatusBadGateway
			require.Equal(t, fixture.quota, IsUpstreamAccountQuotaRejection(err))
		})
	}
	localError := types.NewOpenAIError(errors.New("wallet exhausted"), types.ErrorCodeInsufficientUserQuota, http.StatusPaymentRequired)
	require.False(t, IsUpstreamAccountQuotaRejection(localError))
}

type droidFailedResponseReader struct {
	closed bool
}

func (*droidFailedResponseReader) Read(buffer []byte) (int, error) {
	return copy(buffer, "partial quota detail"), errors.New("response read failed")
}
func (reader *droidFailedResponseReader) Close() error {
	reader.closed = true
	return nil
}

func TestDroidQuotaRejectionRetainsStatusWhenBodyReadFails(t *testing.T) {
	body := &droidFailedResponseReader{}
	response := &http.Response{StatusCode: http.StatusPaymentRequired, Header: make(http.Header), Body: body}
	err := RelayErrorHandler(context.Background(), response, false)
	require.NotNil(t, err)
	require.Equal(t, http.StatusPaymentRequired, err.UpstreamStatusCode)
	require.Equal(t, "partial quota detail", err.UpstreamResponseBody)
	require.ErrorContains(t, err, "response read failed")
	require.True(t, body.closed)
	require.True(t, IsUpstreamAccountQuotaRejection(err))
}

func TestDroidUpstreamReceiptSurvivesExistingFeeNormalization(t *testing.T) {
	for _, upstream := range []types.OpenAIError{
		{Message: CSAMViolationMarker, Code: "upstream_rejected"},
		{Message: "upstream rejected", Code: "violation_fee.upstream"},
	} {
		source := types.WithOpenAIError(upstream, http.StatusBadRequest)
		source.UpstreamStatusCode = http.StatusForbidden
		source.UpstreamResponseBody = `{"error":"original upstream rejection"}`
		source.SetRetryAt(123456, "retry-after")
		wrapped := NormalizeViolationFeeError(source)
		require.True(t, types.IsSkipRetryError(wrapped))
		require.Equal(t, source.UpstreamStatusCode, wrapped.UpstreamStatusCode)
		require.Equal(t, source.UpstreamResponseBody, wrapped.UpstreamResponseBody)
		when, origin, present := wrapped.GetRetryAt()
		require.True(t, present)
		require.Equal(t, int64(123456), when)
		require.Equal(t, "retry-after", origin)
	}
}
