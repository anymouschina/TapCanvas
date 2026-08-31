package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/pkg/geminiauth"
)

const (
	testGeminiAntigravityClientID     = "example-client-id"
	testGeminiAntigravityClientSecret = "example-client-secret"
)

func setGeminiAntigravityOAuthTestClient(t *testing.T) {
	t.Helper()
	t.Setenv(geminiAntigravityClientIDEnv, testGeminiAntigravityClientID)
	t.Setenv(geminiAntigravityClientSecretEnv, testGeminiAntigravityClientSecret)
}

func TestNormalizeGeminiCredentialImportsHydratesDirectAntigravityRefreshToken(t *testing.T) {
	setGeminiAntigravityOAuthTestClient(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/token":
			if err := request.ParseForm(); err != nil {
				t.Fatalf("ParseForm() error = %v", err)
			}
			if request.Form.Get("grant_type") != "refresh_token" {
				t.Fatalf("grant_type = %q, want refresh_token", request.Form.Get("grant_type"))
			}
			if request.Form.Get("client_id") != testGeminiAntigravityClientID {
				t.Fatalf("client_id = %q, want Antigravity client", request.Form.Get("client_id"))
			}
			if request.Form.Get("client_secret") != testGeminiAntigravityClientSecret {
				t.Fatal("client_secret does not match the Antigravity installed-app client")
			}
			if request.Form.Get("refresh_token") != "1//refresh-token" {
				t.Fatalf("refresh_token = %q", request.Form.Get("refresh_token"))
			}
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"access_token":"access-token","token_type":"Bearer","scope":"scope-a","expires_in":3600}`))
		case "/userinfo":
			if request.Header.Get("Authorization") != "Bearer access-token" {
				t.Fatalf("userinfo Authorization = %q", request.Header.Get("Authorization"))
			}
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"sub":"account-1","email":"user@example.com"}`))
		case "/v1internal:loadCodeAssist":
			if request.Header.Get("Authorization") != "Bearer access-token" {
				t.Fatalf("loadCodeAssist Authorization = %q", request.Header.Get("Authorization"))
			}
			if request.Header.Get("User-Agent") != geminiAntigravityUserAgent {
				t.Fatalf("loadCodeAssist User-Agent = %q", request.Header.Get("User-Agent"))
			}
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"cloudaicompanionProject":"project-1"}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	t.Setenv(geminiOAuthTokenURLEnv, server.URL+"/token")
	t.Setenv(geminiOAuthUserInfoURLEnv, server.URL+"/userinfo")
	t.Setenv("GEMINI_CODE_ASSIST_BASE_URL", server.URL)

	result, err := NormalizeGeminiCredentialImports(context.Background(), []string{"1//refresh-token"}, "")
	if err != nil {
		t.Fatalf("NormalizeGeminiCredentialImports() error = %v", err)
	}
	if len(result.Keys) != 1 {
		t.Fatalf("NormalizeGeminiCredentialImports() returned %d keys, want 1", len(result.Keys))
	}
	key, err := geminiauth.ParseOAuthKey(result.Keys[0])
	if err != nil {
		t.Fatalf("ParseOAuthKey() error = %v", err)
	}
	if key.AccessToken != "access-token" || key.RefreshToken != "1//refresh-token" {
		t.Fatalf("unexpected token fields: %#v", key)
	}
	if key.OAuthType != "antigravity" || key.ProjectID != "project-1" {
		t.Fatalf("unexpected Antigravity metadata: %#v", key)
	}
	if key.Email != "user@example.com" || key.AccountID != "account-1" {
		t.Fatalf("unexpected account identity: %#v", key)
	}
	if key.ExpiresAt == 0 || strings.TrimSpace(key.Expired) == "" || strings.TrimSpace(key.LastRefresh) == "" {
		t.Fatalf("expected expiry and refresh timestamps: %#v", key)
	}
}

func TestNormalizeGeminiCredentialImportsRejectsAntigravityEmailMismatch(t *testing.T) {
	setGeminiAntigravityOAuthTestClient(t)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/token":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"access_token":"access-token","expires_in":3600}`))
		case "/userinfo":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"sub":"account-1","email":"actual@example.com"}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	t.Setenv(geminiOAuthTokenURLEnv, server.URL+"/token")
	t.Setenv(geminiOAuthUserInfoURLEnv, server.URL+"/userinfo")

	_, err := NormalizeGeminiCredentialImports(
		context.Background(),
		[]string{`{"type":"antigravity","refresh_token":"1//refresh-token","email":"declared@example.com"}`},
		"",
	)
	if err == nil || !strings.Contains(err.Error(), "email mismatch") {
		t.Fatalf("NormalizeGeminiCredentialImports() error = %v, want email mismatch", err)
	}
}
