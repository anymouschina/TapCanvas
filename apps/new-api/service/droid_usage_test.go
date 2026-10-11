package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const droidLimitsFixture = `{"usesTokenRateLimitsBilling":true,"limits":{"standard":{"fiveHour":{"usedPercent":1,"windowEnd":"2026-10-06T12:07:29.682Z"},"weekly":{"usedPercent":0,"windowEnd":null},"monthly":{}}},"extraUsageBalanceCents":0,"extraUsageAllowed":false,"overagePreference":"droidCore"}`
const droidSubscriptionFixture = `{"organization":{"subscription":{"factoryTier":"team_annual","orbSubscription":{"status":"active","current_billing_period_start_date":"2026-10-05T07:00:00Z","current_billing_period_end_date":"2027-10-05T07:00:00Z","end_date":null,"trial_info":{"end_date":null},"billing_portal_url":"secret-portal-must-not-persist"}}}}`
const droidTotalsFixture = `{"usage":{"startDate":1791268642503,"endDate":null,"standard":{"userTokens":67177,"orgTotalTokensUsed":67177,"totalAllowance":20000000,"orgOverageUsed":0,"orgOverageLimit":0},"premium":{"userTokens":0,"orgTotalTokensUsed":0,"totalAllowance":0,"orgOverageUsed":0,"orgOverageLimit":0}},"source":"cache"}`

func TestDroidLimitsPreserveZerosNullsAndMissingMeasurements(t *testing.T) {
	now := time.Unix(1791280000, 0)
	usage, err := parseDroidUsageSnapshot([]byte(droidLimitsFixture), now)
	require.NoError(t, err)
	require.Len(t, usage.QuotaWindows, 3)
	require.Equal(t, float64(1), *usage.QuotaWindows[0].UsedPercent)
	require.Equal(t, int64(1791288449), *usage.QuotaWindows[0].ResetAt)
	require.Nil(t, usage.QuotaWindows[1].UsedPercent)
	require.Nil(t, usage.QuotaWindows[1].ResetAt)
	require.Equal(t, float64(0), *usage.QuotaWindows[2].UsedPercent)
	require.Nil(t, usage.QuotaWindows[2].ResetAt)
	require.Equal(t, int64(0), *usage.ExtraUsageBalanceCents)
	require.False(t, *usage.ExtraUsageAllowed)
	require.Equal(t, now.Unix(), usage.QuotaWindowsCheckedAt)
	for _, body := range []string{`{`, `null`, `{}`, `{"limits":{}}`, `{"limits":{"standard":{"weekly":null}}}`, `{"limits":{"standard":{"weekly":{"usedPercent":"bad"}}}}`, `{"limits":{"standard":{"weekly":{"windowEnd":"bad"}}}}`} {
		_, err := parseDroidUsageSnapshot([]byte(body), now)
		require.Error(t, err, body)
	}
}

func TestDroidMetadataProjectsOnlyVerifiedFieldsAndUnits(t *testing.T) {
	now := time.Unix(1791280000, 0)
	usage := model.ChannelKeyUsage{}
	require.NoError(t, parseDroidSubscription([]byte(droidSubscriptionFixture), &usage, now))
	require.Equal(t, "team_annual", usage.PlanType)
	require.Equal(t, "active", usage.SubscriptionStatus)
	require.True(t, usage.SubscriptionEndKnown)
	require.Nil(t, usage.SubscriptionEndAt)
	require.Equal(t, time.Date(2027, 10, 5, 7, 0, 0, 0, time.UTC).Unix(), *usage.BillingPeriodEndAt)
	require.NoError(t, parseDroidQuotaTotals([]byte(droidTotalsFixture), &usage, now))
	require.Equal(t, "cache", usage.QuotaTotalsSource)
	require.Equal(t, int64(1791268642), *usage.QuotaTotalsStartAt)
	require.Nil(t, usage.QuotaTotalsEndAt)
	require.Len(t, usage.QuotaTotals, 2)
	require.Equal(t, float64(0), *usage.QuotaTotals[1].UserTokens)
	require.NoError(t, parseDroidCredentialMetadata([]byte(`[{"fingerprint":"abcdefgh","isRevoked":false}]`), "fixture-abcdefgh", &usage, now))
	require.True(t, usage.CredentialExpiryKnown)
	require.Nil(t, usage.CredentialExpiresAt)
	require.False(t, *usage.CredentialRevoked)
	encoded, err := common.Marshal(usage)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "secret-portal")
	require.NotContains(t, string(encoded), "abcdefgh")
	require.NoError(t, parseDroidCredentialMetadata([]byte(`[{"fingerprint":"abcdefgh","expiresAt":1791268642503}]`), "fixture-abcdefgh", &usage, now))
	require.Equal(t, int64(1791268642), *usage.CredentialExpiresAt)
	for _, body := range []string{`[]`, `null`, `[{"fingerprint":""}]`, `[{"fingerprint":"abcdefgh"},{"fingerprint":"abcdefgh"}]`, `[{"fingerprint":"abcdefgh","expiresAt":"bad"}]`} {
		require.Error(t, parseDroidCredentialMetadata([]byte(body), "fixture-abcdefgh", &usage, now))
	}
	unknown := model.ChannelKeyUsage{}
	require.NoError(t, parseDroidSubscription([]byte(`{"organization":{"subscription":{"orbSubscription":{"status":"active"}}}}`), &unknown, now))
	require.False(t, unknown.SubscriptionEndKnown)
	require.Nil(t, unknown.SubscriptionEndAt)
	require.Error(t, parseDroidSubscription([]byte(`{"organization":{"subscription":{"orbSubscription":{"end_date":42}}}}`), &unknown, now))
	require.Error(t, parseDroidQuotaTotals([]byte(`{"usage":{}}`), &unknown, now))
}

func TestDroidPartialQueryFailureRetainsSnapshotsWithoutDisablingKeys(t *testing.T) {
	now := time.Unix(1791280000, 0)
	old := model.ChannelKeyUsage{PlanType: "old-plan", UpdatedAt: now.Unix() - 30, SubscriptionCheckedAt: now.Unix() - 30}
	channel := &model.Channel{Key: "second\nfirst\nnew", Status: common.ChannelStatusEnabled, ChannelInfo: model.ChannelInfo{MultiKeyUsage: map[int]model.ChannelKeyUsage{0: old}, MultiKeyStatusList: map[int]int{0: 2}}}
	limits, err := parseDroidUsageSnapshot([]byte(droidLimitsFixture), now)
	require.NoError(t, err)
	result, err := applyDroidUsageProbes(channel, []droidUsageProbe{
		{identity: droidCredentialIdentity("first"), snapshot: droidUsageSnapshot{usage: model.ChannelKeyUsage{PlanType: "first-plan", SubscriptionCheckedAt: now.Unix()}, subscription: true}},
		{identity: droidCredentialIdentity("second"), snapshot: droidUsageSnapshot{usage: limits, limits: true}, err: errors.New("subscription: unavailable")},
		{identity: droidCredentialIdentity("removed"), snapshot: droidUsageSnapshot{usage: model.ChannelKeyUsage{PlanType: "removed-plan"}, subscription: true}},
	}, now)
	require.ErrorContains(t, err, "subscription: unavailable")
	require.Equal(t, 2, result.RefreshedCount)
	require.Equal(t, 1, result.FailedCount)
	require.Equal(t, "old-plan", channel.ChannelInfo.MultiKeyUsage[0].PlanType)
	require.Equal(t, old.UpdatedAt, channel.ChannelInfo.MultiKeyUsage[0].UpdatedAt)
	require.Len(t, channel.ChannelInfo.MultiKeyUsage[0].QuotaWindows, 3)
	require.Equal(t, now.Unix(), channel.ChannelInfo.MultiKeyUsage[0].QuotaWindowsCheckedAt)
	require.Equal(t, "first-plan", channel.ChannelInfo.MultiKeyUsage[1].PlanType)
	_, exists := channel.ChannelInfo.MultiKeyUsage[2]
	require.False(t, exists)
	require.Equal(t, 2, channel.ChannelInfo.MultiKeyStatusList[0])
	require.Equal(t, common.ChannelStatusEnabled, channel.Status)
}

func TestDroidFetchContinuesOtherQueriesAndRedactsFailureBodies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer fixture-abcdefgh", r.Header.Get("Authorization"))
		require.Equal(t, "factory-cli/0.234.0", r.Header.Get("User-Agent"))
		switch r.URL.Path {
		case "/api/billing/limits":
			fmt.Fprint(w, droidLimitsFixture)
		case "/api/app/auth/me":
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, "secret-fixture-abcdefgh-portal")
		case "/api/organization/subscription/usage":
			fmt.Fprint(w, droidTotalsFixture)
		case "/api/factory-api-key/list":
			fmt.Fprint(w, `[{"fingerprint":"abcdefgh","isRevoked":false}]`)
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	snapshot, err := fetchDroidUsageSnapshot(context.Background(), server.Client(), server.URL, "fixture-abcdefgh", time.Now())
	require.ErrorContains(t, err, "HTTP 403")
	require.NotContains(t, err.Error(), "secret")
	require.NotContains(t, err.Error(), "abcdefgh")
	require.True(t, snapshot.limits)
	require.True(t, snapshot.totals)
	require.True(t, snapshot.credential)
	require.False(t, snapshot.subscription)
}

func TestDroidRefreshPersistsAgainstCurrentCredentialIdentity(t *testing.T) {
	previousDB, previousCache := model.DB, common.MemoryCacheEnabled
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}))
	model.DB, common.MemoryCacheEnabled = db, false
	t.Cleanup(func() { model.DB, common.MemoryCacheEnabled = previousDB, previousCache })
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/billing/limits" {
			once.Do(func() { close(started) })
			<-release
		}
		switch r.URL.Path {
		case "/api/billing/limits":
			fmt.Fprint(w, droidLimitsFixture)
		case "/api/app/auth/me":
			fmt.Fprint(w, droidSubscriptionFixture)
		case "/api/organization/subscription/usage":
			fmt.Fprint(w, droidTotalsFixture)
		case "/api/factory-api-key/list":
			fmt.Fprint(w, `[{"fingerprint":"aaaaaaaa"},{"fingerprint":"bbbbbbbb"}]`)
		}
	}))
	defer server.Close()
	channel := model.Channel{Type: constant.ChannelTypeDroid, Key: "fixture-aaaaaaaa\nfixture-bbbbbbbb", BaseURL: &server.URL, Status: common.ChannelStatusEnabled, ChannelInfo: model.ChannelInfo{IsMultiKey: true, MultiKeySize: 2}}
	require.NoError(t, db.Create(&channel).Error)
	finished := make(chan error, 1)
	go func() {
		_, err := RefreshDroidChannelUsage(context.Background(), channel.Id)
		finished <- err
	}()
	<-started
	lock := model.GetChannelPollingLock(channel.Id)
	lock.Lock()
	err = db.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("key", "fixture-bbbbbbbb\nfixture-cccccccc").Error
	lock.Unlock()
	close(release)
	require.NoError(t, err)
	require.NoError(t, <-finished)
	current, err := model.GetChannelById(channel.Id, true)
	require.NoError(t, err)
	require.Len(t, current.ChannelInfo.MultiKeyUsage, 1)
	require.Equal(t, "team_annual", current.ChannelInfo.MultiKeyUsage[0].PlanType)
	_, exists := current.ChannelInfo.MultiKeyUsage[1]
	require.False(t, exists, "new key must never inherit removed key's snapshot")
	require.Equal(t, common.ChannelStatusEnabled, current.Status)
}
