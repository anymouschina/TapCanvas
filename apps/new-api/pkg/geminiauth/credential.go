package geminiauth

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// UnixTimestamp accepts both the numeric and quoted numeric expires_at forms
// used by Gemini account exports. It is marshalled as a JSON number by the
// standard encoder.
type UnixTimestamp int64

func (timestamp *UnixTimestamp) UnmarshalJSON(raw []byte) error {
	value := strings.TrimSpace(string(raw))
	if value == "" || value == "null" {
		*timestamp = 0
		return nil
	}
	if strings.HasPrefix(value, "\"") {
		unquoted, err := strconv.Unquote(value)
		if err != nil {
			return err
		}
		value = strings.TrimSpace(unquoted)
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid unix timestamp %q: %w", value, err)
	}
	*timestamp = UnixTimestamp(parsed)
	return nil
}

// OAuthKey is the canonical Gemini OAuth credential stored as one line in a
// channel's multi-key field. The shape intentionally keeps provider metadata
// alongside tokens so Code Assist accounts can retain project and tier data.
type OAuthKey struct {
	AccessToken  string        `json:"access_token,omitempty"`
	RefreshToken string        `json:"refresh_token,omitempty"`
	TokenType    string        `json:"token_type,omitempty"`
	Scope        string        `json:"scope,omitempty"`
	ProjectID    string        `json:"project_id,omitempty"`
	OAuthType    string        `json:"oauth_type,omitempty"`
	TierID       string        `json:"tier_id,omitempty"`
	Email        string        `json:"email,omitempty"`
	AccountID    string        `json:"account_id,omitempty"`
	Expired      string        `json:"expired,omitempty"`
	ExpiresAt    UnixTimestamp `json:"expires_at,omitempty"`
	LastRefresh  string        `json:"last_refresh,omitempty"`
}

type exportedAccount struct {
	Platform    string          `json:"platform"`
	Type        string          `json:"type"`
	ExpiresAt   UnixTimestamp   `json:"expires_at,omitempty"`
	Credentials json.RawMessage `json:"credentials"`
}

type accountExport struct {
	Accounts []exportedAccount `json:"accounts"`
}

// ParseOAuthKey parses one native Gemini OAuth object. Plain API keys are
// deliberately rejected so callers can keep API Key and OAuth handling
// explicit.
func ParseOAuthKey(raw string) (*OAuthKey, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("gemini channel: empty oauth key")
	}
	if !strings.HasPrefix(trimmed, "{") {
		return nil, errors.New("gemini channel: key is not oauth json")
	}
	return normalizeNativeOAuthKey(trimmed)
}

func IsOAuthKey(raw string) bool {
	_, err := ParseOAuthKey(raw)
	return err == nil
}

type cliProxyOAuthMetadata struct {
	Type      string        `json:"type"`
	Provider  string        `json:"provider"`
	Expired   string        `json:"expired"`
	ExpiresIn int64         `json:"expires_in"`
	Timestamp UnixTimestamp `json:"timestamp"`
	Email     string        `json:"email"`
	ProjectID string        `json:"project_id"`
}

func normalizeNativeOAuthKey(raw string) (*OAuthKey, error) {
	var key OAuthKey
	if err := common.Unmarshal([]byte(raw), &key); err != nil {
		return nil, errors.New("gemini channel: invalid oauth key json")
	}
	if strings.TrimSpace(key.AccessToken) == "" {
		return nil, errors.New("gemini channel: oauth key is missing access_token")
	}

	metadata := cliProxyOAuthMetadata{}
	if err := common.Unmarshal([]byte(raw), &metadata); err != nil {
		return nil, errors.New("gemini channel: invalid oauth metadata")
	}
	credentialType := strings.ToLower(strings.TrimSpace(metadata.Type))
	provider := strings.ToLower(strings.TrimSpace(metadata.Provider))
	if credentialType == "antigravity" || provider == "antigravity" {
		// CLIProxyAPI calls this Google Code Assist transport "antigravity".
		// Preserve the distinct OAuth refresh client while sharing the
		// Code Assist request transport.
		if strings.TrimSpace(key.OAuthType) == "" {
			key.OAuthType = "antigravity"
		}
		if strings.TrimSpace(key.Email) == "" {
			key.Email = strings.TrimSpace(metadata.Email)
		}
		if strings.TrimSpace(key.ProjectID) == "" {
			key.ProjectID = strings.TrimSpace(metadata.ProjectID)
		}
		if strings.TrimSpace(key.Expired) == "" {
			key.Expired = strings.TrimSpace(metadata.Expired)
		}
		if key.ExpiresAt == 0 && metadata.Timestamp > 0 && metadata.ExpiresIn > 0 {
			timestamp := int64(metadata.Timestamp)
			if timestamp >= 1_000_000_000_000 {
				timestamp /= 1000
			}
			expiresAt := time.Unix(timestamp+metadata.ExpiresIn, 0).UTC()
			key.ExpiresAt = UnixTimestamp(expiresAt.Unix())
			if strings.TrimSpace(key.Expired) == "" {
				key.Expired = expiresAt.Format(time.RFC3339)
			}
		}
	}
	return &key, nil
}

// NormalizeCredentials accepts one Gemini OAuth object, a CLIProxyAPI
// Antigravity OAuth object, or a sub2api account export containing Gemini
// OAuth accounts.
func NormalizeCredentials(raw string) ([]OAuthKey, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("gemini channel: empty credential")
	}

	var fields map[string]json.RawMessage
	if err := common.Unmarshal([]byte(trimmed), &fields); err != nil {
		return nil, errors.New("gemini channel: invalid credential json")
	}
	if _, isExport := fields["accounts"]; !isExport {
		key, err := ParseOAuthKey(trimmed)
		if err != nil {
			return nil, err
		}
		return []OAuthKey{*key}, nil
	}

	var exported accountExport
	if err := common.Unmarshal([]byte(trimmed), &exported); err != nil {
		return nil, errors.New("gemini channel: invalid account export")
	}
	if len(exported.Accounts) == 0 {
		return nil, errors.New("gemini channel: account export contains no accounts")
	}

	keys := make([]OAuthKey, 0, len(exported.Accounts))
	for index, account := range exported.Accounts {
		if strings.TrimSpace(account.Platform) != "gemini" || strings.TrimSpace(account.Type) != "oauth" {
			return nil, fmt.Errorf("gemini channel: account %d is not a Gemini OAuth account", index+1)
		}
		key, err := ParseOAuthKey(strings.TrimSpace(string(account.Credentials)))
		if err != nil {
			return nil, fmt.Errorf("gemini channel: account %d: %w", index+1, err)
		}
		if key.ExpiresAt == 0 && account.ExpiresAt > 0 {
			key.ExpiresAt = account.ExpiresAt
		}
		if strings.TrimSpace(key.Expired) == "" && key.ExpiresAt > 0 {
			key.Expired = time.Unix(int64(key.ExpiresAt), 0).UTC().Format(time.RFC3339)
		}
		keys = append(keys, *key)
	}
	return keys, nil
}

func (key OAuthKey) EffectiveOAuthType() string {
	if oauthType := strings.TrimSpace(key.OAuthType); oauthType != "" {
		return oauthType
	}
	if strings.TrimSpace(key.ProjectID) != "" {
		return "code_assist"
	}
	return "ai_studio"
}

func (key OAuthKey) IsCodeAssist() bool {
	// An explicit Code Assist type is authoritative for imported credentials;
	// project_id remains a second signal for exports that omit oauth_type.
	oauthType := strings.ToLower(strings.TrimSpace(key.EffectiveOAuthType()))
	return oauthType == "code_assist" || oauthType == "google_one" || oauthType == "antigravity" || strings.TrimSpace(key.ProjectID) != ""
}

func (key OAuthKey) Identity() string {
	if value := strings.TrimSpace(key.AccountID); value != "" {
		return "account_id:" + value
	}
	if value := strings.TrimSpace(key.Email); value != "" {
		return "email:" + strings.ToLower(value)
	}
	if value := strings.TrimSpace(key.RefreshToken); value != "" {
		return "refresh_token:" + value
	}
	return "access_token:" + strings.TrimSpace(key.AccessToken)
}

func (key OAuthKey) ExpiryTime() (time.Time, bool) {
	if expired := strings.TrimSpace(key.Expired); expired != "" {
		parsed, err := time.Parse(time.RFC3339, expired)
		if err == nil {
			return parsed, true
		}
	}
	if key.ExpiresAt > 0 {
		return time.Unix(int64(key.ExpiresAt), 0), true
	}
	return time.Time{}, false
}
