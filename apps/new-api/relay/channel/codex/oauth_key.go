package codex

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/codexauth"
)

type OAuthKey = codexauth.OAuthKey
type OAuthCredentialDiagnostics = codexauth.CredentialDiagnostics

// ParseOAuthKeys accepts one JSON object, a JSON array of objects, or the compact
// newline-delimited representation used by multi-key channels.
func ParseOAuthKeys(raw string) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("codex channel: empty oauth key")
	}
	if strings.HasPrefix(trimmed, "[") {
		var values []json.RawMessage
		if err := common.Unmarshal([]byte(trimmed), &values); err != nil {
			return nil, errors.New("codex channel: invalid oauth key array")
		}
		result := make([]string, 0, len(values))
		for index, value := range values {
			compact := strings.TrimSpace(string(value))
			canonical, err := normalizeOAuthJSON(compact)
			if err != nil {
				return nil, fmt.Errorf("codex channel: invalid account %d: %w", index+1, err)
			}
			result = append(result, canonical)
		}
		return result, nil
	}
	if canonical, err := normalizeOAuthJSON(trimmed); err == nil {
		return []string{canonical}, nil
	}

	lines := strings.Split(trimmed, "\n")
	result := make([]string, 0, len(lines))
	for index, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		canonical, err := normalizeOAuthJSON(line)
		if err != nil {
			return nil, fmt.Errorf("codex channel: invalid account %d: %w", index+1, err)
		}
		result = append(result, canonical)
	}
	if len(result) == 0 {
		return nil, errors.New("codex channel: no oauth accounts")
	}
	return result, nil
}

func normalizeOAuthJSON(raw string) (string, error) {
	key, _, err := NormalizeOAuthCredential(raw)
	if err != nil {
		return "", err
	}
	encoded, err := common.Marshal(key)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func compactOAuthJSON(raw string) (string, error) {
	var value map[string]interface{}
	if err := common.Unmarshal([]byte(raw), &value); err != nil {
		return "", errors.New("codex channel: invalid oauth key json")
	}
	encoded, err := common.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func ParseOAuthKey(raw string) (*OAuthKey, error) {
	key, _, err := NormalizeOAuthCredential(raw)
	return key, err
}

// NormalizeOAuthCredential converts CLIProxy top-level exports, Codex auth.json
// token envelopes, and CPA account exports into one strict relay credential.
func NormalizeOAuthCredential(raw string) (*OAuthKey, OAuthCredentialDiagnostics, error) {
	return codexauth.NormalizeCredential(raw)
}

// NormalizeCodexOAuthCredentials accepts one existing Codex credential or a
// sub2api data export containing one or more OpenAI OAuth accounts.
func NormalizeCodexOAuthCredentials(raw string) ([]OAuthKey, []OAuthCredentialDiagnostics, error) {
	return codexauth.NormalizeCredentials(raw)
}
