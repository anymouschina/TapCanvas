package controller

import (
	"errors"
	"net/mail"
	"strings"

	"github.com/QuantumNous/new-api/model"
)

// The annotation is independent from the credential and never changes its wire format.
func prepareAPIKeyEmail(request *PatchChannel, original *model.Channel) (string, []string, error) {
	if request.KeyEmail == nil || strings.TrimSpace(*request.KeyEmail) == "" {
		return "", nil, nil
	}
	email := strings.TrimSpace(*request.KeyEmail)
	address, err := mail.ParseAddress(email)
	if err != nil || address.Name != "" || address.Address != email || len(email) > 254 {
		return "", nil, errors.New("请输入有效邮箱地址")
	}
	if !original.ChannelInfo.IsMultiKey || request.KeyMode == nil || *request.KeyMode != "append" {
		return "", nil, errors.New("邮箱注释仅支持追加 API Key 到现有号池")
	}
	keys, err := getLineSeparatedKeys(request.Key)
	if err != nil {
		return "", nil, err
	}
	for _, key := range keys {
		if strings.HasPrefix(key, "{") || strings.HasPrefix(key, "[") {
			return "", nil, errors.New("邮箱注释仅支持裸 API Key，账号 JSON 使用自身邮箱字段")
		}
	}
	return email, keys, nil
}

func applyAPIKeyEmail(channel *model.Channel, submittedKeys []string, email string) {
	if email == "" {
		return
	}
	submitted := make(map[string]struct{}, len(submittedKeys))
	for _, key := range submittedKeys {
		submitted[strings.TrimSpace(key)] = struct{}{}
	}
	annotations := make(map[int]string, len(channel.ChannelInfo.MultiKeyEmail)+len(submittedKeys))
	for index, existing := range channel.ChannelInfo.MultiKeyEmail {
		annotations[index] = existing
	}
	for index, key := range channel.GetKeys() {
		if _, included := submitted[strings.TrimSpace(key)]; included && annotations[index] == "" {
			annotations[index] = email
		}
	}
	channel.ChannelInfo.MultiKeyEmail = annotations
}

func filterKeyStatuses(keys []KeyStatus, status *int, email string) []KeyStatus {
	query := strings.ToLower(strings.TrimSpace(email))
	filtered := make([]KeyStatus, 0, len(keys))
	for _, key := range keys {
		if status != nil && key.Status != *status {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(key.Email), query) {
			continue
		}
		filtered = append(filtered, key)
	}
	return filtered
}
