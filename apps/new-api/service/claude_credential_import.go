package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/claudeauth"
)

type ClaudeCredentialImportResult struct {
	AccountCount  int
	AddedCount    int
	ReplacedCount int
	Keys          []string
}

type validatedClaudeCredential struct {
	Raw       string
	AccountID string
}

func NormalizeClaudeCredentialImports(rawCredentials []string) (ClaudeCredentialImportResult, error) {
	if len(rawCredentials) == 0 {
		return ClaudeCredentialImportResult{}, errors.New("claude channel: at least one credential is required")
	}

	validated := make([]validatedClaudeCredential, 0, len(rawCredentials))
	seen := make(map[string]struct{})
	for fileIndex, rawCredential := range rawCredentials {
		keys, err := claudeauth.NormalizeCredentials(rawCredential)
		if err != nil {
			return ClaudeCredentialImportResult{}, fmt.Errorf("claude channel: file %d: %w", fileIndex+1, err)
		}
		for accountIndex, key := range keys {
			accountID := strings.TrimSpace(key.AccountID)
			if _, exists := seen[accountID]; exists {
				return ClaudeCredentialImportResult{}, fmt.Errorf("claude channel: duplicate account_id in import at file %d account %d", fileIndex+1, accountIndex+1)
			}
			seen[accountID] = struct{}{}
			encoded, marshalErr := common.Marshal(key)
			if marshalErr != nil {
				return ClaudeCredentialImportResult{}, fmt.Errorf("claude channel: encode file %d account %d: %w", fileIndex+1, accountIndex+1, marshalErr)
			}
			validated = append(validated, validatedClaudeCredential{Raw: string(encoded), AccountID: accountID})
		}
	}

	result := ClaudeCredentialImportResult{Keys: make([]string, 0, len(validated))}
	for _, credential := range validated {
		result.Keys = append(result.Keys, credential.Raw)
	}
	result.AccountCount = len(result.Keys)
	result.AddedCount = len(result.Keys)
	return result, nil
}

func ImportClaudeChannelCredentials(channelID int, rawCredentials []string) (ClaudeCredentialImportResult, error) {
	incoming, err := NormalizeClaudeCredentialImports(rawCredentials)
	if err != nil {
		return ClaudeCredentialImportResult{}, err
	}

	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()

	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return ClaudeCredentialImportResult{}, err
	}
	if ch == nil {
		return ClaudeCredentialImportResult{}, errors.New("channel not found")
	}
	if ch.Type != constant.ChannelTypeAnthropic {
		return ClaudeCredentialImportResult{}, errors.New("channel type is not Claude")
	}

	keys := ch.GetKeys()
	indexByAccountID := make(map[string]int, len(keys))
	for index, rawKey := range keys {
		parsed, parseErr := parseClaudeOAuthKey(strings.TrimSpace(rawKey))
		if parseErr == nil && strings.TrimSpace(parsed.AccountID) != "" {
			indexByAccountID[strings.TrimSpace(parsed.AccountID)] = index
		}
	}

	result := ClaudeCredentialImportResult{Keys: incoming.Keys}
	for _, rawKey := range incoming.Keys {
		parsed, parseErr := parseClaudeOAuthKey(rawKey)
		if parseErr != nil {
			return ClaudeCredentialImportResult{}, parseErr
		}
		accountID := strings.TrimSpace(parsed.AccountID)
		if index, exists := indexByAccountID[accountID]; exists {
			keys[index] = rawKey
			result.ReplacedCount++
			continue
		}
		indexByAccountID[accountID] = len(keys)
		keys = append(keys, rawKey)
		result.AddedCount++
	}

	ch.ChannelInfo.IsMultiKey = len(keys) > 1
	ch.ChannelInfo.MultiKeySize = len(keys)
	if ch.ChannelInfo.MultiKeyMode == "" {
		ch.ChannelInfo.MultiKeyMode = constant.MultiKeyModeRandom
	}
	updates := map[string]interface{}{
		"key":          strings.Join(keys, "\n"),
		"channel_info": ch.ChannelInfo,
	}
	if err := model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Updates(updates).Error; err != nil {
		return ClaudeCredentialImportResult{}, err
	}
	result.AccountCount = len(keys)
	return result, nil
}
