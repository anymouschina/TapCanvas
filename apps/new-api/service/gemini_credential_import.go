package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/geminiauth"
)

const geminiAntigravityRefreshTokenPrefix = "1//"

type geminiAntigravityRefreshTokenImport struct {
	Type         string `json:"type"`
	Provider     string `json:"provider"`
	OAuthType    string `json:"oauth_type"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	Email        string `json:"email"`
	ProjectID    string `json:"project_id"`
	TierID       string `json:"tier_id"`
}

func resolveGeminiRefreshTokenCredential(ctx context.Context, raw string, proxyURL string) ([]geminiauth.OAuthKey, bool, error) {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, geminiAntigravityRefreshTokenPrefix) {
		key, err := hydrateGeminiAntigravityCredential(ctx, geminiAntigravityRefreshTokenImport{
			Type:         "antigravity",
			RefreshToken: trimmed,
		}, proxyURL)
		if err != nil {
			return nil, true, err
		}
		return []geminiauth.OAuthKey{*key}, true, nil
	}
	if !strings.HasPrefix(trimmed, "{") {
		return nil, false, nil
	}
	var candidate geminiAntigravityRefreshTokenImport
	if err := common.Unmarshal([]byte(trimmed), &candidate); err != nil {
		return nil, false, nil
	}
	if !isAntigravityCredentialType(candidate) {
		return nil, false, nil
	}
	if strings.TrimSpace(candidate.RefreshToken) == "" {
		return nil, true, errors.New("Gemini Antigravity credential is missing refresh_token")
	}
	if strings.TrimSpace(candidate.AccessToken) != "" && strings.TrimSpace(candidate.ProjectID) != "" {
		return nil, false, nil
	}
	key, err := hydrateGeminiAntigravityCredential(ctx, candidate, proxyURL)
	if err != nil {
		return nil, true, err
	}
	return []geminiauth.OAuthKey{*key}, true, nil
}

func isAntigravityCredentialType(candidate geminiAntigravityRefreshTokenImport) bool {
	for _, value := range []string{candidate.Type, candidate.Provider, candidate.OAuthType} {
		if strings.EqualFold(strings.TrimSpace(value), "antigravity") {
			return true
		}
	}
	return false
}

func hydrateGeminiAntigravityCredential(ctx context.Context, candidate geminiAntigravityRefreshTokenImport, proxyURL string) (*geminiauth.OAuthKey, error) {
	refreshToken := strings.TrimSpace(candidate.RefreshToken)
	if refreshToken == "" {
		return nil, errors.New("Gemini Antigravity credential is missing refresh_token")
	}
	result, err := RefreshGeminiOAuthToken(ctx, refreshToken, "antigravity", proxyURL)
	if err != nil {
		return nil, fmt.Errorf("refresh Gemini Antigravity credential: %w", err)
	}
	if strings.TrimSpace(result.RefreshToken) != "" {
		refreshToken = strings.TrimSpace(result.RefreshToken)
	}
	profile, profileErr := FetchGeminiOAuthProfile(ctx, result.AccessToken, proxyURL)
	email := ""
	accountID := ""
	if profileErr != nil {
		common.SysLog(fmt.Sprintf("Gemini Antigravity userinfo unavailable after successful token refresh: %v", profileErr))
	} else if profile != nil {
		email = strings.TrimSpace(profile.Email)
		accountID = strings.TrimSpace(profile.Subject)
	}
	declaredEmail := strings.TrimSpace(candidate.Email)
	if declaredEmail != "" && email == "" {
		return nil, errors.New("Gemini Antigravity account email cannot be verified because userinfo is unavailable")
	}
	if declaredEmail != "" && !strings.EqualFold(declaredEmail, email) {
		return nil, fmt.Errorf("Gemini Antigravity account email mismatch: declared=%s authenticated=%s", declaredEmail, email)
	}
	projectID, err := FetchGeminiAntigravityProjectID(ctx, result.AccessToken, proxyURL)
	if err != nil {
		return nil, fmt.Errorf("discover Gemini Antigravity project_id: %w", err)
	}
	declaredProjectID := strings.TrimSpace(candidate.ProjectID)
	if declaredProjectID != "" && declaredProjectID != projectID {
		return nil, fmt.Errorf("Gemini Antigravity project_id mismatch: declared=%s authenticated=%s", declaredProjectID, projectID)
	}
	if projectID == "" {
		return nil, errors.New("Gemini Antigravity project discovery returned empty project_id")
	}
	key := &geminiauth.OAuthKey{
		AccessToken:  strings.TrimSpace(result.AccessToken),
		RefreshToken: refreshToken,
		TokenType:    strings.TrimSpace(result.TokenType),
		Scope:        strings.TrimSpace(result.Scope),
		ProjectID:    projectID,
		OAuthType:    "antigravity",
		TierID:       strings.TrimSpace(candidate.TierID),
		Email:        email,
		AccountID:    accountID,
		LastRefresh:  time.Now().UTC().Format(time.RFC3339),
	}
	if !result.ExpiresAt.IsZero() {
		key.Expired = result.ExpiresAt.UTC().Format(time.RFC3339)
		key.ExpiresAt = geminiauth.UnixTimestamp(result.ExpiresAt.Unix())
	}
	return key, nil
}
