package service

import (
	"encoding/base64"
	"testing"
)

func TestValidateCodexCredentialBatch(t *testing.T) {
	credentials, err := validateCodexCredentialBatch([]string{
		`{"access_token":"token-a","account_id":"account-a","session_token":"session-a"}`,
		`{"access_token":"token-b","account_id":"account-b"}`,
	})
	if err != nil {
		t.Fatalf("validate batch error = %v", err)
	}
	if len(credentials) != 2 || credentials[0].AccountID != "account-a" || credentials[1].AccountID != "account-b" {
		t.Fatalf("credentials = %#v", credentials)
	}
	if credentials[0].Raw == "" {
		t.Fatal("raw credential was not preserved")
	}
}

func TestValidateCodexCredentialBatchRejectsWholeBatch(t *testing.T) {
	tests := []struct {
		name        string
		credentials []string
	}{
		{name: "empty", credentials: nil},
		{name: "missing access token", credentials: []string{`{"account_id":"account-a"}`}},
		{name: "missing account id", credentials: []string{`{"access_token":"token-a"}`}},
		{name: "duplicate oauth account without session token", credentials: []string{
			`{"access_token":"token-a","account_id":"account-a"}`,
			`{"access_token":"token-b","account_id":"account-a"}`,
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := validateCodexCredentialBatch(test.credentials); err == nil {
				t.Fatal("validate error = nil")
			}
		})
	}
}

func TestValidateCodexCredentialBatchAllowsSameAccountWithDistinctSessions(t *testing.T) {
	credentials, err := validateCodexCredentialBatch([]string{
		`{"access_token":"token-a","account_id":"account-a","session_token":"session-a"}`,
		`{"access_token":"token-b","account_id":"account-a","session_token":"session-b"}`,
	})
	if err != nil {
		t.Fatalf("validate distinct sessions error = %v", err)
	}
	if len(credentials) != 2 || credentials[0].SessionKey == credentials[1].SessionKey {
		t.Fatalf("credentials = %#v", credentials)
	}
}

func TestValidateCodexCredentialBatchAllowsSameAccountWithDistinctJWTSessions(t *testing.T) {
	jwt := func(sessionID string) string {
		payload := base64.RawURLEncoding.EncodeToString([]byte(`{"https://api.openai.com/auth":{"chatgpt_account_id":"account-a","session_id":"` + sessionID + `"}}`))
		return "header." + payload + ".signature"
	}
	credentials, err := validateCodexCredentialBatch([]string{
		`{"access_token":"` + jwt("session-a") + `"}`,
		`{"access_token":"` + jwt("session-b") + `"}`,
	})
	if err != nil {
		t.Fatalf("validate distinct JWT sessions error = %v", err)
	}
	if len(credentials) != 2 || credentials[0].SessionKey != "session_id:session-a" || credentials[1].SessionKey != "session_id:session-b" {
		t.Fatalf("credentials = %#v", credentials)
	}
}

func TestValidateCodexCredentialBatchRejectsDuplicateJWTSession(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"https://api.openai.com/auth":{"chatgpt_account_id":"account-a","session_id":"same-session"}}`))
	token := "header." + payload + ".signature"
	if _, err := validateCodexCredentialBatch([]string{
		`{"access_token":"` + token + `"}`,
		`{"access_token":"` + token + `"}`,
	}); err == nil {
		t.Fatal("duplicate JWT session error = nil")
	}
}

func TestValidateCodexCredentialBatchCanonicalizesCPAFormat(t *testing.T) {
	credentials, err := validateCodexCredentialBatch([]string{
		`{"access_token":"token-a","chatgpt_account_id":"account-a","client_id":"foreign-client"}`,
	})
	if err != nil {
		t.Fatalf("validate CPA credential error = %v", err)
	}
	if len(credentials) != 1 || credentials[0].AccountID != "account-a" {
		t.Fatalf("credentials = %#v", credentials)
	}
	if credentials[0].Diagnostics.SourceFormat != "cpa" || credentials[0].Diagnostics.Refreshable {
		t.Fatalf("diagnostics = %#v", credentials[0].Diagnostics)
	}
	if credentials[0].Raw != `{"access_token":"token-a","account_id":"account-a","type":"codex"}` {
		t.Fatalf("canonical raw = %s", credentials[0].Raw)
	}
}
