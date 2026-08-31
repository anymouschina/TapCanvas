package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/geminiauth"
)

type GeminiCredentialRefreshOptions struct {
	ResetCaches bool
}

type GeminiCredentialImportResult struct {
	AccountCount  int
	AddedCount    int
	ReplacedCount int
	Keys          []string
}

func IsGeminiOAuthKey(raw string) bool {
	return geminiauth.IsOAuthKey(raw)
}

// IsGeminiPermanentCredentialRefreshError identifies provider errors that
// cannot be repaired by retrying the same refresh request. Transport failures
// and temporary upstream failures intentionally return false so the account
// remains eligible for a later retry.
func IsGeminiPermanentCredentialRefreshError(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	for _, marker := range []string{"invalid_grant", "invalid_client", "unauthorized_client", "refresh_token is required"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func parseGeminiOAuthKey(raw string) (*geminiauth.OAuthKey, error) {
	return geminiauth.ParseOAuthKey(strings.TrimSpace(raw))
}

func normalizeGeminiCredentialBatch(ctx context.Context, rawCredentials []string, proxyURL string) ([]string, error) {
	if len(rawCredentials) == 0 {
		return nil, errors.New("gemini channel: at least one credential is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	keys := make([]string, 0, len(rawCredentials))
	identities := make(map[string]struct{}, len(rawCredentials))
	for index, rawCredential := range rawCredentials {
		raw := strings.TrimSpace(rawCredential)
		if raw == "" {
			return nil, fmt.Errorf("gemini channel: credential %d is empty", index+1)
		}
		resolved, handled, err := resolveGeminiRefreshTokenCredential(ctx, raw, proxyURL)
		if err != nil {
			return nil, fmt.Errorf("gemini channel: credential %d: %w", index+1, err)
		}
		if handled {
			if err := appendNormalizedGeminiOAuthKeys(&keys, identities, index, resolved); err != nil {
				return nil, err
			}
			continue
		}

		if strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") {
			normalized, err := geminiauth.NormalizeCredentials(raw)
			if err != nil {
				return nil, fmt.Errorf("gemini channel: credential %d: %w", index+1, err)
			}
			if err := appendNormalizedGeminiOAuthKeys(&keys, identities, index, normalized); err != nil {
				return nil, err
			}
			continue
		}

		if strings.ContainsAny(raw, "\r\n") {
			return nil, fmt.Errorf("gemini channel: credential %d contains multiple lines", index+1)
		}
		identity := "api_key:" + raw
		if _, exists := identities[identity]; exists {
			return nil, fmt.Errorf("gemini channel: duplicate API key in import batch at credential %d", index+1)
		}
		identities[identity] = struct{}{}
		keys = append(keys, raw)
	}
	return keys, nil
}

func appendNormalizedGeminiOAuthKeys(keys *[]string, identities map[string]struct{}, credentialIndex int, oauthKeys []geminiauth.OAuthKey) error {
	for accountIndex, oauthKey := range oauthKeys {
		if oauthKey.IsCodeAssist() && strings.TrimSpace(oauthKey.ProjectID) == "" {
			return fmt.Errorf("gemini channel: credential %d account %d: Code Assist OAuth requires project_id", credentialIndex+1, accountIndex+1)
		}
		if strings.TrimSpace(oauthKey.OAuthType) == "" {
			oauthKey.OAuthType = oauthKey.EffectiveOAuthType()
		}
		if strings.TrimSpace(oauthKey.Expired) == "" {
			if expiry, ok := oauthKey.ExpiryTime(); ok {
				oauthKey.Expired = expiry.UTC().Format(time.RFC3339)
			}
		}
		encoded, err := common.Marshal(&oauthKey)
		if err != nil {
			return fmt.Errorf("gemini channel: credential %d account %d: encode oauth key: %w", credentialIndex+1, accountIndex+1, err)
		}
		sessionKey := "oauth:" + oauthKey.Identity()
		if _, exists := identities[sessionKey]; exists {
			return fmt.Errorf("gemini channel: duplicate account in import batch at credential %d account %d", credentialIndex+1, accountIndex+1)
		}
		identities[sessionKey] = struct{}{}
		*keys = append(*keys, string(encoded))
	}
	return nil
}

func NormalizeGeminiCredentialImports(ctx context.Context, rawCredentials []string, proxyURL string) (GeminiCredentialImportResult, error) {
	keys, err := normalizeGeminiCredentialBatch(ctx, rawCredentials, proxyURL)
	if err != nil {
		return GeminiCredentialImportResult{}, err
	}
	return GeminiCredentialImportResult{
		AccountCount: len(keys),
		AddedCount:   len(keys),
		Keys:         keys,
	}, nil
}

// ImportGeminiChannelCredentials atomically appends or replaces Gemini API
// Key/OAuth accounts while preserving the existing account indexes and status
// maps. A re-authorized OAuth account replaces its previous line by identity.
func ImportGeminiChannelCredentials(ctx context.Context, channelID int, rawCredentials []string) (GeminiCredentialImportResult, error) {
	initialChannel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return GeminiCredentialImportResult{}, err
	}
	if initialChannel == nil {
		return GeminiCredentialImportResult{}, errors.New("channel not found")
	}
	if initialChannel.Type != constant.ChannelTypeGemini {
		return GeminiCredentialImportResult{}, errors.New("channel type is not Gemini")
	}
	validated, err := normalizeGeminiCredentialBatch(ctx, rawCredentials, initialChannel.GetSetting().Proxy)
	if err != nil {
		return GeminiCredentialImportResult{}, err
	}

	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()

	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return GeminiCredentialImportResult{}, err
	}
	if channel == nil {
		return GeminiCredentialImportResult{}, errors.New("channel not found")
	}
	if channel.Type != constant.ChannelTypeGemini {
		return GeminiCredentialImportResult{}, errors.New("channel type is not Gemini")
	}

	keys := channel.GetKeys()
	indexByIdentity := make(map[string]int, len(keys))
	for index, rawKey := range keys {
		indexByIdentity[geminiCredentialIdentity(rawKey)] = index
	}

	result := GeminiCredentialImportResult{}
	for _, normalized := range validated {
		identity := geminiCredentialIdentity(normalized)
		if index, exists := indexByIdentity[identity]; exists {
			keys[index] = normalized
			result.ReplacedCount++
			continue
		}
		indexByIdentity[identity] = len(keys)
		keys = append(keys, normalized)
		result.AddedCount++
	}

	channel.ChannelInfo.IsMultiKey = channel.ChannelInfo.IsMultiKey || len(keys) > 1
	channel.ChannelInfo.MultiKeySize = len(keys)
	if channel.ChannelInfo.MultiKeyMode == "" {
		channel.ChannelInfo.MultiKeyMode = constant.MultiKeyModeRandom
	}
	updates := map[string]interface{}{
		"key":          strings.Join(keys, "\n"),
		"channel_info": channel.ChannelInfo,
	}
	if err := model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Updates(updates).Error; err != nil {
		return GeminiCredentialImportResult{}, err
	}
	result.AccountCount = len(keys)
	return result, nil
}

func geminiCredentialIdentity(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if oauthKey, err := parseGeminiOAuthKey(trimmed); err == nil {
		return "oauth:" + oauthKey.Identity()
	}
	return "api_key:" + trimmed
}

func refreshGeminiOAuthKey(ctx context.Context, key *geminiauth.OAuthKey, proxyURL string) error {
	if key == nil {
		return errors.New("gemini channel: oauth key is nil")
	}
	if strings.TrimSpace(key.RefreshToken) == "" {
		return errors.New("gemini channel: refresh_token is required")
	}
	refreshCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := RefreshGeminiOAuthToken(refreshCtx, key.RefreshToken, key.EffectiveOAuthType(), proxyURL)
	if err != nil {
		return err
	}
	key.AccessToken = result.AccessToken
	if strings.TrimSpace(result.RefreshToken) != "" {
		key.RefreshToken = result.RefreshToken
	}
	if strings.TrimSpace(result.TokenType) != "" {
		key.TokenType = result.TokenType
	}
	if strings.TrimSpace(result.Scope) != "" {
		key.Scope = result.Scope
	}
	if !result.ExpiresAt.IsZero() {
		key.Expired = result.ExpiresAt.UTC().Format(time.RFC3339)
		key.ExpiresAt = geminiauth.UnixTimestamp(result.ExpiresAt.Unix())
	}
	key.LastRefresh = time.Now().UTC().Format(time.RFC3339)
	if email, ok := ExtractEmailFromJWT(result.IDToken); ok && strings.TrimSpace(key.Email) == "" {
		key.Email = email
	}
	if accountID, ok := ExtractGeminiAccountIDFromJWT(result.IDToken); ok && strings.TrimSpace(key.AccountID) == "" {
		key.AccountID = accountID
	}
	return nil
}

func ExtractGeminiAccountIDFromJWT(token string) (string, bool) {
	claims, ok := decodeJWTClaims(token)
	if !ok {
		return "", false
	}
	subject, ok := claims["sub"].(string)
	if !ok {
		return "", false
	}
	subject = strings.TrimSpace(subject)
	return subject, subject != ""
}

func RefreshGeminiChannelCredential(ctx context.Context, channelID int, opts GeminiCredentialRefreshOptions) (*geminiauth.OAuthKey, *model.Channel, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, nil, err
	}
	if channel == nil {
		return nil, nil, errors.New("channel not found")
	}
	if channel.Type != constant.ChannelTypeGemini {
		return nil, nil, errors.New("channel type is not Gemini")
	}
	if channel.ChannelInfo.IsMultiKey {
		return nil, channel, errors.New("multi-key Gemini channel requires account refresh")
	}
	return RefreshGeminiChannelKeyCredential(ctx, channelID, 0, opts)
}

// RefreshGeminiChannelKeyCredential refreshes exactly one account selected by
// the relay retry loop. It avoids refreshing sibling accounts when a single
// access token returns 401 and keeps multi-key indexes stable.
func RefreshGeminiChannelKeyCredential(ctx context.Context, channelID int, keyIndex int, opts GeminiCredentialRefreshOptions) (*geminiauth.OAuthKey, *model.Channel, error) {
	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()

	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, nil, err
	}
	if channel == nil {
		return nil, nil, errors.New("channel not found")
	}
	if channel.Type != constant.ChannelTypeGemini {
		return nil, nil, errors.New("channel type is not Gemini")
	}
	keys := channel.GetKeys()
	if keyIndex < 0 || keyIndex >= len(keys) {
		return nil, channel, fmt.Errorf("Gemini account index out of range: %d", keyIndex)
	}
	originalKey, err := parseGeminiOAuthKey(keys[keyIndex])
	if err != nil {
		return nil, channel, err
	}
	stableIdentity := geminiCredentialStableIdentity(originalKey)
	var oauthKey *geminiauth.OAuthKey
	var refreshedChannel *model.Channel
	refreshErr := withGeminiCredentialRefreshLease(ctx, channelID, keyIndex, originalKey, func() error {
		current, currentErr := model.GetChannelById(channelID, true)
		if currentErr != nil {
			return currentErr
		}
		if current == nil {
			return errors.New("channel not found")
		}
		currentKeys := current.GetKeys()
		currentIndex := findGeminiCredentialIndex(currentKeys, keyIndex, stableIdentity)
		if currentIndex < 0 || currentIndex >= len(currentKeys) {
			return fmt.Errorf("Gemini account identity no longer exists: key_index=%d", keyIndex)
		}
		currentKey, parseErr := parseGeminiOAuthKey(currentKeys[currentIndex])
		if parseErr != nil {
			return parseErr
		}
		if currentKey.AccessToken != originalKey.AccessToken && geminiCredentialHasFreshAccessToken(currentKey, time.Now()) {
			oauthKey = currentKey
			refreshedChannel = current
			return nil
		}
		if refreshErr := refreshGeminiOAuthKey(ctx, currentKey, current.GetSetting().Proxy); refreshErr != nil {
			return refreshErr
		}
		encoded, marshalErr := common.Marshal(currentKey)
		if marshalErr != nil {
			return marshalErr
		}
		if current.ChannelInfo.IsMultiKey {
			currentKeys[currentIndex] = string(encoded)
			if updateErr := model.DB.Model(&model.Channel{}).Where("id = ?", current.Id).Update("key", strings.Join(currentKeys, "\n")).Error; updateErr != nil {
				return updateErr
			}
		} else if updateErr := model.DB.Model(&model.Channel{}).Where("id = ?", current.Id).Update("key", string(encoded)).Error; updateErr != nil {
			return updateErr
		}
		oauthKey = currentKey
		refreshedChannel = current
		return nil
	})
	if refreshErr != nil {
		return nil, channel, refreshErr
	}
	if oauthKey == nil || refreshedChannel == nil {
		return nil, channel, errors.New("Gemini credential refresh returned no credential")
	}
	if opts.ResetCaches {
		ResetProxyClientCache()
		if err := model.RefreshChannelCache(); err != nil {
			return oauthKey, refreshedChannel, fmt.Errorf("Gemini 凭据已保存，但刷新运行时渠道缓存失败: %w", err)
		}
	}
	return oauthKey, refreshedChannel, nil
}

// RefreshGeminiChannelCredentials refreshes all OAuth accounts in a channel.
// Plain API Key accounts are intentionally left untouched when a channel
// contains mixed credential types.
func RefreshGeminiChannelCredentials(ctx context.Context, channelID int, opts GeminiCredentialRefreshOptions) (int, *model.Channel, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return 0, nil, err
	}
	if channel == nil {
		return 0, nil, errors.New("channel not found")
	}
	if channel.Type != constant.ChannelTypeGemini {
		return 0, channel, errors.New("channel type is not Gemini")
	}
	if !channel.ChannelInfo.IsMultiKey {
		oauthKey, parseErr := parseGeminiOAuthKey(channel.Key)
		if parseErr != nil || strings.TrimSpace(oauthKey.RefreshToken) == "" {
			return 0, channel, nil
		}
		_, refreshedChannel, refreshErr := RefreshGeminiChannelKeyCredential(ctx, channelID, 0, opts)
		if refreshErr != nil {
			return 0, channel, refreshErr
		}
		return 1, refreshedChannel, nil
	}

	keys := channel.GetKeys()
	refreshed := 0
	var failures []string
	for index, rawKey := range keys {
		oauthKey, parseErr := parseGeminiOAuthKey(rawKey)
		if parseErr != nil {
			continue
		}
		if strings.TrimSpace(oauthKey.RefreshToken) == "" {
			continue
		}
		if _, _, refreshErr := RefreshGeminiChannelKeyCredential(ctx, channelID, index, GeminiCredentialRefreshOptions{}); refreshErr != nil {
			failures = append(failures, fmt.Sprintf("account %d: %v", index+1, refreshErr))
			continue
		}
		refreshed++
	}
	if opts.ResetCaches && refreshed > 0 {
		ResetProxyClientCache()
		if err := model.RefreshChannelCache(); err != nil {
			return refreshed, channel, fmt.Errorf("Gemini 多账号凭据已保存，但刷新运行时渠道缓存失败: %w", err)
		}
	}
	if len(failures) > 0 {
		return refreshed, channel, fmt.Errorf("Gemini OAuth refresh failed: %s", strings.Join(failures, "; "))
	}
	return refreshed, channel, nil
}

// RefreshGeminiChannelMultiKeyCredentials is used by the background task. It
// refreshes only accounts inside the threshold and records per-account errors
// without discarding successful updates from the same channel.
func RefreshGeminiChannelMultiKeyCredentials(ctx context.Context, channelID int, threshold time.Duration, now time.Time) (int, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return 0, err
	}
	if channel == nil || channel.Type != constant.ChannelTypeGemini || !channel.ChannelInfo.IsMultiKey {
		return 0, nil
	}
	keys := channel.GetKeys()
	refreshed := 0
	for index, rawKey := range keys {
		oauthKey, parseErr := parseGeminiOAuthKey(rawKey)
		if parseErr != nil || strings.TrimSpace(oauthKey.RefreshToken) == "" {
			continue
		}
		if expiry, ok := oauthKey.ExpiryTime(); ok && expiry.Sub(now) > threshold {
			continue
		}
		if !allowGeminiBackgroundRefresh(channel.Id, index, now) {
			continue
		}
		if _, _, refreshErr := RefreshGeminiChannelKeyCredential(ctx, channelID, index, GeminiCredentialRefreshOptions{}); refreshErr != nil {
			recordGeminiBackgroundRefreshFailure(channel.Id, index, now)
			logger.LogWarn(ctx, fmt.Sprintf("gemini credential auto-refresh: channel_id=%d name=%s key_index=%d refresh failed: %v", channel.Id, channel.Name, index, refreshErr))
			if IsGeminiPermanentCredentialRefreshError(refreshErr) {
				DisableGeminiChannelKey(channel.Id, index, "Gemini OAuth credential is permanently invalid: "+refreshErr.Error())
			}
			continue
		}
		clearGeminiBackgroundRefreshFailure(channel.Id, index)
		refreshed++
	}
	return refreshed, nil
}
