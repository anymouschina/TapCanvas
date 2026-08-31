package middleware

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/gin-gonic/gin"
)

func selectForcedOfficialGeminiChannel(modelName string) (*model.Channel, error) {
	channel, err := model.CacheGetUniqueChannelByNameAndType(
		constant.GoogleGeminiOfficialChannelName,
		constant.ChannelTypeGemini,
	)
	if err != nil {
		return nil, err
	}
	if err := validateForcedOfficialGeminiChannel(channel, modelName); err != nil {
		return nil, err
	}
	return channel, nil
}

func validateForcedOfficialGeminiChannel(channel *model.Channel, modelName string) error {
	if channel == nil {
		return fmt.Errorf("Google Gemini 官渠未配置")
	}
	if channel.Status != common.ChannelStatusEnabled {
		return fmt.Errorf("Google Gemini 官渠 #%d 未启用", channel.Id)
	}
	key := strings.TrimSpace(channel.Key)
	if key == "" || strings.HasPrefix(key, "PLACEHOLDER_") {
		return fmt.Errorf("Google Gemini 官渠 #%d 没有真实 API Key", channel.Id)
	}
	baseURL := strings.TrimRight(strings.TrimSpace(channel.GetBaseURL()), "/")
	if baseURL != constant.GoogleGeminiOfficialBaseURL {
		return fmt.Errorf(
			"Google Gemini 官渠 #%d 的 Base URL 必须是 %s，当前为 %s",
			channel.Id,
			constant.GoogleGeminiOfficialBaseURL,
			baseURL,
		)
	}
	if mapping := strings.TrimSpace(channel.GetModelMapping()); mapping != "" && mapping != "{}" {
		return fmt.Errorf("Google Gemini 官渠 #%d 禁止配置 model_mapping，必须原样传递模型 ID", channel.Id)
	}
	resolved, err := channel.ResolveProtocol(modelName)
	if err != nil {
		return err
	}
	if resolved.Protocol.ID != constant.ProtocolGemini {
		return fmt.Errorf("Google Gemini 官渠 #%d 必须绑定 gemini 协议", channel.Id)
	}
	if strings.TrimSpace(resolved.ChannelSetting.Proxy) != "" {
		return fmt.Errorf("Google Gemini 官渠 #%d 禁止配置渠道代理", channel.Id)
	}
	return nil
}

func markForcedOfficialGeminiRoute(c *gin.Context, channel *model.Channel) {
	common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, fmt.Sprintf("%d", channel.Id))
	common.SetContextKey(c, constant.ContextKeyForceOfficialGeminiChannel, true)
}

func shouldForceOfficialGeminiRoute(modelName string) bool {
	return model_setting.ShouldForceOfficialGeminiChannel(modelName)
}
