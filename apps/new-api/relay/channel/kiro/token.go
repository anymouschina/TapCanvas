package kiro

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// tokenCache 以 refreshToken 为键缓存 accessToken，避免每次请求都刷新。
var tokenCache sync.Map // refreshToken -> *cachedToken

type cachedToken struct {
	accessToken string
	expireAt    time.Time
}

// refreshMu 防止同一个 refreshToken 并发刷新（粗粒度全局锁，刷新很快，可接受）。
var refreshMu sync.Mutex

var tokenHTTPClient = &http.Client{Timeout: 30 * time.Second}

// getAccessToken 用 refreshToken 换取（并缓存）accessToken。
func getAccessToken(key *KiroKey) (string, error) {
	if v, ok := tokenCache.Load(key.RefreshToken); ok {
		ct := v.(*cachedToken)
		if time.Now().Before(ct.expireAt) {
			return ct.accessToken, nil
		}
	}

	refreshMu.Lock()
	defer refreshMu.Unlock()
	// 二次检查：可能在等待锁期间已被其他请求刷新。
	if v, ok := tokenCache.Load(key.RefreshToken); ok {
		ct := v.(*cachedToken)
		if time.Now().Before(ct.expireAt) {
			return ct.accessToken, nil
		}
	}

	region := key.Region
	if region == "" {
		region = "us-east-1"
	}
	reqBody, _ := json.Marshal(map[string]string{
		"clientId":     key.ClientID,
		"clientSecret": key.ClientSecret,
		"refreshToken": key.RefreshToken,
		"grantType":    "refresh_token",
	})
	url := fmt.Sprintf("https://oidc.%s.amazonaws.com/token", region)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := tokenHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("kiro channel: 刷新 token 失败: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("kiro channel: 刷新 token 失败 (%d): %s", resp.StatusCode, string(body))
	}

	var rd struct {
		AccessToken string  `json:"accessToken"`
		ExpiresIn   float64 `json:"expiresIn"`
	}
	if err := json.Unmarshal(body, &rd); err != nil {
		return "", fmt.Errorf("kiro channel: token 响应解析失败: %s", string(body))
	}
	if rd.AccessToken == "" {
		return "", errors.New("kiro channel: token 响应缺少 accessToken")
	}

	// 提前 5 分钟过期，留出余量；默认按 30 分钟兜底。
	ttl := time.Duration(rd.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	ttl -= 5 * time.Minute
	if ttl < time.Minute {
		ttl = time.Minute
	}
	tokenCache.Store(key.RefreshToken, &cachedToken{
		accessToken: rd.AccessToken,
		expireAt:    time.Now().Add(ttl),
	})
	return rd.AccessToken, nil
}
