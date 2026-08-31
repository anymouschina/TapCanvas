package megaby

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

type SubmitPayload struct {
	Model           string   `json:"model"`
	Prompt          string   `json:"prompt"`
	Duration        *int     `json:"duration,omitempty"`
	Ratio           string   `json:"ratio"`
	Resolution      string   `json:"resolution"`
	ReferenceImages []string `json:"referenceImages,omitempty"`
	ReferenceVideos []string `json:"referenceVideos,omitempty"`
	ReferenceAudios []string `json:"referenceAudios,omitempty"`
}

type mediaReferences struct {
	images []string
	videos []string
	audios []string
}

func BuildSubmitPayload(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	if req == nil {
		return nil, fmt.Errorf("megaby: nil task request")
	}
	publicModel := strings.TrimSpace(req.Model)
	providerSpec, err := resolveProviderModel(publicModel, req.Resolution)
	if err != nil {
		return nil, err
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, fmt.Errorf("megaby %s: prompt is required", publicModel)
	}
	duration, err := resolveDuration(req)
	if err != nil {
		return nil, fmt.Errorf("megaby %s: %w", publicModel, err)
	}
	if duration == nil {
		defaultDuration := 5
		duration = &defaultDuration
	}
	ratio := strings.TrimSpace(req.AspectRatio)
	if ratio == "" && strings.Contains(req.Size, ":") {
		ratio = strings.TrimSpace(req.Size)
	}
	if ratio == "" {
		ratio = "16:9"
	}
	if ratio != "16:9" && ratio != "9:16" && ratio != "1:1" {
		return nil, fmt.Errorf("megaby %s: ratio must be 16:9, 9:16, or 1:1", publicModel)
	}
	references, err := collectMediaReferences(req)
	if err != nil {
		return nil, fmt.Errorf("megaby %s: %w", publicModel, err)
	}
	limits, configured := providerMediaLimits[publicModel]
	if !configured {
		return nil, fmt.Errorf("megaby: media limits are not configured for public model %q", publicModel)
	}
	if len(references.images) > limits.images {
		return nil, fmt.Errorf("megaby %s: at most %d reference images are supported", publicModel, limits.images)
	}
	if len(references.videos) > limits.videos {
		return nil, fmt.Errorf("megaby %s: at most %d reference videos are supported", publicModel, limits.videos)
	}
	if len(references.audios) > limits.audios {
		return nil, fmt.Errorf("megaby %s: at most %d reference audios are supported", publicModel, limits.audios)
	}

	return &SubmitPayload{
		Model:           providerSpec.providerModel,
		Prompt:          prompt,
		Duration:        duration,
		Ratio:           ratio,
		Resolution:      providerSpec.resolution,
		ReferenceImages: references.images,
		ReferenceVideos: references.videos,
		ReferenceAudios: references.audios,
	}, nil
}

func resolveBillingSpec(req *relaycommon.TaskSubmitReq) (string, int, error) {
	if req == nil {
		return "", 0, fmt.Errorf("megaby: nil task request")
	}
	resolution := strings.ToLower(strings.TrimSpace(req.Resolution))
	duration := req.Duration
	if resolution == "" || duration <= 0 {
		return "", 0, fmt.Errorf("megaby %s: normalized resolution and duration are required for billing", req.Model)
	}
	references, err := collectMediaReferences(req)
	if err != nil {
		return "", 0, err
	}
	if _, hasReferenceVideoPricing := referenceVideoCostMultipliers[req.Model]; hasReferenceVideoPricing && len(references.videos) > 0 {
		resolution += "+video"
	}
	return resolution, duration, nil
}

func normalizeRequestForBilling(req relaycommon.TaskSubmitReq) (relaycommon.TaskSubmitReq, error) {
	payload, err := BuildSubmitPayload(&req)
	if err != nil {
		return relaycommon.TaskSubmitReq{}, err
	}
	req.Model = strings.TrimSpace(req.Model)
	req.Resolution = payload.Resolution
	req.Duration = *payload.Duration
	req.AspectRatio = payload.Ratio
	return req, nil
}

func resolveProviderModel(publicModel, requestedResolution string) (providerModelSpec, error) {
	modelName := strings.TrimSpace(publicModel)
	resolutionMap, supported := providerModels[modelName]
	if !supported {
		return providerModelSpec{}, fmt.Errorf("megaby: unsupported public model %q", modelName)
	}
	resolution := strings.ToLower(strings.TrimSpace(requestedResolution))
	if resolution == "" {
		resolution = defaultModelResolutions[modelName]
	}
	providerSpec, supported := resolutionMap[resolution]
	if supported {
		return providerSpec, nil
	}
	available := make([]string, 0, len(resolutionMap))
	for candidate := range resolutionMap {
		available = append(available, candidate)
	}
	sort.Strings(available)
	return providerModelSpec{}, fmt.Errorf(
		"megaby %s: unsupported resolution %q; supported resolutions: %s",
		modelName,
		requestedResolution,
		strings.Join(available, ", "),
	)
}

func resolveDuration(req *relaycommon.TaskSubmitReq) (*int, error) {
	duration := req.Duration
	if duration <= 0 && strings.TrimSpace(req.Seconds) != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(req.Seconds))
		if err != nil {
			return nil, fmt.Errorf("seconds must be an integer")
		}
		duration = parsed
	}
	if duration == 0 {
		return nil, nil
	}
	if duration < 4 || duration > 15 {
		return nil, fmt.Errorf("duration must be between 4 and 15 seconds")
	}
	return &duration, nil
}

func collectMediaReferences(req *relaycommon.TaskSubmitReq) (mediaReferences, error) {
	refs := mediaReferences{}
	addImage := func(value string) error {
		return appendMediaURL(&refs.images, value)
	}
	addVideo := func(value string) error {
		return appendMediaURL(&refs.videos, value)
	}
	addAudio := func(value string) error {
		return appendMediaURL(&refs.audios, value)
	}

	for _, value := range req.ReferenceImages {
		if err := addImage(value); err != nil {
			return refs, err
		}
	}
	for _, value := range req.Images {
		if err := addImage(value); err != nil {
			return refs, err
		}
	}
	for _, value := range req.Urls {
		if err := addImage(value); err != nil {
			return refs, err
		}
	}
	for _, value := range []string{req.Image, req.InputReference} {
		if err := addImage(value); err != nil {
			return refs, err
		}
	}

	metadata := req.Metadata
	if metadata == nil {
		return refs, nil
	}
	if hasNonEmptyMetadataValue(
		metadata,
		"first_image",
		"last_image",
		"first_frame_url",
		"last_frame_url",
		"image_start",
		"image_end",
	) {
		return refs, fmt.Errorf("first/last frame inputs are not supported by this provider")
	}
	if hasNonEmptyMetadataValue(
		metadata,
		"styleReferences",
		"style_references",
		"elementReferences",
		"element_references",
	) {
		return refs, fmt.Errorf("style and element reference roles are not supported by this provider")
	}
	for _, key := range []string{"referenceImages", "reference_images"} {
		for _, value := range metadataStringSlice(metadata[key]) {
			if err := addImage(value); err != nil {
				return refs, err
			}
		}
	}
	for _, key := range []string{"referenceVideos", "reference_videos", "video_urls"} {
		for _, value := range metadataStringSlice(metadata[key]) {
			if err := addVideo(value); err != nil {
				return refs, err
			}
		}
	}
	if value, ok := metadata["video_url"].(string); ok {
		if err := addVideo(value); err != nil {
			return refs, err
		}
	}
	for _, key := range []string{"referenceAudios", "reference_audios", "audio_urls"} {
		for _, value := range metadataStringSlice(metadata[key]) {
			if err := addAudio(value); err != nil {
				return refs, err
			}
		}
	}
	if content, ok := metadata["content"].([]any); ok {
		for _, item := range content {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			typeName, _ := entry["type"].(string)
			role, _ := entry["role"].(string)
			switch strings.TrimSpace(role) {
			case "first_frame", "last_frame", "start_frame", "end_frame", "first_image", "last_image":
				return refs, fmt.Errorf("first/last frame roles are not supported by this provider")
			}
			var add func(string) error
			switch typeName {
			case "image_url":
				add = addImage
			case "video_url":
				add = addVideo
			case "audio_url":
				add = addAudio
			default:
				continue
			}
			value := nestedMediaURL(entry[typeName])
			if err := add(value); err != nil {
				return refs, err
			}
		}
	}
	return refs, nil
}

func appendMediaURL(values *[]string, raw string) error {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("media reference must be a public http/https URL: %q", trimmed)
	}
	for _, existing := range *values {
		if existing == trimmed {
			return nil
		}
	}
	*values = append(*values, trimmed)
	return nil
}

func metadataStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func nestedMediaURL(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	if object, ok := value.(map[string]any); ok {
		text, _ := object["url"].(string)
		return text
	}
	return ""
}

func hasNonEmptyMetadataValue(metadata map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, exists := metadata[key]
		if !exists {
			continue
		}
		if text, ok := value.(string); !ok || strings.TrimSpace(text) != "" {
			return true
		}
	}
	return false
}
