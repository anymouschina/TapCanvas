package bach

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

const (
	ModelBach10Pro    = "Bach-1.0-Pro"
	ModelBach10ProAds = "Bach-1.0-Pro-Ads"

	defaultBaseURL    = "https://api-gen-na.bach.art/api/vdr"
	defaultDuration   = 5
	minDuration       = 5
	maxDuration       = 16
	defaultResolution = "1080p"
	maxPromptChars    = 6500
	minSeed           = 1
	maxSeed           = 100000
	maxRefImages      = 9
	maxRefVideos      = 3
	maxRefAudios      = 3
	maxRefTotal       = 12
)

var ModelList = []string{ModelBach10Pro, ModelBach10ProAds}

var supportedResolutions = map[string]bool{
	"1080p": true,
	"4k":    true,
}

var supportedAspectRatios = map[string]bool{
	"4:3":  true,
	"3:4":  true,
	"16:9": true,
	"9:16": true,
	"21:9": true,
	"1:1":  true,
	"auto": true,
}

// videoRequest matches POST /video/v2 on https://api-gen-na.bach.art/api/vdr.
type videoRequest struct {
	ModelName   string     `json:"model_name"`
	CallbackURL string     `json:"callback_url,omitempty"`
	Input       videoInput `json:"input"`
}

type videoInput struct {
	Task            string           `json:"task"`
	TaskMode        string           `json:"task_mode,omitempty"`
	Prompt          string           `json:"prompt"`
	Duration        float64          `json:"duration,omitempty"`
	GenerateAudio   *bool            `json:"generate_audio,omitempty"`
	AspectRatio     string           `json:"aspect_ratio,omitempty"`
	Resolution      string           `json:"resolution"`
	Seed            *int             `json:"seed,omitempty"`
	ImageURL        string           `json:"image_url,omitempty"`
	EndImageURL     string           `json:"end_image_url,omitempty"`
	ReferenceInputs []referenceInput `json:"reference_inputs,omitempty"`
}

type referenceInput struct {
	Type      string   `json:"type"`
	URL       string   `json:"url"`
	StartTime *float64 `json:"start_time,omitempty"`
}

type contentItem struct {
	Type      string   `json:"type"`
	Role      string   `json:"role"`
	URL       string   `json:"url"`
	StartTime *float64 `json:"start_time,omitempty"`
	ImageURL  *struct {
		URL string `json:"url"`
	} `json:"image_url"`
	VideoURL *struct {
		URL string `json:"url"`
	} `json:"video_url"`
	AudioURL *struct {
		URL string `json:"url"`
	} `json:"audio_url"`
}

type parsedRequest struct {
	req            relaycommon.TaskSubmitReq
	fields         map[string]json.RawMessage
	metadata       map[string]json.RawMessage
	inputReference json.RawMessage
	audioSwitch    json.RawMessage
	rawDuration    json.RawMessage
}

func (p parsedRequest) lookup(key string) json.RawMessage {
	if raw := p.fields[key]; len(raw) > 0 && string(raw) != "null" {
		return raw
	}
	if raw := p.metadata[key]; len(raw) > 0 && string(raw) != "null" {
		return raw
	}
	return nil
}

func CanonicalModelName(name string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "bach-1.0-pro":
		return ModelBach10Pro, true
	case "bach-1.0-pro-ads":
		return ModelBach10ProAds, true
	default:
		return "", false
	}
}

func parseRequest(body []byte) (parsedRequest, error) {
	var parsed parsedRequest
	if err := common.Unmarshal(body, &parsed.fields); err != nil {
		return parsed, fmt.Errorf("bach video requires a JSON body with public media URLs: %w", err)
	}
	parsed.inputReference = parsed.fields["input_reference"]
	delete(parsed.fields, "input_reference")
	if raw := parsed.fields["duration"]; len(raw) > 0 && string(raw) != "null" {
		parsed.rawDuration = raw
		// TaskSubmitReq.Duration is int; strip decimals before unmarshaling into it.
		var f float64
		if err := common.Unmarshal(raw, &f); err == nil && math.Floor(f) != f {
			delete(parsed.fields, "duration")
		}
	}
	if raw := parsed.fields["audio"]; len(raw) > 0 && (string(raw) == "true" || string(raw) == "false") {
		parsed.audioSwitch = raw
		delete(parsed.fields, "audio")
	}
	stripped, err := common.Marshal(parsed.fields)
	if err != nil {
		return parsed, err
	}
	if err := common.Unmarshal(stripped, &parsed.req); err != nil {
		return parsed, err
	}
	if raw := parsed.fields["metadata"]; len(raw) > 0 && string(raw) != "null" {
		if err := common.Unmarshal(raw, &parsed.metadata); err != nil {
			return parsed, fmt.Errorf("metadata must be an object: %w", err)
		}
	}
	return parsed, nil
}

func NormalizePayload(body []byte) (videoRequest, relaycommon.TaskSubmitReq, error) {
	var payload videoRequest
	parsed, err := parseRequest(body)
	if err != nil {
		return payload, parsed.req, err
	}
	req := parsed.req
	fail := func(err error) (videoRequest, relaycommon.TaskSubmitReq, error) { return payload, req, err }

	modelName, ok := CanonicalModelName(req.Model)
	if !ok {
		return fail(fmt.Errorf("unsupported bach video model %q (supported: Bach-1.0-Pro, Bach-1.0-Pro-Ads)", req.Model))
	}
	payload.ModelName = modelName

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return fail(fmt.Errorf("prompt is required"))
	}
	if len([]rune(prompt)) > maxPromptChars {
		return fail(fmt.Errorf("prompt exceeds maximum length of %d characters", maxPromptChars))
	}
	payload.Input.Prompt = req.Prompt

	duration, err := resolveDuration(parsed)
	if err != nil {
		return fail(err)
	}
	if duration < minDuration || duration > maxDuration {
		return fail(fmt.Errorf("%s duration must be between %d and %d seconds (got %g)", modelName, minDuration, maxDuration, duration))
	}
	payload.Input.Duration = duration
	billedSeconds := int(math.Ceil(duration))

	resolution, aspectRatio, err := resolveSpec(req, parsed)
	if err != nil {
		return fail(err)
	}
	if resolution == "" {
		resolution = defaultResolution
	}
	if !supportedResolutions[resolution] {
		return fail(fmt.Errorf("%s requires resolution 1080p or 4k (got %q)", modelName, resolution))
	}
	payload.Input.Resolution = resolution

	if aspectRatio != "" {
		normalizedRatio := strings.ToLower(strings.TrimSpace(aspectRatio))
		if !supportedAspectRatios[normalizedRatio] {
			return fail(fmt.Errorf("%s unsupported aspect_ratio %q", modelName, aspectRatio))
		}
		payload.Input.AspectRatio = normalizedRatio
	}

	generateAudio, err := optionalBool(parsed.lookup("generate_audio"), parsed.audioSwitch, parsed.metadata["audio"])
	if err != nil {
		return fail(err)
	}
	payload.Input.GenerateAudio = generateAudio

	if req.Seed != nil {
		seed := int(*req.Seed)
		if seed < minSeed || seed > maxSeed {
			return fail(fmt.Errorf("%s seed must be between %d and %d (got %d)", modelName, minSeed, maxSeed, seed))
		}
		payload.Input.Seed = &seed
	}

	if cb := optionalString(parsed.lookup("callback_url")); cb != "" {
		payload.CallbackURL = cb
	}

	if err := populateMedia(&payload.Input, parsed); err != nil {
		return fail(err)
	}

	req.Model = modelName
	req.Duration = billedSeconds
	req.Seconds = strconv.Itoa(billedSeconds)
	req.Resolution = resolution
	req.AspectRatio = payload.Input.AspectRatio
	return payload, req, nil
}

func resolveDuration(parsed parsedRequest) (float64, error) {
	var duration float64
	hasDuration := false
	if len(parsed.rawDuration) > 0 {
		var v float64
		if err := common.Unmarshal(parsed.rawDuration, &v); err != nil {
			var s string
			if errStr := common.Unmarshal(parsed.rawDuration, &s); errStr != nil {
				return 0, fmt.Errorf("duration must be a number: %w", err)
			}
			parsedVal, errParse := strconv.ParseFloat(strings.TrimSpace(s), 64)
			if errParse != nil {
				return 0, fmt.Errorf("duration must be a number: %w", errParse)
			}
			v = parsedVal
		}
		duration = v
		hasDuration = true
	} else if parsed.req.Duration > 0 {
		duration = float64(parsed.req.Duration)
		hasDuration = true
	}

	if sec := strings.TrimSpace(parsed.req.Seconds); sec != "" {
		v, err := strconv.ParseFloat(sec, 64)
		if err != nil {
			return 0, fmt.Errorf("seconds must be a number: %w", err)
		}
		if hasDuration && math.Abs(duration-v) > 1e-6 {
			return 0, fmt.Errorf("duration and seconds disagree")
		}
		duration = v
		hasDuration = true
	}

	if !hasDuration {
		return defaultDuration, nil
	}
	if math.IsNaN(duration) || math.IsInf(duration, 0) {
		return 0, fmt.Errorf("duration must be a finite number")
	}
	return duration, nil
}

func resolveSpec(req relaycommon.TaskSubmitReq, parsed parsedRequest) (resolution, ratio string, err error) {
	ratio = firstNonEmpty(optionalString(parsed.lookup("ratio")), req.AspectRatio)
	resolution = strings.ToLower(strings.TrimSpace(req.Resolution))
	if size := strings.TrimSpace(req.Size); size != "" {
		sizeResolution, sizeRatio, parseErr := parseSize(size)
		if parseErr != nil {
			return "", "", parseErr
		}
		if resolution == "" {
			resolution = sizeResolution
		}
		if ratio == "" {
			ratio = sizeRatio
		}
	}
	return resolution, ratio, nil
}

func parseSize(size string) (resolution, ratio string, err error) {
	lower := strings.ToLower(strings.TrimSpace(size))
	if supportedResolutions[lower] {
		return lower, "", nil
	}
	if lower == "auto" || strings.Contains(lower, ":") {
		return "", lower, nil
	}
	parts := strings.Split(lower, "x")
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unsupported size %q; use resolution (1080p/4k) and aspect_ratio", size)
	}
	width, errW := strconv.Atoi(parts[0])
	height, errH := strconv.Atoi(parts[1])
	if errW != nil || errH != nil || width <= 0 || height <= 0 {
		return "", "", fmt.Errorf("unsupported size %q; use resolution (1080p/4k) and aspect_ratio", size)
	}
	short := min(width, height)
	switch {
	case short >= 2160:
		resolution = "4k"
	case short >= 1080:
		resolution = "1080p"
	default:
		return "", "", fmt.Errorf("size %q does not map to 1080p or 4k", size)
	}
	d := gcd(width, height)
	return resolution, fmt.Sprintf("%d:%d", width/d, height/d), nil
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func populateMedia(input *videoInput, parsed parsedRequest) error {
	req := parsed.req
	explicitTask := strings.ToLower(optionalString(parsed.lookup("task")))
	taskMode := strings.ToLower(optionalString(parsed.lookup("task_mode")))
	if taskMode != "" && taskMode != "auto" && taskMode != "edit" {
		return fmt.Errorf("unsupported task_mode %q (supported: auto, edit)", taskMode)
	}

	firstFrame := firstNonEmpty(
		optionalString(parsed.lookup("image_url")),
		optionalString(parsed.lookup("first_frame")),
		req.StartFrame,
	)
	lastFrame := firstNonEmpty(
		optionalString(parsed.lookup("end_image_url")),
		optionalString(parsed.lookup("last_frame")),
		req.EndFrame,
	)

	var refs []referenceInput
	seenRef := map[string]bool{}
	addRef := func(kind, rawURL string, startTime *float64) error {
		u := strings.TrimSpace(rawURL)
		if u == "" {
			return nil
		}
		if !isPublicHTTPURL(u) {
			return fmt.Errorf("bach reference media must be a publicly reachable HTTP/HTTPS URL (got %q)", truncateForError(u))
		}
		key := kind + "\x00" + u
		if seenRef[key] {
			return nil
		}
		seenRef[key] = true
		item := referenceInput{Type: kind, URL: u}
		if startTime != nil {
			if *startTime < 0 {
				return fmt.Errorf("reference_inputs.start_time must be >= 0")
			}
			v := *startTime
			item.StartTime = &v
		}
		refs = append(refs, item)
		return nil
	}

	// Explicit reference_inputs[]
	hasExplicitRefInputs := false
	if raw := parsed.lookup("reference_inputs"); len(raw) > 0 {
		var items []referenceInput
		if err := common.Unmarshal(raw, &items); err != nil {
			return fmt.Errorf("reference_inputs must be an array: %w", err)
		}
		if len(items) > 0 {
			hasExplicitRefInputs = true
		}
		for _, item := range items {
			kind := strings.ToLower(strings.TrimSpace(item.Type))
			if kind != "image" && kind != "video" && kind != "audio" {
				return fmt.Errorf("unsupported reference_inputs type %q", item.Type)
			}
			if err := addRef(kind, item.URL, item.StartTime); err != nil {
				return err
			}
		}
	}

	// metadata.content[] (TapCanvas unified multimodal manifest)
	hasRoleRefImage := false
	if raw := parsed.metadata["content"]; len(raw) > 0 && string(raw) != "null" {
		var items []contentItem
		if err := common.Unmarshal(raw, &items); err != nil {
			return fmt.Errorf("metadata.content must be an array: %w", err)
		}
		for _, item := range items {
			role := strings.ToLower(strings.TrimSpace(item.Role))
			switch strings.ToLower(strings.TrimSpace(item.Type)) {
			case "image_url", "image":
				u := item.URL
				if item.ImageURL != nil && item.ImageURL.URL != "" {
					u = item.ImageURL.URL
				}
				u = strings.TrimSpace(u)
				if u == "" {
					continue
				}
				switch role {
				case "first_frame":
					if firstFrame == "" {
						firstFrame = u
					}
				case "last_frame":
					if lastFrame == "" {
						lastFrame = u
					}
				default:
					if role == "reference_image" {
						hasRoleRefImage = true
					}
					if err := addRef("image", u, item.StartTime); err != nil {
						return err
					}
				}
			case "video_url", "video":
				u := item.URL
				if item.VideoURL != nil && item.VideoURL.URL != "" {
					u = item.VideoURL.URL
				}
				if err := addRef("video", u, item.StartTime); err != nil {
					return err
				}
			case "audio_url", "audio":
				u := item.URL
				if item.AudioURL != nil && item.AudioURL.URL != "" {
					u = item.AudioURL.URL
				}
				if err := addRef("audio", u, item.StartTime); err != nil {
					return err
				}
			}
		}
	}

	// metadata.video_url (e.g. video_edit source)
	if videoURL := optionalString(parsed.metadata["video_url"]); videoURL != "" {
		if err := addRef("video", videoURL, nil); err != nil {
			return err
		}
		if taskMode == "" && strings.EqualFold(optionalString(parsed.metadata["taskKind"]), "video_edit") {
			taskMode = "edit"
		}
	}

	// Standard top-level fields: input_reference, image, images, urls, audio
	if len(parsed.inputReference) > 0 && string(parsed.inputReference) != "null" {
		var single string
		if err := common.Unmarshal(parsed.inputReference, &single); err == nil && strings.TrimSpace(single) != "" {
			if err := addRef("image", single, nil); err != nil {
				return err
			}
		} else {
			var list []string
			if err := common.Unmarshal(parsed.inputReference, &list); err == nil {
				for _, u := range list {
					if err := addRef("image", u, nil); err != nil {
						return err
					}
				}
			}
		}
	}
	if strings.TrimSpace(req.Image) != "" {
		if err := addRef("image", req.Image, nil); err != nil {
			return err
		}
	}
	for _, u := range req.Images {
		if err := addRef("image", u, nil); err != nil {
			return err
		}
	}
	for _, u := range req.Urls {
		if err := addRef("image", u, nil); err != nil {
			return err
		}
	}
	for _, u := range req.ReferenceImages {
		if err := addRef("image", u, nil); err != nil {
			return err
		}
	}
	for _, u := range req.ReferenceVideos {
		if err := addRef("video", u, nil); err != nil {
			return err
		}
	}
	for _, u := range req.ReferenceAudios {
		if err := addRef("audio", u, nil); err != nil {
			return err
		}
	}
	for _, u := range req.Audios {
		if err := addRef("audio", u, nil); err != nil {
			return err
		}
	}
	if audioURL := optionalString(parsed.fields["audio"]); audioURL != "" {
		if err := addRef("audio", audioURL, nil); err != nil {
			return err
		}
	}

	// Validate explicit frame URLs
	if firstFrame != "" && !isPublicHTTPURL(firstFrame) {
		return fmt.Errorf("bach image_url must be a publicly reachable HTTP/HTTPS URL")
	}
	if lastFrame != "" && !isPublicHTTPURL(lastFrame) {
		return fmt.Errorf("bach end_image_url must be a publicly reachable HTTP/HTTPS URL")
	}

	// Count reference media by type
	imageCount, videoCount, audioCount := countRefs(refs)

	// Decide task: explicit > inferred
	task := explicitTask
	if task == "" {
		switch {
		case taskMode == "edit" || videoCount > 0 || audioCount > 0 || hasExplicitRefInputs || hasRoleRefImage:
			task = "r2v"
		case firstFrame != "" || lastFrame != "":
			if imageCount > 0 {
				// Both frame anchors and additional reference images -> upgrade to r2v
				task = "r2v"
			} else {
				task = "i2v"
			}
		case imageCount == 1:
			task = "i2v"
			firstFrame = refs[0].URL
			refs = nil
		case imageCount >= 2:
			task = "r2v"
		default:
			task = "t2v"
		}
	}

	switch task {
	case "t2v":
		input.Task = "t2v"
		if taskMode != "" {
			return fmt.Errorf("task_mode is only valid for r2v")
		}
		return nil

	case "i2v":
		if firstFrame == "" && lastFrame == "" {
			if imageCount >= 1 {
				firstFrame = refs[0].URL
			}
			if imageCount >= 2 {
				lastFrame = refs[1].URL
			}
		}
		if firstFrame == "" && lastFrame == "" {
			return fmt.Errorf("i2v requires image_url and/or end_image_url")
		}
		if taskMode != "" {
			return fmt.Errorf("task_mode is only valid for r2v")
		}
		input.Task = "i2v"
		input.ImageURL = firstFrame
		input.EndImageURL = lastFrame
		// Bach docs: for i2v, aspect_ratio is always auto.
		input.AspectRatio = ""
		return nil

	case "r2v":
		// If firstFrame/lastFrame were also supplied alongside r2v media, include them as reference images in order.
		var merged []referenceInput
		mergedSeen := map[string]bool{}
		push := func(item referenceInput) {
			k := item.Type + "\x00" + item.URL
			if mergedSeen[k] {
				return
			}
			mergedSeen[k] = true
			merged = append(merged, item)
		}
		if firstFrame != "" {
			push(referenceInput{Type: "image", URL: firstFrame})
		}
		if lastFrame != "" {
			push(referenceInput{Type: "image", URL: lastFrame})
		}
		for _, item := range refs {
			push(item)
		}

		imgN, vidN, audN := countRefs(merged)
		if len(merged) == 0 {
			return fmt.Errorf("r2v requires non-empty reference_inputs")
		}
		if imgN == 0 && vidN == 0 {
			return fmt.Errorf("r2v requires at least one reference image or video; audio-only is not allowed")
		}
		if imgN > maxRefImages {
			return fmt.Errorf("r2v supports at most %d reference images (got %d)", maxRefImages, imgN)
		}
		if vidN > maxRefVideos {
			return fmt.Errorf("r2v supports at most %d reference videos (got %d)", maxRefVideos, vidN)
		}
		if audN > maxRefAudios {
			return fmt.Errorf("r2v supports at most %d reference audio files (got %d)", maxRefAudios, audN)
		}
		if len(merged) > maxRefTotal {
			return fmt.Errorf("r2v supports at most %d combined reference inputs (got %d)", maxRefTotal, len(merged))
		}
		if taskMode == "edit" && vidN != 1 {
			return fmt.Errorf("r2v with task_mode=edit requires exactly 1 reference video (got %d)", vidN)
		}
		input.Task = "r2v"
		if taskMode != "" {
			input.TaskMode = taskMode
		}
		input.ReferenceInputs = merged
		return nil

	default:
		return fmt.Errorf("unsupported task %q (supported: t2v, i2v, r2v)", task)
	}
}

func countRefs(items []referenceInput) (images, videos, audios int) {
	for _, item := range items {
		switch item.Type {
		case "image":
			images++
		case "video":
			videos++
		case "audio":
			audios++
		}
	}
	return images, videos, audios
}

func isPublicHTTPURL(u string) bool {
	lower := strings.ToLower(strings.TrimSpace(u))
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func truncateForError(s string) string {
	if len(s) <= 64 {
		return s
	}
	return s[:64] + "..."
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func optionalString(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if err := common.Unmarshal(raw, &s); err != nil {
		return ""
	}
	return strings.TrimSpace(s)
}

func optionalBool(candidates ...json.RawMessage) (*bool, error) {
	var out *bool
	for _, raw := range candidates {
		if len(raw) == 0 || string(raw) == "null" {
			continue
		}
		var value bool
		if err := common.Unmarshal(raw, &value); err != nil {
			continue
		}
		if out != nil && *out != value {
			return nil, fmt.Errorf("generate_audio and audio disagree")
		}
		v := value
		out = &v
	}
	return out, nil
}
