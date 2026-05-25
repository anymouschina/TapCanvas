package common

import "github.com/QuantumNous/new-api/constant"

func ChannelType2APIType(channelType int) (int, bool) {
	apiType := -1
	switch channelType {
	case constant.ChannelTypeOpenAI:
		apiType = constant.APITypeOpenAI
	case constant.ChannelTypeAnthropic:
		apiType = constant.APITypeAnthropic
	case constant.ChannelTypeBaidu:
		apiType = constant.APITypeBaidu
	case constant.ChannelTypePaLM:
		apiType = constant.APITypePaLM
	case constant.ChannelTypeZhipu:
		apiType = constant.APITypeZhipu
	case constant.ChannelTypeAli:
		apiType = constant.APITypeAli
	case constant.ChannelTypeXunfei:
		apiType = constant.APITypeXunfei
	case constant.ChannelTypeAIProxyLibrary:
		apiType = constant.APITypeAIProxyLibrary
	case constant.ChannelTypeTencent:
		apiType = constant.APITypeTencent
	case constant.ChannelTypeGemini:
		apiType = constant.APITypeGemini
	case constant.ChannelTypeZhipu_v4:
		apiType = constant.APITypeZhipuV4
	case constant.ChannelTypeOllama:
		apiType = constant.APITypeOllama
	case constant.ChannelTypePerplexity:
		apiType = constant.APITypePerplexity
	case constant.ChannelTypeAws:
		apiType = constant.APITypeAws
	case constant.ChannelTypeCohere:
		apiType = constant.APITypeCohere
	case constant.ChannelTypeDify:
		apiType = constant.APITypeDify
	case constant.ChannelTypeJina:
		apiType = constant.APITypeJina
	case constant.ChannelCloudflare:
		apiType = constant.APITypeCloudflare
	case constant.ChannelTypeSiliconFlow:
		apiType = constant.APITypeSiliconFlow
	case constant.ChannelTypeVertexAi:
		apiType = constant.APITypeVertexAi
	case constant.ChannelTypeMistral:
		apiType = constant.APITypeMistral
	case constant.ChannelTypeDeepSeek:
		apiType = constant.APITypeDeepSeek
	case constant.ChannelTypeMokaAI:
		apiType = constant.APITypeMokaAI
	case constant.ChannelTypeVolcEngine:
		apiType = constant.APITypeVolcEngine
	case constant.ChannelTypeBaiduV2:
		apiType = constant.APITypeBaiduV2
	case constant.ChannelTypeOpenRouter:
		apiType = constant.APITypeOpenRouter
	case constant.ChannelTypeXinference:
		apiType = constant.APITypeXinference
	case constant.ChannelTypeXai:
		apiType = constant.APITypeXai
	case constant.ChannelTypeCoze:
		apiType = constant.APITypeCoze
	case constant.ChannelTypeJimeng:
		apiType = constant.APITypeJimeng
	case constant.ChannelTypeMoonshot:
		apiType = constant.APITypeMoonshot
	case constant.ChannelTypeSubmodel:
		apiType = constant.APITypeSubmodel
	case constant.ChannelTypeMiniMax:
		apiType = constant.APITypeMiniMax
	case constant.ChannelTypeReplicate:
		apiType = constant.APITypeReplicate
	case constant.ChannelTypeCodex:
		apiType = constant.APITypeCodex
	case constant.ChannelTypeWuyinkeji:
		apiType = constant.APITypeWuyinkeji
	case constant.ChannelTypeApimart:
		apiType = constant.APITypeApimart
	case constant.ChannelTypeRightCode:
		apiType = constant.APITypeRightCode
	case constant.ChannelTypeMagic666:
		apiType = constant.APITypeMagic666
	case constant.ChannelType147AI:
		apiType = constant.APIType147AI
	case constant.ChannelTypeAmux:
		apiType = constant.APITypeAmux
	case constant.ChannelTypeCode0AI:
		apiType = constant.APITypeCode0AI
	}
	if apiType == -1 {
		return constant.APITypeOpenAI, false
	}
	return apiType, true
}
