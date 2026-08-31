package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	claudechannel "github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/claude/oauth"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

type claudeOAuthCompleteRequest struct {
	Input string `json:"input"`
}

type claudeCredentialImportRequest struct {
	Credential  string   `json:"credential"`
	Credentials []string `json:"credentials"`
}

func normalizeClaudeCredentialRequest(req claudeCredentialImportRequest) ([]string, error) {
	credentials := make([]string, 0, len(req.Credentials)+1)
	if strings.TrimSpace(req.Credential) != "" {
		credentials = append(credentials, req.Credential)
	}
	for _, credential := range req.Credentials {
		if strings.TrimSpace(credential) != "" {
			credentials = append(credentials, credential)
		}
	}
	if len(credentials) == 0 {
		return nil, errors.New("必须提供 Claude 账号 JSON")
	}
	return credentials, nil
}

func NormalizeClaudeChannelCredentials(c *gin.Context) {
	req := claudeCredentialImportRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	credentials, err := normalizeClaudeCredentialRequest(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	result, err := service.NormalizeClaudeCredentialImports(credentials)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"key":           strings.Join(result.Keys, "\n"),
		"account_count": result.AccountCount,
	}})
}

func AddClaudeChannelCredentials(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	req := claudeCredentialImportRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	credentials, err := normalizeClaudeCredentialRequest(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	result, err := service.ImportClaudeChannelCredentials(channelID, credentials)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	service.ResetProxyClientCache()
	if !refreshChannelCacheAfterWrite(c, "Claude 渠道凭据已导入") {
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"account_count":  result.AccountCount,
		"added_count":    result.AddedCount,
		"replaced_count": result.ReplacedCount,
	}})
}

func claudeOAuthSessionKey(channelID int, field string) string {
	return fmt.Sprintf("claude_oauth_%s_%d", field, channelID)
}

// parseClaudeAuthorizationInput 解析用户粘回的授权信息,提取 code 与 state。
// 兼容三种形态:"code#state"、含 code= 的 URL/query、纯 code。
func parseClaudeAuthorizationInput(input string) (code string, state string, err error) {
	v := strings.TrimSpace(input)
	if v == "" {
		return "", "", errors.New("empty input")
	}
	if strings.Contains(v, "#") {
		parts := strings.SplitN(v, "#", 2)
		code = strings.TrimSpace(parts[0])
		state = strings.TrimSpace(parts[1])
		return code, state, nil
	}
	if strings.Contains(v, "code=") {
		u, parseErr := url.Parse(v)
		if parseErr == nil {
			q := u.Query()
			code = strings.TrimSpace(q.Get("code"))
			state = strings.TrimSpace(q.Get("state"))
			return code, state, nil
		}
		q, parseErr := url.ParseQuery(v)
		if parseErr == nil {
			code = strings.TrimSpace(q.Get("code"))
			state = strings.TrimSpace(q.Get("state"))
			return code, state, nil
		}
	}

	code = v
	return code, "", nil
}

func StartClaudeOAuth(c *gin.Context) {
	startClaudeOAuthWithChannelID(c, 0)
}

func StartClaudeOAuthForChannel(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	startClaudeOAuthWithChannelID(c, channelID)
}

func startClaudeOAuthWithChannelID(c *gin.Context, channelID int) {
	if channelID > 0 {
		ch, err := model.GetChannelById(channelID, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if ch == nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel not found"})
			return
		}
		if ch.Type != constant.ChannelTypeAnthropic {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel type is not Claude"})
			return
		}
	}

	state, err := oauth.GenerateState()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	verifier, err := oauth.GenerateCodeVerifier()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	challenge := oauth.GenerateCodeChallenge(verifier)
	// 浏览器版 scope(含 org:create_api_key)。
	authorizeURL := oauth.BuildAuthorizationURL(state, challenge, oauth.ScopeOAuth)

	session := sessions.Default(c)
	session.Set(claudeOAuthSessionKey(channelID, "state"), state)
	session.Set(claudeOAuthSessionKey(channelID, "verifier"), verifier)
	session.Set(claudeOAuthSessionKey(channelID, "created_at"), time.Now().Unix())
	_ = session.Save()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"authorize_url": authorizeURL,
		},
	})
}

func CompleteClaudeOAuth(c *gin.Context) {
	completeClaudeOAuthWithChannelID(c, 0)
}

func CompleteClaudeOAuthForChannel(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	completeClaudeOAuthWithChannelID(c, channelID)
}

func completeClaudeOAuthWithChannelID(c *gin.Context, channelID int) {
	req := claudeOAuthCompleteRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	code, state, err := parseClaudeAuthorizationInput(req.Input)
	if err != nil {
		common.SysError("failed to parse claude authorization input: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "解析授权信息失败，请检查输入格式"})
		return
	}
	if strings.TrimSpace(code) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "missing authorization code"})
		return
	}
	if strings.TrimSpace(state) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "missing state in input"})
		return
	}

	channelProxy := ""
	channelBase := ""
	if channelID > 0 {
		ch, err := model.GetChannelById(channelID, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if ch == nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel not found"})
			return
		}
		if ch.Type != constant.ChannelTypeAnthropic {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel type is not Claude"})
			return
		}
		channelProxy = ch.GetSetting().Proxy
		channelBase = ch.GetBaseURL()
	}

	session := sessions.Default(c)
	expectedState, _ := session.Get(claudeOAuthSessionKey(channelID, "state")).(string)
	verifier, _ := session.Get(claudeOAuthSessionKey(channelID, "verifier")).(string)
	if strings.TrimSpace(expectedState) == "" || strings.TrimSpace(verifier) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "oauth flow not started or session expired"})
		return
	}
	if state != expectedState {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "state mismatch"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	tokenRes, err := service.ExchangeClaudeOAuthCode(ctx, code, state, verifier, channelBase, channelProxy)
	if err != nil {
		common.SysError("failed to exchange claude authorization code: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "授权码交换失败，请重试"})
		return
	}

	key := claudechannel.ClaudeOAuthKey{
		AccessToken:  tokenRes.AccessToken,
		RefreshToken: tokenRes.RefreshToken,
		LastRefresh:  time.Now().Format(time.RFC3339),
	}
	if !tokenRes.ExpiresAt.IsZero() {
		key.Expired = tokenRes.ExpiresAt.Format(time.RFC3339)
	}
	encoded, err := common.Marshal(key)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	session.Delete(claudeOAuthSessionKey(channelID, "state"))
	session.Delete(claudeOAuthSessionKey(channelID, "verifier"))
	session.Delete(claudeOAuthSessionKey(channelID, "created_at"))
	_ = session.Save()

	if channelID > 0 {
		if err := model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Update("key", string(encoded)).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		service.ResetProxyClientCache()
		if !refreshChannelCacheAfterWrite(c, "Claude OAuth 凭据已保存") {
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "saved",
			"data": gin.H{
				"channel_id":   channelID,
				"expires_at":   key.Expired,
				"last_refresh": key.LastRefresh,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "generated",
		"data": gin.H{
			"key":          string(encoded),
			"expires_at":   key.Expired,
			"last_refresh": key.LastRefresh,
		},
	})
}

// RefreshClaudeChannelCredential 是 service.RefreshClaudeChannelCredential 的 HTTP handler 包装,
// 对照 RefreshCodexChannelCredential。
func RefreshClaudeChannelCredential(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	oauthKey, ch, err := service.RefreshClaudeChannelCredential(ctx, channelId, service.ClaudeCredentialRefreshOptions{ResetCaches: true})
	if err != nil {
		common.SysError("failed to refresh claude channel credential: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "刷新凭证失败，请稍后重试"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "refreshed",
		"data": gin.H{
			"expires_at":   oauthKey.Expired,
			"last_refresh": oauthKey.LastRefresh,
			"email":        oauthKey.Email,
			"channel_id":   ch.Id,
			"channel_type": ch.Type,
			"channel_name": ch.Name,
		},
	})
}

// GetClaudeChannelUsage 查询 claude 订阅渠道的额度,对照 GetCodexChannelUsage。
func GetClaudeChannelUsage(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}

	ch, err := model.GetChannelById(channelId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if ch == nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel not found"})
		return
	}
	if ch.Type != constant.ChannelTypeAnthropic {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel type is not Claude"})
		return
	}
	if ch.ChannelInfo.IsMultiKey {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "multi-key channel is not supported"})
		return
	}

	oauthKey, err := claudechannel.ParseClaudeOAuthKey(strings.TrimSpace(ch.Key))
	if err != nil {
		common.SysError("failed to parse claude oauth key: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "解析凭证失败，请检查渠道配置(仅订阅式 OAuth 渠道支持用量查询)"})
		return
	}
	accessToken := strings.TrimSpace(oauthKey.AccessToken)
	if accessToken == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "claude channel: access_token is required"})
		return
	}

	proxyURL := ch.GetSetting().Proxy

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	statusCode, body, parsed, err := service.FetchClaudeUsage(ctx, accessToken, ch.GetBaseURL(), proxyURL)
	if err != nil {
		common.SysError("failed to fetch claude usage: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取用量信息失败，请稍后重试"})
		return
	}

	// 401/403 即时刷新一次后重试(对照 codex usage 行为)。
	if (statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden) && strings.TrimSpace(oauthKey.RefreshToken) != "" {
		refreshCtx, refreshCancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer refreshCancel()

		res, refreshErr := service.RefreshClaudeOAuthToken(refreshCtx, oauthKey.RefreshToken, ch.GetBaseURL(), proxyURL)
		if refreshErr != nil {
			common.ApiErrorMsg(c, "Claude OAuth 令牌刷新失败: "+refreshErr.Error())
			return
		}
		oauthKey.AccessToken = res.AccessToken
		if strings.TrimSpace(res.RefreshToken) != "" {
			oauthKey.RefreshToken = res.RefreshToken
		}
		oauthKey.LastRefresh = time.Now().Format(time.RFC3339)
		if !res.ExpiresAt.IsZero() {
			oauthKey.Expired = res.ExpiresAt.Format(time.RFC3339)
		}

		encoded, encErr := common.Marshal(oauthKey)
		if encErr != nil {
			common.ApiErrorMsg(c, "Claude OAuth 令牌已刷新，但凭据序列化失败: "+encErr.Error())
			return
		}
		if err := model.DB.Model(&model.Channel{}).Where("id = ?", ch.Id).Update("key", string(encoded)).Error; err != nil {
			common.ApiErrorMsg(c, "Claude OAuth 令牌已刷新，但凭据保存失败: "+err.Error())
			return
		}
		service.ResetProxyClientCache()
		if !refreshChannelCacheAfterWrite(c, "Claude OAuth 令牌已刷新并保存") {
			return
		}

		ctx2, cancel2 := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel2()
		statusCode, body, parsed, err = service.FetchClaudeUsage(ctx2, oauthKey.AccessToken, ch.GetBaseURL(), proxyURL)
		if err != nil {
			common.SysError("failed to fetch claude usage after refresh: " + err.Error())
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取用量信息失败，请稍后重试"})
			return
		}
	}

	var payload any
	if parsed != nil {
		payload = parsed
	} else if common.Unmarshal(body, &payload) != nil {
		payload = string(body)
	}

	ok := statusCode >= 200 && statusCode < 300
	resp := gin.H{
		"success":         ok,
		"message":         "",
		"upstream_status": statusCode,
		"data":            payload,
	}
	if !ok {
		resp["message"] = fmt.Sprintf("upstream status: %d", statusCode)
	}
	c.JSON(http.StatusOK, resp)
}
