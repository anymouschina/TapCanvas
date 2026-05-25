package magic666

const ChannelName = "Magic666"

// GeminiImageModels are served via Gemini-format endpoint:
// POST {base}/v1beta/models/{model}:generateContent
var GeminiImageModels = []string{
	"gemini-2.5-flash-image",
	"gemini-3-pro-image-preview",
	"gemini-3.1-flash-image-preview",
	"gemini-2.5-flash-image-preview",
}

// OpenAIImageModels are served via OpenAI-format endpoint:
// POST {base}/v1/images/generations
var OpenAIImageModels = []string{
	"gpt-image-2",
	"gpt-image-2-pro",
}

var OpenAIResponsesModels = []string{
	"gpt-5.5",
}

var ModelList = append(append(append([]string{}, GeminiImageModels...), OpenAIImageModels...), OpenAIResponsesModels...)
