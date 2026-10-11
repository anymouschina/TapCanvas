package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

type droidUsageSnapshot struct {
	usage                                    model.ChannelKeyUsage
	limits, subscription, totals, credential bool
}

func droidTimestamp(value *string) (*int64, error) {
	if value == nil {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, *value)
	if err != nil {
		return nil, errors.New("Factory subscription contains an invalid timestamp")
	}
	unix := parsed.Unix()
	return &unix, nil
}

func parseDroidSubscription(body []byte, usage *model.ChannelKeyUsage, now time.Time) error {
	var response struct {
		Organization *struct {
			Subscription *struct {
				FactoryTier     string `json:"factoryTier"`
				OrbSubscription *struct {
					Status    string          `json:"status"`
					Start     *string         `json:"current_billing_period_start_date"`
					End       *string         `json:"current_billing_period_end_date"`
					EndDate   json.RawMessage `json:"end_date"`
					TrialInfo *struct {
						EndDate *string `json:"end_date"`
					} `json:"trial_info"`
				} `json:"orbSubscription"`
			} `json:"subscription"`
		} `json:"organization"`
	}
	if err := common.Unmarshal(body, &response); err != nil {
		return errors.New("Factory subscription response has invalid JSON or field types")
	}
	if response.Organization == nil || response.Organization.Subscription == nil {
		return errors.New("Factory subscription metadata is missing")
	}
	subscription := response.Organization.Subscription
	projection := model.ChannelKeyUsage{PlanType: subscription.FactoryTier, SubscriptionCheckedAt: now.Unix()}
	if orb := subscription.OrbSubscription; orb != nil {
		projection.SubscriptionStatus = orb.Status
		var err error
		if projection.BillingPeriodStartAt, err = droidTimestamp(orb.Start); err != nil {
			return err
		}
		if projection.BillingPeriodEndAt, err = droidTimestamp(orb.End); err != nil {
			return err
		}
		if len(orb.EndDate) > 0 {
			var end *string
			if err := common.Unmarshal(orb.EndDate, &end); err != nil {
				return errors.New("Factory subscription end date has an invalid type")
			}
			if projection.SubscriptionEndAt, err = droidTimestamp(end); err != nil {
				return err
			}
			projection.SubscriptionEndKnown = true
		}
		if orb.TrialInfo != nil {
			if projection.TrialEndAt, err = droidTimestamp(orb.TrialInfo.EndDate); err != nil {
				return err
			}
		}
	}
	copyDroidSubscription(usage, projection)
	return nil
}

func parseDroidQuotaTotals(body []byte, usage *model.ChannelKeyUsage, now time.Time) error {
	var response struct {
		Usage *struct {
			Start    *int64           `json:"startDate"`
			End      *int64           `json:"endDate"`
			Standard *droidQuotaTotal `json:"standard"`
			Premium  *droidQuotaTotal `json:"premium"`
		} `json:"usage"`
		Source string `json:"source"`
	}
	if err := common.Unmarshal(body, &response); err != nil {
		return errors.New("Factory quota totals response has invalid JSON or field types")
	}
	if response.Usage == nil || (response.Usage.Standard == nil && response.Usage.Premium == nil) {
		return errors.New("Factory quota totals metadata is missing")
	}
	projection := model.ChannelKeyUsage{QuotaTotalsSource: response.Source, QuotaTotalsCheckedAt: now.Unix(), QuotaTotalsStartAt: droidMillis(response.Usage.Start), QuotaTotalsEndAt: droidMillis(response.Usage.End)}
	for _, source := range []struct {
		scope string
		total *droidQuotaTotal
	}{{"standard", response.Usage.Standard}, {"premium", response.Usage.Premium}} {
		if source.total == nil {
			continue
		}
		projection.QuotaTotals = append(projection.QuotaTotals, model.ChannelQuotaTotal{Scope: source.scope, UserTokens: source.total.UserTokens, OrgUsedTokens: source.total.OrgUsedTokens, TotalAllowance: source.total.TotalAllowance, OrgOverageUsed: source.total.OrgOverageUsed, OrgOverageLimit: source.total.OrgOverageLimit})
	}
	copyDroidTotals(usage, projection)
	return nil
}

type droidQuotaTotal struct {
	UserTokens      *float64 `json:"userTokens"`
	OrgUsedTokens   *float64 `json:"orgTotalTokensUsed"`
	TotalAllowance  *float64 `json:"totalAllowance"`
	OrgOverageUsed  *float64 `json:"orgOverageUsed"`
	OrgOverageLimit *float64 `json:"orgOverageLimit"`
}

func droidMillis(value *int64) *int64 {
	if value == nil {
		return nil
	}
	seconds := *value / 1000
	return &seconds
}

func parseDroidCredentialMetadata(body []byte, key string, usage *model.ChannelKeyUsage, now time.Time) error {
	var entries []struct {
		Fingerprint string `json:"fingerprint"`
		ExpiresAt   *int64 `json:"expiresAt"`
		IsRevoked   *bool  `json:"isRevoked"`
	}
	if err := common.Unmarshal(body, &entries); err != nil {
		return errors.New("Factory key metadata response has invalid JSON or field types")
	}
	matches := 0
	projection := model.ChannelKeyUsage{}
	for _, entry := range entries {
		if entry.Fingerprint == "" || !strings.HasSuffix(strings.TrimSpace(key), entry.Fingerprint) {
			continue
		}
		matches++
		projection.CredentialExpiresAt = droidMillis(entry.ExpiresAt)
		projection.CredentialExpiryKnown = true
		projection.CredentialRevoked = entry.IsRevoked
		projection.CredentialCheckedAt = now.Unix()
	}
	if matches != 1 {
		return errors.New("Factory key metadata could not be uniquely matched to this credential")
	}
	copyDroidCredential(usage, projection)
	return nil
}

func fetchDroidUsageSnapshot(ctx context.Context, client *http.Client, baseURL, key string, now time.Time) (droidUsageSnapshot, error) {
	snapshot := droidUsageSnapshot{}
	var failures []error
	limits, err := FetchDroidUsage(ctx, client, baseURL, key, now)
	if err == nil {
		snapshot.usage = limits
		snapshot.limits = true
	} else {
		failures = append(failures, fmt.Errorf("quota windows: %w", err))
	}
	for _, query := range []struct {
		path, label string
		parse       func([]byte, *model.ChannelKeyUsage, time.Time) error
		present     *bool
	}{
		{"/api/app/auth/me", "subscription", parseDroidSubscription, &snapshot.subscription},
		{"/api/organization/subscription/usage", "quota totals", parseDroidQuotaTotals, &snapshot.totals},
		{"/api/factory-api-key/list", "credential metadata", func(body []byte, usage *model.ChannelKeyUsage, now time.Time) error {
			return parseDroidCredentialMetadata(body, key, usage, now)
		}, &snapshot.credential},
	} {
		body, err := fetchDroidUsageBody(ctx, client, baseURL, key, query.path)
		if err == nil {
			err = query.parse(body, &snapshot.usage, now)
		}
		if err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", query.label, err))
		} else {
			*query.present = true
		}
	}
	return snapshot, errors.Join(failures...)
}

func copyDroidSubscription(target *model.ChannelKeyUsage, source model.ChannelKeyUsage) {
	target.PlanType, target.SubscriptionStatus = source.PlanType, source.SubscriptionStatus
	target.BillingPeriodStartAt, target.BillingPeriodEndAt = source.BillingPeriodStartAt, source.BillingPeriodEndAt
	target.SubscriptionEndAt, target.SubscriptionEndKnown, target.TrialEndAt = source.SubscriptionEndAt, source.SubscriptionEndKnown, source.TrialEndAt
	target.SubscriptionCheckedAt = source.SubscriptionCheckedAt
}

func copyDroidTotals(target *model.ChannelKeyUsage, source model.ChannelKeyUsage) {
	target.QuotaTotals, target.QuotaTotalsSource = source.QuotaTotals, source.QuotaTotalsSource
	target.QuotaTotalsStartAt, target.QuotaTotalsEndAt, target.QuotaTotalsCheckedAt = source.QuotaTotalsStartAt, source.QuotaTotalsEndAt, source.QuotaTotalsCheckedAt
}

func copyDroidCredential(target *model.ChannelKeyUsage, source model.ChannelKeyUsage) {
	target.CredentialExpiresAt, target.CredentialExpiryKnown = source.CredentialExpiresAt, source.CredentialExpiryKnown
	target.CredentialRevoked, target.CredentialCheckedAt = source.CredentialRevoked, source.CredentialCheckedAt
}
