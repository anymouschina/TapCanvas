package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	claudeoauth "github.com/QuantumNous/new-api/relay/channel/claude/oauth"
)

// ClaudeOAuthTokenResult 是 Claude 订阅 OAuth token 端点返回的标准化结果。
type ClaudeOAuthTokenResult struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

// claudeOAuthTokenPayload 是 Claude OAuth token 端点的响应结构。
type claudeOAuthTokenPayload struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

// RefreshClaudeOAuthToken 用 refresh_token 向 Claude OAuth token 端点换取新 token。
//
// 迁移自 sub2api repository/claude_oauth_service.go 的 RefreshToken：
// POST https://platform.claude.com/v1/oauth/token
// body {grant_type:"refresh_token", refresh_token, client_id}
// HTTP client 走 new-api 现有方式（参考 codex_oauth.go），不引 resty。
// baseURL 传渠道 base_url：非空时改打 <base_url>/v1/oauth/token，让走反代域名的
// 渠道刷新与转发同路（部署地直连 platform.claude.com 会被地域 403）。
func RefreshClaudeOAuthToken(ctx context.Context, refreshToken string, baseURL string, proxyURL string) (*ClaudeOAuthTokenResult, error) {
	rt := strings.TrimSpace(refreshToken)
	if rt == "" {
		return nil, errors.New("refresh_token is required")
	}

	reqBody := map[string]any{
		"grant_type":    "refresh_token",
		"refresh_token": rt,
		"client_id":     claudeoauth.ClientID,
	}
	return postClaudeOAuthToken(ctx, reqBody, baseURL, proxyURL)
}

// ExchangeClaudeOAuthCode 用授权 code + state + code_verifier 向 Claude OAuth token 端点换取 token。
//
// 迁移自 sub2api repository/claude_oauth_service.go 的 ExchangeCodeForToken：
// POST https://platform.claude.com/v1/oauth/token
// body {grant_type:"authorization_code", code, state, client_id, redirect_uri, code_verifier}
//
// **state 必须随交换体一起发**：Claude 的 token 端点要求 authorization_code 交换携带 state，
// 缺失会返回 400。调用方应显式传入授权回调里的 state；同时兼容把整串 "authCode#state"
// 当作 code 传入的旧形态(从 # 后回退解析 state)。
func ExchangeClaudeOAuthCode(ctx context.Context, code string, state string, codeVerifier string, baseURL string, proxyURL string) (*ClaudeOAuthTokenResult, error) {
	c := strings.TrimSpace(code)
	v := strings.TrimSpace(codeVerifier)
	s := strings.TrimSpace(state)
	if c == "" {
		return nil, errors.New("authorization code is required")
	}
	if v == "" {
		return nil, errors.New("code_verifier is required")
	}

	// 兼容 "authCode#state" 形态：若 code 仍带 #，拆出 authCode，并在显式 state 缺失时回退取用。
	authCode := c
	if idx := strings.Index(c, "#"); idx != -1 {
		authCode = c[:idx]
		if s == "" {
			s = strings.TrimSpace(c[idx+1:])
		}
	}

	reqBody := map[string]any{
		"code":          authCode,
		"grant_type":    "authorization_code",
		"client_id":     claudeoauth.ClientID,
		"redirect_uri":  claudeoauth.RedirectURI,
		"code_verifier": v,
	}
	if s != "" {
		reqBody["state"] = s
	}

	return postClaudeOAuthToken(ctx, reqBody, baseURL, proxyURL)
}

// postClaudeOAuthToken 向 Claude OAuth token 端点 POST JSON body 并解析标准化结果。
func postClaudeOAuthToken(ctx context.Context, reqBody map[string]any, baseURL string, proxyURL string) (*ClaudeOAuthTokenResult, error) {
	client, err := getClaudeOAuthHTTPClient(proxyURL)
	if err != nil {
		return nil, err
	}

	bodyBytes, err := common.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, claudeoauth.TokenEndpointForBase(baseURL), bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "axios/1.13.6")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// 非 2xx：把上游错误体带进 error（仅错误路径，成功路径不记录 body，避免泄漏 token）。
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := strings.TrimSpace(string(respBytes))
		if len(snippet) > 500 {
			snippet = snippet[:500]
		}
		return nil, fmt.Errorf("claude oauth token request failed: status=%d body=%s", resp.StatusCode, snippet)
	}

	var payload claudeOAuthTokenPayload
	if err := common.Unmarshal(respBytes, &payload); err != nil {
		return nil, err
	}

	if strings.TrimSpace(payload.AccessToken) == "" {
		return nil, errors.New("claude oauth token response missing access_token")
	}

	result := &ClaudeOAuthTokenResult{
		AccessToken:  strings.TrimSpace(payload.AccessToken),
		RefreshToken: strings.TrimSpace(payload.RefreshToken),
	}
	if payload.ExpiresIn > 0 {
		result.ExpiresAt = time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)
	}
	return result, nil
}

// getClaudeOAuthHTTPClient 复用 new-api 的 HTTP client + proxy 机制（同 codex_oauth.go）。
func getClaudeOAuthHTTPClient(proxyURL string) (*http.Client, error) {
	baseClient, err := GetHttpClientWithProxy(strings.TrimSpace(proxyURL))
	if err != nil {
		return nil, err
	}
	if baseClient == nil {
		return &http.Client{Timeout: defaultHTTPTimeout}, nil
	}
	clientCopy := *baseClient
	clientCopy.Timeout = defaultHTTPTimeout
	return &clientCopy, nil
}
