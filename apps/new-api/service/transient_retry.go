package service

import (
	"strings"

	"github.com/QuantumNous/new-api/types"
)

var transientUpstreamErrorMarkers = []string{
	"系统繁忙",
	"请稍后再试",
	"稍后重试",
	"try again later",
	"temporarily unavailable",
	"temporary unavailable",
	"temporarily busy",
	"server busy",
	"system busy",
	"upstream busy",
	"overloaded",
	"overload",
	"rate limit",
	"rate_limit",
}

func IsRetryableTransientUpstreamError(err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	messages := []string{
		err.Error(),
	}
	if openAIError, ok := err.RelayError.(types.OpenAIError); ok {
		messages = append(messages, openAIError.Message, openAIError.Type)
		if code, ok := openAIError.Code.(string); ok {
			messages = append(messages, code)
		}
	}
	if claudeError, ok := err.RelayError.(types.ClaudeError); ok {
		messages = append(messages, claudeError.Message, claudeError.Type)
	}
	for _, message := range messages {
		normalized := strings.ToLower(strings.TrimSpace(message))
		if normalized == "" {
			continue
		}
		for _, marker := range transientUpstreamErrorMarkers {
			if strings.Contains(normalized, strings.ToLower(marker)) {
				return true
			}
		}
	}
	return false
}
