package evolink

import "strings"

// ChannelName is the internal identifier used by logs and admin UI.
const ChannelName = "evolink"

// Evolink (api.evolink.ai) async video flow:
//
//	submit → POST {base}/v1/videos/generations   (returns a task envelope)
//	poll   → GET  {base}/v1/tasks/{task_id}       (returns status + result)
//
// The envelope is identical to APIMart's flat ("generation.task") form, so the
// poll-result parsing reuses the APIMart task package's SubmitResponse /
// DetailResponse structs (see adaptor.go). Only the submit body differs per
// model family, which is what payload.go builds.
const submitPathVideos = "/v1/videos/generations"

// ModelList advertises the video model ids this channel serves. Used by the
// admin "fetch models" button.
//
// Docs: https://docs.evolink.ai/en/api-manual/video-series/{seedance2.0,kling}/...
var ModelList = []string{
	"seedance-2.0-reference-to-video",
	"seedance-2.0-fast-image-to-video",
	"seedance-2.0-fast-reference-to-video",
	"seedance-2.0-mini-reference-to-video",
	"kling-o3-video-edit",
	"kling-o3-reference-to-video",
	"kling-o3-image-to-video",
}

func modelBase(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

// isSeedanceModel reports whether the model is an Evolink Seedance 2.0 SKU.
// All share one submit schema (prompt + image/video/audio_urls + quality +
// aspect_ratio + generate_audio + content_filter).
func isSeedanceModel(name string) bool {
	return strings.HasPrefix(modelBase(name), "seedance-2.0")
}

func isKlingImageToVideo(name string) bool {
	return modelBase(name) == "kling-o3-image-to-video"
}

func isKlingReferenceToVideo(name string) bool {
	return modelBase(name) == "kling-o3-reference-to-video"
}

func isKlingVideoEdit(name string) bool {
	return modelBase(name) == "kling-o3-video-edit"
}

func isKlingModel(name string) bool {
	return strings.HasPrefix(modelBase(name), "kling-o3")
}
