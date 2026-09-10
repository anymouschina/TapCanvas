package heyroute

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

type videoPayload struct {
	Model                 string           `json:"model"`
	Prompt                string           `json:"prompt"`
	Seconds               string           `json:"seconds,omitempty"`
	Ratio                 string           `json:"ratio,omitempty"`
	Resolution            string           `json:"resolution,omitempty"`
	InputReference        json.RawMessage  `json:"input_reference,omitempty"`
	Images                []mediaReference `json:"images,omitempty"`
	Videos                []mediaReference `json:"videos,omitempty"`
	Audios                []mediaReference `json:"audios,omitempty"`
	GenerateAudio         *bool            `json:"generate_audio,omitempty"`
	Seed                  *int64           `json:"seed,omitempty"`
	NegativePrompt        string           `json:"negative_prompt,omitempty"`
	Shots                 json.RawMessage  `json:"shots,omitempty"`
	OmniReferenceTaskType string           `json:"omni_reference_task_type,omitempty"`
	OutputFormat          string           `json:"output_format,omitempty"`
}
type mediaReference struct {
	URL  string `json:"url"`
	Role string `json:"role,omitempty"`
}
type modelSpec struct {
	min, max, defaultSeconds int
	resolutions              []string
	defaultResolution        string
}

// Exact transport capability facts from the provider's video documentation.
var specs = map[string]modelSpec{
	"grok-video":                {6, 15, 0, []string{"405p"}, "405p"},
	"grok-imagine-video":        {1, 15, 8, []string{"480p", "720p"}, "480p"},
	"grok-imagine-1.5-video":    {1, 15, 8, []string{"480p", "720p", "1080p"}, "480p"},
	"grok-imagine-video-1.5":    {1, 15, 8, []string{"480p", "720p", "1080p"}, "480p"},
	"minimax-h3-quantized-768p": {4, 10, 4, []string{"768p"}, "768p"},
	"minimax-h3-original-768p":  {4, 15, 4, []string{"768p"}, "768p"},
	"minimax-h3-original-1080p": {4, 15, 4, []string{"1080p"}, "1080p"},
	"minimax-h3-original-cf-2k": {4, 15, 4, []string{"2k"}, "2k"},
	"minimax-h3":                {4, 15, 4, []string{"480p", "720p"}, "480p"},
	"MiniMax-H3":                {4, 15, 4, []string{"480p", "720p"}, "480p"},
	"seedance-2.5":              {4, 30, 0, []string{"480p", "720p", "1080p"}, "720p"},
	"seedance-2.0":              {15, 15, 15, []string{"480p", "720p"}, "480p"},
	"seedance-2.0-fast":         {15, 15, 15, []string{"480p", "720p"}, "480p"},
}

func NormalizePayload(body []byte) (videoPayload, relaycommon.TaskSubmitReq, error) {
	var fields map[string]json.RawMessage
	var req relaycommon.TaskSubmitReq
	var payload videoPayload
	fail := func(err error) (videoPayload, relaycommon.TaskSubmitReq, error) { return payload, req, err }
	if err := common.Unmarshal(body, &fields); err != nil {
		return fail(err)
	}
	// Canonical metadata carries optional provider parameters, with explicit
	// top-level fields authoritative. Do not let metadata replace model/prompt.
	var metadata map[string]json.RawMessage
	if raw := fields["metadata"]; len(raw) > 0 {
		if err := common.Unmarshal(raw, &metadata); err != nil {
			return fail(err)
		}
	}
	for key, value := range metadata {
		if key != "model" && key != "prompt" {
			if _, exists := fields[key]; !exists {
				fields[key] = value
			}
		}
	}
	input := fields["input_reference"]
	delete(fields, "input_reference")
	encoded, err := common.Marshal(fields)
	if err != nil {
		return fail(err)
	}
	if err := common.Unmarshal(encoded, &req); err != nil {
		return fail(err)
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return fail(fmt.Errorf("prompt is required"))
	}
	spec, ok := specs[req.Model]
	if !ok {
		return fail(fmt.Errorf("unsupported HeyRoute video model %q", req.Model))
	}
	payload.Model = req.Model
	payload.Prompt = req.Prompt
	if raw := fields["generate_audio"]; len(raw) > 0 {
		if err := common.Unmarshal(raw, &payload.GenerateAudio); err != nil {
			return fail(err)
		}
	}
	if raw := fields["seed"]; len(raw) > 0 {
		if err := common.Unmarshal(raw, &payload.Seed); err != nil {
			return fail(err)
		}
	}
	for key, target := range map[string]*string{"negative_prompt": &payload.NegativePrompt, "omni_reference_task_type": &payload.OmniReferenceTaskType, "output_format": &payload.OutputFormat} {
		if raw := fields[key]; len(raw) > 0 {
			if err := common.Unmarshal(raw, target); err != nil {
				return fail(err)
			}
		}
	}
	payload.Shots = fields["shots"]
	seconds := req.Duration
	if req.Seconds != "" {
		n, err := strconv.Atoi(req.Seconds)
		if err != nil {
			return fail(err)
		}
		if seconds != 0 && seconds != n {
			return fail(fmt.Errorf("duration and seconds disagree"))
		}
		seconds = n
	}
	if seconds == 0 {
		seconds = spec.defaultSeconds
	}
	if seconds < spec.min || seconds > spec.max {
		return fail(fmt.Errorf("%s requires explicit duration %d–%d seconds", req.Model, spec.min, spec.max))
	}
	if req.Model == "grok-video" && seconds != 6 && seconds != 10 && seconds != 15 {
		return fail(fmt.Errorf("grok-video supports 6, 10 or 15 seconds"))
	}
	resolution := strings.ToLower(req.Resolution)
	if resolution == "" {
		resolution = spec.defaultResolution
	}
	valid := false
	for _, value := range spec.resolutions {
		if value == resolution {
			valid = true
		}
	}
	if !valid {
		return fail(fmt.Errorf("%s does not support resolution %s", req.Model, resolution))
	}
	payload.Seconds = strconv.Itoa(seconds)
	payload.Resolution = resolution
	payload.Ratio = req.AspectRatio
	if raw := fields["ratio"]; len(raw) > 0 {
		if err := common.Unmarshal(raw, &payload.Ratio); err != nil {
			return fail(err)
		}
	}
	if payload.Ratio == "" && strings.Contains(req.Size, ":") {
		payload.Ratio = req.Size
	}
	if req.Size != "" && !strings.Contains(req.Size, ":") {
		return fail(fmt.Errorf("use explicit ratio and resolution instead of pixel size"))
	}
	payload.InputReference = input
	refs := append([]string{}, req.Images...)
	refs = append(refs, req.ReferenceImages...)
	if req.Image != "" {
		refs = append(refs, req.Image)
	}
	if len(refs) > 0 {
		if len(input) > 0 {
			return fail(fmt.Errorf("input_reference and canonical images cannot both be supplied"))
		}
		var raw []byte
		var err error
		if len(refs) == 1 {
			raw, err = common.Marshal(refs[0])
		} else {
			raw, err = common.Marshal(refs)
		}
		if err != nil {
			return fail(err)
		}
		payload.InputReference = raw
	}
	if req.StartFrame != "" {
		payload.Images = append(payload.Images, mediaReference{req.StartFrame, "first_frame"})
	}
	if req.EndFrame != "" {
		payload.Images = append(payload.Images, mediaReference{req.EndFrame, "last_frame"})
	}
	for _, url := range req.ReferenceVideos {
		payload.Videos = append(payload.Videos, mediaReference{url, "reference_video"})
	}
	for _, ref := range req.VideoReferences {
		if ref.StartSeconds != nil || ref.RequireAudio != nil {
			return fail(fmt.Errorf("HeyRoute does not support reference video start_seconds or require_audio"))
		}
		payload.Videos = append(payload.Videos, mediaReference{ref.URL, "reference_video"})
	}
	for _, url := range append(req.ReferenceAudios, req.Audios...) {
		payload.Audios = append(payload.Audios, mediaReference{url, "reference_audio"})
	}
	// These upstream families consume one reference field, not role arrays.
	if strings.HasPrefix(req.Model, "minimax-h3-") {
		media := append(append(append([]mediaReference{}, payload.Images...), payload.Videos...), payload.Audios...)
		if req.Model == "minimax-h3-quantized-768p" && len(payload.Videos)+len(payload.Audios) > 0 {
			return fail(fmt.Errorf("quantized video accepts image references only"))
		}
		if len(media) > 1 || len(media) > 0 && len(payload.InputReference) > 0 {
			return fail(fmt.Errorf("this video tier accepts one reference item"))
		}
		if len(media) == 1 {
			raw, err := common.Marshal(media[0].URL)
			if err != nil {
				return fail(err)
			}
			payload.InputReference = raw
			payload.Images = nil
			payload.Videos = nil
			payload.Audios = nil
		}
		if len(payload.InputReference) > 0 {
			var reference string
			if err := common.Unmarshal(payload.InputReference, &reference); err != nil {
				return fail(fmt.Errorf("this video tier requires one reference URL, not an array"))
			}
		}
	}
	if req.Model == "grok-video" {
		if req.Resolution != "" && req.Resolution != "405p" || payload.Ratio != "" || len(payload.InputReference) > 0 || len(payload.Images)+len(payload.Videos)+len(payload.Audios) > 0 || payload.GenerateAudio != nil || payload.Seed != nil {
			return fail(fmt.Errorf("grok-video supports only model, prompt and seconds"))
		}
		payload.Resolution = ""
	}
	// Editing has source-determined duration and needs completion-time billing;
	// reject it before submission until that contract is available.
	if payload.OmniReferenceTaskType == "edit" {
		return fail(fmt.Errorf("video edit requires source-duration billing; generation and extend accept explicit duration"))
	}
	req.Duration = seconds
	req.Seconds = payload.Seconds
	req.Resolution = resolution
	return payload, req, nil
}
