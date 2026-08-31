package controller

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

func getLineSeparatedKeys(rawKeys string) ([]string, error) {
	seen := make(map[string]struct{})
	keys := make([]string, 0)
	for _, rawKey := range strings.Split(rawKeys, "\n") {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("批量添加的密钥不能为空")
	}
	return keys, nil
}

func getVertexArrayKeys(rawKeys string) ([]string, error) {
	if strings.TrimSpace(rawKeys) == "" {
		return nil, fmt.Errorf("批量添加 Vertex AI 的 keys 不能为空")
	}
	var keyArray []interface{}
	if err := common.Unmarshal([]byte(rawKeys), &keyArray); err != nil {
		return nil, fmt.Errorf("批量添加 Vertex AI 必须使用标准的JsonArray格式，例如[{key1}, {key2}...]，请检查输入: %w", err)
	}

	seen := make(map[string]struct{})
	cleanKeys := make([]string, 0, len(keyArray))
	for _, key := range keyArray {
		var keyString string
		switch value := key.(type) {
		case string:
			keyString = strings.TrimSpace(value)
		default:
			encoded, err := common.Marshal(value)
			if err != nil {
				return nil, fmt.Errorf("Vertex AI key JSON 编码失败: %w", err)
			}
			keyString = string(encoded)
		}
		if keyString == "" {
			continue
		}
		if _, exists := seen[keyString]; exists {
			continue
		}
		seen[keyString] = struct{}{}
		cleanKeys = append(cleanKeys, keyString)
	}
	if len(cleanKeys) == 0 {
		return nil, fmt.Errorf("批量添加 Vertex AI 的 keys 不能为空")
	}
	return cleanKeys, nil
}

func mergeUniqueKeys(existingKeys []string, newKeys []string) []string {
	seen := make(map[string]struct{}, len(existingKeys)+len(newKeys))
	mergedKeys := make([]string, 0, len(existingKeys)+len(newKeys))
	appendUnique := func(rawKey string) {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			return
		}
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		mergedKeys = append(mergedKeys, key)
	}

	for _, key := range existingKeys {
		appendUnique(key)
	}
	for _, key := range newKeys {
		appendUnique(key)
	}

	return mergedKeys
}
