package hailuo

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

const (
	V2ModelMiniMaxH3       = "MiniMax-H3"
	V2PublicModelMiniMaxH3 = "minimax-h3"
	V2GenerateEndpoint     = "/v2/video_generation"
	V2QueryEndpointPrefix  = "/v2/query/video_generation/"

	V2Resolution768P = "768P"
	V2Resolution2K   = "2K"
	V2DefaultRatio   = "adaptive"
)

var V2ModelList = []string{V2ModelMiniMaxH3}

type V2MediaURL struct {
	URL string `json:"url"`
}

type V2ContentItem struct {
	Type     string      `json:"type"`
	Text     string      `json:"text,omitempty"`
	ImageURL *V2MediaURL `json:"image_url,omitempty"`
	VideoURL *V2MediaURL `json:"video_url,omitempty"`
	AudioURL *V2MediaURL `json:"audio_url,omitempty"`
	Role     string      `json:"role,omitempty"`
}

type V2VideoRequest struct {
	Model         string          `json:"model"`
	Content       []V2ContentItem `json:"content"`
	Resolution    string          `json:"resolution"`
	Duration      int             `json:"duration"`
	Ratio         string          `json:"ratio,omitempty"`
	CallbackURL   string          `json:"callback_url,omitempty"`
	AIGCWatermark *bool           `json:"aigc_watermark,omitempty"`
}

type v2RequestMetadata struct {
	Content       []V2ContentItem `json:"content,omitempty"`
	Resolution    string          `json:"resolution,omitempty"`
	Duration      *int            `json:"duration,omitempty"`
	Ratio         string          `json:"ratio,omitempty"`
	AspectRatio   string          `json:"aspect_ratio,omitempty"`
	CallbackURL   string          `json:"callback_url,omitempty"`
	AIGCWatermark *bool           `json:"aigc_watermark,omitempty"`
}

type v2GenerationMode string

const (
	v2ModeText      v2GenerationMode = "text"
	v2ModeFrame     v2GenerationMode = "frame"
	v2ModeReference v2GenerationMode = "reference"
)

func buildV2VideoRequest(req *relaycommon.TaskSubmitReq, upstreamModel string) (*V2VideoRequest, v2GenerationMode, error) {
	if req == nil {
		return nil, "", fmt.Errorf("minimax v2 request is nil")
	}
	normalizedModel, err := normalizeV2Model(upstreamModel)
	if err != nil {
		return nil, "", fmt.Errorf("minimax v2 unsupported model %q", upstreamModel)
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, "", fmt.Errorf("prompt is required")
	}
	if utf8.RuneCountInString(prompt) > 7000 {
		return nil, "", fmt.Errorf("prompt exceeds the MiniMax H3 limit of 7000 characters")
	}

	metadata, err := parseV2RequestMetadata(req.Metadata)
	if err != nil {
		return nil, "", err
	}
	resolution := firstNonEmpty(req.Resolution, metadata.Resolution)
	resolution, err = normalizeV2Resolution(resolution)
	if err != nil {
		return nil, "", err
	}
	duration := req.Duration
	if duration == 0 && metadata.Duration != nil {
		duration = *metadata.Duration
	}
	if duration < 4 || duration > 15 {
		return nil, "", fmt.Errorf("duration must be an integer between 4 and 15 seconds")
	}
	ratio := firstNonEmpty(req.AspectRatio, metadata.Ratio, metadata.AspectRatio)
	if ratio == "" && isV2Ratio(req.Size) {
		ratio = strings.TrimSpace(req.Size)
	}

	content, mode, err := buildV2Content(req, metadata.Content, prompt)
	if err != nil {
		return nil, "", err
	}
	ratio, err = normalizeV2RatioForMode(ratio, mode)
	if err != nil {
		return nil, "", err
	}

	return &V2VideoRequest{
		Model:         normalizedModel,
		Content:       content,
		Resolution:    resolution,
		Duration:      duration,
		Ratio:         ratio,
		CallbackURL:   strings.TrimSpace(metadata.CallbackURL),
		AIGCWatermark: metadata.AIGCWatermark,
	}, mode, nil
}

func normalizeV2Model(value string) (string, error) {
	switch strings.TrimSpace(value) {
	case V2ModelMiniMaxH3, V2PublicModelMiniMaxH3:
		return V2ModelMiniMaxH3, nil
	default:
		return "", fmt.Errorf("unsupported MiniMax V2 model")
	}
}

func parseV2RequestMetadata(raw map[string]any) (v2RequestMetadata, error) {
	metadata := v2RequestMetadata{}
	if len(raw) == 0 {
		return metadata, nil
	}
	data, err := common.Marshal(raw)
	if err != nil {
		return metadata, fmt.Errorf("marshal minimax v2 metadata: %w", err)
	}
	if err := common.Unmarshal(data, &metadata); err != nil {
		return metadata, fmt.Errorf("parse minimax v2 metadata: %w", err)
	}
	return metadata, nil
}

func buildV2Content(req *relaycommon.TaskSubmitReq, metadataContent []V2ContentItem, prompt string) ([]V2ContentItem, v2GenerationMode, error) {
	media := make([]V2ContentItem, 0, len(metadataContent)+len(req.Images))
	seen := make(map[string]struct{})
	appendItem := func(item V2ContentItem) error {
		if item.Type == "text" {
			return nil
		}
		url, err := v2ContentURL(item)
		if err != nil {
			return err
		}
		key := item.Type + "\x00" + url
		if _, exists := seen[key]; exists {
			return nil
		}
		seen[key] = struct{}{}
		media = append(media, item)
		return nil
	}
	for _, item := range metadataContent {
		if err := appendItem(item); err != nil {
			return nil, "", err
		}
	}

	for _, imageURL := range req.ReferenceImages {
		if err := appendItem(v2ImageContent(imageURL, "reference_image")); err != nil {
			return nil, "", err
		}
	}
	for _, imageURL := range req.Images {
		if err := appendItem(v2ImageContent(imageURL, "")); err != nil {
			return nil, "", err
		}
	}

	referenceMode := false
	frameMode := false
	unassignedImages := make([]int, 0, 2)
	for index := range media {
		item := &media[index]
		switch item.Type {
		case "video_url":
			if item.Role == "" {
				item.Role = "reference_video"
			}
			referenceMode = true
		case "audio_url":
			if item.Role == "" {
				item.Role = "reference_audio"
			}
			referenceMode = true
		case "image_url":
			switch item.Role {
			case "reference_image":
				referenceMode = true
			case "first_frame", "last_frame":
				frameMode = true
			case "":
				unassignedImages = append(unassignedImages, index)
			default:
				return nil, "", fmt.Errorf("invalid role %q for image_url", item.Role)
			}
		}
	}
	if referenceMode && frameMode {
		return nil, "", fmt.Errorf("reference media cannot be mixed with first_frame or last_frame")
	}

	if !referenceMode && !frameMode && len(unassignedImages) > 2 {
		referenceMode = true
	}
	if referenceMode {
		for _, index := range unassignedImages {
			media[index].Role = "reference_image"
		}
	} else {
		for position, index := range unassignedImages {
			if position == 0 && !hasV2Role(media, "first_frame") {
				media[index].Role = "first_frame"
				continue
			}
			if position <= 1 && !hasV2Role(media, "last_frame") {
				media[index].Role = "last_frame"
				continue
			}
			return nil, "", fmt.Errorf("frame mode supports at most one first_frame and one last_frame")
		}
	}

	if err := validateV2MediaCounts(media); err != nil {
		return nil, "", err
	}
	mode := v2ModeText
	if referenceMode {
		mode = v2ModeReference
	} else if len(media) > 0 {
		mode = v2ModeFrame
	}
	content := make([]V2ContentItem, 0, len(media)+1)
	content = append(content, V2ContentItem{Type: "text", Text: prompt})
	content = append(content, media...)
	return content, mode, nil
}

func v2ImageContent(rawURL string, role string) V2ContentItem {
	url := strings.TrimSpace(rawURL)
	return V2ContentItem{Type: "image_url", ImageURL: &V2MediaURL{URL: url}, Role: role}
}

func v2ContentURL(item V2ContentItem) (string, error) {
	var rawURL string
	switch item.Type {
	case "image_url":
		if item.ImageURL != nil {
			rawURL = item.ImageURL.URL
		}
	case "video_url":
		if item.VideoURL != nil {
			rawURL = item.VideoURL.URL
		}
		if item.Role != "" && item.Role != "reference_video" {
			return "", fmt.Errorf("invalid role %q for video_url", item.Role)
		}
	case "audio_url":
		if item.AudioURL != nil {
			rawURL = item.AudioURL.URL
		}
		if item.Role != "" && item.Role != "reference_audio" {
			return "", fmt.Errorf("invalid role %q for audio_url", item.Role)
		}
	default:
		return "", fmt.Errorf("unsupported minimax v2 content type %q", item.Type)
	}
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", fmt.Errorf("%s content requires a non-empty url", item.Type)
	}
	return rawURL, nil
}

func validateV2MediaCounts(media []V2ContentItem) error {
	counts := map[string]int{}
	for _, item := range media {
		counts[item.Role]++
	}
	if counts["first_frame"] > 1 || counts["last_frame"] > 1 {
		return fmt.Errorf("first_frame and last_frame each support at most one image")
	}
	if counts["reference_image"] > 9 {
		return fmt.Errorf("reference_image supports at most 9 images")
	}
	if counts["reference_video"] > 3 {
		return fmt.Errorf("reference_video supports at most 3 videos")
	}
	if counts["reference_audio"] > 3 {
		return fmt.Errorf("reference_audio supports at most 3 audio files")
	}
	referenceMediaCount := counts["reference_image"] + counts["reference_video"] + counts["reference_audio"]
	if referenceMediaCount > 12 {
		return fmt.Errorf("reference mode supports at most 12 media files in total")
	}
	if counts["reference_audio"] > 0 && counts["reference_image"]+counts["reference_video"] == 0 {
		return fmt.Errorf("reference audio requires at least one reference image or video")
	}
	return nil
}

func normalizeV2Resolution(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "768p":
		return V2Resolution768P, nil
	case "1440p", "2k":
		return V2Resolution2K, nil
	default:
		return "", fmt.Errorf("resolution is required and must be 768P or 1440P")
	}
}

func v2PublicPricingResolution(value string) (string, error) {
	normalized, err := normalizeV2Resolution(value)
	if err != nil {
		return "", err
	}
	if normalized == V2Resolution2K {
		return "1440p", nil
	}
	return "768p", nil
}

func normalizeV2RatioForMode(value string, mode v2GenerationMode) (string, error) {
	ratio := strings.TrimSpace(value)
	if mode == v2ModeFrame {
		return V2DefaultRatio, nil
	}
	if mode == v2ModeReference && ratio == "" {
		return V2DefaultRatio, nil
	}
	if !isV2Ratio(ratio) {
		return "", fmt.Errorf("ratio must be one of 21:9, 16:9, 4:3, 1:1, 3:4, 9:16%s", map[bool]string{true: ", adaptive"}[mode == v2ModeReference])
	}
	if mode == v2ModeText && ratio == V2DefaultRatio {
		return "", fmt.Errorf("text-to-video ratio is required and cannot be adaptive")
	}
	return ratio, nil
}

func isV2Ratio(value string) bool {
	switch strings.TrimSpace(value) {
	case V2DefaultRatio, "21:9", "16:9", "4:3", "1:1", "3:4", "9:16":
		return true
	default:
		return false
	}
}

func hasV2Role(items []V2ContentItem, role string) bool {
	for _, item := range items {
		if item.Role == role {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func countV2InputImages(content []V2ContentItem) int {
	count := 0
	for _, item := range content {
		if item.Type == "image_url" && item.ImageURL != nil {
			count++
		}
	}
	return count
}
