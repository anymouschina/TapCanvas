package megaby

const (
	ChannelName = "megaby"
	submitPath  = "/v1/videos"
)

type providerModelSpec struct {
	providerModel string
	resolution    string
}

type mediaLimits struct {
	images int
	videos int
	audios int
}

// providerModels keeps the supplier's pool-specific IDs behind stable
// public products. Resolution is the only routing input: callers never need to
// know whether a spec is served by the official pool or the 933 pool.
var providerModels = map[string]map[string]providerModelSpec{
	"sd2": {
		"480p":  {providerModel: "sd2-pro-933-480", resolution: "480p"},
		"720p":  {providerModel: "sd2-pro", resolution: "720p"},
		"1080p": {providerModel: "sd-2.0-1080p", resolution: "1080p"},
		"4k":    {providerModel: "sd-2.0-4k", resolution: "4k"},
	},
	"sd2-mini": {
		"480p": {providerModel: "sd-mini-480p", resolution: "480p"},
		"720p": {providerModel: "sd2-mini", resolution: "720p"},
	},
	"seedance-2.5": {
		"480p": {providerModel: "seedance-2-5", resolution: "480p"},
		"720p": {providerModel: "seedance-2-5", resolution: "720p"},
	},
	"minimax-h3": {
		"768p":  {providerModel: "minimax-h3-768p", resolution: "768p"},
		"1440p": {providerModel: "minimax-h3-1440p", resolution: "1440p"},
	},
}

var defaultModelResolutions = map[string]string{
	"sd2":          "720p",
	"sd2-mini":     "720p",
	"seedance-2.5": "720p",
	"minimax-h3":   "768p",
}

var providerMediaLimits = map[string]mediaLimits{
	"sd2":          {images: 9, videos: 3, audios: 3},
	"sd2-mini":     {images: 9, videos: 3, audios: 3},
	"seedance-2.5": {images: 30, videos: 10, audios: 10},
	"minimax-h3":   {images: 9, videos: 3, audios: 3},
}

var referenceVideoCostMultipliers = map[string]float64{
	"sd2":          1.3,
	"sd2-mini":     1.3,
	"seedance-2.5": 1.4,
}

var ModelList = []string{"sd2", "sd2-mini", "seedance-2.5", "minimax-h3"}
