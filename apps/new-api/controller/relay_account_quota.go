package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
)

// Presentation is a copy: routing, trace, billing and logs retain the actual
// upstream rejection, while every client wire gets the same actionable text.
func accountQuotaErrorPresentation(channelType int, requestID string, err *types.NewAPIError) *types.NewAPIError {
	if err == nil || channelType != constant.ChannelTypeDroid ||
		!service.IsUpstreamAccountQuotaRejection(err) {
		return err
	}
	message := "当前账号的 Droid 额度不足，请查看账号额度与重置时间。"
	if requestID != "" {
		message = common.MessageWithRequestId(message, requestID)
	}
	return relayErrorWithMessage(err, message)
}

func relayErrorWithMessage(err *types.NewAPIError, message string) *types.NewAPIError {
	presented := *err
	presented.SetMessage(message)
	switch source := err.RelayError.(type) {
	case types.OpenAIError:
		source.Message = message
		presented.RelayError = source
	case types.ClaudeError:
		source.Message = message
		presented.RelayError = source
	}
	return &presented
}
