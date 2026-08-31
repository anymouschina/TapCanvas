package codexauth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/google/uuid"
)

type sub2APIExport struct {
	Accounts []sub2APIExportAccount `json:"accounts"`
}

type sub2APIExportAccount struct {
	Platform    string          `json:"platform"`
	Type        string          `json:"type"`
	Credentials json.RawMessage `json:"credentials"`
	ExpiresAt   *int64          `json:"expires_at"`
}

func NormalizeCredentials(raw string) ([]OAuthKey, []CredentialDiagnostics, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil, errors.New("codex channel: empty credential json")
	}
	var object map[string]json.RawMessage
	if err := common.Unmarshal([]byte(trimmed), &object); err != nil {
		return nil, nil, errors.New("codex channel: invalid credential json")
	}
	if _, isExport := object["accounts"]; !isExport {
		key, diagnostics, err := NormalizeCredential(trimmed)
		if err != nil {
			return nil, nil, err
		}
		return []OAuthKey{*key}, []CredentialDiagnostics{diagnostics}, nil
	}
	var exported sub2APIExport
	if err := common.Unmarshal([]byte(trimmed), &exported); err != nil {
		return nil, nil, errors.New("codex channel: invalid sub2api account export")
	}
	if len(exported.Accounts) == 0 {
		return nil, nil, errors.New("codex channel: sub2api export contains no accounts")
	}
	keys := make([]OAuthKey, 0, len(exported.Accounts))
	diagnostics := make([]CredentialDiagnostics, 0, len(exported.Accounts))
	for index, account := range exported.Accounts {
		if strings.TrimSpace(account.Platform) != "openai" || strings.TrimSpace(account.Type) != "oauth" {
			return nil, nil, fmt.Errorf("codex channel: account %d is not an openai oauth account", index+1)
		}
		key, itemDiagnostics, err := NormalizeCredential(strings.TrimSpace(string(account.Credentials)))
		if err != nil {
			return nil, nil, fmt.Errorf("codex channel: account %d: %w", index+1, err)
		}
		if key.Expired == "" && account.ExpiresAt != nil && *account.ExpiresAt > 0 {
			key.Expired = time.Unix(*account.ExpiresAt, 0).UTC().Format(time.RFC3339)
		}
		keys = append(keys, *key)
		diagnostics = append(diagnostics, itemDiagnostics)
	}
	return keys, diagnostics, nil
}

const cliProxyCodexUserAgent = "codex-tui/0.135.0 (Mac OS 26.5.0; arm64) (codex-tui; 0.135.0)"
const codexOAuthClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

type OAuthKey struct {
	IDToken      string `json:"id_token,omitempty"`
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	SessionToken string `json:"session_token,omitempty"`
	SessionID    string `json:"session_id,omitempty"`
	AccountID    string `json:"account_id,omitempty"`
	LastRefresh  string `json:"last_refresh,omitempty"`
	Email        string `json:"email,omitempty"`
	Type         string `json:"type,omitempty"`
	Expired      string `json:"expired,omitempty"`
}

type CredentialDiagnostics struct {
	SourceFormat     string   `json:"source_format"`
	Refreshable      bool     `json:"refreshable"`
	TokenClientID    string   `json:"token_client_id,omitempty"`
	DeclaredClientID string   `json:"declared_client_id,omitempty"`
	ExpiresAt        string   `json:"expires_at,omitempty"`
	Warnings         []string `json:"warnings,omitempty"`
}

type credentialEnvelope struct {
	OAuthKey
	Tokens           *OAuthKey `json:"tokens,omitempty"`
	AccountIDAlias   string    `json:"chatgpt_account_id,omitempty"`
	WorkspaceIDAlias string    `json:"workspace_id,omitempty"`
	DeclaredClientID string    `json:"client_id,omitempty"`
}

func NormalizeCredential(raw string) (*OAuthKey, CredentialDiagnostics, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, CredentialDiagnostics{}, errors.New("codex channel: empty oauth key")
	}
	var envelope credentialEnvelope
	if err := common.Unmarshal([]byte(raw), &envelope); err != nil {
		return nil, CredentialDiagnostics{}, errors.New("codex channel: invalid oauth key json")
	}
	diagnostics := CredentialDiagnostics{SourceFormat: "cliproxy", Warnings: make([]string, 0, 3)}
	diagnostics.DeclaredClientID = strings.TrimSpace(envelope.DeclaredClientID)
	if diagnostics.DeclaredClientID != "" {
		diagnostics.SourceFormat = "cpa"
	}
	key := envelope.OAuthKey
	if envelope.Tokens != nil {
		diagnostics.SourceFormat = "codex_auth_json"
		key = *envelope.Tokens
	}
	if key.AccountID == "" {
		key.AccountID = strings.TrimSpace(envelope.AccountIDAlias)
		if key.AccountID != "" {
			diagnostics.SourceFormat = "cpa"
		}
	}
	if key.AccountID == "" {
		key.AccountID = strings.TrimSpace(envelope.WorkspaceIDAlias)
		if key.AccountID != "" {
			diagnostics.SourceFormat = "cpa"
			diagnostics.Warnings = append(diagnostics.Warnings, "account_id 由 workspace_id 补齐，仍需上游验证账号归属")
		}
	}
	claims := decodeJWTClaims(firstNonEmpty(key.AccessToken, key.IDToken))
	if key.AccountID == "" {
		key.AccountID = nestedClaimString(claims, "https://api.openai.com/auth", "chatgpt_account_id")
	}
	if key.Email == "" {
		key.Email = claimString(claims, "email")
	}
	if key.SessionID == "" {
		key.SessionID = firstNonEmpty(
			nestedClaimString(claims, "https://api.openai.com/auth", "session_id"),
			claimString(claims, "session_id"),
			claimString(claims, "sid"),
		)
	}
	if key.Expired == "" {
		if exp, ok := claims["exp"].(float64); ok && exp > 0 {
			key.Expired = time.Unix(int64(exp), 0).Format(time.RFC3339)
		}
	}
	if key.Type == "" {
		key.Type = "codex"
	}
	diagnostics.TokenClientID = claimString(claims, "client_id")
	diagnostics.ExpiresAt = key.Expired
	diagnostics.Refreshable = strings.TrimSpace(key.RefreshToken) != ""
	if !diagnostics.Refreshable {
		diagnostics.Warnings = append(diagnostics.Warnings, "缺少 refresh_token；401 或过期后无法自动刷新")
	}
	if strings.TrimSpace(key.AccessToken) == strings.TrimSpace(key.IDToken) && key.AccessToken != "" {
		diagnostics.Warnings = append(diagnostics.Warnings, "id_token 与 access_token 相同；已按 access_token 使用，真实性需上游验证")
	}
	if diagnostics.TokenClientID != "" && diagnostics.TokenClientID != codexOAuthClientID {
		diagnostics.Warnings = append(diagnostics.Warnings, "token_client_id 与 Codex OAuth 客户端不一致；上游可能返回 401")
	}
	if diagnostics.DeclaredClientID != "" && diagnostics.TokenClientID != "" && diagnostics.DeclaredClientID != diagnostics.TokenClientID {
		diagnostics.Warnings = append(diagnostics.Warnings, "declared_client_id 与 JWT token_client_id 不一致")
	}
	return &key, diagnostics, nil
}

func ApplyCLIProxyRequestHeaders(headers *http.Header, accessToken, accountID string, stream bool) {
	headers.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	headers.Set("chatgpt-account-id", strings.TrimSpace(accountID))
	if headers.Get("originator") == "" {
		headers.Set("originator", "codex-tui")
	}
	if headers.Get("User-Agent") == "" {
		headers.Set("User-Agent", cliProxyCodexUserAgent)
	}
	if headers.Get("Session_id") == "" {
		headers.Set("Session_id", uuid.NewString())
	}
	if stream {
		headers.Set("Accept", "text/event-stream")
	} else if headers.Get("Accept") == "" {
		headers.Set("Accept", "application/json")
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
func decodeJWTClaims(token string) map[string]any {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return map[string]any{}
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return map[string]any{}
	}
	claims := make(map[string]any)
	if common.Unmarshal(payload, &claims) != nil {
		return map[string]any{}
	}
	return claims
}
func claimString(claims map[string]any, key string) string {
	value, _ := claims[key].(string)
	return strings.TrimSpace(value)
}
func nestedClaimString(claims map[string]any, parent, key string) string {
	nested, _ := claims[parent].(map[string]any)
	return claimString(nested, key)
}
