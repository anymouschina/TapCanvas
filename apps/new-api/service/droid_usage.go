package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const (
	DroidQuotaSource        = "factory_billing_limits"
	droidUsageHTTPTimeout   = 15 * time.Second
	droidUsageResponseLimit = 1 << 20
)

type droidBillingWindow struct {
	UsedPercent *float64 `json:"usedPercent"`
	WindowEnd   *string  `json:"windowEnd"`
}

type droidBillingLimits struct {
	Limits                     map[string]map[string]*droidBillingWindow `json:"limits"`
	UsesTokenRateLimitsBilling *bool                                     `json:"usesTokenRateLimitsBilling"`
	ExtraUsageBalanceCents     *int64                                    `json:"extraUsageBalanceCents"`
	ExtraUsageAllowed          *bool                                     `json:"extraUsageAllowed"`
	OveragePreference          string                                    `json:"overagePreference"`
}

func parseDroidUsageSnapshot(body []byte, now time.Time) (model.ChannelKeyUsage, error) {
	var response droidBillingLimits
	if err := common.Unmarshal(body, &response); err != nil {
		return model.ChannelKeyUsage{}, errors.New("Factory billing limits response has invalid JSON or field types")
	}
	if len(response.Limits) == 0 {
		return model.ChannelKeyUsage{}, errors.New("Factory billing limits response is missing quota windows")
	}
	usage := model.ChannelKeyUsage{
		QuotaSource: DroidQuotaSource, UpdatedAt: now.Unix(), UsageCheckedAt: now.Unix(),
		QuotaWindowsCheckedAt:      now.Unix(),
		ExtraUsageBalanceCents:     response.ExtraUsageBalanceCents,
		ExtraUsageAllowed:          response.ExtraUsageAllowed,
		OveragePreference:          response.OveragePreference,
		UsesTokenRateLimitsBilling: response.UsesTokenRateLimitsBilling,
	}
	scopes := make([]string, 0, len(response.Limits))
	for scope := range response.Limits {
		scopes = append(scopes, scope)
	}
	sort.Strings(scopes)
	for _, scope := range scopes {
		windows := make([]string, 0, len(response.Limits[scope]))
		for window := range response.Limits[scope] {
			windows = append(windows, window)
		}
		sort.Strings(windows)
		for _, window := range windows {
			source := response.Limits[scope][window]
			if source == nil {
				return model.ChannelKeyUsage{}, errors.New("Factory billing limits quota window must be an object")
			}
			value := model.ChannelQuotaWindow{Scope: scope, Window: window, UsedPercent: source.UsedPercent}
			if source.WindowEnd != nil {
				reset, err := time.Parse(time.RFC3339Nano, *source.WindowEnd)
				if err != nil {
					return model.ChannelKeyUsage{}, errors.New("Factory billing limits contains an invalid window reset timestamp")
				}
				unix := reset.Unix()
				value.ResetAt = &unix
			}
			usage.QuotaWindows = append(usage.QuotaWindows, value)
		}
	}
	if len(usage.QuotaWindows) == 0 {
		return model.ChannelKeyUsage{}, errors.New("Factory billing limits response is missing quota windows")
	}
	return usage, nil
}

// FetchDroidUsage never retries, changes credentials or returns upstream text.
func FetchDroidUsage(ctx context.Context, client *http.Client, baseURL, key string, now time.Time) (model.ChannelKeyUsage, error) {
	body, err := fetchDroidUsageBody(ctx, client, baseURL, key, "/api/billing/limits")
	if err != nil {
		return model.ChannelKeyUsage{}, err
	}
	return parseDroidUsageSnapshot(body, now)
}

func fetchDroidUsageBody(ctx context.Context, client *http.Client, baseURL, key, path string) ([]byte, error) {
	if client == nil {
		return nil, errors.New("Droid usage HTTP client is unavailable")
	}
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("Droid usage requires an HTTP(S) origin without credentials, path, query or fragment")
	}
	if strings.TrimSpace(key) == "" {
		return nil, errors.New("Factory API key is empty")
	}
	requestCtx, cancel := context.WithTimeout(ctx, droidUsageHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, base+path, nil)
	if err != nil {
		return nil, errors.New("could not create Factory account metadata request")
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(key))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "factory-cli/0.234.0")
	req.Header.Set("X-Factory-Client", "cli")
	req.Header.Set("X-Client-Version", "0.234.0")
	requestClient := *client
	requestClient.Timeout = droidUsageHTTPTimeout
	requestClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := requestClient.Do(req)
	if err != nil {
		if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("Factory account metadata request timed out")
		}
		if errors.Is(requestCtx.Err(), context.Canceled) {
			return nil, errors.New("Factory account metadata request canceled")
		}
		return nil, errors.New("Factory account metadata network request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Factory account metadata returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, droidUsageResponseLimit+1))
	if err != nil {
		return nil, errors.New("could not read Factory account metadata response")
	}
	if len(body) > droidUsageResponseLimit {
		return nil, errors.New("Factory account metadata response exceeded the size limit")
	}
	return body, nil
}
