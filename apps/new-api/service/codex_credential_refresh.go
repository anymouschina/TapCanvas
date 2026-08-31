package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/codexauth"
)

type CodexCredentialRefreshOptions struct {
	ResetCaches bool
}

type CodexOAuthKey struct {
	IDToken      string `json:"id_token,omitempty"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	SessionToken string `json:"session_token,omitempty"`
	SessionID    string `json:"session_id,omitempty"`

	AccountID   string `json:"account_id,omitempty"`
	LastRefresh string `json:"last_refresh,omitempty"`
	Email       string `json:"email,omitempty"`
	Type        string `json:"type,omitempty"`
	Expired     string `json:"expired,omitempty"`
}

func parseCodexOAuthKey(raw string) (*CodexOAuthKey, error) {
	normalized, _, err := codexauth.NormalizeCredential(raw)
	if err != nil {
		return nil, err
	}
	return &CodexOAuthKey{
		IDToken: normalized.IDToken, AccessToken: normalized.AccessToken,
		RefreshToken: normalized.RefreshToken, SessionToken: normalized.SessionToken,
		SessionID: normalized.SessionID,
		AccountID: normalized.AccountID, LastRefresh: normalized.LastRefresh,
		Email: normalized.Email, Type: normalized.Type, Expired: normalized.Expired,
	}, nil
}

func RefreshCodexChannelCredential(ctx context.Context, channelID int, opts CodexCredentialRefreshOptions) (*CodexOAuthKey, *model.Channel, error) {
	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, nil, err
	}
	if ch == nil {
		return nil, nil, fmt.Errorf("channel not found")
	}
	if ch.Type != constant.ChannelTypeCodex {
		return nil, nil, fmt.Errorf("channel type is not Codex")
	}

	oauthKey, err := parseCodexOAuthKey(strings.TrimSpace(ch.Key))
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(oauthKey.RefreshToken) == "" {
		return nil, nil, fmt.Errorf("codex channel: refresh_token is required to refresh credential")
	}

	refreshCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	res, err := RefreshCodexOAuthTokenWithProxy(refreshCtx, oauthKey.RefreshToken, ch.GetSetting().Proxy)
	if err != nil {
		return nil, nil, err
	}

	oauthKey.AccessToken = res.AccessToken
	oauthKey.RefreshToken = res.RefreshToken
	oauthKey.LastRefresh = time.Now().Format(time.RFC3339)
	oauthKey.Expired = res.ExpiresAt.Format(time.RFC3339)
	if strings.TrimSpace(oauthKey.Type) == "" {
		oauthKey.Type = "codex"
	}

	if strings.TrimSpace(oauthKey.AccountID) == "" {
		if accountID, ok := ExtractCodexAccountIDFromJWT(oauthKey.AccessToken); ok {
			oauthKey.AccountID = accountID
		}
	}
	if strings.TrimSpace(oauthKey.Email) == "" {
		if email, ok := ExtractEmailFromJWT(oauthKey.AccessToken); ok {
			oauthKey.Email = email
		}
	}

	encoded, err := common.Marshal(oauthKey)
	if err != nil {
		return nil, nil, err
	}

	if err := model.DB.Model(&model.Channel{}).Where("id = ?", ch.Id).Update("key", string(encoded)).Error; err != nil {
		return nil, nil, err
	}

	if opts.ResetCaches {
		ResetProxyClientCache()
		if err := model.RefreshChannelCache(); err != nil {
			return oauthKey, ch, fmt.Errorf("Codex 凭据已保存，但刷新运行时渠道缓存失败: %w", err)
		}
	}

	return oauthKey, ch, nil
}

// UpsertCodexChannelCredential adds one OAuth account to a Codex channel. Re-authorizing
// the same upstream account replaces its credential in place so status indexes stay stable.
func UpsertCodexChannelCredential(channelID int, rawCredential string) (accountCount int, replaced bool, err error) {
	result, err := ImportCodexChannelCredentials(channelID, []string{rawCredential})
	return result.AccountCount, result.ReplacedCount == 1, err
}

type CodexCredentialImportResult struct {
	AccountCount  int
	AddedCount    int
	ReplacedCount int
	Diagnostics   []codexauth.CredentialDiagnostics
	Keys          []string
}

type validatedCodexCredential struct {
	Raw         string
	AccountID   string
	SessionKey  string
	Diagnostics codexauth.CredentialDiagnostics
}

func codexCredentialSessionKey(key *CodexOAuthKey) string {
	if key == nil {
		return ""
	}
	if sessionToken := strings.TrimSpace(key.SessionToken); sessionToken != "" {
		return "session_token:" + sessionToken
	}
	if sessionID := strings.TrimSpace(key.SessionID); sessionID != "" {
		return "session_id:" + sessionID
	}
	if accountID := strings.TrimSpace(key.AccountID); accountID != "" {
		return "account_id:" + accountID
	}
	return ""
}

func validateCodexCredentialBatch(rawCredentials []string) ([]validatedCodexCredential, error) {
	if len(rawCredentials) == 0 {
		return nil, errors.New("codex channel: at least one credential is required")
	}
	validated := make([]validatedCodexCredential, 0, len(rawCredentials))
	seen := make(map[string]struct{}, len(rawCredentials))
	for index, rawCredential := range rawCredentials {
		raw := strings.TrimSpace(rawCredential)
		normalizedKeys, diagnosticsItems, err := codexauth.NormalizeCredentials(raw)
		if err != nil {
			return nil, fmt.Errorf("codex channel: file %d: %w", index+1, err)
		}
		for accountIndex, normalized := range normalizedKeys {
			incoming := &CodexOAuthKey{
				IDToken: normalized.IDToken, AccessToken: normalized.AccessToken,
				RefreshToken: normalized.RefreshToken, SessionToken: normalized.SessionToken,
				SessionID: normalized.SessionID,
				AccountID: normalized.AccountID, LastRefresh: normalized.LastRefresh,
				Email: normalized.Email, Type: normalized.Type, Expired: normalized.Expired,
			}
			accountID := strings.TrimSpace(incoming.AccountID)
			if accountID == "" {
				return nil, fmt.Errorf("codex channel: file %d account %d: account_id is required", index+1, accountIndex+1)
			}
			if strings.TrimSpace(incoming.AccessToken) == "" {
				return nil, fmt.Errorf("codex channel: file %d account %d: access_token is required", index+1, accountIndex+1)
			}
			sessionKey := codexCredentialSessionKey(incoming)
			if _, exists := seen[sessionKey]; exists {
				return nil, fmt.Errorf("codex channel: duplicate account session in import batch at file %d account %d", index+1, accountIndex+1)
			}
			seen[sessionKey] = struct{}{}
			encoded, marshalErr := common.Marshal(normalized)
			if marshalErr != nil {
				return nil, fmt.Errorf("codex channel: file %d account %d: encode normalized credential: %w", index+1, accountIndex+1, marshalErr)
			}
			validated = append(validated, validatedCodexCredential{
				Raw: string(encoded), AccountID: accountID, SessionKey: sessionKey, Diagnostics: diagnosticsItems[accountIndex],
			})
		}
	}
	return validated, nil
}

func NormalizeCodexCredentialImports(rawCredentials []string) (CodexCredentialImportResult, error) {
	validated, err := validateCodexCredentialBatch(rawCredentials)
	if err != nil {
		return CodexCredentialImportResult{}, err
	}
	result := CodexCredentialImportResult{
		AccountCount: len(validated),
		AddedCount:   len(validated),
		Diagnostics:  make([]codexauth.CredentialDiagnostics, 0, len(validated)),
		Keys:         make([]string, 0, len(validated)),
	}
	for _, credential := range validated {
		result.Keys = append(result.Keys, credential.Raw)
		result.Diagnostics = append(result.Diagnostics, credential.Diagnostics)
	}
	return result, nil
}

// ImportCodexChannelCredentials validates the complete batch before taking the
// channel lock and persists all additions/replacements in one database update.
func ImportCodexChannelCredentials(channelID int, rawCredentials []string) (CodexCredentialImportResult, error) {
	validated, err := validateCodexCredentialBatch(rawCredentials)
	if err != nil {
		return CodexCredentialImportResult{}, err
	}

	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()

	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return CodexCredentialImportResult{}, err
	}
	if ch.Type != constant.ChannelTypeCodex {
		return CodexCredentialImportResult{}, errors.New("channel type is not Codex")
	}

	keys := ch.GetKeys()
	indexBySessionKey := make(map[string]int, len(keys))
	for index, rawKey := range keys {
		existing, parseErr := parseCodexOAuthKey(strings.TrimSpace(rawKey))
		if parseErr == nil {
			if sessionKey := codexCredentialSessionKey(existing); sessionKey != "" {
				indexBySessionKey[sessionKey] = index
			}
		}
	}
	result := CodexCredentialImportResult{Diagnostics: make([]codexauth.CredentialDiagnostics, 0, len(validated))}
	for _, credential := range validated {
		result.Diagnostics = append(result.Diagnostics, credential.Diagnostics)
		if index, exists := indexBySessionKey[credential.SessionKey]; exists {
			keys[index] = credential.Raw
			result.ReplacedCount++
			continue
		}
		indexBySessionKey[credential.SessionKey] = len(keys)
		keys = append(keys, credential.Raw)
		result.AddedCount++
	}

	ch.ChannelInfo.IsMultiKey = ch.ChannelInfo.IsMultiKey || len(keys) > 1
	ch.ChannelInfo.MultiKeySize = len(keys)
	if ch.ChannelInfo.MultiKeyMode == "" {
		ch.ChannelInfo.MultiKeyMode = constant.MultiKeyModeRandom
	}
	updates := map[string]interface{}{
		"key":          strings.Join(keys, "\n"),
		"channel_info": ch.ChannelInfo,
	}
	if err := model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Updates(updates).Error; err != nil {
		return CodexCredentialImportResult{}, err
	}
	result.AccountCount = len(keys)
	return result, nil
}

// RefreshCodexChannelCredentials refreshes every refreshable account in a channel.
// A per-account failure is surfaced after all accounts were attempted; it is never hidden.
func RefreshCodexChannelCredentials(ctx context.Context, channelID int, opts CodexCredentialRefreshOptions) (int, *model.Channel, error) {
	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return 0, nil, err
	}
	if ch.Type != constant.ChannelTypeCodex {
		return 0, nil, errors.New("channel type is not Codex")
	}
	if !ch.ChannelInfo.IsMultiKey {
		_, refreshedChannel, refreshErr := RefreshCodexChannelCredential(ctx, channelID, opts)
		if refreshErr != nil {
			return 0, ch, refreshErr
		}
		return 1, refreshedChannel, nil
	}

	keys := ch.GetKeys()
	refreshed := 0
	for index, rawKey := range keys {
		oauthKey, parseErr := parseCodexOAuthKey(strings.TrimSpace(rawKey))
		if parseErr != nil {
			return refreshed, ch, fmt.Errorf("codex channel: account %d: %w", index+1, parseErr)
		}
		if strings.TrimSpace(oauthKey.RefreshToken) == "" {
			return refreshed, ch, fmt.Errorf("codex channel: account %d refresh_token is required", index+1)
		}
		res, refreshErr := RefreshCodexOAuthTokenWithProxy(ctx, oauthKey.RefreshToken, ch.GetSetting().Proxy)
		if refreshErr != nil {
			return refreshed, ch, fmt.Errorf("codex channel: account %d refresh failed: %w", index+1, refreshErr)
		}
		oauthKey.AccessToken = res.AccessToken
		oauthKey.RefreshToken = res.RefreshToken
		oauthKey.LastRefresh = time.Now().Format(time.RFC3339)
		oauthKey.Expired = res.ExpiresAt.Format(time.RFC3339)
		encoded, marshalErr := common.Marshal(oauthKey)
		if marshalErr != nil {
			return refreshed, ch, marshalErr
		}
		keys[index] = string(encoded)
		refreshed++
	}
	if err := model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Update("key", strings.Join(keys, "\n")).Error; err != nil {
		return refreshed, ch, err
	}
	if opts.ResetCaches {
		ResetProxyClientCache()
		if err := model.RefreshChannelCache(); err != nil {
			return refreshed, ch, fmt.Errorf("Codex 多账号凭据已保存，但刷新运行时渠道缓存失败: %w", err)
		}
	}
	return refreshed, ch, nil
}

func RefreshCodexChannelMultiKeyCredentials(ctx context.Context, channelID int, threshold time.Duration, now time.Time) (int, error) {
	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return 0, err
	}
	if ch.Type != constant.ChannelTypeCodex || !ch.ChannelInfo.IsMultiKey {
		return 0, nil
	}
	keys := ch.GetKeys()
	refreshed := 0
	changed := false
	for index, rawKey := range keys {
		oauthKey, parseErr := parseCodexOAuthKey(strings.TrimSpace(rawKey))
		if parseErr != nil || strings.TrimSpace(oauthKey.RefreshToken) == "" {
			continue
		}
		if expiredAt, timeErr := time.Parse(time.RFC3339, strings.TrimSpace(oauthKey.Expired)); timeErr == nil &&
			!expiredAt.IsZero() && expiredAt.Sub(now) > threshold {
			continue
		}
		refreshCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		res, refreshErr := RefreshCodexOAuthTokenWithProxy(refreshCtx, oauthKey.RefreshToken, ch.GetSetting().Proxy)
		cancel()
		if refreshErr != nil {
			return refreshed, fmt.Errorf("account %d refresh failed: %w", index+1, refreshErr)
		}
		oauthKey.AccessToken = res.AccessToken
		oauthKey.RefreshToken = res.RefreshToken
		oauthKey.LastRefresh = now.Format(time.RFC3339)
		oauthKey.Expired = res.ExpiresAt.Format(time.RFC3339)
		encoded, marshalErr := common.Marshal(oauthKey)
		if marshalErr != nil {
			return refreshed, marshalErr
		}
		keys[index] = string(encoded)
		changed = true
		refreshed++
	}
	if changed {
		if err := model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Update("key", strings.Join(keys, "\n")).Error; err != nil {
			return refreshed, err
		}
	}
	return refreshed, nil
}
