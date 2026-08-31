package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

type VertexCredentialImportResult struct {
	AccountCount  int
	AddedCount    int
	ReplacedCount int
	Keys          []string
}

type VertexServiceAccountMetadata struct {
	ProjectID   string
	ClientEmail string
}

type vertexServiceAccountCredential struct {
	Type        string `json:"type"`
	ProjectID   string `json:"project_id"`
	PrivateKey  string `json:"private_key"`
	ClientEmail string `json:"client_email"`
}

type normalizedVertexCredential struct {
	Raw      string
	Identity string
}

func normalizeVertexKeyType(keyType dto.VertexKeyType) (dto.VertexKeyType, error) {
	switch keyType {
	case "", dto.VertexKeyTypeJSON:
		return dto.VertexKeyTypeJSON, nil
	case dto.VertexKeyTypeAPIKey:
		return dto.VertexKeyTypeAPIKey, nil
	default:
		return "", fmt.Errorf("vertex channel: unsupported credential type %q", keyType)
	}
}

func ParseVertexServiceAccountMetadata(raw string) (VertexServiceAccountMetadata, error) {
	credential := vertexServiceAccountCredential{}
	if err := common.Unmarshal([]byte(strings.TrimSpace(raw)), &credential); err != nil {
		return VertexServiceAccountMetadata{}, fmt.Errorf("invalid service account JSON: %w", err)
	}
	if credential.Type != "" && credential.Type != "service_account" {
		return VertexServiceAccountMetadata{}, fmt.Errorf("type must be service_account, got %q", credential.Type)
	}
	credential.ProjectID = strings.TrimSpace(credential.ProjectID)
	credential.ClientEmail = strings.TrimSpace(credential.ClientEmail)
	credential.PrivateKey = strings.TrimSpace(credential.PrivateKey)
	if credential.ProjectID == "" {
		return VertexServiceAccountMetadata{}, errors.New("project_id is required")
	}
	if credential.ClientEmail == "" {
		return VertexServiceAccountMetadata{}, errors.New("client_email is required")
	}
	if credential.PrivateKey == "" {
		return VertexServiceAccountMetadata{}, errors.New("private_key is required")
	}
	return VertexServiceAccountMetadata{
		ProjectID:   credential.ProjectID,
		ClientEmail: credential.ClientEmail,
	}, nil
}

func normalizeVertexCredentialBatch(keyType dto.VertexKeyType, rawCredentials []string) ([]normalizedVertexCredential, error) {
	normalizedType, err := normalizeVertexKeyType(keyType)
	if err != nil {
		return nil, err
	}
	if len(rawCredentials) == 0 {
		return nil, errors.New("vertex channel: at least one credential is required")
	}

	credentials := make([]normalizedVertexCredential, 0, len(rawCredentials))
	seen := make(map[string]struct{})
	appendCredential := func(credential normalizedVertexCredential) error {
		if _, exists := seen[credential.Identity]; exists {
			return errors.New("vertex channel: duplicate account in import batch")
		}
		seen[credential.Identity] = struct{}{}
		credentials = append(credentials, credential)
		return nil
	}

	for credentialIndex, rawCredential := range rawCredentials {
		raw := strings.TrimSpace(rawCredential)
		if raw == "" {
			return nil, fmt.Errorf("vertex channel: credential %d is empty", credentialIndex+1)
		}
		if normalizedType == dto.VertexKeyTypeAPIKey {
			for _, line := range strings.Split(raw, "\n") {
				apiKey := strings.TrimSpace(line)
				if apiKey == "" {
					continue
				}
				if err := appendCredential(normalizedVertexCredential{
					Raw:      apiKey,
					Identity: "api_key:" + apiKey,
				}); err != nil {
					return nil, err
				}
			}
			continue
		}

		rawMessages := make([]json.RawMessage, 0, 1)
		if strings.HasPrefix(raw, "[") {
			if err := common.Unmarshal([]byte(raw), &rawMessages); err != nil {
				return nil, fmt.Errorf("vertex channel: credential %d must be a valid JSON array: %w", credentialIndex+1, err)
			}
		} else {
			rawMessages = append(rawMessages, json.RawMessage(raw))
		}
		if len(rawMessages) == 0 {
			return nil, fmt.Errorf("vertex channel: credential %d JSON array is empty", credentialIndex+1)
		}
		for accountIndex, rawMessage := range rawMessages {
			metadata, err := ParseVertexServiceAccountMetadata(string(rawMessage))
			if err != nil {
				return nil, fmt.Errorf("vertex channel: credential %d account %d: %w", credentialIndex+1, accountIndex+1, err)
			}
			var value map[string]interface{}
			if err := common.Unmarshal(rawMessage, &value); err != nil {
				return nil, fmt.Errorf("vertex channel: credential %d account %d: %w", credentialIndex+1, accountIndex+1, err)
			}
			encoded, err := common.Marshal(value)
			if err != nil {
				return nil, fmt.Errorf("vertex channel: credential %d account %d: encode JSON: %w", credentialIndex+1, accountIndex+1, err)
			}
			if err := appendCredential(normalizedVertexCredential{
				Raw:      string(encoded),
				Identity: "service_account:" + metadata.ProjectID + ":" + metadata.ClientEmail,
			}); err != nil {
				return nil, err
			}
		}
	}
	if len(credentials) == 0 {
		return nil, errors.New("vertex channel: at least one credential is required")
	}
	return credentials, nil
}

func NormalizeVertexCredentialImports(keyType dto.VertexKeyType, rawCredentials []string) (VertexCredentialImportResult, error) {
	normalized, err := normalizeVertexCredentialBatch(keyType, rawCredentials)
	if err != nil {
		return VertexCredentialImportResult{}, err
	}
	result := VertexCredentialImportResult{
		AccountCount: len(normalized),
		AddedCount:   len(normalized),
		Keys:         make([]string, 0, len(normalized)),
	}
	for _, credential := range normalized {
		result.Keys = append(result.Keys, credential.Raw)
	}
	return result, nil
}

func ImportVertexChannelCredentials(channelID int, rawCredentials []string) (VertexCredentialImportResult, error) {
	lock := model.GetChannelPollingLock(channelID)
	lock.Lock()
	defer lock.Unlock()

	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return VertexCredentialImportResult{}, err
	}
	if channel == nil {
		return VertexCredentialImportResult{}, errors.New("channel not found")
	}
	if channel.Type != constant.ChannelTypeVertexAi {
		return VertexCredentialImportResult{}, errors.New("channel type is not Vertex AI")
	}
	keyType, err := normalizeVertexKeyType(channel.GetOtherSettings().VertexKeyType)
	if err != nil {
		return VertexCredentialImportResult{}, err
	}
	incoming, err := normalizeVertexCredentialBatch(keyType, rawCredentials)
	if err != nil {
		return VertexCredentialImportResult{}, err
	}

	keys := channel.GetKeys()
	indexByIdentity := make(map[string]int, len(keys))
	for index, rawKey := range keys {
		identity, identityErr := vertexCredentialIdentity(keyType, rawKey)
		if identityErr != nil {
			return VertexCredentialImportResult{}, fmt.Errorf("vertex channel: existing credential %d: %w", index+1, identityErr)
		}
		indexByIdentity[identity] = index
	}

	result := VertexCredentialImportResult{Keys: make([]string, 0, len(incoming))}
	for _, credential := range incoming {
		result.Keys = append(result.Keys, credential.Raw)
		if index, exists := indexByIdentity[credential.Identity]; exists {
			keys[index] = credential.Raw
			result.ReplacedCount++
			continue
		}
		indexByIdentity[credential.Identity] = len(keys)
		keys = append(keys, credential.Raw)
		result.AddedCount++
	}

	// A Vertex account-session channel remains a multi-account management
	// container even while it has zero or one credential. AccountSessions lists
	// channels by this persisted capability flag; deriving it from the current
	// credential count would make the channel disappear immediately after the
	// first import.
	channel.ChannelInfo.IsMultiKey = true
	channel.ChannelInfo.MultiKeySize = len(keys)
	if channel.ChannelInfo.MultiKeyMode == "" {
		channel.ChannelInfo.MultiKeyMode = constant.MultiKeyModeRandom
	}
	updates := map[string]interface{}{
		"key":          strings.Join(keys, "\n"),
		"channel_info": channel.ChannelInfo,
	}
	if err := model.DB.Model(&model.Channel{}).Where("id = ?", channelID).Updates(updates).Error; err != nil {
		return VertexCredentialImportResult{}, err
	}
	result.AccountCount = len(keys)
	return result, nil
}

func vertexCredentialIdentity(keyType dto.VertexKeyType, raw string) (string, error) {
	if keyType == dto.VertexKeyTypeAPIKey {
		apiKey := strings.TrimSpace(raw)
		if apiKey == "" {
			return "", errors.New("API key is empty")
		}
		return "api_key:" + apiKey, nil
	}
	metadata, err := ParseVertexServiceAccountMetadata(raw)
	if err != nil {
		return "", err
	}
	return "service_account:" + metadata.ProjectID + ":" + metadata.ClientEmail, nil
}
