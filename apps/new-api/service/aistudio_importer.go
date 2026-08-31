package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

const (
	aiStudioStorageStateMaxBytes = 2 * 1024 * 1024
	aiStudioImporterMaxBodyBytes = 2 * 1024 * 1024
)

var aiStudioAccountNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.@-]{1,64}$`)

var aiStudioImporterHTTPClient = &http.Client{Timeout: 30 * time.Second}
var aiStudioOnboardingHTTPClient = &http.Client{Timeout: 370 * time.Second}

type AIStudioImporterAccount struct {
	File    string `json:"file"`
	Index   int    `json:"index"`
	Name    string `json:"name"`
	Cookies int    `json:"cookies"`
	MTime   int64  `json:"mtime"`
	Proxy   string `json:"proxy"`
	Note    string `json:"note"`
	Expired *bool  `json:"expired,omitempty"`
}

type AIStudioImporterAccounts struct {
	Accounts  []AIStudioImporterAccount `json:"accounts"`
	ProxyPool []string                  `json:"proxy_pool"`
}

type AIStudioAccountImport struct {
	Name         string
	Proxy        string
	Note         string
	StorageState json.RawMessage
	DryRun       bool
}

// AIStudioAccountOnboarding carries one-time Google credentials directly to
// the Studio Importer. Callers must never persist or log this value.
type AIStudioAccountOnboarding struct {
	Name          string
	Email         string
	Password      string
	RecoveryEmail string
	TOTPSecret    string
	Proxy         string
	Note          string
}

type AIStudioAccountImportResult struct {
	File              string `json:"file"`
	Name              string `json:"name"`
	Proxy             string `json:"proxy"`
	DryRun            bool   `json:"dry_run,omitempty"`
	RuntimeValidation string `json:"runtime_validation,omitempty"`
}

type aiStudioImporterAccountsResponse struct {
	OK        bool                      `json:"ok"`
	Error     string                    `json:"error"`
	Accounts  []AIStudioImporterAccount `json:"accounts"`
	ProxyPool []string                  `json:"proxy_pool"`
}

type aiStudioImporterImportResponse struct {
	OK                bool   `json:"ok"`
	Error             string `json:"error"`
	File              string `json:"file"`
	Name              string `json:"name"`
	Proxy             string `json:"proxy"`
	DryRun            bool   `json:"dry_run,omitempty"`
	RuntimeValidation string `json:"runtime_validation,omitempty"`
}

type aiStudioImporterOnboardRequest struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	Password      string `json:"password"`
	RecoveryEmail string `json:"recovery_email,omitempty"`
	TOTPSecret    string `json:"totp_secret,omitempty"`
	Proxy         string `json:"proxy"`
	Note          string `json:"note,omitempty"`
}

type aiStudioStorageState struct {
	Cookies []json.RawMessage `json:"cookies"`
	Origins []json.RawMessage `json:"origins,omitempty"`
}

type aiStudioProxy struct {
	Line string
	Host string
}

func ListAIStudioImporterAccounts(ctx context.Context, settings dto.ChannelSettings) (AIStudioImporterAccounts, error) {
	if err := settings.ValidateAIStudioImporter(); err != nil {
		return AIStudioImporterAccounts{}, err
	}

	request, err := newAIStudioImporterRequest(ctx, settings, http.MethodGet, "/api/accounts", nil, "")
	if err != nil {
		return AIStudioImporterAccounts{}, err
	}

	var response aiStudioImporterAccountsResponse
	if err := executeAIStudioImporterRequest(request, &response); err != nil {
		return AIStudioImporterAccounts{}, err
	}
	if !response.OK {
		return AIStudioImporterAccounts{}, importerRejectedError(response.Error)
	}

	return AIStudioImporterAccounts{
		Accounts:  response.Accounts,
		ProxyPool: response.ProxyPool,
	}, nil
}

func ImportAIStudioAccount(ctx context.Context, settings dto.ChannelSettings, input AIStudioAccountImport) (AIStudioAccountImportResult, error) {
	if err := settings.ValidateAIStudioImporter(); err != nil {
		return AIStudioAccountImportResult{}, err
	}

	name := strings.TrimSpace(input.Name)
	if !aiStudioAccountNamePattern.MatchString(name) {
		return AIStudioAccountImportResult{}, errors.New("账号名称必须为 1-64 位，只能包含字母、数字、下划线、点、横线和 @")
	}
	proxy, err := parseAIStudioProxy(input.Proxy)
	if err != nil {
		return AIStudioAccountImportResult{}, err
	}
	if len(input.StorageState) == 0 {
		return AIStudioAccountImportResult{}, errors.New("storageState JSON 不能为空")
	}
	if len(input.StorageState) > aiStudioStorageStateMaxBytes {
		return AIStudioAccountImportResult{}, fmt.Errorf("storageState JSON 不能超过 %d MiB", aiStudioStorageStateMaxBytes/(1024*1024))
	}
	var storageState aiStudioStorageState
	if err := common.Unmarshal(input.StorageState, &storageState); err != nil {
		return AIStudioAccountImportResult{}, fmt.Errorf("storageState JSON 无效: %w", err)
	}
	if len(storageState.Cookies) == 0 {
		return AIStudioAccountImportResult{}, errors.New("storageState JSON 必须包含非空 cookies 数组")
	}
	note := strings.TrimSpace(input.Note)
	if len([]rune(note)) > 255 {
		return AIStudioAccountImportResult{}, errors.New("备注不能超过 255 个字符")
	}

	// Preflight gives administrators a deterministic error before uploading a
	// sensitive storageState. The importer repeats the same checks and remains
	// the final authority, so concurrent imports cannot bypass one-account-one-IP.
	existing, err := ListAIStudioImporterAccounts(ctx, settings)
	if err != nil {
		return AIStudioAccountImportResult{}, fmt.Errorf("读取 AI Studio 账号池失败: %w", err)
	}
	if err := validateAIStudioAccountUniqueness(name, proxy, existing.Accounts); err != nil {
		return AIStudioAccountImportResult{}, err
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for field, value := range map[string]string{
		"name":  name,
		"proxy": proxy.Line,
		"note":  note,
	} {
		if err := writer.WriteField(field, value); err != nil {
			return AIStudioAccountImportResult{}, fmt.Errorf("构建导入请求失败: %w", err)
		}
	}
	if input.DryRun {
		if err := writer.WriteField("dry", "1"); err != nil {
			return AIStudioAccountImportResult{}, fmt.Errorf("构建导入请求失败: %w", err)
		}
	}
	part, err := writer.CreateFormFile("file", "storage-state.json")
	if err != nil {
		return AIStudioAccountImportResult{}, fmt.Errorf("构建导入文件失败: %w", err)
	}
	if _, err := part.Write(input.StorageState); err != nil {
		return AIStudioAccountImportResult{}, fmt.Errorf("写入导入文件失败: %w", err)
	}
	if err := writer.Close(); err != nil {
		return AIStudioAccountImportResult{}, fmt.Errorf("完成导入请求失败: %w", err)
	}

	request, err := newAIStudioImporterRequest(ctx, settings, http.MethodPost, "/api/import", &body, writer.FormDataContentType())
	if err != nil {
		return AIStudioAccountImportResult{}, err
	}
	var response aiStudioImporterImportResponse
	if err := executeAIStudioImporterRequest(request, &response); err != nil {
		return AIStudioAccountImportResult{}, err
	}
	if !response.OK {
		return AIStudioAccountImportResult{}, importerRejectedError(response.Error)
	}
	return AIStudioAccountImportResult{
		File:              response.File,
		Name:              response.Name,
		Proxy:             redactAIStudioProxy(response.Proxy),
		DryRun:            response.DryRun,
		RuntimeValidation: response.RuntimeValidation,
	}, nil
}

func OnboardAIStudioAccount(ctx context.Context, settings dto.ChannelSettings, input AIStudioAccountOnboarding) (AIStudioAccountImportResult, error) {
	if err := settings.ValidateAIStudioImporter(); err != nil {
		return AIStudioAccountImportResult{}, err
	}
	name := strings.TrimSpace(input.Name)
	if !aiStudioAccountNamePattern.MatchString(name) {
		return AIStudioAccountImportResult{}, errors.New("账号名称必须为 1-64 位，只能包含字母、数字、下划线、点、横线和 @")
	}
	email := strings.TrimSpace(input.Email)
	if email == "" || len(email) > 320 || !strings.Contains(email, "@") || strings.ContainsAny(email, " \t\r\n") {
		return AIStudioAccountImportResult{}, errors.New("Google 登录邮箱无效")
	}
	password := input.Password
	if password == "" || len(password) > 1024 {
		return AIStudioAccountImportResult{}, errors.New("Google 登录密码不能为空且不能超过 1024 字节")
	}
	recoveryEmail := strings.TrimSpace(input.RecoveryEmail)
	if recoveryEmail != "" && (len(recoveryEmail) > 320 || !strings.Contains(recoveryEmail, "@") || strings.ContainsAny(recoveryEmail, " \t\r\n")) {
		return AIStudioAccountImportResult{}, errors.New("恢复邮箱无效")
	}
	totpSecret := strings.TrimSpace(input.TOTPSecret)
	if len(totpSecret) > 2048 {
		return AIStudioAccountImportResult{}, errors.New("2FA TOTP 密钥不能超过 2048 字节")
	}
	proxy, err := parseAIStudioProxy(input.Proxy)
	if err != nil {
		return AIStudioAccountImportResult{}, err
	}
	note := strings.TrimSpace(input.Note)
	if len([]rune(note)) > 255 {
		return AIStudioAccountImportResult{}, errors.New("备注不能超过 255 个字符")
	}

	existing, err := ListAIStudioImporterAccounts(ctx, settings)
	if err != nil {
		return AIStudioAccountImportResult{}, fmt.Errorf("读取 AI Studio 账号池失败: %w", err)
	}
	if err := validateAIStudioAccountUniqueness(name, proxy, existing.Accounts); err != nil {
		return AIStudioAccountImportResult{}, err
	}

	payload, err := common.Marshal(aiStudioImporterOnboardRequest{
		Name:          name,
		Email:         email,
		Password:      password,
		RecoveryEmail: recoveryEmail,
		TOTPSecret:    totpSecret,
		Proxy:         proxy.Line,
		Note:          note,
	})
	if err != nil {
		return AIStudioAccountImportResult{}, fmt.Errorf("构建 AI Studio 自动登录请求失败: %w", err)
	}
	request, err := newAIStudioImporterRequest(ctx, settings, http.MethodPost, "/api/onboard", bytes.NewReader(payload), "application/json")
	if err != nil {
		return AIStudioAccountImportResult{}, err
	}
	var response aiStudioImporterImportResponse
	if err := executeAIStudioImporterRequestWithClient(aiStudioOnboardingHTTPClient, request, &response); err != nil {
		return AIStudioAccountImportResult{}, err
	}
	if !response.OK {
		return AIStudioAccountImportResult{}, importerRejectedError(response.Error)
	}
	return AIStudioAccountImportResult{
		File:              response.File,
		Name:              response.Name,
		Proxy:             redactAIStudioProxy(response.Proxy),
		RuntimeValidation: response.RuntimeValidation,
	}, nil
}

func RedactAIStudioImporterAccounts(accounts AIStudioImporterAccounts) AIStudioImporterAccounts {
	redacted := AIStudioImporterAccounts{
		Accounts:  make([]AIStudioImporterAccount, len(accounts.Accounts)),
		ProxyPool: make([]string, len(accounts.ProxyPool)),
	}
	for index, account := range accounts.Accounts {
		account.Proxy = redactAIStudioProxy(account.Proxy)
		redacted.Accounts[index] = account
	}
	for index, proxy := range accounts.ProxyPool {
		redacted.ProxyPool[index] = redactAIStudioProxy(proxy)
	}
	return redacted
}

func validateAIStudioAccountUniqueness(name string, proxy aiStudioProxy, accounts []AIStudioImporterAccount) error {
	for _, account := range accounts {
		if strings.EqualFold(strings.TrimSpace(account.Name), name) {
			return fmt.Errorf("账号名称 %q 已存在", name)
		}
		if strings.TrimSpace(account.Proxy) == "" {
			continue
		}
		existingProxy, err := parseAIStudioProxy(account.Proxy)
		if err != nil {
			return fmt.Errorf("账号 %q 的现有代理配置无效，拒绝继续导入: %w", account.Name, err)
		}
		if existingProxy.Line == proxy.Line {
			return fmt.Errorf("该代理已绑定账号 %q", account.Name)
		}
		if strings.EqualFold(existingProxy.Host, proxy.Host) {
			return fmt.Errorf("代理主机 %q 已绑定账号 %q；一号一 IP 不允许复用", proxy.Host, account.Name)
		}
	}
	return nil
}

func parseAIStudioProxy(raw string) (aiStudioProxy, error) {
	line := strings.TrimSpace(raw)
	if line == "" {
		return aiStudioProxy{}, errors.New("每个 AI Studio 账号必须配置专属代理")
	}
	if strings.ContainsAny(line, "\r\n") {
		return aiStudioProxy{}, errors.New("代理配置只能包含一行")
	}

	if strings.Contains(line, "://") {
		parsedURL, err := url.Parse(line)
		if err != nil {
			return aiStudioProxy{}, fmt.Errorf("代理 URL 无效: %w", err)
		}
		switch strings.ToLower(parsedURL.Scheme) {
		case "http", "https", "socks5", "socks5h":
		default:
			return aiStudioProxy{}, errors.New("代理协议必须是 http、https、socks5 或 socks5h")
		}
		if parsedURL.User == nil || parsedURL.User.Username() == "" {
			return aiStudioProxy{}, errors.New("URL 格式代理必须包含用户名和密码")
		}
		if _, exists := parsedURL.User.Password(); !exists {
			return aiStudioProxy{}, errors.New("URL 格式代理必须包含用户名和密码")
		}
		if err := validateAIStudioProxyAddress(parsedURL.Hostname(), parsedURL.Port()); err != nil {
			return aiStudioProxy{}, err
		}
		if (parsedURL.Path != "" && parsedURL.Path != "/") || parsedURL.RawQuery != "" || parsedURL.Fragment != "" {
			return aiStudioProxy{}, errors.New("代理 URL 不能包含 path、query 或 fragment")
		}
		return aiStudioProxy{Line: line, Host: strings.ToLower(parsedURL.Hostname())}, nil
	}

	if at := strings.LastIndex(line, "@"); at >= 0 {
		credentials := line[:at]
		address := line[at+1:]
		if credentials == "" || !strings.Contains(credentials, ":") {
			return aiStudioProxy{}, errors.New("代理认证格式必须是 用户名:密码@主机:端口")
		}
		host, _, err := splitAIStudioProxyAddress(address)
		if err != nil {
			return aiStudioProxy{}, err
		}
		return aiStudioProxy{Line: line, Host: strings.ToLower(host)}, nil
	}

	parts := strings.Split(line, ":")
	switch len(parts) {
	case 2:
		if err := validateAIStudioProxyAddress(parts[0], parts[1]); err != nil {
			return aiStudioProxy{}, err
		}
		return aiStudioProxy{Line: line, Host: strings.ToLower(parts[0])}, nil
	case 4:
		if strings.TrimSpace(parts[2]) == "" || strings.TrimSpace(parts[3]) == "" {
			return aiStudioProxy{}, errors.New("代理用户名和密码不能为空")
		}
		if err := validateAIStudioProxyAddress(parts[0], parts[1]); err != nil {
			return aiStudioProxy{}, err
		}
		return aiStudioProxy{Line: line, Host: strings.ToLower(parts[0])}, nil
	default:
		return aiStudioProxy{}, errors.New("代理格式必须是 主机:端口、主机:端口:用户名:密码 或 用户名:密码@主机:端口")
	}
}

func splitAIStudioProxyAddress(address string) (string, string, error) {
	parts := strings.Split(address, ":")
	if len(parts) != 2 {
		return "", "", errors.New("代理地址必须是 主机:端口")
	}
	if err := validateAIStudioProxyAddress(parts[0], parts[1]); err != nil {
		return "", "", err
	}
	return parts[0], parts[1], nil
}

func validateAIStudioProxyAddress(host string, port string) error {
	if strings.TrimSpace(host) == "" {
		return errors.New("代理主机不能为空")
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return errors.New("代理端口必须是 1-65535 的数字")
	}
	return nil
}

func redactAIStudioProxy(raw string) string {
	line := strings.TrimSpace(raw)
	if line == "" {
		return ""
	}
	if strings.Contains(line, "://") {
		parsedURL, err := url.Parse(line)
		if err == nil && parsedURL.User != nil {
			parsedURL.User = url.UserPassword(parsedURL.User.Username(), "***")
			return parsedURL.String()
		}
	}
	if at := strings.LastIndex(line, "@"); at >= 0 {
		credentials := line[:at]
		username := strings.SplitN(credentials, ":", 2)[0]
		return username + ":***@" + line[at+1:]
	}
	parts := strings.Split(line, ":")
	if len(parts) == 4 {
		return strings.Join([]string{parts[0], parts[1], parts[2], "***"}, ":")
	}
	return line
}

func newAIStudioImporterRequest(
	ctx context.Context,
	settings dto.ChannelSettings,
	method string,
	endpoint string,
	body io.Reader,
	contentType string,
) (*http.Request, error) {
	passwordEnv := strings.TrimSpace(settings.AIStudioImporterPasswordEnv)
	password, exists := os.LookupEnv(passwordEnv)
	if !exists || password == "" {
		return nil, fmt.Errorf("AI Studio Importer 密码环境变量 %s 未配置", passwordEnv)
	}
	baseURL := strings.TrimRight(strings.TrimSpace(settings.AIStudioImporterURL), "/")
	request, err := http.NewRequestWithContext(ctx, method, baseURL+endpoint, body)
	if err != nil {
		return nil, fmt.Errorf("创建 AI Studio Importer 请求失败: %w", err)
	}
	request.SetBasicAuth(strings.TrimSpace(settings.AIStudioImporterUsername), password)
	request.Header.Set("Accept", "application/json")
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	return request, nil
}

func executeAIStudioImporterRequest(request *http.Request, output any) error {
	return executeAIStudioImporterRequestWithClient(aiStudioImporterHTTPClient, request, output)
}

func executeAIStudioImporterRequestWithClient(client *http.Client, request *http.Request, output any) error {
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("AI Studio Importer 请求失败: %w", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, aiStudioImporterMaxBodyBytes+1))
	if err != nil {
		return fmt.Errorf("读取 AI Studio Importer 响应失败: %w", err)
	}
	if len(body) > aiStudioImporterMaxBodyBytes {
		return errors.New("AI Studio Importer 响应超过 2 MiB 限制")
	}
	if err := common.Unmarshal(body, output); err != nil {
		return fmt.Errorf("AI Studio Importer 返回了无效 JSON（HTTP %d）: %w", response.StatusCode, err)
	}
	return nil
}

func importerRejectedError(message string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "未提供错误原因"
	}
	return fmt.Errorf("AI Studio Importer 拒绝请求: %s", message)
}
