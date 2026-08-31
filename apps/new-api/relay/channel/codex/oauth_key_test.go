package codex

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
)

func TestParseOAuthKeysAcceptsPrettyObjectAndArray(t *testing.T) {
	pretty := `{
  "type": "codex",
  "access_token": "token-a",
  "account_id": "account-a",
  "session_token": "session-a"
}`
	keys, err := ParseOAuthKeys(pretty)
	if err != nil {
		t.Fatalf("ParseOAuthKeys(pretty) error = %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("ParseOAuthKeys(pretty) len = %d, want 1", len(keys))
	}
	parsed, err := ParseOAuthKey(keys[0])
	if err != nil || parsed.AccountID != "account-a" {
		t.Fatalf("parsed account = %#v, err = %v", parsed, err)
	}

	array := `[{"access_token":"token-a","account_id":"account-a"},{"access_token":"token-b","account_id":"account-b"}]`
	keys, err = ParseOAuthKeys(array)
	if err != nil {
		t.Fatalf("ParseOAuthKeys(array) error = %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("ParseOAuthKeys(array) len = %d, want 2", len(keys))
	}
}

func TestNormalizeOAuthCredentialAcceptsCPAAndDerivesJWTFields(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"client_id":"cpa-client","email":"user@example.com","exp":1784888516,"https://api.openai.com/auth":{"chatgpt_account_id":"account-from-jwt"}}`))
	token := "header." + payload + ".signature"
	key, diagnostics, err := NormalizeOAuthCredential(`{"type":"codex","access_token":"` + token + `","id_token":"` + token + `","chatgpt_account_id":"account-alias"}`)
	if err != nil {
		t.Fatalf("NormalizeOAuthCredential error = %v", err)
	}
	if key.AccountID != "account-alias" || key.Email != "user@example.com" || key.Expired == "" {
		t.Fatalf("normalized key = %#v", key)
	}
	if diagnostics.SourceFormat != "cpa" || diagnostics.Refreshable || diagnostics.TokenClientID != "cpa-client" {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
	if len(diagnostics.Warnings) != 3 {
		t.Fatalf("warnings = %#v, want missing refresh, identical token, and client mismatch warnings", diagnostics.Warnings)
	}
}

func TestNormalizeOAuthCredentialAcceptsCodexTokensEnvelope(t *testing.T) {
	key, diagnostics, err := NormalizeOAuthCredential(`{"auth_mode":"chatgpt","tokens":{"access_token":"token-a","refresh_token":"refresh-a","account_id":"account-a"}}`)
	if err != nil {
		t.Fatalf("NormalizeOAuthCredential error = %v", err)
	}
	if key.AccessToken != "token-a" || key.AccountID != "account-a" || key.Type != "codex" {
		t.Fatalf("normalized key = %#v", key)
	}
	if diagnostics.SourceFormat != "codex_auth_json" || !diagnostics.Refreshable {
		t.Fatalf("diagnostics = %#v", diagnostics)
	}
}

func TestApplyCLIProxyRequestHeaders(t *testing.T) {
	headers := make(http.Header)
	ApplyCLIProxyRequestHeaders(&headers, " token-a ", " account-a ", true)
	if headers.Get("Authorization") != "Bearer token-a" || headers.Get("Chatgpt-Account-Id") != "account-a" {
		t.Fatalf("auth headers = %#v", headers)
	}
	for _, name := range []string{"Originator", "User-Agent", "Session_id"} {
		if strings.TrimSpace(headers.Get(name)) == "" {
			t.Fatalf("missing %s in %#v", name, headers)
		}
	}
	if headers.Get("Accept") != "text/event-stream" {
		t.Fatalf("Accept = %q", headers.Get("Accept"))
	}
}

func TestParseOAuthKeysRejectsInvalidAccount(t *testing.T) {
	if _, err := ParseOAuthKeys(`[{"access_token":"token"},not-json]`); err == nil {
		t.Fatal("ParseOAuthKeys(invalid) error = nil")
	}
}
