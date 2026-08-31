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
	"github.com/QuantumNous/new-api/pkg/geminiauth"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

const geminiOAuthSessionTTL = 30 * time.Minute

type geminiOAuthStartRequest struct {
	OAuthType string `json:"oauth_type"`
	ProjectID string `json:"project_id"`
	TierID    string `json:"tier_id"`
}

type geminiOAuthCompleteRequest struct {
	Input string `json:"input"`
	Email string `json:"email"`
}

type geminiCredentialImportRequest struct {
	Credential  string   `json:"credential"`
	Credentials []string `json:"credentials"`
}

func normalizeGeminiCredentialRequest(req geminiCredentialImportRequest) ([]string, error) {
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
		return nil, errors.New("必须提供 Gemini API Key、Antigravity RT 或 OAuth JSON")
	}
	return credentials, nil
}

func NormalizeGeminiChannelCredentials(c *gin.Context) {
	request := geminiCredentialImportRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	credentials, err := normalizeGeminiCredentialRequest(request)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	result, err := service.NormalizeGeminiCredentialImports(c.Request.Context(), credentials, "")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"key":           strings.Join(result.Keys, "\n"),
			"account_count": result.AccountCount,
		},
	})
}

func AddGeminiChannelCredentials(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	request := geminiCredentialImportRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	credentials, err := normalizeGeminiCredentialRequest(request)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	result, err := service.ImportGeminiChannelCredentials(c.Request.Context(), channelID, credentials)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	service.ResetProxyClientCache()
	if !refreshChannelCacheAfterWrite(c, "Gemini 渠道凭据已导入") {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"account_count":  result.AccountCount,
			"added_count":    result.AddedCount,
			"replaced_count": result.ReplacedCount,
		},
	})
}

func geminiOAuthSessionKey(channelID int, field string) string {
	return fmt.Sprintf("gemini_oauth_%s_%d", field, channelID)
}

func parseGeminiAuthorizationInput(input string) (string, string, error) {
	value := strings.TrimSpace(input)
	if value == "" {
		return "", "", errors.New("empty input")
	}
	if strings.Contains(value, "#") {
		parts := strings.SplitN(value, "#", 2)
		code := strings.TrimSpace(parts[0])
		state := strings.TrimSpace(parts[1])
		if code == "" || state == "" {
			return "", "", errors.New("invalid code#state input")
		}
		return code, state, nil
	}
	if parsedURL, err := url.Parse(value); err == nil && parsedURL.Query().Get("code") != "" {
		return strings.TrimSpace(parsedURL.Query().Get("code")), strings.TrimSpace(parsedURL.Query().Get("state")), nil
	}
	if parsedQuery, err := url.ParseQuery(value); err == nil && parsedQuery.Get("code") != "" {
		return strings.TrimSpace(parsedQuery.Get("code")), strings.TrimSpace(parsedQuery.Get("state")), nil
	}
	return value, "", nil
}

func StartGeminiOAuth(c *gin.Context) {
	startGeminiOAuthWithChannelID(c, 0)
}

func StartGeminiOAuthForChannel(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	startGeminiOAuthWithChannelID(c, channelID)
}

func startGeminiOAuthWithChannelID(c *gin.Context, channelID int) {
	request := geminiOAuthStartRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if channelID > 0 {
		channel, err := model.GetChannelById(channelID, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if channel == nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel not found"})
			return
		}
		if channel.Type != constant.ChannelTypeGemini {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel type is not Gemini"})
			return
		}
	}

	flow, err := service.CreateGeminiOAuthAuthorizationFlow(service.GeminiOAuthAuthorizationOptions{
		OAuthType: request.OAuthType,
		ProjectID: request.ProjectID,
		TierID:    request.TierID,
	})
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	session := sessions.Default(c)
	session.Set(geminiOAuthSessionKey(channelID, "state"), flow.State)
	session.Set(geminiOAuthSessionKey(channelID, "verifier"), flow.Verifier)
	session.Set(geminiOAuthSessionKey(channelID, "oauth_type"), flow.OAuthType)
	session.Set(geminiOAuthSessionKey(channelID, "project_id"), flow.ProjectID)
	session.Set(geminiOAuthSessionKey(channelID, "tier_id"), flow.TierID)
	session.Set(geminiOAuthSessionKey(channelID, "created_at"), time.Now().Unix())
	if err := session.Save(); err != nil {
		common.ApiError(c, fmt.Errorf("save Gemini OAuth session: %w", err))
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"authorize_url": flow.AuthorizeURL,
			"oauth_type":    flow.OAuthType,
			"project_id":    flow.ProjectID,
		},
	})
}

func CompleteGeminiOAuth(c *gin.Context) {
	completeGeminiOAuthWithChannelID(c, 0)
}

func CompleteGeminiOAuthForChannel(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	completeGeminiOAuthWithChannelID(c, channelID)
}

func completeGeminiOAuthWithChannelID(c *gin.Context, channelID int) {
	request := geminiOAuthCompleteRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	code, state, err := parseGeminiAuthorizationInput(request.Input)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "解析授权信息失败，请检查输入格式"})
		return
	}
	session := sessions.Default(c)
	expectedState, _ := session.Get(geminiOAuthSessionKey(channelID, "state")).(string)
	verifier, _ := session.Get(geminiOAuthSessionKey(channelID, "verifier")).(string)
	oauthType, _ := session.Get(geminiOAuthSessionKey(channelID, "oauth_type")).(string)
	projectID, _ := session.Get(geminiOAuthSessionKey(channelID, "project_id")).(string)
	tierID, _ := session.Get(geminiOAuthSessionKey(channelID, "tier_id")).(string)
	createdAt := getGeminiOAuthSessionInt64(session, geminiOAuthSessionKey(channelID, "created_at"))
	if strings.TrimSpace(expectedState) == "" || strings.TrimSpace(verifier) == "" || strings.TrimSpace(oauthType) == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "oauth flow not started or session expired"})
		return
	}
	if createdAt <= 0 || time.Since(time.Unix(createdAt, 0)) > geminiOAuthSessionTTL {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "oauth session expired"})
		return
	}
	if strings.TrimSpace(state) == "" || state != expectedState {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "state mismatch or missing state"})
		return
	}

	channelProxy := ""
	if channelID > 0 {
		channel, err := model.GetChannelById(channelID, false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if channel == nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel not found"})
			return
		}
		if channel.Type != constant.ChannelTypeGemini {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "channel type is not Gemini"})
			return
		}
		channelProxy = channel.GetSetting().Proxy
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	token, err := service.ExchangeGeminiAuthorizationCode(ctx, code, verifier, oauthType, channelProxy)
	if err != nil {
		common.SysError("failed to exchange Gemini authorization code: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "授权码交换失败，请检查 OAuth 客户端配置和回调内容"})
		return
	}
	profileCtx, profileCancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	profile, profileErr := service.FetchGeminiOAuthProfile(profileCtx, token.AccessToken, channelProxy)
	profileCancel()
	if profileErr != nil {
		common.SysError("failed to fetch Gemini OAuth profile after token exchange: " + profileErr.Error())
	}
	key := geminiauth.OAuthKey{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenType:    token.TokenType,
		Scope:        token.Scope,
		ProjectID:    strings.TrimSpace(projectID),
		OAuthType:    strings.TrimSpace(oauthType),
		TierID:       strings.TrimSpace(tierID),
		Email:        strings.TrimSpace(request.Email),
		LastRefresh:  time.Now().UTC().Format(time.RFC3339),
	}
	if !token.ExpiresAt.IsZero() {
		key.Expired = token.ExpiresAt.UTC().Format(time.RFC3339)
		key.ExpiresAt = geminiauth.UnixTimestamp(token.ExpiresAt.Unix())
	}
	if key.Email == "" {
		if email, ok := service.ExtractEmailFromJWT(token.IDToken); ok {
			key.Email = email
		}
	}
	if accountID, ok := service.ExtractGeminiAccountIDFromJWT(token.IDToken); ok {
		key.AccountID = accountID
	}
	if profile != nil {
		if key.Email == "" {
			key.Email = strings.TrimSpace(profile.Email)
		}
		if key.AccountID == "" {
			key.AccountID = strings.TrimSpace(profile.Subject)
		}
	}
	encoded, err := common.Marshal(&key)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	clearGeminiOAuthSession(session, channelID)
	if err := session.Save(); err != nil {
		common.ApiError(c, fmt.Errorf("clear Gemini OAuth session: %w", err))
		return
	}

	if channelID > 0 {
		result, err := service.ImportGeminiChannelCredentials(c.Request.Context(), channelID, []string{string(encoded)})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "OAuth 已完成，但账号保存失败: " + err.Error()})
			return
		}
		service.ResetProxyClientCache()
		if !refreshChannelCacheAfterWrite(c, "Gemini OAuth 凭据已保存") {
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "saved",
			"data": gin.H{
				"channel_id":     channelID,
				"account_count":  result.AccountCount,
				"added_count":    result.AddedCount,
				"replaced_count": result.ReplacedCount,
				"email":          key.Email,
				"expires_at":     key.Expired,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "generated",
		"data": gin.H{
			"key":        string(encoded),
			"email":      key.Email,
			"expires_at": key.Expired,
		},
	})
}

func clearGeminiOAuthSession(session sessions.Session, channelID int) {
	for _, field := range []string{"state", "verifier", "oauth_type", "project_id", "tier_id", "created_at"} {
		session.Delete(geminiOAuthSessionKey(channelID, field))
	}
}

func getGeminiOAuthSessionInt64(session sessions.Session, key string) int64 {
	value := session.Get(key)
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case int32:
		return int64(typed)
	case float64:
		return int64(typed)
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		if err == nil {
			return parsed
		}
	}
	return 0
}

func RefreshGeminiChannelCredential(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	refreshed, channel, err := service.RefreshGeminiChannelCredentials(ctx, channelID, service.GeminiCredentialRefreshOptions{ResetCaches: true})
	if err != nil {
		common.SysError("failed to refresh Gemini channel credentials: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "刷新 Gemini OAuth 凭证失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "refreshed",
		"data": gin.H{
			"refreshed_count": refreshed,
			"channel_id":      channel.Id,
			"channel_type":    channel.Type,
			"channel_name":    channel.Name,
		},
	})
}

// GetGeminiAntigravityCredits refreshes the upstream paid-tier snapshot for
// every Antigravity account in a multi-key Gemini channel.
func GetGeminiAntigravityCredits(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	usage, refreshErr := service.RefreshGeminiAntigravityCredits(ctx, channelID, time.Now())
	if refreshErr != nil {
		common.SysError("failed to refresh Gemini Antigravity credits: " + refreshErr.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": refreshErr.Error(), "data": gin.H{"accounts": usage}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"accounts": usage, "quota_source": "antigravity_load_code_assist"}})
}

func GetGeminiOAuthCapabilities(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"ai_studio": gin.H{
				"client_configured":   service.GeminiOAuthClientConfigured("ai_studio"),
				"requires_project_id": false,
			},
			"code_assist": gin.H{
				"client_configured":   service.GeminiOAuthClientConfigured("code_assist"),
				"requires_project_id": true,
			},
		},
	})
}
