package claude

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/claudeauth"
)

type ClaudeOAuthKey = claudeauth.OAuthKey

func NormalizeClaudeOAuthCredentials(raw string) ([]ClaudeOAuthKey, error) {
	return claudeauth.NormalizeCredentials(raw)
}

func IsClaudeOAuthKey(raw string) bool {
	return strings.HasPrefix(strings.TrimSpace(raw), "{")
}

func ParseClaudeOAuthKey(raw string) (*ClaudeOAuthKey, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("claude channel: empty oauth key")
	}
	if !strings.HasPrefix(trimmed, "{") {
		return nil, errors.New("claude channel: key is not oauth json")
	}
	var key ClaudeOAuthKey
	if err := common.Unmarshal([]byte(trimmed), &key); err != nil {
		return nil, errors.New("claude channel: invalid oauth key json")
	}
	return &key, nil
}
