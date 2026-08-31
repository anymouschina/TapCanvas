package funai

const (
	ChannelName = "funai"
	submitPath  = "/v1/videos"

	publicModelSeedance20 = "seedance-2.0-funai"
	publicModelKlingO3    = "kling-o3-funai"
	publicModelKlingV3    = "kling-v3-funai"

	modelSeedance20 = "seedance-2.0"
	modelKlingO3    = "kling-o3"
	modelKlingV3    = "kling-v3"

	modelKlingO3ProV2V      = "kling-o3-pro-v2v-reference"
	modelKlingO3StandardV2V = "kling-o3-standard-v2v-reference"
	modelKlingV3OmniV2V     = "kling-v3-omni-v2v-create"
)

// ModelList intentionally exposes only the stable product-facing models. The
// provider-only V2V variants are selected from structured media inputs by the
// payload builder and must not become separate catalog entries.
var ModelList = []string{publicModelSeedance20, publicModelKlingO3, publicModelKlingV3}
