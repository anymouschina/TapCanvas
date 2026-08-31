package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	CodexMinimumRemainingPercent = 5.0
	codexUsageLifecycleInterval  = 2 * time.Minute
	codexUsageRequestTimeout     = 15 * time.Second
	codexUsageResetBuffer        = 60
	codexUsageProbeConcurrency   = 4
)

const codexQuotaGuardReasonPrefix = "codex quota guard:"

type codexUsagePayload struct {
	PlanType  string `json:"plan_type"`
	RateLimit struct {
		Allowed       bool `json:"allowed"`
		LimitReached  bool `json:"limit_reached"`
		PrimaryWindow struct {
			UsedPercent float64 `json:"used_percent"`
			ResetAt     int64   `json:"reset_at"`
		} `json:"primary_window"`
		SecondaryWindow struct {
			UsedPercent float64 `json:"used_percent"`
			ResetAt     int64   `json:"reset_at"`
		} `json:"secondary_window"`
	} `json:"rate_limit"`
}

type codexUsageProbe struct {
	sessionKey string
	usage      model.ChannelKeyUsage
	remove     bool
	err        error
}

var (
	codexUsageLifecycleOnce    sync.Once
	codexUsageLifecycleRunning atomic.Bool
)

func parseCodexUsageSnapshot(body []byte, now time.Time) (model.ChannelKeyUsage, error) {
	var payload codexUsagePayload
	if err := common.Unmarshal(body, &payload); err != nil {
		return model.ChannelKeyUsage{}, fmt.Errorf("decode Codex usage: %w", err)
	}
	primary := payload.RateLimit.PrimaryWindow.UsedPercent
	secondary := payload.RateLimit.SecondaryWindow.UsedPercent
	used := math.Max(primary, secondary)
	if used < 0 || used > 100 {
		return model.ChannelKeyUsage{}, fmt.Errorf("Codex usage used_percent out of range: %.2f", used)
	}
	return model.ChannelKeyUsage{
		PlanType:             payload.PlanType,
		UsedPercent:          used,
		RemainingPercent:     math.Max(0, 100-used),
		PrimaryUsedPercent:   primary,
		PrimaryResetAt:       payload.RateLimit.PrimaryWindow.ResetAt,
		SecondaryUsedPercent: secondary,
		SecondaryResetAt:     payload.RateLimit.SecondaryWindow.ResetAt,
		Allowed:              payload.RateLimit.Allowed,
		LimitReached:         payload.RateLimit.LimitReached,
		UpdatedAt:            now.Unix(),
	}, nil
}

func codexUsageCooldownUntil(usage model.ChannelKeyUsage, now int64) int64 {
	threshold := 100 - CodexMinimumRemainingPercent
	resetAt := int64(0)
	if usage.PrimaryUsedPercent > threshold {
		resetAt = usage.PrimaryResetAt
	}
	if usage.SecondaryUsedPercent > threshold && usage.SecondaryResetAt > resetAt {
		resetAt = usage.SecondaryResetAt
	}
	if resetAt <= now {
		return now + int64(codexUsageLifecycleInterval/time.Second) + codexUsageResetBuffer
	}
	return resetAt + codexUsageResetBuffer
}

func probeCodexUsage(ctx context.Context, ch *model.Channel, rawKey string, now time.Time) codexUsageProbe {
	key, err := parseCodexOAuthKey(strings.TrimSpace(rawKey))
	if err != nil {
		return codexUsageProbe{err: err}
	}
	sessionKey := codexCredentialSessionKey(key)
	if sessionKey == "" || strings.TrimSpace(key.AccessToken) == "" || strings.TrimSpace(key.AccountID) == "" {
		return codexUsageProbe{sessionKey: sessionKey, err: errors.New("Codex usage requires account_id and access_token")}
	}
	client, err := NewProxyHttpClient(ch.GetSetting().Proxy)
	if err != nil {
		return codexUsageProbe{sessionKey: sessionKey, err: err}
	}
	fetchCtx, cancel := context.WithTimeout(ctx, codexUsageRequestTimeout)
	defer cancel()
	status, body, err := FetchCodexWhamUsage(fetchCtx, client, ch.GetBaseURL(), key.AccessToken, key.AccountID)
	if err != nil {
		return codexUsageProbe{sessionKey: sessionKey, err: err}
	}
	if status == http.StatusForbidden {
		return codexUsageProbe{sessionKey: sessionKey, remove: true}
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return codexUsageProbe{sessionKey: sessionKey, err: fmt.Errorf("Codex usage upstream status %d", status)}
	}
	usage, err := parseCodexUsageSnapshot(body, now)
	return codexUsageProbe{sessionKey: sessionKey, usage: usage, err: err}
}

// RefreshCodexChannelUsageLifecycle probes every account, persists usage, and
// atomically changes scheduling eligibility. Existing session affinity is
// naturally rebound because disabled preferred indexes are rejected by key selection.
func RefreshCodexChannelUsageLifecycle(ctx context.Context, channelID int, now time.Time) ([]model.ChannelKeyUsage, error) {
	ch, err := model.GetChannelById(channelID, true)
	if err != nil || ch == nil {
		return nil, fmt.Errorf("load Codex channel: %w", err)
	}
	if ch.Type != constant.ChannelTypeCodex || !ch.ChannelInfo.IsMultiKey {
		return nil, errors.New("Codex usage lifecycle requires a multi-key Codex channel")
	}
	keys := ch.GetKeys()
	probes := make([]codexUsageProbe, len(keys))
	semaphore := make(chan struct{}, codexUsageProbeConcurrency)
	var waitGroup sync.WaitGroup
	for index, rawKey := range keys {
		waitGroup.Add(1)
		go func(index int, rawKey string) {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				probes[index] = codexUsageProbe{err: ctx.Err()}
				return
			}
			probes[index] = probeCodexUsage(ctx, ch, rawKey, now)
		}(index, rawKey)
	}
	waitGroup.Wait()

	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()
	current, err := model.GetChannelById(channelID, true)
	if err != nil || current == nil {
		return nil, fmt.Errorf("reload Codex channel: %w", err)
	}
	info := &current.ChannelInfo
	if info.MultiKeyUsage == nil {
		info.MultiKeyUsage = make(map[int]model.ChannelKeyUsage)
	}
	if info.MultiKeyStatusList == nil {
		info.MultiKeyStatusList = make(map[int]int)
	}
	if info.MultiKeyDisabledReason == nil {
		info.MultiKeyDisabledReason = make(map[int]string)
	}
	if info.MultiKeyDisabledTime == nil {
		info.MultiKeyDisabledTime = make(map[int]int64)
	}
	if info.MultiKeyCooldownUntil == nil {
		info.MultiKeyCooldownUntil = make(map[int]int64)
	}

	probeBySession := make(map[string]codexUsageProbe, len(probes))
	removedSessions := make(map[string]struct{})
	var probeErrors []error
	for index, probe := range probes {
		if probe.remove {
			removedSessions[probe.sessionKey] = struct{}{}
			continue
		}
		if probe.err != nil {
			probeErrors = append(probeErrors, fmt.Errorf("account %d: %w", index+1, probe.err))
			continue
		}
		probeBySession[probe.sessionKey] = probe
	}
	currentKeys := current.GetKeys()
	if len(removedSessions) > 0 && len(removedSessions) < len(currentKeys) {
		remainingKeys := make([]string, 0, len(currentKeys)-len(removedSessions))
		indexMap := make(map[int]int, len(currentKeys))
		for oldIndex, rawKey := range currentKeys {
			key, parseErr := parseCodexOAuthKey(strings.TrimSpace(rawKey))
			if parseErr == nil {
				if _, remove := removedSessions[codexCredentialSessionKey(key)]; remove {
					continue
				}
			}
			indexMap[oldIndex] = len(remainingKeys)
			remainingKeys = append(remainingKeys, rawKey)
		}
		current.Key = strings.Join(remainingKeys, "\n")
		info.MultiKeySize = len(remainingKeys)
		info.MultiKeyStatusList = remapIntMap(info.MultiKeyStatusList, indexMap)
		info.MultiKeyDisabledReason = remapStringMap(info.MultiKeyDisabledReason, indexMap)
		info.MultiKeyDisabledTime = remapInt64Map(info.MultiKeyDisabledTime, indexMap)
		info.MultiKeyCooldownUntil = remapInt64Map(info.MultiKeyCooldownUntil, indexMap)
		info.MultiKeyUsage = remapUsageMap(info.MultiKeyUsage, indexMap)
		currentKeys = remainingKeys
	}
	threshold := 100 - CodexMinimumRemainingPercent
	result := make([]model.ChannelKeyUsage, len(currentKeys))
	for index, rawKey := range currentKeys {
		key, parseErr := parseCodexOAuthKey(strings.TrimSpace(rawKey))
		if parseErr != nil {
			continue
		}
		probe, found := probeBySession[codexCredentialSessionKey(key)]
		if !found {
			continue
		}
		usage := probe.usage
		info.MultiKeyUsage[index] = usage
		result[index] = usage
		if usage.RemainingPercent < CodexMinimumRemainingPercent || usage.UsedPercent > threshold || !usage.Allowed || usage.LimitReached {
			until := codexUsageCooldownUntil(usage, now.Unix())
			info.MultiKeyStatusList[index] = common.ChannelStatusAutoDisabled
			info.MultiKeyDisabledTime[index] = now.Unix()
			info.MultiKeyCooldownUntil[index] = until
			info.MultiKeyDisabledReason[index] = fmt.Sprintf("%s remaining %.1f%%, resume after %s", codexQuotaGuardReasonPrefix, usage.RemainingPercent, time.Unix(until, 0).Format(time.RFC3339))
		} else if info.MultiKeyStatusList[index] == common.ChannelStatusAutoDisabled && strings.HasPrefix(info.MultiKeyDisabledReason[index], codexQuotaGuardReasonPrefix) {
			delete(info.MultiKeyStatusList, index)
			delete(info.MultiKeyDisabledTime, index)
			delete(info.MultiKeyCooldownUntil, index)
			delete(info.MultiKeyDisabledReason, index)
		}
	}
	allDisabled := info.MultiKeySize > 0 && len(info.MultiKeyStatusList) >= info.MultiKeySize
	if allDisabled && current.Status == common.ChannelStatusEnabled {
		current.Status = common.ChannelStatusAutoDisabled
		otherInfo := current.GetOtherInfo()
		otherInfo["status_reason"] = codexQuotaGuardReasonPrefix + " all accounts unavailable"
		otherInfo["status_time"] = now.Unix()
		current.SetOtherInfo(otherInfo)
	} else if !allDisabled && current.Status == common.ChannelStatusAutoDisabled {
		otherInfo := current.GetOtherInfo()
		statusReason, _ := otherInfo["status_reason"].(string)
		if strings.HasPrefix(statusReason, codexQuotaGuardReasonPrefix) {
			current.Status = common.ChannelStatusEnabled
			delete(otherInfo, "status_reason")
			delete(otherInfo, "status_time")
			current.SetOtherInfo(otherInfo)
		}
	}
	if err := current.Save(); err != nil {
		return result, err
	}
	if len(removedSessions) > 0 && len(removedSessions) < len(keys) {
		logger.LogInfo(ctx, fmt.Sprintf("Codex usage lifecycle channel_id=%d removed %d upstream-forbidden account(s)", channelID, len(removedSessions)))
	}
	if err := model.UpdateAbilityStatus(channelID, current.Status == common.ChannelStatusEnabled); err != nil {
		return result, err
	}
	if err := model.RefreshChannelCache(); err != nil {
		return result, errors.Join(
			errors.Join(probeErrors...),
			fmt.Errorf("Codex 账号状态已保存，但刷新运行时渠道缓存失败: %w", err),
		)
	}
	return result, errors.Join(probeErrors...)
}

func remapIntMap(values map[int]int, indexes map[int]int) map[int]int {
	result := make(map[int]int)
	for oldIndex, value := range values {
		if newIndex, exists := indexes[oldIndex]; exists {
			result[newIndex] = value
		}
	}
	return result
}

func remapInt64Map(values map[int]int64, indexes map[int]int) map[int]int64 {
	result := make(map[int]int64)
	for oldIndex, value := range values {
		if newIndex, exists := indexes[oldIndex]; exists {
			result[newIndex] = value
		}
	}
	return result
}

func remapStringMap(values map[int]string, indexes map[int]int) map[int]string {
	result := make(map[int]string)
	for oldIndex, value := range values {
		if newIndex, exists := indexes[oldIndex]; exists {
			result[newIndex] = value
		}
	}
	return result
}

func remapUsageMap(values map[int]model.ChannelKeyUsage, indexes map[int]int) map[int]model.ChannelKeyUsage {
	result := make(map[int]model.ChannelKeyUsage)
	for oldIndex, value := range values {
		if newIndex, exists := indexes[oldIndex]; exists {
			result[newIndex] = value
		}
	}
	return result
}

func StartCodexUsageLifecycleTask() {
	codexUsageLifecycleOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			runCodexUsageLifecycleOnce()
			ticker := time.NewTicker(codexUsageLifecycleInterval)
			defer ticker.Stop()
			for range ticker.C {
				runCodexUsageLifecycleOnce()
			}
		})
	})
}

// RefreshCodexUsageAfterLimit asynchronously records the upstream limit and
// removes the exhausted account from subsequent scheduling without delaying
// the current request's sibling-account retry.
func RefreshCodexUsageAfterLimit(channelID int) {
	gopool.Go(func() {
		if _, err := RefreshCodexChannelUsageLifecycle(context.Background(), channelID, time.Now()); err != nil {
			logger.LogWarn(context.Background(), fmt.Sprintf("Codex post-limit usage refresh channel_id=%d: %v", channelID, err))
		}
	})
}

func runCodexUsageLifecycleOnce() {
	if !codexUsageLifecycleRunning.CompareAndSwap(false, true) {
		return
	}
	defer codexUsageLifecycleRunning.Store(false)
	var channels []model.Channel
	if err := model.DB.Select("id", "channel_info").Where("type = ?", constant.ChannelTypeCodex).Find(&channels).Error; err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("Codex usage lifecycle query failed: %v", err))
		return
	}
	for _, ch := range channels {
		if !ch.ChannelInfo.IsMultiKey {
			continue
		}
		if _, err := RefreshCodexChannelUsageLifecycle(context.Background(), ch.Id, time.Now()); err != nil {
			logger.LogWarn(context.Background(), fmt.Sprintf("Codex usage lifecycle channel_id=%d: %v", ch.Id, err))
		}
	}
}
