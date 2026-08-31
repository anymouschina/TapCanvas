package funai

import (
	"fmt"
	"strconv"
	"strings"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

type SubmitPayload struct {
	Model             string   `json:"model"`
	Prompt            string   `json:"prompt,omitempty"`
	Seconds           *int     `json:"seconds,omitempty"`
	Size              string   `json:"size,omitempty"`
	Resolution        string   `json:"resolution,omitempty"`
	AspectRatio       string   `json:"aspect_ratio,omitempty"`
	Audio             *bool    `json:"audio,omitempty"`
	Quantity          *int     `json:"quantity,omitempty"`
	StartFrame        string   `json:"start_frame,omitempty"`
	EndFrame          string   `json:"end_frame,omitempty"`
	ReferenceImages   []string `json:"reference_images,omitempty"`
	Images            []string `json:"images,omitempty"`
	StyleReferences   []string `json:"style_references,omitempty"`
	ElementReferences []string `json:"element_references,omitempty"`
	InputVideo        string   `json:"input_video,omitempty"`
	VideoReferences   []string `json:"video_references,omitempty"`
	AudioReference    []string `json:"audio_reference,omitempty"`
	ReferenceStrength string   `json:"reference_strength,omitempty"`
}

type mediaInputs struct {
	startFrame        string
	endFrame          string
	referenceImages   []string
	styleReferences   []string
	elementReferences []string
	videos            []string
	audioReferences   []string
	audio             *bool
	referenceStrength string
	videoReferType    string
}

func BuildSubmitPayload(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	if req == nil {
		return nil, fmt.Errorf("funai: nil task request")
	}
	inputs := collectMediaInputs(req)
	payload := basePayload(req, inputs)

	switch strings.ToLower(strings.TrimSpace(req.Model)) {
	case modelSeedance20:
		return buildSeedancePayload(payload, inputs)
	case modelKlingV3:
		return buildKlingV3Payload(payload, inputs)
	case modelKlingO3:
		return buildKlingO3Payload(payload, inputs)
	default:
		return nil, fmt.Errorf("funai: unsupported public model %q", req.Model)
	}
}

func basePayload(req *relaycommon.TaskSubmitReq, inputs mediaInputs) *SubmitPayload {
	payload := &SubmitPayload{
		Prompt:            strings.TrimSpace(req.Prompt),
		Size:              normalizedSize(req.Size),
		Resolution:        normalizedResolution(req.Resolution),
		AspectRatio:       strings.TrimSpace(req.AspectRatio),
		Audio:             inputs.audio,
		ReferenceStrength: inputs.referenceStrength,
	}
	if payload.AspectRatio == "" && strings.Contains(req.Size, ":") {
		payload.AspectRatio = strings.TrimSpace(req.Size)
		payload.Size = ""
	}
	if seconds := requestSeconds(req); seconds > 0 {
		payload.Seconds = &seconds
	}
	return payload
}

func buildSeedancePayload(payload *SubmitPayload, inputs mediaInputs) (*SubmitPayload, error) {
	payload.Model = modelSeedance20
	one := 1
	payload.Quantity = &one
	if err := validateSeconds(payload.Seconds, 4, 15, modelSeedance20); err != nil {
		return nil, err
	}
	if resolution := effectiveResolution(payload); resolution != "" && resolution != "720P" {
		return nil, fmt.Errorf("funai %s: current provider pool only accepts 720P, got %s", modelSeedance20, resolution)
	}
	if len(inputs.styleReferences) > 0 || len(inputs.elementReferences) > 0 {
		return nil, fmt.Errorf("funai %s: style_references and element_references are not supported", modelSeedance20)
	}
	if inputs.endFrame != "" && inputs.startFrame == "" {
		return nil, fmt.Errorf("funai %s: end_frame requires start_frame", modelSeedance20)
	}
	if inputs.startFrame != "" && (len(inputs.referenceImages) > 0 || len(inputs.videos) > 0) {
		return nil, fmt.Errorf("funai %s: frame mode cannot be combined with reference_images or video_references", modelSeedance20)
	}
	if len(inputs.referenceImages) > 4 {
		return nil, fmt.Errorf("funai %s: at most 4 reference_images are supported", modelSeedance20)
	}
	if len(inputs.videos) > 3 {
		return nil, fmt.Errorf("funai %s: at most 3 video_references are supported", modelSeedance20)
	}
	if len(inputs.audioReferences) > 1 {
		return nil, fmt.Errorf("funai %s: at most 1 audio reference is supported", modelSeedance20)
	}
	if len(inputs.audioReferences) > 0 && len(inputs.referenceImages) == 0 && len(inputs.videos) == 0 {
		return nil, fmt.Errorf("funai %s: audio reference requires image or video references", modelSeedance20)
	}
	payload.StartFrame = inputs.startFrame
	payload.EndFrame = inputs.endFrame
	payload.ReferenceImages = inputs.referenceImages
	payload.VideoReferences = inputs.videos
	payload.AudioReference = inputs.audioReferences
	return payload, nil
}

func buildKlingV3Payload(payload *SubmitPayload, inputs mediaInputs) (*SubmitPayload, error) {
	if err := validateSeconds(payload.Seconds, 3, 15, modelKlingV3); err != nil {
		return nil, err
	}
	usesOmni := len(inputs.videos) > 0 || len(inputs.styleReferences) > 0 || len(inputs.elementReferences) > 0
	if !usesOmni {
		payload.Model = modelKlingV3
		if len(inputs.audioReferences) > 0 {
			return nil, fmt.Errorf("funai %s: audio reference input is not supported", modelKlingV3)
		}
		allFrames := uniqueStrings(append(appendFrameValues(inputs.startFrame, inputs.endFrame), inputs.referenceImages...))
		if len(allFrames) > 2 {
			return nil, fmt.Errorf("funai %s: at most 2 frame images are supported", modelKlingV3)
		}
		frames := appendFrameFallbacks(inputs.startFrame, inputs.endFrame, inputs.referenceImages)
		payload.StartFrame, payload.EndFrame = frames[0], frames[1]
		if payload.EndFrame != "" && payload.StartFrame == "" {
			return nil, fmt.Errorf("funai %s: end_frame requires start_frame", modelKlingV3)
		}
		return payload, nil
	}

	payload.Model = modelKlingV3OmniV2V
	if err := validateV2VOutput(payload, modelKlingV3OmniV2V); err != nil {
		return nil, err
	}
	if len(inputs.videos) > 1 {
		return nil, fmt.Errorf("funai %s: at most 1 input_video is supported", modelKlingV3OmniV2V)
	}
	if inputs.startFrame != "" || inputs.endFrame != "" {
		return nil, fmt.Errorf("funai %s: start_frame/end_frame are not supported", modelKlingV3OmniV2V)
	}
	if len(inputs.audioReferences) > 0 {
		return nil, fmt.Errorf("funai %s: audio reference input is not supported", modelKlingV3OmniV2V)
	}
	elements := append([]string(nil), inputs.elementReferences...)
	if len(inputs.referenceImages) > 0 {
		if inputs.videoReferType != "feature" {
			return nil, fmt.Errorf("funai %s: untyped reference images are ambiguous; send style_references/element_references or video_refer_type=feature", modelKlingV3OmniV2V)
		}
		elements = append(elements, inputs.referenceImages...)
	}
	if len(inputs.styleReferences) > 3 || len(elements) > 3 {
		return nil, fmt.Errorf("funai %s: at most 3 style and 3 element references are supported", modelKlingV3OmniV2V)
	}
	payload.StyleReferences = uniqueStrings(inputs.styleReferences)
	payload.ElementReferences = uniqueStrings(elements)
	if len(inputs.videos) == 1 {
		payload.InputVideo = inputs.videos[0]
	}
	return payload, nil
}

func buildKlingO3Payload(payload *SubmitPayload, inputs mediaInputs) (*SubmitPayload, error) {
	if len(inputs.audioReferences) > 0 {
		return nil, fmt.Errorf("funai %s: audio reference input is not supported", modelKlingO3)
	}
	usesV2V := len(inputs.videos) > 0 || len(inputs.styleReferences) > 0 || len(inputs.elementReferences) > 0
	if !usesV2V {
		payload.Model = modelKlingO3
		if err := validateSeconds(payload.Seconds, 3, 15, modelKlingO3); err != nil {
			return nil, err
		}
		if inputs.startFrame != "" && len(inputs.referenceImages) > 0 {
			return nil, fmt.Errorf("funai %s: frame mode cannot be combined with reference_images", modelKlingO3)
		}
		if inputs.endFrame != "" && inputs.startFrame == "" {
			return nil, fmt.Errorf("funai %s: end_frame requires start_frame", modelKlingO3)
		}
		if len(inputs.referenceImages) > 7 {
			return nil, fmt.Errorf("funai %s: at most 7 reference_images are supported", modelKlingO3)
		}
		payload.StartFrame = inputs.startFrame
		payload.EndFrame = inputs.endFrame
		payload.ReferenceImages = inputs.referenceImages
		return payload, nil
	}

	if len(inputs.videos) > 1 {
		return nil, fmt.Errorf("funai kling-o3 V2V: at most 1 input_video is supported")
	}
	if err := validateSeconds(payload.Seconds, 3, 15, "kling-o3 V2V"); err != nil {
		return nil, err
	}
	if err := validateV2VOutput(payload, "kling-o3 V2V"); err != nil {
		return nil, err
	}
	payload.Model = modelKlingO3StandardV2V
	if len(inputs.styleReferences) > 0 || len(inputs.elementReferences) > 0 {
		payload.Model = modelKlingO3ProV2V
	}
	if len(inputs.styleReferences) > 3 || len(inputs.elementReferences) > 3 {
		return nil, fmt.Errorf("funai %s: at most 3 style and 3 element references are supported", payload.Model)
	}
	visualCount := len(inputs.referenceImages) + len(inputs.styleReferences) + len(inputs.elementReferences)
	if inputs.startFrame != "" {
		visualCount++
	}
	if inputs.endFrame != "" {
		visualCount++
	}
	if len(inputs.videos) > 0 {
		visualCount++
	}
	if visualCount > 4 {
		return nil, fmt.Errorf("funai %s: all visual and video references combined must not exceed 4", payload.Model)
	}
	payload.Images = uniqueStrings(append(appendFrameValues(inputs.startFrame, inputs.endFrame), inputs.referenceImages...))
	payload.StyleReferences = inputs.styleReferences
	payload.ElementReferences = inputs.elementReferences
	if len(inputs.videos) == 1 {
		payload.InputVideo = inputs.videos[0]
	}
	return payload, nil
}

func validateSeconds(seconds *int, min, max int, modelName string) error {
	if seconds == nil {
		return nil
	}
	if *seconds < min || *seconds > max {
		return fmt.Errorf("funai %s: seconds must be between %d and %d", modelName, min, max)
	}
	return nil
}

func validateV2VOutput(payload *SubmitPayload, modelName string) error {
	if resolution := effectiveResolution(payload); resolution != "" && resolution != "720P" {
		return fmt.Errorf("funai %s: only 720P output is supported, got %s", modelName, resolution)
	}
	if ratio := strings.TrimSpace(payload.AspectRatio); ratio != "" && ratio != "16:9" && ratio != "9:16" {
		return fmt.Errorf("funai %s: only 16:9 and 9:16 are supported", modelName)
	}
	return nil
}

func effectiveResolution(payload *SubmitPayload) string {
	if payload.Resolution != "" {
		return payload.Resolution
	}
	switch strings.ToLower(payload.Size) {
	case "1280x720", "720x1280":
		return "720P"
	case "1920x1080", "1080x1920":
		return "1080P"
	case "3840x2160", "2160x3840":
		return "2160P"
	default:
		return ""
	}
}

func requestSeconds(req *relaycommon.TaskSubmitReq) int {
	if req.Duration > 0 {
		return req.Duration
	}
	seconds, _ := strconv.Atoi(strings.TrimSpace(req.Seconds))
	return seconds
}

func normalizedResolution(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "4K" {
		return "2160P"
	}
	return value
}

func normalizedSize(value string) string {
	value = strings.TrimSpace(value)
	if strings.Contains(value, "x") {
		return value
	}
	return ""
}

func collectMediaInputs(req *relaycommon.TaskSubmitReq) mediaInputs {
	inputs := mediaInputs{}
	inputs.referenceImages = append(inputs.referenceImages, req.Images...)
	inputs.referenceImages = append(inputs.referenceImages, req.ReferenceImages...)
	inputs.referenceImages = append(inputs.referenceImages, req.Urls...)
	inputs.referenceImages = appendValue(inputs.referenceImages, req.InputReference)
	inputs.referenceImages = appendValue(inputs.referenceImages, req.Image)
	metadata := req.Metadata
	if metadata == nil {
		inputs.referenceImages = uniqueStrings(inputs.referenceImages)
		return inputs
	}

	inputs.startFrame = firstString(metadata, "start_frame", "startFrame", "first_frame_url")
	inputs.endFrame = firstString(metadata, "end_frame", "endFrame", "last_frame_url")
	inputs.referenceImages = append(inputs.referenceImages, stringSlice(metadata, "reference_images", "referenceImages", "images")...)
	inputs.styleReferences = stringSlice(metadata, "style_references", "styleReferences")
	inputs.elementReferences = stringSlice(metadata, "element_references", "elementReferences")
	inputs.videos = stringSlice(metadata, "video_references", "videoReferences", "video_urls")
	inputs.videos = appendValue(inputs.videos, firstString(metadata, "input_video", "inputVideo", "video_url"))
	inputs.audioReferences = stringSlice(metadata, "audio_references", "audioReferences")
	inputs.audioReferences = appendValue(inputs.audioReferences, firstString(metadata, "audio_reference", "audioReference"))
	inputs.referenceStrength = firstString(metadata, "reference_strength", "referenceStrength")
	inputs.videoReferType = strings.ToLower(firstString(metadata, "video_refer_type", "videoReferType"))
	if value, ok := metadata["audio"].(bool); ok {
		inputs.audio = &value
	}
	collectContent(metadata["content"], &inputs)

	inputs.referenceImages = uniqueStrings(inputs.referenceImages)
	inputs.styleReferences = uniqueStrings(inputs.styleReferences)
	inputs.elementReferences = uniqueStrings(inputs.elementReferences)
	inputs.videos = uniqueStrings(inputs.videos)
	inputs.audioReferences = uniqueStrings(inputs.audioReferences)
	return inputs
}

func collectContent(value any, inputs *mediaInputs) {
	items, ok := value.([]any)
	if !ok {
		return
	}
	for _, item := range items {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		typeName, _ := entry["type"].(string)
		role, _ := entry["role"].(string)
		switch typeName {
		case "image_url":
			url := nestedURL(entry["image_url"])
			switch role {
			case "first_frame":
				if inputs.startFrame == "" {
					inputs.startFrame = url
				}
			case "last_frame":
				if inputs.endFrame == "" {
					inputs.endFrame = url
				}
			case "style_reference":
				inputs.styleReferences = appendValue(inputs.styleReferences, url)
			case "element_reference":
				inputs.elementReferences = appendValue(inputs.elementReferences, url)
			default:
				inputs.referenceImages = appendValue(inputs.referenceImages, url)
			}
		case "video_url":
			inputs.videos = appendValue(inputs.videos, nestedURL(entry["video_url"]))
		case "audio_url":
			inputs.audioReferences = appendValue(inputs.audioReferences, nestedURL(entry["audio_url"]))
		}
	}
}

func nestedURL(value any) string {
	if raw, ok := value.(string); ok {
		return strings.TrimSpace(raw)
	}
	entry, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	url, _ := entry["url"].(string)
	return strings.TrimSpace(url)
}

func firstString(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := metadata[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringSlice(metadata map[string]any, keys ...string) []string {
	for _, key := range keys {
		switch values := metadata[key].(type) {
		case []string:
			return uniqueStrings(values)
		case []any:
			out := make([]string, 0, len(values))
			for _, value := range values {
				if text, ok := value.(string); ok {
					out = appendValue(out, text)
				}
			}
			return uniqueStrings(out)
		}
	}
	return nil
}

func appendFrameFallbacks(first, last string, references []string) [2]string {
	frames := [2]string{first, last}
	for _, reference := range references {
		if frames[0] == "" {
			frames[0] = reference
			continue
		}
		if frames[1] == "" && reference != frames[0] {
			frames[1] = reference
		}
	}
	return frames
}

func appendFrameValues(first, last string) []string {
	values := make([]string, 0, 2)
	values = appendValue(values, first)
	values = appendValue(values, last)
	return values
}

func appendValue(values []string, value string) []string {
	if value = strings.TrimSpace(value); value != "" {
		return append(values, value)
	}
	return values
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
