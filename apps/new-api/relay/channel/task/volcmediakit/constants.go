package volcmediakit

// VolcEngine AI MediaKit 画质增强 (video super-resolution / enhancement).
//
// Upstream is a simple Bearer-auth async task API (NOT VolcEngine V4 signing):
//
//	submit → POST {base}/api/v1/tools/enhance-video   (returns task_id)
//	poll   → GET  {base}/api/v1/tasks/{task_id}        (returns status + result.video_url)
//
// Doc: backend/docs/火山超分（画质增强）接入API文档.md
//      MediaKit console: https://console.volcengine.com/imp/ai-mediakit
//
// The channel exposes the MediaKit video tools as separate public model ids.
// The model id selects the upstream tool endpoint; all tasks use the same
// Bearer-auth async task API and polling contract.

// ChannelName is the internal identifier used by logs and admin UI.
const ChannelName = "volc-mediakit"

const (
	submitPath      = "/api/v1/tools/enhance-video"
	subtitlePath    = "/api/v1/tools/erase-video-subtitle"
	subtitleProPath = "/api/v1/tools/erase-video-subtitle-pro"
	mattingPath     = "/api/v1/tools/matte-greenscreen-video"
	pollPathPrefix  = "/api/v1/tasks/"
)

// PollPath returns the GET status path for a task id.
func PollPath(taskID string) string { return pollPathPrefix + taskID }

// EnhanceModel is the MediaKit video quality enhancement tool.
const EnhanceModel = "volc-enhance-video"

// SubtitleModel removes hard subtitles automatically (OCR + temporal repair).
const SubtitleModel = "volc-erase-video-subtitle"

// SubtitleProModel removes subtitles using explicit normalized rectangles or
// the fine-grained text mode. It is the model used by LibTV's box-select flow.
const SubtitleProModel = "volc-erase-video-subtitle-pro"

// MattingModel extracts a foreground subject from green-screen/person footage
// into MOV/WEBM with transparency. It is intentionally not advertised as
// arbitrary object removal; that requires video inpainting, not matting.
const MattingModel = "volc-matte-greenscreen-video"

func toolPathForModel(model string) (string, bool) {
	switch model {
	case EnhanceModel:
		return submitPath, true
	case SubtitleModel:
		return subtitlePath, true
	case SubtitleProModel:
		return subtitleProPath, true
	case MattingModel:
		return mattingPath, true
	default:
		return "", false
	}
}
