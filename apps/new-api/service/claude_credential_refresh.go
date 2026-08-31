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
)

type ClaudeCredentialRefreshOptions struct {
	ResetCaches bool
}

// ClaudeOAuthKey 是 claude 渠道 OAuth(订阅)模式下 channel.Key 存储的 JSON 结构。
// 与 relay/channel/claude.ClaudeOAuthKey 保持字段一致(此处独立定义,避免 service
// 反向依赖 relay 包)。
type ClaudeOAuthKey struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Expired      string `json:"expired,omitempty"`      // RFC3339
	LastRefresh  string `json:"last_refresh,omitempty"` // RFC3339
	Email        string `json:"email,omitempty"`
	AccountID    string `json:"account_id,omitempty"`
}

// IsClaudeOAuthKey 判断 channel.Key 是否为 Claude 订阅(OAuth)JSON 凭证(而非 x-api-key 明文)。
// relay/controller 据此把 OAuth 渠道的 401 当「access token 一时过期」处理(刷新+重试，不禁渠道)。
func IsClaudeOAuthKey(raw string) bool {
	_, err := parseClaudeOAuthKey(raw)
	return err == nil
}

func parseClaudeOAuthKey(raw string) (*ClaudeOAuthKey, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("claude channel: empty oauth key")
	}
	if !strings.HasPrefix(trimmed, "{") {
		return nil, errors.New("claude channel: key is not oauth json")
	}
	var key ClaudeOAuthKey
	if err := common.Unmarshal([]byte(trimmed), &key); err != nil {
		return nil, errors.New("claude channel: invalid oauth key json")
	}
	return &key, nil
}

// RefreshClaudeChannelCredential 刷新指定 claude 渠道的 OAuth 凭证并回写 channel.Key。
//
// 对照 codex_credential_refresh.go 的结构:
// 载入 channel → 校验类型为 claude(Anthropic) 且 key 为 JSON → 调
// RefreshClaudeOAuthToken → 更新 access/refresh/expired/last_refresh → Update("key")
// → 可选 ResetCaches。
func RefreshClaudeChannelCredential(ctx context.Context, channelID int, opts ClaudeCredentialRefreshOptions) (*ClaudeOAuthKey, *model.Channel, error) {
	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, nil, err
	}
	if ch == nil {
		return nil, nil, fmt.Errorf("channel not found")
	}
	if ch.Type != constant.ChannelTypeAnthropic {
		return nil, nil, fmt.Errorf("channel type is not Claude")
	}

	oauthKey, err := parseClaudeOAuthKey(strings.TrimSpace(ch.Key))
	if err != nil {
		return nil, nil, err
	}
	if strings.TrimSpace(oauthKey.RefreshToken) == "" {
		return nil, nil, fmt.Errorf("claude channel: refresh_token is required to refresh credential")
	}

	refreshCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	res, err := RefreshClaudeOAuthToken(refreshCtx, oauthKey.RefreshToken, ch.GetBaseURL(), ch.GetSetting().Proxy)
	if err != nil {
		return nil, nil, err
	}

	oauthKey.AccessToken = res.AccessToken
	if strings.TrimSpace(res.RefreshToken) != "" {
		oauthKey.RefreshToken = res.RefreshToken
	}
	oauthKey.LastRefresh = time.Now().Format(time.RFC3339)
	if !res.ExpiresAt.IsZero() {
		oauthKey.Expired = res.ExpiresAt.Format(time.RFC3339)
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
			return oauthKey, ch, fmt.Errorf("Claude 凭据已保存，但刷新运行时渠道缓存失败: %w", err)
		}
	}

	return oauthKey, ch, nil
}

// RefreshClaudeChannelMultiKeyCredentials 刷新一个多 key(multi-key)claude 渠道内所有
// 临近过期的 OAuth key,并整体回写 channel.Key(换行分隔)。裸 API key、非 OAuth JSON、
// refresh_token 为空、以及尚未临近过期的 key 一律原样保留。返回本次实际刷新的 key 数量。
//
// 背景:自动刷新任务(claude_credential_refresh_task.go)对单 key 渠道整条刷新,但会跳过
// multi-key 渠道。当一个渠道里塞多个订阅账号(每个 key 一份 OAuth JSON)时,必须逐 key
// 续期,否则各账号 access_token 会在过期后一起失效。
func RefreshClaudeChannelMultiKeyCredentials(ctx context.Context, channelID int, threshold time.Duration, now time.Time) (int, error) {
	// 串行化对该渠道 key 列表的读-改-写,避免与 relay 轮询/自动禁用竞争。
	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()

	ch, err := model.GetChannelById(channelID, true)
	if err != nil {
		return 0, err
	}
	if ch == nil {
		return 0, fmt.Errorf("channel not found")
	}
	if ch.Type != constant.ChannelTypeAnthropic {
		return 0, fmt.Errorf("channel type is not Claude")
	}
	if !ch.ChannelInfo.IsMultiKey {
		return 0, nil
	}

	keys := ch.GetKeys()
	if len(keys) == 0 {
		return 0, nil
	}

	proxy := ch.GetSetting().Proxy
	baseURL := ch.GetBaseURL()
	changed := false
	refreshed := 0

	for i, raw := range keys {
		oauthKey, perr := parseClaudeOAuthKey(strings.TrimSpace(raw))
		if perr != nil {
			continue // 裸 API key 或非 OAuth JSON,跳过
		}
		if strings.TrimSpace(oauthKey.RefreshToken) == "" {
			continue
		}
		// 未临近过期则跳过
		if expiredAt, terr := time.Parse(time.RFC3339, strings.TrimSpace(oauthKey.Expired)); terr == nil &&
			!expiredAt.IsZero() && expiredAt.Sub(now) > threshold {
			continue
		}

		refreshCtx, cancel := context.WithTimeout(ctx, claudeCredentialRefreshTimeout)
		res, rerr := RefreshClaudeOAuthToken(refreshCtx, oauthKey.RefreshToken, baseURL, proxy)
		cancel()
		if rerr != nil {
			logger.LogWarn(ctx, fmt.Sprintf("claude credential auto-refresh: channel_id=%d name=%s key_index=%d refresh failed: %v", ch.Id, ch.Name, i, rerr))
			continue
		}

		oauthKey.AccessToken = res.AccessToken
		if strings.TrimSpace(res.RefreshToken) != "" {
			oauthKey.RefreshToken = res.RefreshToken
		}
		oauthKey.LastRefresh = time.Now().Format(time.RFC3339)
		if !res.ExpiresAt.IsZero() {
			oauthKey.Expired = res.ExpiresAt.Format(time.RFC3339)
		}

		encoded, merr := common.Marshal(oauthKey)
		if merr != nil {
			logger.LogWarn(ctx, fmt.Sprintf("claude credential auto-refresh: channel_id=%d key_index=%d marshal failed: %v", ch.Id, i, merr))
			continue
		}
		keys[i] = string(encoded)
		changed = true
		refreshed++
		logger.LogInfo(ctx, fmt.Sprintf("claude credential auto-refresh: channel_id=%d name=%s key_index=%d refreshed, expires_at=%s", ch.Id, ch.Name, i, oauthKey.Expired))
	}

	if changed {
		joined := strings.Join(keys, "\n")
		if err := model.DB.Model(&model.Channel{}).Where("id = ?", ch.Id).Update("key", joined).Error; err != nil {
			return refreshed, err
		}
	}

	return refreshed, nil
}
