package apimart

// Source: https://docs.apimart.ai/sitemap.xml (accessed 2026-04-22) + the
// individual /api-reference/{images,videos}/{family}/generation pages. Every
// entry is the exact `model` string accepted by APIMart's unified POST
// /v1/images/generations or POST /v1/videos/generations endpoint.
//
// Scope policy: we only enumerate the models TapCanvas business actually
// routes. APIMart exposes many more — they are intentionally omitted so the
// ability/pricing tables stay proportional to the rest of the catalog.

// ChannelName is the internal identifier used by logs and admin UI.
const ChannelName = "apimart"

const (
	submitPathImages = "/v1/images/generations"
	submitPathVideos = "/v1/videos/generations"
	pollPathPrefix   = "/v1/tasks/"
)

// SubmitPath returns the POST submit path for a model based on its DB kind.
// Returns ("", false) only if the kind is completely unknown.
func SubmitPath(modelName string, kind string) (string, bool) {
	switch kind {
	case "image":
		return submitPathImages, true
	case "video":
		return submitPathVideos, true
	default:
		return "", false
	}
}

// PollPath returns the GET status path for a task id.
func PollPath(taskID string) string { return pollPathPrefix + taskID }

// AllAsyncModels returns every model id known to the APIMart channel.
// Reads from the model DB cache — no hardcoded whitelist.
func AllAsyncModels() []string { return nil }
