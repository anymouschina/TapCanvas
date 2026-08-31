package service

import (
	"strings"
	"testing"
)

func TestGeminiAntigravityOAuthRequiresExplicitClientConfiguration(t *testing.T) {
	t.Setenv(geminiAntigravityClientIDEnv, "")
	t.Setenv(geminiAntigravityClientSecretEnv, "")

	_, err := geminiOAuthClient("antigravity")
	if err == nil {
		t.Fatal("expected missing Antigravity OAuth client configuration to fail")
	}
	if !strings.Contains(err.Error(), geminiAntigravityClientIDEnv) ||
		!strings.Contains(err.Error(), geminiAntigravityClientSecretEnv) {
		t.Fatalf("expected error to name both required environment variables, got %q", err.Error())
	}
}

func TestGeminiAntigravityOAuthUsesExplicitClientConfiguration(t *testing.T) {
	t.Setenv(geminiAntigravityClientIDEnv, "example-client-id")
	t.Setenv(geminiAntigravityClientSecretEnv, "example-client-secret")

	client, err := geminiOAuthClient("antigravity")
	if err != nil {
		t.Fatalf("expected configured Antigravity OAuth client, got %v", err)
	}
	if client.ClientID != "example-client-id" || client.ClientSecret != "example-client-secret" {
		t.Fatalf("unexpected Antigravity OAuth client configuration: %+v", client)
	}
	if client.RedirectURI != defaultGeminiOAuthAntigravityRedirectURI {
		t.Fatalf("unexpected Antigravity redirect URI %q", client.RedirectURI)
	}
	if client.Scope != geminiOAuthScopeAntigravity {
		t.Fatalf("unexpected Antigravity OAuth scope %q", client.Scope)
	}
}
