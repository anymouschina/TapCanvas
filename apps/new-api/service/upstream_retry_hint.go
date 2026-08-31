package service

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	googleRPCErrorInfoType = "type.googleapis.com/google.rpc.ErrorInfo"
	googleRPCRetryInfoType = "type.googleapis.com/google.rpc.RetryInfo"
)

type upstreamRetryHint struct {
	RetryAtUnix int64
	Source      string
}

type googleRPCErrorEnvelope struct {
	Error struct {
		Status  string            `json:"status"`
		Details []googleRPCDetail `json:"details"`
	} `json:"error"`
}

type googleRPCDetail struct {
	Type       string `json:"@type"`
	Reason     string `json:"reason"`
	RetryDelay string `json:"retryDelay"`
	Metadata   struct {
		QuotaResetDelay     string `json:"quotaResetDelay"`
		QuotaResetTimeStamp string `json:"quotaResetTimeStamp"`
	} `json:"metadata"`
}

// extractUpstreamRetryHint reads deterministic retry timing from standard HTTP
// Retry-After and Google RPC quota details. A provider reset timestamp wins over
// relative delays, and body metadata wins over the less specific HTTP header.
// Malformed values are returned as diagnostics so callers never silently hide
// an invalid upstream contract.
func extractUpstreamRetryHint(resp *http.Response, responseBody []byte, now time.Time) (upstreamRetryHint, []error) {
	diagnostics := make([]error, 0)
	headerHint, headerErr := parseRetryAfterHeader(resp, now)
	if headerErr != nil {
		diagnostics = append(diagnostics, headerErr)
	}

	bodyHint, bodyDiagnostics := parseGoogleRPCQuotaRetryHint(responseBody, now)
	diagnostics = append(diagnostics, bodyDiagnostics...)
	if bodyHint.RetryAtUnix > 0 {
		return bodyHint, diagnostics
	}
	return headerHint, diagnostics
}

func parseRetryAfterHeader(resp *http.Response, now time.Time) (upstreamRetryHint, error) {
	if resp == nil {
		return upstreamRetryHint{}, nil
	}
	raw := strings.TrimSpace(resp.Header.Get("Retry-After"))
	if raw == "" {
		return upstreamRetryHint{}, nil
	}
	if seconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if seconds <= 0 {
			return upstreamRetryHint{}, fmt.Errorf("invalid upstream Retry-After seconds %q", raw)
		}
		return upstreamRetryHint{
			RetryAtUnix: now.Unix() + seconds,
			Source:      "http.retry-after-seconds",
		}, nil
	}
	retryAt, err := http.ParseTime(raw)
	if err != nil {
		return upstreamRetryHint{}, fmt.Errorf("invalid upstream Retry-After value %q: %w", raw, err)
	}
	if !retryAt.After(now) {
		return upstreamRetryHint{}, fmt.Errorf("upstream Retry-After time %q is not in the future", raw)
	}
	return upstreamRetryHint{
		RetryAtUnix: retryAt.Unix(),
		Source:      "http.retry-after-date",
	}, nil
}

func parseGoogleRPCQuotaRetryHint(responseBody []byte, now time.Time) (upstreamRetryHint, []error) {
	if len(responseBody) == 0 {
		return upstreamRetryHint{}, nil
	}
	var envelope googleRPCErrorEnvelope
	if err := common.Unmarshal(responseBody, &envelope); err != nil {
		return upstreamRetryHint{}, nil
	}
	if envelope.Error.Status != "RESOURCE_EXHAUSTED" {
		return upstreamRetryHint{}, nil
	}

	diagnostics := make([]error, 0)
	var quotaDelayHint upstreamRetryHint
	var retryInfoHint upstreamRetryHint
	for _, detail := range envelope.Error.Details {
		switch detail.Type {
		case googleRPCErrorInfoType:
			if detail.Reason != "QUOTA_EXHAUSTED" {
				continue
			}
			if raw := strings.TrimSpace(detail.Metadata.QuotaResetTimeStamp); raw != "" {
				retryAt, err := time.Parse(time.RFC3339Nano, raw)
				if err != nil {
					diagnostics = append(diagnostics, fmt.Errorf("invalid Google quotaResetTimeStamp %q: %w", raw, err))
				} else if retryAt.After(now) {
					return upstreamRetryHint{
						RetryAtUnix: ceilUnix(retryAt),
						Source:      "google.rpc.ErrorInfo.metadata.quotaResetTimeStamp",
					}, diagnostics
				} else {
					diagnostics = append(diagnostics, fmt.Errorf("Google quotaResetTimeStamp %q is not in the future", raw))
				}
			}
			if quotaDelayHint.RetryAtUnix == 0 {
				hint, err := retryHintFromDuration(detail.Metadata.QuotaResetDelay, now, "google.rpc.ErrorInfo.metadata.quotaResetDelay")
				if err != nil {
					diagnostics = append(diagnostics, err)
				} else if hint.RetryAtUnix > 0 {
					quotaDelayHint = hint
				}
			}
		case googleRPCRetryInfoType:
			if retryInfoHint.RetryAtUnix != 0 {
				continue
			}
			hint, err := retryHintFromDuration(detail.RetryDelay, now, "google.rpc.RetryInfo.retryDelay")
			if err != nil {
				diagnostics = append(diagnostics, err)
			} else if hint.RetryAtUnix > 0 {
				retryInfoHint = hint
			}
		}
	}
	if quotaDelayHint.RetryAtUnix > 0 {
		return quotaDelayHint, diagnostics
	}
	return retryInfoHint, diagnostics
}

func retryHintFromDuration(raw string, now time.Time, source string) (upstreamRetryHint, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return upstreamRetryHint{}, nil
	}
	duration, err := time.ParseDuration(trimmed)
	if err != nil {
		return upstreamRetryHint{}, fmt.Errorf("invalid %s duration %q: %w", source, trimmed, err)
	}
	if duration <= 0 {
		return upstreamRetryHint{}, fmt.Errorf("invalid %s duration %q: must be positive", source, trimmed)
	}
	return upstreamRetryHint{
		RetryAtUnix: ceilUnix(now.Add(duration)),
		Source:      source,
	}, nil
}

func ceilUnix(value time.Time) int64 {
	unixSeconds := value.Unix()
	if value.Nanosecond() > 0 {
		unixSeconds++
	}
	return unixSeconds
}
