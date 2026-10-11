package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

const droidUsageConcurrency = 4

var droidUsageRefreshLocks sync.Map

type DroidUsageAccount struct {
	Index int                   `json:"index"`
	Usage model.ChannelKeyUsage `json:"usage"`
}

type DroidUsageRefreshResult struct {
	Accounts       []DroidUsageAccount `json:"accounts"`
	RefreshedCount int                 `json:"refreshed_count"`
	FailedCount    int                 `json:"failed_count"`
}

type droidUsageProbe struct {
	identity [32]byte
	snapshot droidUsageSnapshot
	err      error
}

func droidCredentialIdentity(key string) [32]byte {
	return sha256.Sum256([]byte(strings.TrimSpace(key)))
}

// Fetch outside the polling lock, then match identities against the current
// credentials. An index captured before a key removal/reorder is not identity.
func RefreshDroidChannelUsage(ctx context.Context, channelID int) (DroidUsageRefreshResult, error) {
	entry, _ := droidUsageRefreshLocks.LoadOrStore(channelID, &sync.Mutex{})
	refreshLock := entry.(*sync.Mutex)
	refreshLock.Lock()
	defer refreshLock.Unlock()
	// Collection begins after acquiring the independent refresh lock, so a queued
	// older invocation cannot overwrite a newer snapshot with its caller timestamp.
	now := time.Now()
	result := DroidUsageRefreshResult{Accounts: []DroidUsageAccount{}}
	channel, err := model.GetChannelById(channelID, true)
	if err != nil || channel == nil {
		return result, errors.New("Droid usage channel could not be loaded")
	}
	if channel.Type != constant.ChannelTypeDroid {
		return result, errors.New("channel type is not Droid")
	}
	keys := channel.GetKeys()
	if len(keys) == 0 {
		return result, errors.New("Droid channel has no API keys")
	}
	client, clientErr := NewProxyHttpClient(channel.GetSetting().Proxy)
	probes := make([]droidUsageProbe, len(keys))
	jobs := make(chan int, len(keys))
	for index := range keys {
		jobs <- index
	}
	close(jobs)
	workers := min(len(keys), droidUsageConcurrency)
	var group sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for index := range jobs {
				probe := droidUsageProbe{identity: droidCredentialIdentity(keys[index])}
				if clientErr != nil {
					probe.err = errors.New("Droid usage proxy client could not be configured")
				} else {
					probe.snapshot, probe.err = fetchDroidUsageSnapshot(ctx, client, channel.GetBaseURL(), keys[index], now)
				}
				probes[index] = probe
			}
		}()
	}
	group.Wait()

	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()
	current, err := model.GetChannelById(channelID, true)
	if err != nil || current == nil {
		return result, errors.New("Droid usage channel could not be reloaded")
	}
	if current.Type != constant.ChannelTypeDroid {
		return result, errors.New("channel type changed while refreshing Droid usage")
	}
	result, refreshErr := applyDroidUsageProbes(current, probes, now)
	if err := current.SaveChannelInfo(); err != nil {
		return result, errors.Join(refreshErr, errors.New("Droid usage snapshots could not be saved"))
	}
	if err := model.RefreshChannelCache(); err != nil {
		return result, errors.Join(refreshErr, errors.New("Droid usage snapshots saved, but channel cache refresh failed"))
	}
	return result, refreshErr
}

func applyDroidUsageProbes(channel *model.Channel, probes []droidUsageProbe, now time.Time) (DroidUsageRefreshResult, error) {
	result := DroidUsageRefreshResult{Accounts: []DroidUsageAccount{}}
	byIdentity := make(map[[32]byte]droidUsageProbe, len(probes))
	for _, probe := range probes {
		byIdentity[probe.identity] = probe
	}
	if channel.ChannelInfo.MultiKeyUsage == nil {
		channel.ChannelInfo.MultiKeyUsage = make(map[int]model.ChannelKeyUsage)
	}
	var failures []error
	for index, key := range channel.GetKeys() {
		probe, found := byIdentity[droidCredentialIdentity(key)]
		if !found {
			continue
		}
		previous := channel.ChannelInfo.MultiKeyUsage[index]
		if previous.UsageCheckedAt > now.Unix() {
			result.Accounts = append(result.Accounts, DroidUsageAccount{Index: index, Usage: previous})
			continue
		}
		usage := previous
		usage.QuotaSource = DroidQuotaSource
		usage.UsageCheckedAt = now.Unix()
		snapshot := probe.snapshot
		if snapshot.limits {
			usage.QuotaWindows = snapshot.usage.QuotaWindows
			usage.ExtraUsageBalanceCents, usage.ExtraUsageAllowed = snapshot.usage.ExtraUsageBalanceCents, snapshot.usage.ExtraUsageAllowed
			usage.OveragePreference, usage.UsesTokenRateLimitsBilling = snapshot.usage.OveragePreference, snapshot.usage.UsesTokenRateLimitsBilling
			usage.QuotaWindowsCheckedAt = snapshot.usage.QuotaWindowsCheckedAt
		}
		if snapshot.subscription {
			copyDroidSubscription(&usage, snapshot.usage)
		}
		if snapshot.totals {
			copyDroidTotals(&usage, snapshot.usage)
		}
		if snapshot.credential {
			copyDroidCredential(&usage, snapshot.usage)
		}
		if snapshot.limits || snapshot.subscription || snapshot.totals || snapshot.credential {
			result.RefreshedCount++
		}
		if probe.err != nil {
			usage.UsageError = probe.err.Error()
			result.FailedCount++
			failures = append(failures, fmt.Errorf("account %d: %w", index+1, probe.err))
		} else {
			usage.UsageError = ""
			usage.UpdatedAt = now.Unix()
		}
		channel.ChannelInfo.MultiKeyUsage[index] = usage
		result.Accounts = append(result.Accounts, DroidUsageAccount{Index: index, Usage: usage})
	}
	return result, errors.Join(failures...)
}
