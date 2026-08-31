package evolink

import (
	"strings"

	"github.com/QuantumNous/new-api/model"
)

// ChannelName is the human-facing / log identifier for the Evolink channel.
const ChannelName = "evolink"

// Evolink (api.evolink.ai) exposes a unified async API:
//
//	submit: POST {base}/v1/images/generations            (returns a task envelope)
//	poll:   GET  {base}/v1/tasks/{task_id}               (returns status + result)
//
// The submit response is the OpenAI-style "generation.task" flat envelope
// ({id, object:"image.generation.task", status, progress}); the SAME parsing the
// APIMart task package already implements covers it. The only difference from the
// APIMart "toapis" flat form is the poll PATH: APIMart's toapis flat tasks poll
// /v1/images/generations/{id}, but Evolink polls /v1/tasks/{id} for both images
// and videos. We therefore reuse APIMart's response structs but force the
// /v1/tasks/{id} poll path here.
const (
	submitPathImages = "/v1/images/generations"
	pollPathPrefix   = "/v1/tasks/"
)

// PollPath returns the Evolink GET status path for a task id.
func PollPath(taskID string) string { return pollPathPrefix + taskID }

// ModelList advertises the public image-model keys this channel can serve (used
// by the admin "fetch models" button). Evolink becomes another candidate upstream
// for these existing keys — no catalog/pricing change is needed for images.
//
// Docs:
//   - gpt-image-2:                    .../image-series/gpt-image-2/gpt-image-2-image-generation
//   - gemini-3.1-flash-image-preview: .../image-series/nanobanana/nanobanana-2-image-generate
//   - gemini-3-pro-image-preview:     .../image-series/nanobanana/nanobanana-pro-image-generate
var ModelList = []string{
	"gpt-image-2",
	"gemini-3.1-flash-image-preview",
	"gemini-3-pro-image-preview",
}

// isGptImage2 reports whether the (canonical) model is the gpt-image-2 family.
// gpt-image-2 reads the resolution tier from the `resolution` field (1K/2K/4K)
// and uses `quality` for the low/medium/high render-effort knob.
func isGptImage2(modelName string) bool {
	return model.CanonicalModelKey(modelName) == "gpt-image-2"
}

// isGeminiImage reports whether the model is a nanobanana (Gemini image) model.
// These take the resolution tier in the `quality` field (0.5K/1K/2K/4K) and have
// no separate `resolution` parameter.
func isGeminiImage(modelName string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(model.CanonicalModelKey(modelName))), "gemini-")
}
