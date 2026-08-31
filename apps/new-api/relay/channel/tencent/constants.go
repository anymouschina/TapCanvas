package tencent

var ModelList = []string{
	"hunyuan-lite",
	"hunyuan-standard",
	"hunyuan-standard-256K",
	"hunyuan-pro",
}

// ImageModelList holds model names routed to Tencent VOD AIGC image generation.
// These are the upstream model names the backend sends for /v1/images/generations.
var ImageModelList = []string{
	"gpt-image-2",
	"gemini-2.5-flash-image-preview",
	"gemini-3.1-flash-image-preview",
	"gemini-3-pro",
	"gemini-3-pro-image-preview",
	"gemini-2.5-pro",
}

var ChannelName = "tencent"
