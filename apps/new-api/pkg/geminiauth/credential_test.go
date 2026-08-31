package geminiauth

import (
	"testing"
)

func TestNormalizeCredentialsAcceptsSub2APIExport(t *testing.T) {
	raw := `{"accounts":[{"platform":"gemini","type":"oauth","expires_at":1700000000,"credentials":{"access_token":"access","refresh_token":"refresh","email":"user@example.com","project_id":"project-1"}}]}`
	keys, err := NormalizeCredentials(raw)
	if err != nil {
		t.Fatalf("NormalizeCredentials() error = %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("NormalizeCredentials() returned %d keys, want 1", len(keys))
	}
	key := keys[0]
	if key.AccessToken != "access" || key.RefreshToken != "refresh" {
		t.Fatalf("unexpected token fields: %#v", key)
	}
	if key.ProjectID != "project-1" || key.Email != "user@example.com" {
		t.Fatalf("unexpected account metadata: %#v", key)
	}
	if key.Expired == "" {
		t.Fatal("expected expires_at to be normalized to expired")
	}
	if !key.IsCodeAssist() {
		t.Fatal("expected project-backed credential to use Code Assist transport")
	}
}

func TestParseOAuthKeyAcceptsQuotedExpiresAt(t *testing.T) {
	key, err := ParseOAuthKey(`{"access_token":"access","expires_at":"1700000000","project_id":"project-1"}`)
	if err != nil {
		t.Fatalf("ParseOAuthKey() error = %v", err)
	}
	if key.ExpiresAt != UnixTimestamp(1700000000) {
		t.Fatalf("ExpiresAt = %d, want 1700000000", key.ExpiresAt)
	}
	if key.EffectiveOAuthType() != "code_assist" {
		t.Fatalf("EffectiveOAuthType() = %q, want code_assist", key.EffectiveOAuthType())
	}
}

func TestNormalizeCredentialsAcceptsCLIProxyAPIAuth(t *testing.T) {
	raw := `{"type":"antigravity","access_token":"access","refresh_token":"refresh","expires_in":3600,"timestamp":1700000000000,"email":"user@example.com","project_id":"project-1"}`
	keys, err := NormalizeCredentials(raw)
	if err != nil {
		t.Fatalf("NormalizeCredentials() error = %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("NormalizeCredentials() returned %d keys, want 1", len(keys))
	}
	key := keys[0]
	if key.OAuthType != "antigravity" {
		t.Fatalf("OAuthType = %q, want antigravity", key.OAuthType)
	}
	if key.ProjectID != "project-1" || key.Email != "user@example.com" {
		t.Fatalf("unexpected account metadata: %#v", key)
	}
	if key.ExpiresAt != UnixTimestamp(1700003600) {
		t.Fatalf("ExpiresAt = %d, want 1700003600", key.ExpiresAt)
	}
	if !key.IsCodeAssist() {
		t.Fatal("expected CLIProxyAPI credential to use Code Assist transport")
	}
}

func TestNormalizeCredentialsRejectsNonGeminiExport(t *testing.T) {
	raw := `{"accounts":[{"platform":"openai","type":"oauth","credentials":{"access_token":"access"}}]}`
	if _, err := NormalizeCredentials(raw); err == nil {
		t.Fatal("NormalizeCredentials() expected non-Gemini export error")
	}
}
