package claudeauth

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type OAuthKey struct {
	AccessToken  string `json:"access_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Expired      string `json:"expired,omitempty"`
	LastRefresh  string `json:"last_refresh,omitempty"`
	Email        string `json:"email,omitempty"`
	AccountID    string `json:"account_id,omitempty"`
}

type sub2APIExport struct {
	ExportedAt string                 `json:"exported_at"`
	Accounts   []sub2APIExportAccount `json:"accounts"`
}

type sub2APIExportAccount struct {
	Platform    string                   `json:"platform"`
	Type        string                   `json:"type"`
	Credentials sub2APIExportCredentials `json:"credentials"`
}

type sub2APIExportCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
	EmailAddress string `json:"email_address"`
	AccountUUID  string `json:"account_uuid"`
}

func NormalizeCredentials(raw string) ([]OAuthKey, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("claude channel: empty credential json")
	}
	var object map[string]json.RawMessage
	if err := common.Unmarshal([]byte(trimmed), &object); err != nil {
		return nil, errors.New("claude channel: invalid credential json")
	}
	if _, isExport := object["accounts"]; isExport {
		return normalizeSub2APIExport(trimmed)
	}
	var key OAuthKey
	if err := common.Unmarshal([]byte(trimmed), &key); err != nil {
		return nil, errors.New("claude channel: invalid oauth key json")
	}
	if err := validateImportedKey(key); err != nil {
		return nil, err
	}
	return []OAuthKey{key}, nil
}

func normalizeSub2APIExport(raw string) ([]OAuthKey, error) {
	var exported sub2APIExport
	if err := common.Unmarshal([]byte(raw), &exported); err != nil {
		return nil, errors.New("claude channel: invalid sub2api account export")
	}
	if len(exported.Accounts) == 0 {
		return nil, errors.New("claude channel: sub2api export contains no accounts")
	}
	lastRefresh := strings.TrimSpace(exported.ExportedAt)
	if lastRefresh != "" {
		parsed, err := time.Parse(time.RFC3339, lastRefresh)
		if err != nil {
			return nil, errors.New("claude channel: sub2api exported_at must be RFC3339")
		}
		lastRefresh = parsed.UTC().Format(time.RFC3339)
	}
	keys := make([]OAuthKey, 0, len(exported.Accounts))
	seenAccounts := make(map[string]struct{}, len(exported.Accounts))
	for index, account := range exported.Accounts {
		if strings.TrimSpace(account.Platform) != "anthropic" || strings.TrimSpace(account.Type) != "oauth" {
			return nil, fmt.Errorf("claude channel: account %d is not an anthropic oauth account", index+1)
		}
		credential := account.Credentials
		key := OAuthKey{
			AccessToken: strings.TrimSpace(credential.AccessToken), RefreshToken: strings.TrimSpace(credential.RefreshToken),
			LastRefresh: lastRefresh, Email: strings.TrimSpace(credential.EmailAddress), AccountID: strings.TrimSpace(credential.AccountUUID),
		}
		if credential.ExpiresAt > 0 {
			key.Expired = time.Unix(credential.ExpiresAt, 0).UTC().Format(time.RFC3339)
		}
		if err := validateImportedKey(key); err != nil {
			return nil, fmt.Errorf("claude channel: account %d: %w", index+1, err)
		}
		if _, exists := seenAccounts[key.AccountID]; exists {
			return nil, fmt.Errorf("claude channel: duplicate account_id in import at account %d", index+1)
		}
		seenAccounts[key.AccountID] = struct{}{}
		keys = append(keys, key)
	}
	return keys, nil
}

func validateImportedKey(key OAuthKey) error {
	if strings.TrimSpace(key.AccessToken) == "" {
		return errors.New("access_token is required")
	}
	if strings.TrimSpace(key.RefreshToken) == "" {
		return errors.New("refresh_token is required")
	}
	if strings.TrimSpace(key.AccountID) == "" {
		return errors.New("account_id is required")
	}
	if key.Expired != "" {
		if _, err := time.Parse(time.RFC3339, key.Expired); err != nil {
			return errors.New("expired must be RFC3339")
		}
	}
	return nil
}
