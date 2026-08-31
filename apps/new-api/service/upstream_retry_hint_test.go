package service

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

const geminiQuotaExhaustedResponse = `{
  "error": {
    "code": 429,
    "message": "You have exhausted your capacity on this model. Your quota will reset after 2h51m0s.",
    "status": "RESOURCE_EXHAUSTED",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "QUOTA_EXHAUSTED",
        "domain": "cloudcode-pa.googleapis.com",
        "metadata": {
          "uiMessage": "true",
          "model": "gemini-3.1-flash-image",
          "quotaResetDelay": "2h51m0.934591442s",
          "quotaResetTimeStamp": "2026-08-08T12:41:46Z"
        }
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        "retryDelay": "10260.934591442s"
      }
    ]
  }
}`

func TestExtractUpstreamRetryHintPrefersGoogleQuotaResetTimestamp(t *testing.T) {
	now := time.Date(2026, time.August, 8, 9, 50, 45, 0, time.UTC)
	resp := &http.Response{Header: make(http.Header)}
	resp.Header.Set("Retry-After", "60")

	hint, diagnostics := extractUpstreamRetryHint(resp, []byte(geminiQuotaExhaustedResponse), now)

	require.Empty(t, diagnostics)
	require.Equal(t, time.Date(2026, time.August, 8, 12, 41, 46, 0, time.UTC).Unix(), hint.RetryAtUnix)
	require.Equal(t, "google.rpc.ErrorInfo.metadata.quotaResetTimeStamp", hint.Source)
}

func TestExtractUpstreamRetryHintUsesGoogleRetryDelayWhenTimestampIsInvalid(t *testing.T) {
	now := time.Date(2026, time.August, 8, 9, 50, 45, 0, time.UTC)
	body := strings.Replace(geminiQuotaExhaustedResponse, "2026-08-08T12:41:46Z", "invalid-reset-time", 1)

	hint, diagnostics := extractUpstreamRetryHint(&http.Response{Header: make(http.Header)}, []byte(body), now)

	require.Len(t, diagnostics, 1)
	require.Equal(t, now.Unix()+10261, hint.RetryAtUnix)
	require.Equal(t, "google.rpc.ErrorInfo.metadata.quotaResetDelay", hint.Source)
}

func TestRelayErrorHandlerCarriesGeminiQuotaResetIntoAPIError(t *testing.T) {
	providerReset := time.Now().UTC().Add(3 * time.Hour).Truncate(time.Second)
	body := strings.Replace(
		geminiQuotaExhaustedResponse,
		"2026-08-08T12:41:46Z",
		providerReset.Format(time.RFC3339),
		1,
	)
	resp := &http.Response{
		StatusCode: http.StatusTooManyRequests,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	apiErr := RelayErrorHandler(t.Context(), resp, false)

	require.Equal(t, http.StatusTooManyRequests, apiErr.StatusCode)
	retryAt, source, ok := apiErr.GetRetryAt()
	require.True(t, ok)
	require.Equal(t, providerReset.Unix(), retryAt)
	require.Equal(t, "google.rpc.ErrorInfo.metadata.quotaResetTimeStamp", source)
}

func TestResolveGeminiKeyCooldownPrefersProviderReset(t *testing.T) {
	now := time.Date(2026, time.August, 8, 9, 50, 45, 0, time.UTC)
	apiErr := types.InitOpenAIError(types.ErrorCodeBadResponseStatusCode, http.StatusTooManyRequests)
	providerReset := now.Add(3 * time.Hour).Unix()
	apiErr.SetRetryAt(providerReset, "google.rpc.RetryInfo.retryDelay")

	until, source := resolveGeminiKeyCooldown(now, 120, apiErr)

	require.Equal(t, providerReset, until)
	require.Equal(t, "google.rpc.RetryInfo.retryDelay", source)
}

func TestResolveGeminiKeyCooldownUsesConfiguredFallbackWithoutProviderHint(t *testing.T) {
	now := time.Date(2026, time.August, 8, 9, 50, 45, 0, time.UTC)

	until, source := resolveGeminiKeyCooldown(now, 7200, nil)

	require.Equal(t, now.Unix()+7200, until)
	require.Equal(t, "channel.oauth_key_cooldown_seconds", source)
}
