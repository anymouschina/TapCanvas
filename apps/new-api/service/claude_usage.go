package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	claudeUsageURL         = "https://api.anthropic.com/api/oauth/usage"
	claudeUsageUserAgent   = "claude-code/2.1.7"
	claudeUsageBetaHeader  = "oauth-2025-04-20"
	claudeUsageHTTPTimeout = 30 * time.Second
)

// ClaudeUsageWindow 表示一个用量窗口的额度信息(利用率 + 重置时间)。
type ClaudeUsageWindow struct {
	Utilization float64 `json:"utilization"`
	ResetsAt    string  `json:"resets_at"`
}

// ClaudeUsageResponse 是 Anthropic /api/oauth/usage 返回的额度结构。
// 迁移自 sub2api service.ClaudeUsageResponse。
type ClaudeUsageResponse struct {
	FiveHour       ClaudeUsageWindow `json:"five_hour"`
	SevenDay       ClaudeUsageWindow `json:"seven_day"`
	SevenDaySonnet ClaudeUsageWindow `json:"seven_day_sonnet"`
}

// FetchClaudeUsage 调用 Anthropic OAuth usage 端点获取订阅额度。
//
// 迁移自 sub2api repository/claude_usage_service.go 的 FetchUsage:
// GET https://api.anthropic.com/api/oauth/usage
// 头: Accept / Content-Type / Authorization: Bearer / anthropic-beta: oauth-2025-04-20 / User-Agent
// 去掉 sub2api 的 httpUpstream/TLS 指纹依赖,用 new-api 的普通 HTTP client(带 proxy)。
//
// 返回 (statusCode, body, parsed, error):
//   - statusCode/body 透出给调用方做 401/403 即时刷新及原始展示;
//   - parsed 为成功(2xx)时解析后的结构,非 2xx 时为 nil。
//
// baseURL 传渠道 base_url:非空时改打 <base_url>/api/oauth/usage,让走反代域名的渠道
// 用量查询与转发同路(部署地直连 api.anthropic.com 会被地域 403);为空用官方端点。
func FetchClaudeUsage(ctx context.Context, accessToken, baseURL, proxyURL string) (int, []byte, *ClaudeUsageResponse, error) {
	client, err := getClaudeUsageHTTPClient(proxyURL)
	if err != nil {
		return 0, nil, nil, err
	}

	endpoint := claudeUsageURL
	if b := strings.TrimSpace(baseURL); b != "" {
		endpoint = strings.TrimSuffix(b, "/") + "/api/oauth/usage"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("create request failed: %w", err)
	}

	// 与 sub2api/抓包一致;不设置 Accept-Encoding,让 Go 自动处理压缩。
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("anthropic-beta", claudeUsageBetaHeader)
	req.Header.Set("User-Agent", claudeUsageUserAgent)

	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, nil, fmt.Errorf("read response failed: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, body, nil, nil
	}

	var usageResp ClaudeUsageResponse
	if err := common.Unmarshal(body, &usageResp); err != nil {
		return resp.StatusCode, body, nil, fmt.Errorf("decode response failed: %w", err)
	}
	return resp.StatusCode, body, &usageResp, nil
}

// getClaudeUsageHTTPClient 复用 new-api 的 HTTP client + proxy 机制。
func getClaudeUsageHTTPClient(proxyURL string) (*http.Client, error) {
	baseClient, err := GetHttpClientWithProxy(proxyURL)
	if err != nil {
		return nil, err
	}
	if baseClient == nil {
		return &http.Client{Timeout: claudeUsageHTTPTimeout}, nil
	}
	clientCopy := *baseClient
	clientCopy.Timeout = claudeUsageHTTPTimeout
	return &clientCopy, nil
}
