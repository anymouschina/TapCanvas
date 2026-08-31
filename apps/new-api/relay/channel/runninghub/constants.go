package runninghub

// ChannelName is the human-facing name for the RunningHub channel.
const ChannelName = "RunningHub"

// ----------------------------------------------------------------------------
// 上游接口端点（RunningHub Standard Model API / openapi v2）。
//
// 提交（已由用户提供的 curl 实证）：
//
//	POST {base}/openapi/v2/{slug}/{op}
//	headers: Authorization: Bearer {API_KEY}
//	body:    {"prompt":"...","imageUrls":["..."],"aspectRatio":"16:9","resolution":"2k"}
//
//	返回 {"taskId":"...","status":"QUEUED|RUNNING|SUCCESS|FAILED","results":[{"url":...}]}
//
// 轮询：返回 taskId 后，POST {base}/openapi/v2/query 拿结果。query 的请求体官方文档
// 未给出，按同族约定（提交也是 POST + Bearer）推断为 POST + {"taskId":...}。若实测
// 路径/方法/字段不同，改 queryPath 与 pollBody 即可——结果 URL 的提取走递归扫描，
// 对字段命名不敏感。
// ----------------------------------------------------------------------------
const (
	// submitPathPrefix + slug + "/" + op 组成提交 URL。
	submitPathPrefix = "/openapi/v2/"
	// queryPath 是按 taskId 轮询结果的端点。
	queryPath = "/openapi/v2/query"
)

// modelEndpoint 描述一个公开模型键对应的 RunningHub slug 及其可用的算子端点。
//
// RunningHub 把不同底模重命名到自己的 rhart-image-* 命名空间（slug），并按算子
// 暴露不同的 op 后缀：
//   - rhart-image-g-2        = gpt-image-2     （text-to-image / image-to-image）
//   - rhart-image-n-g31-flash = gemini-3.1-flash（image-to-image，n=nano-banana g31=gemini3.1）
//   - rhart-image-n-pro      = gemini-3-pro    （edit，n-pro=nano-banana pro）
//
// t2iOp 为纯文生图算子，editOp 为带参考图（图生图/编辑）算子；为空表示该模型不暴露
// 对应算子。注意：n-g31-flash / n-pro 的 text-to-image 端点未经 curl 实证，这里按
// rhart 标准模型普遍暴露 text-to-image 的惯例乐观默认；若上游对纯文生图返回 404，
// 把对应 t2iOp 置空（请求会自动落到 editOp）即可。
type modelEndpoint struct {
	slug   string
	t2iOp  string
	editOp string
}

// publicModelToEndpoint 把我们对外的公开模型键映射到 RunningHub 的 slug + op。
// 客户端仍调用既有的 gpt-image-2 / gemini-* 键，ConvertImageRequest 在提交时换成
// RunningHub 的 slug，因此该渠道无需配置 model_mapping。
//
// 计费不受影响：图片计费按 info.OriginModelName（客户端请求的公开键）走既有规则，
// 与灵镜等其它上游同价，客户端无感。
var publicModelToEndpoint = map[string]modelEndpoint{
	"gpt-image-2":                    {slug: "rhart-image-g-2", t2iOp: "text-to-image", editOp: "image-to-image"},
	"gemini-3.1-flash-image-preview": {slug: "rhart-image-n-g31-flash", t2iOp: "text-to-image", editOp: "image-to-image"},
	"gemini-3-pro-image-preview":     {slug: "rhart-image-n-pro", t2iOp: "text-to-image", editOp: "edit"},
}

// ModelList advertises the public keys this channel can serve (used by the admin
// "fetch models" button). RunningHub becomes another candidate upstream for these
// keys, alongside lingjing / apimart / etc.
var ModelList = []string{
	"gpt-image-2",
	"gemini-3.1-flash-image-preview",
	"gemini-3-pro-image-preview",
}

// resolveEndpoint returns the RunningHub endpoint spec for a requested public key.
func resolveEndpoint(modelName string) (modelEndpoint, bool) {
	e, ok := publicModelToEndpoint[modelName]
	return e, ok
}
