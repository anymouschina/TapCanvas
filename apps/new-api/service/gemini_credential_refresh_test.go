package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/pkg/geminiauth"
)

func TestIsGeminiPermanentCredentialRefreshError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "invalid grant", err: errors.New("oauth token exchange failed: invalid_grant"), want: true},
		{name: "invalid client", err: errors.New("invalid_client"), want: true},
		{name: "missing refresh token", err: errors.New("Gemini channel: refresh_token is required"), want: true},
		{name: "temporary network error", err: errors.New("dial tcp: timeout"), want: false},
		{name: "nil", err: nil, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsGeminiPermanentCredentialRefreshError(test.err); got != test.want {
				t.Fatalf("IsGeminiPermanentCredentialRefreshError() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestNormalizeGeminiCredentialBatchRequiresCodeAssistProject(t *testing.T) {
	_, err := normalizeGeminiCredentialBatch(context.Background(), []string{`{"access_token":"access","refresh_token":"refresh","oauth_type":"code_assist"}`}, "")
	if err == nil {
		t.Fatal("expected Code Assist credentials without project_id to be rejected")
	}

	keys, err := normalizeGeminiCredentialBatch(context.Background(), []string{`{"access_token":"access","refresh_token":"refresh","oauth_type":"code_assist","project_id":"project-1"}`}, "")
	if err != nil {
		t.Fatalf("normalizeGeminiCredentialBatch() error = %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("normalizeGeminiCredentialBatch() returned %d keys, want 1", len(keys))
	}
}

func TestFindGeminiCredentialIndexUsesStableIdentity(t *testing.T) {
	keys := []string{
		`{"access_token":"new-a","refresh_token":"refresh-a","email":"a@example.com"}`,
		`{"access_token":"new-b","refresh_token":"refresh-b","email":"b@example.com"}`,
	}
	if got := findGeminiCredentialIndex(keys, 0, "email:b@example.com"); got != 1 {
		t.Fatalf("findGeminiCredentialIndex() = %d, want 1", got)
	}
	if got := findGeminiCredentialIndex(keys, 0, ""); got != 0 {
		t.Fatalf("findGeminiCredentialIndex() without identity = %d, want 0", got)
	}
	if got := findGeminiCredentialIndex(keys, 0, "email:missing@example.com"); got != -1 {
		t.Fatalf("findGeminiCredentialIndex() for missing identity = %d, want -1", got)
	}
}

func TestGeminiCredentialHasFreshAccessToken(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	key := &geminiauth.OAuthKey{
		AccessToken: "access",
		ExpiresAt:   geminiauth.UnixTimestamp(now.Add(3 * time.Minute).Unix()),
	}
	if !geminiCredentialHasFreshAccessToken(key, now) {
		t.Fatal("expected a token beyond the freshness buffer to be fresh")
	}
	key.ExpiresAt = geminiauth.UnixTimestamp(now.Add(2 * time.Minute).Unix())
	if geminiCredentialHasFreshAccessToken(key, now) {
		t.Fatal("expected a token at the freshness buffer to be stale")
	}
}
