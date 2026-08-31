package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	defaultGeminiOAuthAuthorizeURL           = "https://accounts.google.com/o/oauth2/v2/auth"
	defaultGeminiOAuthTokenURL               = "https://oauth2.googleapis.com/token"
	defaultGeminiOAuthAIStudioRedirectURI    = "http://localhost:1455/auth/callback"
	defaultGeminiOAuthCodeAssistRedirectURI  = "https://codeassist.google.com/authcode"
	defaultGeminiOAuthAntigravityRedirectURI = "http://localhost:51121/oauth-callback"
	defaultGeminiOAuthUserInfoURL            = "https://www.googleapis.com/oauth2/v3/userinfo"
	geminiOAuthAuthorizeURLEnv               = "GEMINI_OAUTH_AUTHORIZE_URL"
	geminiOAuthTokenURLEnv                   = "GEMINI_OAUTH_TOKEN_URL"
	geminiOAuthAIStudioRedirectURIEnv        = "GEMINI_OAUTH_AI_STUDIO_REDIRECT_URI"
	geminiOAuthCodeAssistRedirectURIEnv      = "GEMINI_OAUTH_CODE_ASSIST_REDIRECT_URI"
	geminiOAuthUserInfoURLEnv                = "GEMINI_OAUTH_USERINFO_URL"
	geminiOAuthClientIDEnv                   = "GEMINI_OAUTH_CLIENT_ID"
	geminiOAuthClientSecretEnv               = "GEMINI_OAUTH_CLIENT_SECRET"
	geminiCodeAssistClientIDEnv              = "GEMINI_CODE_ASSIST_OAUTH_CLIENT_ID"
	geminiCodeAssistClientSecretEnv          = "GEMINI_CODE_ASSIST_OAUTH_CLIENT_SECRET"
	geminiAIStudioClientIDEnv                = "GEMINI_AI_STUDIO_OAUTH_CLIENT_ID"
	geminiAIStudioClientSecretEnv            = "GEMINI_AI_STUDIO_OAUTH_CLIENT_SECRET"
	geminiOAuthScopeAIStudio                 = "openid https://www.googleapis.com/auth/generative-language.retriever https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
	geminiOAuthScopeCodeAssist               = "openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
	geminiOAuthScopeAntigravity              = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs"
	geminiAntigravityClientIDEnv             = "GEMINI_ANTIGRAVITY_OAUTH_CLIENT_ID"
	geminiAntigravityClientSecretEnv         = "GEMINI_ANTIGRAVITY_OAUTH_CLIENT_SECRET"
	geminiAntigravityUserAgent               = "antigravity/hub/2.2.1 darwin/arm64"
)

func geminiOAuthAuthorizeEndpoint() string {
	return strings.TrimRight(
		common.GetEnvOrDefaultString(geminiOAuthAuthorizeURLEnv, defaultGeminiOAuthAuthorizeURL),
		"/",
	)
}

func geminiOAuthTokenEndpoint() string {
	return strings.TrimRight(
		common.GetEnvOrDefaultString(geminiOAuthTokenURLEnv, defaultGeminiOAuthTokenURL),
		"/",
	)
}

func geminiOAuthAIStudioRedirectURI() string {
	return common.GetEnvOrDefaultString(
		geminiOAuthAIStudioRedirectURIEnv,
		defaultGeminiOAuthAIStudioRedirectURI,
	)
}

func geminiOAuthCodeAssistRedirectURI() string {
	return common.GetEnvOrDefaultString(
		geminiOAuthCodeAssistRedirectURIEnv,
		defaultGeminiOAuthCodeAssistRedirectURI,
	)
}

func geminiOAuthUserInfoEndpoint() string {
	return strings.TrimRight(
		common.GetEnvOrDefaultString(geminiOAuthUserInfoURLEnv, defaultGeminiOAuthUserInfoURL),
		"/",
	)
}

type GeminiOAuthAuthorizationOptions struct {
	OAuthType string
	ProjectID string
	TierID    string
}

type GeminiOAuthAuthorizationFlow struct {
	State        string
	Verifier     string
	Challenge    string
	AuthorizeURL string
	OAuthType    string
	ProjectID    string
	TierID       string
}

type GeminiOAuthTokenResult struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	Scope        string
	IDToken      string
	ExpiresAt    time.Time
}

type geminiOAuthClientConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	Scope        string
}

type geminiOAuthTokenPayload struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	IDToken      string `json:"id_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

type GeminiOAuthProfile struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
}

// GeminiOAuthClientConfigured reports whether the selected Gemini OAuth flow
// has a complete client configuration. Secrets are read only from the
// process environment and are never persisted in channel credentials.
func GeminiOAuthClientConfigured(oauthType string) bool {
	_, err := geminiOAuthClient(oauthType)
	return err == nil
}

func CreateGeminiOAuthAuthorizationFlow(options GeminiOAuthAuthorizationOptions) (*GeminiOAuthAuthorizationFlow, error) {
	oauthType, err := normalizeGeminiOAuthType(options.OAuthType)
	if err != nil {
		return nil, err
	}
	if oauthType == "antigravity" {
		return nil, errors.New("Gemini Antigravity OAuth requires refresh-token import")
	}
	client, err := geminiOAuthClient(oauthType)
	if err != nil {
		return nil, err
	}
	if (oauthType == "code_assist" || oauthType == "google_one") && strings.TrimSpace(options.ProjectID) == "" {
		return nil, errors.New("Gemini Code Assist OAuth requires project_id")
	}

	state, err := createStateHex(16)
	if err != nil {
		return nil, err
	}
	verifier, challenge, err := generatePKCEPair()
	if err != nil {
		return nil, err
	}
	authorizeURL, err := buildGeminiAuthorizeURL(client, state, challenge)
	if err != nil {
		return nil, err
	}

	return &GeminiOAuthAuthorizationFlow{
		State: state, Verifier: verifier, Challenge: challenge,
		AuthorizeURL: authorizeURL, OAuthType: oauthType,
		ProjectID: strings.TrimSpace(options.ProjectID), TierID: strings.TrimSpace(options.TierID),
	}, nil
}

func ExchangeGeminiAuthorizationCode(ctx context.Context, code string, verifier string, oauthType string, proxyURL string) (*GeminiOAuthTokenResult, error) {
	clientConfig, err := geminiOAuthClient(oauthType)
	if err != nil {
		return nil, err
	}
	client, err := getGeminiOAuthHTTPClient(proxyURL)
	if err != nil {
		return nil, err
	}
	return exchangeGeminiAuthorizationCode(ctx, client, clientConfig, code, verifier)
}

func RefreshGeminiOAuthToken(ctx context.Context, refreshToken string, oauthType string, proxyURL string) (*GeminiOAuthTokenResult, error) {
	clientConfig, err := geminiOAuthClient(oauthType)
	if err != nil {
		return nil, err
	}
	client, err := getGeminiOAuthHTTPClient(proxyURL)
	if err != nil {
		return nil, err
	}
	return refreshGeminiOAuthToken(ctx, client, clientConfig, refreshToken)
}

// FetchGeminiOAuthProfile is intentionally separate from token exchange. A
// valid token must not be rejected because Google's optional profile endpoint
// is unavailable, while callers can still surface its error explicitly.
func FetchGeminiOAuthProfile(ctx context.Context, accessToken string, proxyURL string) (*GeminiOAuthProfile, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, errors.New("access_token is required")
	}
	client, err := getGeminiOAuthHTTPClient(proxyURL)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, geminiOAuthUserInfoEndpoint(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("gemini oauth profile request failed: status=%d", resp.StatusCode)
	}
	var profile GeminiOAuthProfile
	if err := common.DecodeJson(resp.Body, &profile); err != nil {
		return nil, err
	}
	return &profile, nil
}

func normalizeGeminiOAuthType(value string) (string, error) {
	oauthType := strings.TrimSpace(strings.ToLower(value))
	if oauthType == "" {
		oauthType = "ai_studio"
	}
	switch oauthType {
	case "ai_studio", "code_assist", "google_one", "antigravity":
		return oauthType, nil
	default:
		return "", fmt.Errorf("unsupported Gemini OAuth type %q", value)
	}
}

func geminiOAuthClient(oauthType string) (*geminiOAuthClientConfig, error) {
	normalized, err := normalizeGeminiOAuthType(oauthType)
	if err != nil {
		return nil, err
	}
	if normalized == "antigravity" {
		clientID := strings.TrimSpace(os.Getenv(geminiAntigravityClientIDEnv))
		clientSecret := strings.TrimSpace(os.Getenv(geminiAntigravityClientSecretEnv))
		if clientID == "" || clientSecret == "" {
			return nil, fmt.Errorf(
				"Gemini %s OAuth requires %s and %s",
				normalized,
				geminiAntigravityClientIDEnv,
				geminiAntigravityClientSecretEnv,
			)
		}
		return &geminiOAuthClientConfig{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURI:  defaultGeminiOAuthAntigravityRedirectURI,
			Scope:        geminiOAuthScopeAntigravity,
		}, nil
	}
	clientIDEnv := geminiOAuthClientIDEnv
	clientSecretEnv := geminiOAuthClientSecretEnv
	if normalized == "ai_studio" {
		if value := strings.TrimSpace(os.Getenv(geminiAIStudioClientIDEnv)); value != "" {
			clientIDEnv = geminiAIStudioClientIDEnv
			clientSecretEnv = geminiAIStudioClientSecretEnv
		}
	} else if value := strings.TrimSpace(os.Getenv(geminiCodeAssistClientIDEnv)); value != "" {
		clientIDEnv = geminiCodeAssistClientIDEnv
		clientSecretEnv = geminiCodeAssistClientSecretEnv
	}
	clientID := strings.TrimSpace(os.Getenv(clientIDEnv))
	clientSecret := strings.TrimSpace(os.Getenv(clientSecretEnv))
	if clientID == "" || clientSecret == "" {
		return nil, fmt.Errorf("Gemini %s OAuth requires %s and %s", normalized, clientIDEnv, clientSecretEnv)
	}
	redirectURI := geminiOAuthAIStudioRedirectURI()
	scope := geminiOAuthScopeAIStudio
	if normalized == "code_assist" || normalized == "google_one" {
		redirectURI = geminiOAuthCodeAssistRedirectURI()
		scope = geminiOAuthScopeCodeAssist
	}
	return &geminiOAuthClientConfig{ClientID: clientID, ClientSecret: clientSecret, RedirectURI: redirectURI, Scope: scope}, nil
}

func buildGeminiAuthorizeURL(client *geminiOAuthClientConfig, state string, challenge string) (string, error) {
	u, err := url.Parse(geminiOAuthAuthorizeEndpoint())
	if err != nil {
		return "", err
	}
	query := u.Query()
	query.Set("client_id", client.ClientID)
	query.Set("redirect_uri", client.RedirectURI)
	query.Set("response_type", "code")
	query.Set("scope", client.Scope)
	query.Set("state", state)
	query.Set("code_challenge", challenge)
	query.Set("code_challenge_method", "S256")
	query.Set("access_type", "offline")
	query.Set("prompt", "consent")
	query.Set("include_granted_scopes", "true")
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func exchangeGeminiAuthorizationCode(ctx context.Context, client *http.Client, config *geminiOAuthClientConfig, code string, verifier string) (*GeminiOAuthTokenResult, error) {
	trimmedCode := strings.TrimSpace(code)
	trimmedVerifier := strings.TrimSpace(verifier)
	if trimmedCode == "" {
		return nil, errors.New("authorization code is required")
	}
	if trimmedVerifier == "" {
		return nil, errors.New("code_verifier is required")
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", config.ClientID)
	form.Set("client_secret", config.ClientSecret)
	form.Set("code", trimmedCode)
	form.Set("code_verifier", trimmedVerifier)
	form.Set("redirect_uri", config.RedirectURI)
	return postGeminiOAuthToken(ctx, client, form)
}

func refreshGeminiOAuthToken(ctx context.Context, client *http.Client, config *geminiOAuthClientConfig, refreshToken string) (*GeminiOAuthTokenResult, error) {
	trimmedRefreshToken := strings.TrimSpace(refreshToken)
	if trimmedRefreshToken == "" {
		return nil, errors.New("refresh_token is required")
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", config.ClientID)
	form.Set("client_secret", config.ClientSecret)
	form.Set("refresh_token", trimmedRefreshToken)
	return postGeminiOAuthToken(ctx, client, form)
}

func postGeminiOAuthToken(ctx context.Context, client *http.Client, form url.Values) (*GeminiOAuthTokenResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, geminiOAuthTokenEndpoint(), bytes.NewBufferString(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 500 {
			snippet = snippet[:500]
		}
		return nil, fmt.Errorf("gemini oauth token request failed: status=%d body=%s", resp.StatusCode, snippet)
	}
	var payload geminiOAuthTokenPayload
	if err := common.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if strings.TrimSpace(payload.AccessToken) == "" {
		return nil, errors.New("gemini oauth token response missing access_token")
	}
	result := &GeminiOAuthTokenResult{
		AccessToken:  strings.TrimSpace(payload.AccessToken),
		RefreshToken: strings.TrimSpace(payload.RefreshToken),
		TokenType:    strings.TrimSpace(payload.TokenType),
		Scope:        strings.TrimSpace(payload.Scope),
		IDToken:      strings.TrimSpace(payload.IDToken),
	}
	if payload.ExpiresIn > 0 {
		result.ExpiresAt = time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)
	}
	return result, nil
}

func getGeminiOAuthHTTPClient(proxyURL string) (*http.Client, error) {
	baseClient, err := GetHttpClientWithProxy(strings.TrimSpace(proxyURL))
	if err != nil {
		return nil, err
	}
	if baseClient == nil {
		return &http.Client{Timeout: defaultHTTPTimeout}, nil
	}
	clientCopy := *baseClient
	clientCopy.Timeout = defaultHTTPTimeout
	return &clientCopy, nil
}
