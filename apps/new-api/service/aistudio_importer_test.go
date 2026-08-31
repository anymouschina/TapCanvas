package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

func TestParseAIStudioProxyAcceptsImporterFormats(t *testing.T) {
	tests := []struct {
		input string
		host  string
	}{
		{input: "198.51.100.1:8080", host: "198.51.100.1"},
		{input: "198.51.100.2:8080:user:password", host: "198.51.100.2"},
		{input: "user:password@proxy.example.com:1080", host: "proxy.example.com"},
		{input: "socks5://user:password@proxy.example.com:1080", host: "proxy.example.com"},
	}

	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			proxy, err := parseAIStudioProxy(test.input)
			if err != nil {
				t.Fatalf("parseAIStudioProxy() error = %v", err)
			}
			if proxy.Host != test.host {
				t.Fatalf("parseAIStudioProxy() host = %q, want %q", proxy.Host, test.host)
			}
		})
	}
}

func TestParseAIStudioProxyRejectsURLPath(t *testing.T) {
	_, err := parseAIStudioProxy("https://user:password@proxy.example.com:8443/hidden")
	if err == nil || !strings.Contains(err.Error(), "path") {
		t.Fatalf("parseAIStudioProxy() error = %v, want URL path rejection", err)
	}
}

func TestValidateAIStudioAccountUniquenessRejectsSharedHost(t *testing.T) {
	proxy, err := parseAIStudioProxy("198.51.100.10:9000:new:secret")
	if err != nil {
		t.Fatalf("parse proxy: %v", err)
	}
	err = validateAIStudioAccountUniqueness("account-b", proxy, []AIStudioImporterAccount{
		{Name: "account-a", Proxy: "198.51.100.10:8000:old:secret"},
	})
	if err == nil || !strings.Contains(err.Error(), "一号一 IP") {
		t.Fatalf("validateAIStudioAccountUniqueness() error = %v, want one-account-one-IP rejection", err)
	}
}

func TestImportAIStudioAccountForwardsStorageStateWithoutPersistingIt(t *testing.T) {
	var importCalls int
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		username, password, ok := request.BasicAuth()
		if !ok || username != "admin" || password != "secret" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch request.URL.Path {
		case "/api/accounts":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, `{"ok":true,"accounts":[],"proxy_pool":[]}`)
		case "/api/import":
			importCalls++
			if err := request.ParseMultipartForm(3 * 1024 * 1024); err != nil {
				t.Errorf("ParseMultipartForm() error = %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			if got := request.FormValue("name"); got != "account-a" {
				t.Errorf("name = %q, want account-a", got)
			}
			if got := request.FormValue("proxy"); got != "198.51.100.20:8080:user:password" {
				t.Errorf("proxy = %q", got)
			}
			file, _, err := request.FormFile("file")
			if err != nil {
				t.Errorf("FormFile() error = %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			defer file.Close()
			body, err := io.ReadAll(file)
			if err != nil {
				t.Errorf("ReadAll() error = %v", err)
			}
			if string(body) != `{"cookies":[{"name":"SID","value":"sensitive"}],"origins":[]}` {
				t.Errorf("storageState = %s", body)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, `{"ok":true,"file":"auth-6.json","name":"account-a","proxy":"198.51.100.20:8080:user:password"}`)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	previousClient := aiStudioImporterHTTPClient
	previousOnboardingClient := aiStudioOnboardingHTTPClient
	aiStudioImporterHTTPClient = server.Client()
	aiStudioOnboardingHTTPClient = server.Client()
	defer func() {
		aiStudioImporterHTTPClient = previousClient
		aiStudioOnboardingHTTPClient = previousOnboardingClient
	}()
	t.Setenv("TEST_AISTUDIO_IMPORTER_PASSWORD", "secret")

	result, err := ImportAIStudioAccount(context.Background(), dto.ChannelSettings{
		AIStudioImporterURL:         server.URL,
		AIStudioImporterUsername:    "admin",
		AIStudioImporterPasswordEnv: "TEST_AISTUDIO_IMPORTER_PASSWORD",
	}, AIStudioAccountImport{
		Name:         "account-a",
		Proxy:        "198.51.100.20:8080:user:password",
		Note:         "Tokyo",
		StorageState: []byte(`{"cookies":[{"name":"SID","value":"sensitive"}],"origins":[]}`),
	})
	if err != nil {
		t.Fatalf("ImportAIStudioAccount() error = %v", err)
	}
	if importCalls != 1 {
		t.Fatalf("import calls = %d, want 1", importCalls)
	}
	if result.File != "auth-6.json" {
		t.Fatalf("result.File = %q", result.File)
	}
	if strings.Contains(result.Proxy, "password") || !strings.Contains(result.Proxy, "***") {
		t.Fatalf("result.Proxy = %q, want redacted credentials", result.Proxy)
	}
}

func TestOnboardAIStudioAccountForwardsOneTimeCredentials(t *testing.T) {
	var onboardCalls int
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		username, password, ok := request.BasicAuth()
		if !ok || username != "admin" || password != "secret" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch request.URL.Path {
		case "/api/accounts":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, `{"ok":true,"accounts":[],"proxy_pool":[]}`)
		case "/api/onboard":
			onboardCalls++
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Errorf("ReadAll() error = %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			var payload map[string]string
			if err := common.Unmarshal(body, &payload); err != nil {
				t.Errorf("Unmarshal() error = %v", err)
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			if payload["email"] != "owner@example.com" || payload["password"] != "google-password" {
				t.Errorf("credentials were not forwarded exactly")
			}
			if payload["totp_secret"] != "JBSWY3DPEHPK3PXP" {
				t.Errorf("totp_secret = %q", payload["totp_secret"])
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(writer, `{"ok":true,"file":"auth-7.json","name":"account-b","proxy":"198.51.100.21:8080:user:password","runtime_validation":"pending"}`)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	previousClient := aiStudioImporterHTTPClient
	previousOnboardingClient := aiStudioOnboardingHTTPClient
	aiStudioImporterHTTPClient = server.Client()
	aiStudioOnboardingHTTPClient = server.Client()
	defer func() {
		aiStudioImporterHTTPClient = previousClient
		aiStudioOnboardingHTTPClient = previousOnboardingClient
	}()
	t.Setenv("TEST_AISTUDIO_IMPORTER_PASSWORD", "secret")

	result, err := OnboardAIStudioAccount(context.Background(), dto.ChannelSettings{
		AIStudioImporterURL:         server.URL,
		AIStudioImporterUsername:    "admin",
		AIStudioImporterPasswordEnv: "TEST_AISTUDIO_IMPORTER_PASSWORD",
	}, AIStudioAccountOnboarding{
		Name:          "account-b",
		Email:         "owner@example.com",
		Password:      "google-password",
		RecoveryEmail: "recovery@example.com",
		TOTPSecret:    "JBSWY3DPEHPK3PXP",
		Proxy:         "198.51.100.21:8080:user:password",
		Note:          "Tokyo",
	})
	if err != nil {
		t.Fatalf("OnboardAIStudioAccount() error = %v", err)
	}
	if onboardCalls != 1 {
		t.Fatalf("onboard calls = %d, want 1", onboardCalls)
	}
	if result.RuntimeValidation != "pending" {
		t.Fatalf("RuntimeValidation = %q", result.RuntimeValidation)
	}
	if strings.Contains(result.Proxy, "password") {
		t.Fatalf("result proxy contains a credential")
	}
}

func TestRedactAIStudioProxy(t *testing.T) {
	tests := map[string]string{
		"198.51.100.1:8080:user:password":                   "198.51.100.1:8080:user:***",
		"user:password@proxy.example.com:1080":              "user:***@proxy.example.com:1080",
		"socks5://user:password@proxy.example.com:1080":     "socks5://user:%2A%2A%2A@proxy.example.com:1080",
		"https://user:password@proxy.example.com:8443/path": "https://user:%2A%2A%2A@proxy.example.com:8443/path",
	}
	for input, expected := range tests {
		if got := redactAIStudioProxy(input); got != expected {
			t.Errorf("redactAIStudioProxy(%q) = %q, want %q", input, got, expected)
		}
	}
}
