package constant

import (
	"fmt"
	"sort"
	"strings"
)

// ProtocolTransport describes which relay engine executes an upstream wire
// protocol. It is intentionally independent from Channel.Type: a channel
// represents a commercial connection, while a protocol represents the bytes
// exchanged with that connection.
type ProtocolTransport string

const (
	ProtocolTransportRelay  ProtocolTransport = "relay"
	ProtocolTransportTask   ProtocolTransport = "task"
	ProtocolTransportNative ProtocolTransport = "native"
)

type ProtocolOptionDefinition struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Placeholder string `json:"placeholder,omitempty"`
	Required    bool   `json:"required"`
}

const (
	ProtocolOpenAI        = "openai"
	ProtocolAnthropic     = "anthropic"
	ProtocolGemini        = "gemini"
	ProtocolAzureOpenAI   = "azure-openai"
	ProtocolAWSBedrock    = "aws-bedrock"
	ProtocolVertexAI      = "vertex-ai"
	ProtocolOllama        = "ollama"
	ProtocolDashScope     = "dashscope"
	ProtocolVolcEngine    = "volcengine"
	ProtocolOpenRouter    = "openrouter"
	ProtocolJina          = "jina"
	ProtocolReplicate     = "replicate"
	ProtocolCodex         = "codex"
	ProtocolAPIMart       = "apimart"
	ProtocolRightCode     = "rightcode"
	ProtocolMagic666      = "magic666"
	ProtocolEvolink       = "evolink"
	ProtocolRunningHub    = "runninghub"
	ProtocolLingjing      = "lingjing"
	ProtocolKiro          = "kiro"
	ProtocolFlow2API      = "flow2api"
	ProtocolXinference    = "xinference"
	ProtocolDeepSeek      = "deepseek"
	ProtocolZhipuV4       = "zhipu-v4"
	ProtocolMoonshot      = "moonshot"
	ProtocolTaskSuno      = "task.suno"
	ProtocolTaskAli       = "task.aliyun"
	ProtocolTaskKling     = "task.kling"
	ProtocolTaskJimeng    = "task.jimeng"
	ProtocolTaskVertex    = "task.vertex-ai"
	ProtocolTaskVidu      = "task.vidu"
	ProtocolTaskDoubao    = "task.doubao"
	ProtocolTaskSora      = "task.openai-video"
	ProtocolTaskGemini    = "task.gemini-video"
	ProtocolTaskMiniMax   = "task.minimax"
	ProtocolTaskMiniMaxV2 = "task.minimax-v2"
	ProtocolTaskWuyinkeji = "task.wuyinkeji"
	ProtocolTaskAPIMart   = "task.apimart"
	ProtocolTaskEvolink   = "task.evolink"
	ProtocolTaskFunAI     = "task.funai"
	ProtocolTaskMegaby    = "task.megaby"
	ProtocolTaskMagic666  = "task.magic666"
	ProtocolTaskMediaKit  = "task.volc-mediakit"
	ProtocolNativeMJ      = "native.midjourney"
)

// ProtocolDefinition is the single registry entry used by runtime routing,
// model management, endpoint publication, and the console. APIType and
// TaskPlatform are implementation details and are therefore not serialized.
type ProtocolDefinition struct {
	ID                      string                     `json:"id"`
	Name                    string                     `json:"name"`
	Family                  string                     `json:"family"`
	Transport               ProtocolTransport          `json:"transport"`
	Description             string                     `json:"description"`
	EndpointTypes           []EndpointType             `json:"endpoint_types"`
	SupportsStreamOptions   bool                       `json:"supports_stream_options"`
	RecommendedChannelTypes []int                      `json:"recommended_channel_types,omitempty"`
	Options                 []ProtocolOptionDefinition `json:"options,omitempty"`
	APIType                 int                        `json:"-"`
	TaskPlatform            TaskPlatform               `json:"-"`
}

func withProtocolOptions(
	definition ProtocolDefinition,
	options ...ProtocolOptionDefinition,
) ProtocolDefinition {
	definition.Options = options
	return definition
}

func relayProtocol(
	id string,
	name string,
	family string,
	description string,
	apiType int,
	supportsStreamOptions bool,
	endpointTypes []EndpointType,
	recommendedChannelTypes ...int,
) ProtocolDefinition {
	return ProtocolDefinition{
		ID:                      id,
		Name:                    name,
		Family:                  family,
		Transport:               ProtocolTransportRelay,
		Description:             description,
		EndpointTypes:           endpointTypes,
		SupportsStreamOptions:   supportsStreamOptions,
		RecommendedChannelTypes: recommendedChannelTypes,
		APIType:                 apiType,
	}
}

func taskProtocol(
	id string,
	name string,
	family string,
	description string,
	platform TaskPlatform,
	recommendedChannelTypes ...int,
) ProtocolDefinition {
	return ProtocolDefinition{
		ID:                      id,
		Name:                    name,
		Family:                  family,
		Transport:               ProtocolTransportTask,
		Description:             description,
		EndpointTypes:           []EndpointType{EndpointTypeOpenAIVideo},
		RecommendedChannelTypes: recommendedChannelTypes,
		APIType:                 -1,
		TaskPlatform:            platform,
	}
}

func nativeProtocol(
	id string,
	name string,
	family string,
	description string,
	recommendedChannelTypes ...int,
) ProtocolDefinition {
	return ProtocolDefinition{
		ID:                      id,
		Name:                    name,
		Family:                  family,
		Transport:               ProtocolTransportNative,
		Description:             description,
		EndpointTypes:           []EndpointType{},
		RecommendedChannelTypes: recommendedChannelTypes,
		APIType:                 -1,
	}
}

var protocolDefinitions = []ProtocolDefinition{
	relayProtocol(ProtocolOpenAI, "OpenAI Compatible", "OpenAI", "OpenAI Chat Completions, Responses, Images and Embeddings compatible protocol.", APITypeOpenAI, true,
		[]EndpointType{EndpointTypeOpenAI, EndpointTypeOpenAIResponse, EndpointTypeOpenAIResponseCompact, EndpointTypeImageGeneration, EndpointTypeEmbeddings},
		ChannelTypeOpenAI, ChannelTypeCustom, ChannelTypeOpenAIMax, ChannelTypeOhMyGPT, ChannelTypeAILS, ChannelTypeAIProxy, ChannelTypeAPI2GPT, ChannelTypeAIGC2D, ChannelType360, ChannelTypeLingYiWanWu, ChannelTypeSiliconFlow, ChannelTypeDeepSeek, ChannelTypeXinference, ChannelTypeXai, ChannelTypeGaiscImage, ChannelTypeAIStudioToAPI, ChannelTypeLluban),
	withProtocolOptions(
		relayProtocol(ProtocolFlow2API, "Flow2API Image Chat", "OpenAI", "Flow2API image generation over OpenAI Chat Completions, including deterministic aspect-ratio and resolution model variants.", APITypeFlow2API, false,
			[]EndpointType{EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeGemini),
		ProtocolOptionDefinition{
			Key:         "image_variant_model",
			Label:       "Image variant model",
			Description: "Logical model prefix used to resolve aspect-ratio and resolution entries in model_mapping.",
			Placeholder: "gemini-3-pro-image",
			Required:    true,
		},
	),
	withProtocolOptions(
		relayProtocol(ProtocolAzureOpenAI, "Azure OpenAI", "OpenAI", "Azure OpenAI deployment paths and api-version semantics.", APITypeOpenAI, true,
			[]EndpointType{EndpointTypeOpenAI, EndpointTypeOpenAIResponse, EndpointTypeOpenAIResponseCompact, EndpointTypeImageGeneration, EndpointTypeEmbeddings}, ChannelTypeAzure),
		ProtocolOptionDefinition{
			Key:         "api_version",
			Label:       "API Version",
			Description: "Overrides the channel API version for this protocol binding.",
			Placeholder: AzureDefaultAPIVersion,
		},
	),
	withProtocolOptions(
		relayProtocol(ProtocolAnthropic, "Anthropic Messages", "Anthropic", "Anthropic Messages API with OpenAI request conversion.", APITypeAnthropic, true,
			[]EndpointType{EndpointTypeAnthropic, EndpointTypeOpenAI}, ChannelTypeAnthropic),
		ProtocolOptionDefinition{
			Key:         "anthropic_version",
			Label:       "Anthropic Version",
			Description: "Overrides the anthropic-version request header.",
			Placeholder: "2023-06-01",
		},
	),
	withProtocolOptions(
		relayProtocol(ProtocolGemini, "Google Gemini", "Google", "Gemini generateContent protocol with OpenAI request conversion.", APITypeGemini, true,
			[]EndpointType{EndpointTypeGemini, EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeGemini),
		ProtocolOptionDefinition{
			Key:         "api_version",
			Label:       "API Version",
			Description: "Overrides the Gemini API version for this model binding.",
			Placeholder: "v1beta",
		},
	),
	relayProtocol(ProtocolAWSBedrock, "AWS Bedrock", "AWS", "AWS Bedrock Runtime protocol.", APITypeAws, true,
		[]EndpointType{EndpointTypeAnthropic, EndpointTypeOpenAI}, ChannelTypeAws),
	withProtocolOptions(
		relayProtocol(ProtocolVertexAI, "Google Vertex AI", "Google", "Vertex AI publisher model protocol.", APITypeVertexAi, true,
			[]EndpointType{EndpointTypeGemini, EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeVertexAi),
		ProtocolOptionDefinition{
			Key:         "region",
			Label:       "Region",
			Description: "Overrides the channel region for this model binding.",
			Placeholder: "us-central1",
		},
	),
	relayProtocol(ProtocolOllama, "Ollama", "Open source", "Ollama native API adapter.", APITypeOllama, true,
		[]EndpointType{EndpointTypeOpenAI, EndpointTypeEmbeddings}, ChannelTypeOllama),
	relayProtocol(ProtocolDashScope, "Alibaba DashScope", "Alibaba", "DashScope text, image and rerank protocol.", APITypeAli, true,
		[]EndpointType{EndpointTypeOpenAI, EndpointTypeImageGeneration, EndpointTypeJinaRerank}, ChannelTypeAli),
	relayProtocol(ProtocolVolcEngine, "Volcengine Ark", "ByteDance", "Volcengine Ark protocol.", APITypeVolcEngine, true,
		[]EndpointType{EndpointTypeOpenAI, EndpointTypeOpenAIResponse, EndpointTypeImageGeneration, EndpointTypeEmbeddings}, ChannelTypeVolcEngine),
	relayProtocol(ProtocolOpenRouter, "OpenRouter", "OpenAI", "OpenRouter's OpenAI-compatible protocol and metadata headers.", APITypeOpenRouter, false,
		[]EndpointType{EndpointTypeOpenAI}, ChannelTypeOpenRouter),
	relayProtocol(ProtocolJina, "Jina AI", "Jina", "Jina embeddings and rerank protocol.", APITypeJina, false,
		[]EndpointType{EndpointTypeJinaRerank, EndpointTypeEmbeddings}, ChannelTypeJina),
	relayProtocol(ProtocolReplicate, "Replicate", "Replicate", "Replicate synchronous prediction protocol.", APITypeReplicate, false,
		[]EndpointType{EndpointTypeImageGeneration}, ChannelTypeReplicate),
	relayProtocol(ProtocolCodex, "OpenAI Codex / ChatGPT", "OpenAI", "ChatGPT backend protocol used by Codex OAuth channels.", APITypeCodex, true,
		[]EndpointType{EndpointTypeOpenAIResponse, EndpointTypeOpenAIResponseCompact}, ChannelTypeCodex),
	relayProtocol(ProtocolAPIMart, "APIMart", "APIMart", "APIMart synchronous image protocol.", APITypeApimart, true,
		[]EndpointType{EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeApimart),
	relayProtocol(ProtocolRightCode, "RightCode", "RightCode", "RightCode image and text protocol.", APITypeRightCode, true,
		[]EndpointType{EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeRightCode),
	relayProtocol(ProtocolMagic666, "Magic666", "Gemini", "Gemini-native compatible protocol used by Magic666.", APITypeMagic666, false,
		[]EndpointType{EndpointTypeGemini, EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeMagic666),
	relayProtocol(ProtocolEvolink, "Evolink", "Evolink", "Evolink unified asynchronous image protocol.", APITypeEvolink, false,
		[]EndpointType{EndpointTypeImageGeneration}, ChannelTypeEvolink),
	relayProtocol(ProtocolRunningHub, "RunningHub", "RunningHub", "RunningHub standard model image protocol.", APITypeRunningHub, false,
		[]EndpointType{EndpointTypeImageGeneration}, ChannelTypeRunningHub),
	relayProtocol(ProtocolLingjing, "Lingjing", "Lingjing", "Lingjing asynchronous image protocol.", APITypeLingjing, false,
		[]EndpointType{EndpointTypeImageGeneration}, ChannelTypeLingjing),
	relayProtocol(ProtocolKiro, "Kiro / CodeWhisperer", "AWS", "AWS CodeWhisperer event-stream protocol used by Kiro credentials.", APITypeKiro, false,
		[]EndpointType{EndpointTypeOpenAI}, ChannelTypeKiro),

	relayProtocol("palm", "Google PaLM", "Google", "Legacy PaLM protocol.", APITypePaLM, false, []EndpointType{EndpointTypeOpenAI}, ChannelTypePaLM),
	relayProtocol("baidu-wenxin", "Baidu Wenxin", "Baidu", "Baidu Wenxin legacy protocol.", APITypeBaidu, false, []EndpointType{EndpointTypeOpenAI}, ChannelTypeBaidu),
	relayProtocol("baidu-qianfan", "Baidu Qianfan", "Baidu", "Baidu Qianfan v2 protocol.", APITypeBaiduV2, true, []EndpointType{EndpointTypeOpenAI, EndpointTypeEmbeddings}, ChannelTypeBaiduV2),
	relayProtocol("zhipu", "Zhipu", "Zhipu", "Zhipu legacy protocol.", APITypeZhipu, false, []EndpointType{EndpointTypeOpenAI}, ChannelTypeZhipu),
	relayProtocol(ProtocolZhipuV4, "Zhipu v4", "Zhipu", "Zhipu OpenAI-compatible v4 protocol.", APITypeZhipuV4, true, []EndpointType{EndpointTypeOpenAI}, ChannelTypeZhipu_v4),
	relayProtocol("xunfei", "iFlytek Spark", "iFlytek", "iFlytek Spark protocol.", APITypeXunfei, false, []EndpointType{EndpointTypeOpenAI}, ChannelTypeXunfei),
	relayProtocol("tencent-hunyuan", "Tencent Hunyuan", "Tencent", "Tencent Hunyuan chat and VOD image-generation protocol.", APITypeTencent, false, []EndpointType{EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeTencent),
	relayProtocol("perplexity", "Perplexity", "Perplexity", "Perplexity OpenAI-compatible protocol.", APITypePerplexity, false, []EndpointType{EndpointTypeOpenAI}, ChannelTypePerplexity),
	relayProtocol("cohere", "Cohere", "Cohere", "Cohere chat and embeddings protocol.", APITypeCohere, false, []EndpointType{EndpointTypeOpenAI, EndpointTypeEmbeddings}, ChannelTypeCohere),
	relayProtocol("dify", "Dify", "Dify", "Dify application protocol.", APITypeDify, false, []EndpointType{EndpointTypeOpenAI}, ChannelTypeDify),
	relayProtocol("cloudflare-workers-ai", "Cloudflare Workers AI", "Cloudflare", "Cloudflare Workers AI protocol.", APITypeCloudflare, true, []EndpointType{EndpointTypeOpenAI, EndpointTypeEmbeddings}, ChannelCloudflare),
	relayProtocol("siliconflow", "SiliconFlow", "OpenAI", "SiliconFlow OpenAI-compatible protocol.", APITypeSiliconFlow, true, []EndpointType{EndpointTypeOpenAI, EndpointTypeImageGeneration, EndpointTypeEmbeddings}, ChannelTypeSiliconFlow),
	relayProtocol("mistral", "Mistral", "Mistral", "Mistral chat and embeddings protocol.", APITypeMistral, false, []EndpointType{EndpointTypeOpenAI, EndpointTypeEmbeddings}, ChannelTypeMistral),
	relayProtocol(ProtocolDeepSeek, "DeepSeek", "DeepSeek", "DeepSeek native/OpenAI-compatible protocol.", APITypeDeepSeek, true, []EndpointType{EndpointTypeOpenAI}, ChannelTypeDeepSeek),
	relayProtocol("moka", "Moka AI", "Moka", "Moka embedding protocol.", APITypeMokaAI, false, []EndpointType{EndpointTypeEmbeddings}, ChannelTypeMokaAI),
	relayProtocol(ProtocolXinference, "Xinference", "Open source", "Xinference OpenAI-compatible protocol.", APITypeXinference, false, []EndpointType{EndpointTypeOpenAI, EndpointTypeEmbeddings}, ChannelTypeXinference),
	relayProtocol("xai", "xAI", "xAI", "xAI OpenAI-compatible protocol.", APITypeXai, true, []EndpointType{EndpointTypeOpenAI, EndpointTypeOpenAIResponse}, ChannelTypeXai),
	relayProtocol("coze", "Coze", "ByteDance", "Coze bot protocol.", APITypeCoze, false, []EndpointType{EndpointTypeOpenAI}, ChannelTypeCoze),
	relayProtocol("jimeng", "Jimeng", "ByteDance", "Jimeng image protocol.", APITypeJimeng, false, []EndpointType{EndpointTypeImageGeneration}, ChannelTypeJimeng),
	relayProtocol(ProtocolMoonshot, "Moonshot", "Moonshot", "Moonshot Anthropic-compatible coding protocol.", APITypeMoonshot, true, []EndpointType{EndpointTypeAnthropic, EndpointTypeOpenAI}, ChannelTypeMoonshot),
	relayProtocol("submodel", "Submodel", "Submodel", "Submodel compatible protocol.", APITypeSubmodel, true, []EndpointType{EndpointTypeOpenAI}, ChannelTypeSubmodel),
	relayProtocol("minimax", "MiniMax", "MiniMax", "MiniMax chat protocol.", APITypeMiniMax, true, []EndpointType{EndpointTypeOpenAI}, ChannelTypeMiniMax),
	relayProtocol("wuyinkeji", "Wuyinkeji", "Wuyinkeji", "Wuyinkeji synchronous protocol.", APITypeWuyinkeji, false, []EndpointType{EndpointTypeImageGeneration}, ChannelTypeWuyinkeji),
	relayProtocol("147ai", "147AI", "147AI", "147AI compatible protocol.", APIType147AI, false, []EndpointType{EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelType147AI),
	relayProtocol("amux", "Amux", "Gemini", "Amux Gemini-native protocol.", APITypeAmux, false, []EndpointType{EndpointTypeGemini, EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeAmux),
	relayProtocol("code0ai", "Code0 AI", "Gemini", "Code0 AI Gemini-native protocol.", APITypeCode0AI, false, []EndpointType{EndpointTypeGemini, EndpointTypeOpenAI, EndpointTypeImageGeneration}, ChannelTypeCode0AI),

	taskProtocol(ProtocolTaskSuno, "Suno Task", "Suno", "Suno asynchronous music generation protocol.", TaskPlatformSuno, ChannelTypeSunoAPI),
	taskProtocol(ProtocolTaskAli, "Alibaba Task", "Alibaba", "Alibaba asynchronous media task protocol.", TaskPlatformAli, ChannelTypeAli),
	taskProtocol(ProtocolTaskKling, "Kling Task", "Kuaishou", "Kling asynchronous video protocol.", TaskPlatformKling, ChannelTypeKling),
	taskProtocol(ProtocolTaskJimeng, "Jimeng Task", "ByteDance", "Jimeng asynchronous media task protocol.", TaskPlatformJimeng, ChannelTypeJimeng),
	withProtocolOptions(
		taskProtocol(ProtocolTaskVertex, "Vertex AI Video Task", "Google", "Vertex AI asynchronous video protocol.", TaskPlatformVertex, ChannelTypeVertexAi),
		ProtocolOptionDefinition{
			Key:         "region",
			Label:       "Region",
			Description: "Overrides the channel region for this video model binding.",
			Placeholder: "us-central1",
		},
	),
	taskProtocol(ProtocolTaskVidu, "Vidu Task", "Vidu", "Vidu asynchronous video protocol.", TaskPlatformVidu, ChannelTypeVidu),
	taskProtocol(ProtocolTaskDoubao, "Doubao Video Task", "ByteDance", "Volcengine/Doubao asynchronous video protocol.", TaskPlatformDoubao, ChannelTypeDoubaoVideo, ChannelTypeVolcEngine),
	taskProtocol(ProtocolTaskSora, "OpenAI Video Task", "OpenAI", "OpenAI Sora-compatible asynchronous video protocol.", TaskPlatformSora, ChannelTypeSora, ChannelTypeOpenAI),
	taskProtocol(ProtocolTaskGemini, "Gemini Video Task", "Google", "Gemini asynchronous video protocol.", TaskPlatformGemini, ChannelTypeGemini),
	taskProtocol(ProtocolTaskMiniMax, "MiniMax Video Task", "MiniMax", "MiniMax/Hailuo asynchronous video protocol.", TaskPlatformMiniMax, ChannelTypeMiniMax),
	taskProtocol(ProtocolTaskMiniMaxV2, "MiniMax Video V2 Task", "MiniMax", "MiniMax H3 multimodal asynchronous video protocol.", TaskPlatformMiniMaxV2, ChannelTypeMiniMax),
	taskProtocol(ProtocolTaskWuyinkeji, "Wuyinkeji Task", "Wuyinkeji", "Wuyinkeji asynchronous media protocol.", TaskPlatformWuyinkeji, ChannelTypeWuyinkeji),
	taskProtocol(ProtocolTaskAPIMart, "APIMart Task", "APIMart", "APIMart unified asynchronous image/video protocol.", TaskPlatformAPIMart, ChannelTypeApimart),
	taskProtocol(ProtocolTaskEvolink, "Evolink Task", "Evolink", "Evolink unified asynchronous video protocol.", TaskPlatformEvolink, ChannelTypeEvolink),
	taskProtocol(ProtocolTaskFunAI, "FunAI Task", "FunAI", "FunAI OpenAI-compatible asynchronous video protocol.", TaskPlatformFunAI, ChannelTypeFunAI),
	taskProtocol(ProtocolTaskMegaby, "Megaby Task", "Megaby", "Megaby OpenAI-compatible asynchronous video protocol.", TaskPlatformMegaby, ChannelTypeMegaby),
	taskProtocol(ProtocolTaskMagic666, "Magic666 Task", "Magic666", "Magic666 asynchronous media protocol.", TaskPlatformMagic666, ChannelTypeMagic666),
	taskProtocol(ProtocolTaskMediaKit, "Volcengine MediaKit Task", "ByteDance", "Volcengine MediaKit enhancement protocol.", TaskPlatformMediaKit, ChannelTypeVolcMediaKit),
	nativeProtocol(ProtocolNativeMJ, "Midjourney Native", "Midjourney", "Midjourney proxy routes handled by the native relay.", ChannelTypeMidjourney, ChannelTypeMidjourneyPlus),
}

var protocolDefinitionByID = buildProtocolDefinitionIndex(protocolDefinitions)

func buildProtocolDefinitionIndex(definitions []ProtocolDefinition) map[string]ProtocolDefinition {
	index := make(map[string]ProtocolDefinition, len(definitions))
	for _, definition := range definitions {
		id := strings.TrimSpace(definition.ID)
		if id == "" {
			panic("protocol definition id cannot be empty")
		}
		if definition.Transport == "" {
			panic(fmt.Sprintf("protocol %s transport cannot be empty", id))
		}
		optionKeys := make(map[string]struct{}, len(definition.Options))
		for _, option := range definition.Options {
			key := strings.TrimSpace(option.Key)
			if key == "" {
				panic(fmt.Sprintf("protocol %s option key cannot be empty", id))
			}
			if _, exists := optionKeys[key]; exists {
				panic(fmt.Sprintf("protocol %s has duplicate option %s", id, key))
			}
			optionKeys[key] = struct{}{}
		}
		if _, exists := index[id]; exists {
			panic(fmt.Sprintf("duplicate protocol definition: %s", id))
		}
		definition.ID = id
		index[id] = definition
	}
	return index
}

func cloneProtocolDefinition(definition ProtocolDefinition) ProtocolDefinition {
	// endpoint_types is a required array in the public protocol catalog. Keep an
	// explicitly empty native-protocol slice as [] instead of collapsing it to
	// nil, which would serialize as null and violate the console schema.
	definition.EndpointTypes = append([]EndpointType{}, definition.EndpointTypes...)
	definition.RecommendedChannelTypes = append([]int(nil), definition.RecommendedChannelTypes...)
	definition.Options = append([]ProtocolOptionDefinition(nil), definition.Options...)
	return definition
}

// GetProtocolDefinition returns a defensive copy of a protocol registry entry.
func GetProtocolDefinition(id string) (ProtocolDefinition, bool) {
	definition, ok := protocolDefinitionByID[strings.TrimSpace(id)]
	if !ok {
		return ProtocolDefinition{}, false
	}
	return cloneProtocolDefinition(definition), true
}

// ListProtocolDefinitions returns a stable, UI-friendly protocol catalog.
func ListProtocolDefinitions() []ProtocolDefinition {
	definitions := make([]ProtocolDefinition, 0, len(protocolDefinitionByID))
	for _, definition := range protocolDefinitionByID {
		definitions = append(definitions, cloneProtocolDefinition(definition))
	}
	sort.Slice(definitions, func(i, j int) bool {
		if definitions[i].Family != definitions[j].Family {
			return definitions[i].Family < definitions[j].Family
		}
		if definitions[i].Transport != definitions[j].Transport {
			return definitions[i].Transport < definitions[j].Transport
		}
		return definitions[i].Name < definitions[j].Name
	})
	return definitions
}
