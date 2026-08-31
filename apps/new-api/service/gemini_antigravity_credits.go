package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

const antigravityCreditQuotaSource = "antigravity_load_code_assist"

const antigravityCreditGuardReasonPrefix = "antigravity credit guard:"

type geminiAntigravityCreditProbe struct {
	usage model.ChannelKeyUsage
	err   error
}

// RefreshGeminiAntigravityCredits queries the same loadCodeAssist paid-tier
// payload used by CLIProxyAPI. A numeric credit balance is stored only when
// Google actually returns one. Accounts with an explicitly insufficient
// balance enter the existing per-account cooldown/skip pool; an unknown field
// never gets treated as exhausted.
func RefreshGeminiAntigravityCredits(ctx context.Context, channelID int, now time.Time) ([]model.ChannelKeyUsage, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil || channel == nil {
		return nil, fmt.Errorf("load Gemini channel: %w", err)
	}
	if channel.Type != constant.ChannelTypeGemini || !channel.ChannelInfo.IsMultiKey {
		return nil, errors.New("Antigravity credit refresh requires a multi-key Gemini channel")
	}

	keys := channel.GetKeys()
	probes := make([]geminiAntigravityCreditProbe, len(keys))
	for index := range keys {
		key, refreshedChannel, refreshErr := RefreshGeminiChannelKeyCredential(ctx, channelID, index, GeminiCredentialRefreshOptions{})
		if refreshErr != nil {
			probes[index].err = refreshErr
			continue
		}
		if !strings.EqualFold(key.EffectiveOAuthType(), "antigravity") {
			continue
		}
		client, clientErr := getGeminiOAuthHTTPClient(refreshedChannel.GetSetting().Proxy)
		if clientErr != nil {
			probes[index].err = clientErr
			continue
		}
		baseURL := refreshedChannel.GetBaseURL()
		if strings.TrimSpace(baseURL) == "" {
			baseURL = geminiCodeAssistServiceBaseURL()
		}
		loadResponse, loadErr := loadGeminiCodeAssistAccountAtBaseURL(ctx, client, key.AccessToken, baseURL)
		if loadErr != nil {
			probes[index].err = loadErr
			continue
		}
		probes[index].usage = parseGeminiAntigravityCreditUsage(loadResponse, now)
	}

	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()
	current, err := model.GetChannelById(channelID, true)
	if err != nil || current == nil {
		return nil, fmt.Errorf("reload Gemini channel: %w", err)
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

	result := make([]model.ChannelKeyUsage, len(probes))
	var probeErrors []error
	for index, probe := range probes {
		if probe.err != nil {
			probeErrors = append(probeErrors, fmt.Errorf("account %d: %w", index+1, probe.err))
			continue
		}
		if probe.usage.QuotaSource == "" {
			continue
		}
		info.MultiKeyUsage[index] = probe.usage
		result[index] = probe.usage
		if probe.usage.CreditKnown && !probe.usage.CreditAvailable {
			until := now.Add(DefaultGeminiOAuthKeyCooldownSeconds * time.Second).Unix()
			info.MultiKeyStatusList[index] = common.ChannelStatusAutoDisabled
			info.MultiKeyDisabledTime[index] = now.Unix()
			info.MultiKeyCooldownUntil[index] = until
			info.MultiKeyDisabledReason[index] = fmt.Sprintf("%s balance below required minimum; resume after %s", antigravityCreditGuardReasonPrefix, time.Unix(until, 0).Format(time.RFC3339))
		} else if info.MultiKeyStatusList[index] == common.ChannelStatusAutoDisabled && strings.HasPrefix(info.MultiKeyDisabledReason[index], antigravityCreditGuardReasonPrefix) {
			delete(info.MultiKeyStatusList, index)
			delete(info.MultiKeyDisabledReason, index)
			delete(info.MultiKeyDisabledTime, index)
			delete(info.MultiKeyCooldownUntil, index)
		}
	}
	if err := current.Save(); err != nil {
		return result, err
	}
	if err := model.RefreshChannelCache(); err != nil {
		return result, errors.Join(errors.Join(probeErrors...), err)
	}
	return result, errors.Join(probeErrors...)
}

func parseGeminiAntigravityCreditUsage(response *geminiCodeAssistLoadResponse, now time.Time) model.ChannelKeyUsage {
	usage := model.ChannelKeyUsage{PaidTierID: strings.TrimSpace(response.PaidTier.ID), QuotaSource: antigravityCreditQuotaSource, UpdatedAt: now.Unix()}
	for _, credit := range response.PaidTier.AvailableCredits {
		if credit.CreditType != "GOOGLE_ONE_AI" {
			continue
		}
		amount, amountErr := strconv.ParseFloat(strings.TrimSpace(credit.CreditAmount), 64)
		minimum, minimumErr := strconv.ParseFloat(strings.TrimSpace(credit.MinimumCreditAmountForUsage), 64)
		if amountErr != nil || minimumErr != nil {
			return usage
		}
		usage.CreditKnown = true
		usage.CreditAmount = amount
		usage.MinimumCreditAmount = minimum
		usage.CreditAvailable = amount >= minimum
		return usage
	}
	// A paid tier that does not publish a GOOGLE_ONE_AI balance is observable,
	// but not an exhaustion signal. Keep it visible without disabling the key.
	return usage
}
