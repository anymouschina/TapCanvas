package lingjing

// ChannelName is the human-facing name for the 灵镜AI channel.
const ChannelName = "Lingjing"

// ----------------------------------------------------------------------------
// 上游接口端点（灵镜AI openapi）。
//
// submit 已由用户提供的 curl 实证：
//
//	POST {base}/api/entrance/openapi/draw/task/submit
//	headers: X-Access-Key / X-Secret-Key
//	body:    {"modelCode":"...","taskParams":{"input":{...}}}
//
// query 端点用户未提供文档。灵镜的 submit 端点对 GET 返回 9003「不支持 GET 方法」，
// 说明这套 openapi 均为 POST，因此这里按同族约定推断 query 也是 POST + {"taskId":...}。
// 若实测路径/方法/字段不同，只需改下面这两个常量与 submitResponse / pollResponse 的
// 容错解析即可——结果 URL 的提取走递归扫描，对字段命名不敏感。
// ----------------------------------------------------------------------------
const (
	submitPath = "/api/entrance/openapi/draw/task/submit"
	queryPath  = "/api/entrance/openapi/draw/task/query"
)

// publicModelToUpstream maps our client-facing (public) model keys to 灵镜's
// upstream modelCode. Clients keep calling the existing gemini-* / gpt-image-2
// keys; ConvertImageRequest swaps in the 灵镜 modelCode at submit time. Because
// the translation lives here, the channel does NOT need a model_mapping config.
//
// Billing is unaffected: image billing keys on info.OriginModelName (the public
// key the client requested), so each request is priced by its existing
// gemini-* / gpt-image-2 rule — clients see no price change.
//
// 上游 modelCode 按最新 curl 实证逐个核对：
//   gpt-image-2 → gt_image_official_az（带后缀，不能简单去 _official）
//   gemini-3-pro-image-preview → baba_pro（无 _official）
// 若上游报 model not found，改这一处即可。
var publicModelToUpstream = map[string]string{
	"gpt-image-2":                    "gt_image_official_az",
	"gemini-3.1-flash-image-preview": "baba_2",
	"gemini-3-pro-image-preview":     "baba_pro",
}

// ModelList advertises the public keys this channel can serve (used by the admin
// "fetch models" button). 灵镜 becomes another candidate upstream for these keys.
var ModelList = []string{
	"gpt-image-2",
	"gemini-3.1-flash-image-preview",
	"gemini-3-pro-image-preview",
}

// resolveUpstreamModelCode returns the 灵镜 modelCode for a requested model name.
// Known public keys are translated; anything else (e.g. a raw 灵镜 code) passes
// through unchanged so the channel still works if configured with raw codes.
func resolveUpstreamModelCode(modelName string) string {
	if code, ok := publicModelToUpstream[modelName]; ok {
		return code
	}
	return modelName
}
