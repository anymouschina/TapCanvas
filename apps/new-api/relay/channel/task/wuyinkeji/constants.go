package wuyinkeji

// ChannelName is the internal identifier used by logs and admin UI.
const ChannelName = "wuyinkeji"

// ModelSubmitPath maps the new-api model name to the wuyinkeji async submit path.
// Extend this map (and the SQL seeds) when adding new wuyinkeji-backed models.
var ModelSubmitPath = map[string]string{
	"gpt-image-2-suchuang":      "/api/async/image_gpt",
	"nano-banana-fast-suchuang": "/api/async/image_nanoBanana",
	"nano-banana-pro-suchuang":  "/api/async/image_nanoBanana_pro",
	"nanobanana2-suchuang":      "/api/async/image_nanoBanana2",
	"veo3.1-fast-suchuang":      "/api/async/video_veo3.1_fast",
	"veo3.1-pro-suchuang":       "/api/async/video_veo3.1_pro",
}

// imageModels enumerates wuyinkeji models that produce a still image and can be
// served through new-api's synchronous /v1/images/generations path (submit +
// internal poll). Video models stay on the task path.
var imageModels = map[string]struct{}{
	"gpt-image-2-suchuang":      {},
	"nano-banana-fast-suchuang": {},
	"nano-banana-pro-suchuang":  {},
	"nanobanana2-suchuang":      {},
}

// IsImageModel reports whether the given wuyinkeji model can be served via the
// synchronous image adaptor.
func IsImageModel(model string) bool {
	_, ok := imageModels[model]
	return ok
}

// ImageModels returns the set of wuyinkeji models eligible for the sync image
// adaptor. Callers must not mutate the returned slice.
func ImageModels() []string {
	out := make([]string, 0, len(imageModels))
	for m := range imageModels {
		out = append(out, m)
	}
	return out
}
