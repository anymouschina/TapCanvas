package dto

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

type ImageRequest struct {
	Model             string          `json:"model"`
	Prompt            string          `json:"prompt" binding:"required"`
	N                 *uint           `json:"n,omitempty"`
	Size              string          `json:"size,omitempty"`
	Quality           string          `json:"quality,omitempty"`
	ResponseFormat    string          `json:"response_format,omitempty"`
	Style             json.RawMessage `json:"style,omitempty"`
	User              json.RawMessage `json:"user,omitempty"`
	ExtraFields       json.RawMessage `json:"extra_fields,omitempty"`
	Background        json.RawMessage `json:"background,omitempty"`
	Moderation        json.RawMessage `json:"moderation,omitempty"`
	OutputFormat      json.RawMessage `json:"output_format,omitempty"`
	OutputCompression json.RawMessage `json:"output_compression,omitempty"`
	PartialImages     json.RawMessage `json:"partial_images,omitempty"`
	// Stream            bool            `json:"stream,omitempty"`
	Watermark *bool `json:"watermark,omitempty"`
	// zhipu 4v
	WatermarkEnabled json.RawMessage     `json:"watermark_enabled,omitempty"`
	UserId           json.RawMessage     `json:"user_id,omitempty"`
	Image            json.RawMessage     `json:"image,omitempty"`
	Images           []ImageURLReference `json:"images,omitempty"`
	Mask             *ImageURLReference  `json:"mask,omitempty"`
	// 用匿名参数接收额外参数
	Extra map[string]json.RawMessage `json:"-"`
}

// ImageURLReference is the JSON image reference shape accepted by the G-AISC
// image edit endpoint. It is deliberately typed so the gateway preserves the
// images[].image_url and mask.image_url contract without semantic guessing.
type ImageURLReference struct {
	ImageURL string `json:"image_url"`
}

// UnmarshalJSON accepts both the canonical G-AISC object shape and the legacy
// string-array shape used by existing callers. MarshalJSON remains canonical:
// every reference is emitted as {"image_url":"..."}.
func (reference *ImageURLReference) UnmarshalJSON(data []byte) error {
	var imageURL string
	if err := common.Unmarshal(data, &imageURL); err == nil {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			return errors.New("image URL must not be empty")
		}
		reference.ImageURL = imageURL
		return nil
	}

	type imageURLReferenceAlias ImageURLReference
	var object imageURLReferenceAlias
	if err := common.Unmarshal(data, &object); err != nil {
		return err
	}
	object.ImageURL = strings.TrimSpace(object.ImageURL)
	if object.ImageURL == "" {
		return errors.New("image_url must not be empty")
	}
	*reference = ImageURLReference(object)
	return nil
}

func (i *ImageRequest) UnmarshalJSON(data []byte) error {
	// 先解析成 map[string]interface{}
	var rawMap map[string]json.RawMessage
	if err := common.Unmarshal(data, &rawMap); err != nil {
		return err
	}

	// 用 struct tag 获取所有已定义字段名
	knownFields := GetJSONFieldNames(reflect.TypeOf(*i))

	// 再正常解析已定义字段
	type Alias ImageRequest
	var known Alias
	if err := common.Unmarshal(data, &known); err != nil {
		return err
	}
	*i = ImageRequest(known)

	// 提取多余字段
	i.Extra = make(map[string]json.RawMessage)
	for k, v := range rawMap {
		if _, ok := knownFields[k]; !ok {
			i.Extra[k] = v
		}
	}
	return nil
}

// 序列化时需要重新把字段平铺
func (r ImageRequest) MarshalJSON() ([]byte, error) {
	// 将已定义字段转为 map
	type Alias ImageRequest
	alias := Alias(r)
	base, err := common.Marshal(alias)
	if err != nil {
		return nil, err
	}

	var baseMap map[string]json.RawMessage
	if err := common.Unmarshal(base, &baseMap); err != nil {
		return nil, err
	}

	for k, v := range r.Extra {
		if _, exists := baseMap[k]; !exists {
			baseMap[k] = v
		}
	}

	return common.Marshal(baseMap)
}

func GetJSONFieldNames(t reflect.Type) map[string]struct{} {
	fields := make(map[string]struct{})
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)

		// 跳过匿名字段（例如 ExtraFields）
		if field.Anonymous {
			continue
		}

		tag := field.Tag.Get("json")
		if tag == "-" || tag == "" {
			continue
		}

		// 取逗号前字段名（排除 omitempty 等）
		name := tag
		if commaIdx := indexComma(tag); commaIdx != -1 {
			name = tag[:commaIdx]
		}
		fields[name] = struct{}{}
	}
	return fields
}

func indexComma(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			return i
		}
	}
	return -1
}

func isHighResImageModel(model string) bool {
	return strings.Contains(model, "gpt-image-2") ||
		strings.Contains(model, "banana") ||
		model == "doubao-seedream-5-0-260128"
}

func (i *ImageRequest) GetTokenCountMeta() *types.TokenCountMeta {
	var sizeRatio = 1.0
	var qualityRatio = 1.0

	if strings.HasPrefix(i.Model, "dall-e") {
		// Size
		if i.Size == "256x256" {
			sizeRatio = 0.4
		} else if i.Size == "512x512" {
			sizeRatio = 0.45
		} else if i.Size == "1024x1024" {
			sizeRatio = 1
		} else if i.Size == "1024x1792" || i.Size == "1792x1024" {
			sizeRatio = 2
		}

		if i.Model == "dall-e-3" && i.Quality == "hd" {
			qualityRatio = 2.0
			if i.Size == "1024x1792" || i.Size == "1792x1024" {
				qualityRatio = 1.5
			}
		}
	} else if isHighResImageModel(i.Model) {
		// Prefer explicit imageSize extra field (1K/2K/4K) sent by apimart-style callers.
		// Ratio matches fixedImagePricingRules: 1K→1×, 2K→2×, 4K→3×.
		resolved := false
		for _, key := range []string{"imageSize", "image_size"} {
			raw, ok := i.Extra[key]
			if !ok || len(raw) == 0 {
				continue
			}
			var sz string
			if common.Unmarshal(raw, &sz) == nil {
				switch strings.ToUpper(strings.TrimSpace(sz)) {
				case "2K":
					sizeRatio = 2.0
					resolved = true
				case "4K":
					sizeRatio = 3.0
					resolved = true
				case "1K":
					// sizeRatio stays 1.0
					resolved = true
				}
			}
			if resolved {
				break
			}
		}
		if !resolved {
			// Fallback: pixel-based size field or quality flag.
			if strings.Contains(i.Size, "4096") || i.Quality == "high" {
				sizeRatio = 2.0
			}
		}
	}

	// n is NOT included here; it is handled via OtherRatio("n") in
	// image_handler.go (default) or channel adaptors (actual count).
	// Including n here caused double-counting for channels that also
	// set OtherRatio("n") (e.g. Ali/Bailian).
	return &types.TokenCountMeta{
		CombineText:     i.Prompt,
		MaxTokens:       1584,
		ImagePriceRatio: sizeRatio * qualityRatio,
	}
}

// ValidateGptImage2Size validates the official GPT Image 2 pixel-dimension
// contract, while also accepting the frontend's ratio contract. Ratios are
// normalized to pixel dimensions by NormalizeGptImage2Size before the request
// is sent upstream.
func ValidateGptImage2Size(size string) error {
	size = strings.TrimSpace(size)
	if size == "" || strings.EqualFold(size, "auto") {
		return nil
	}
	if strings.Contains(size, ":") {
		parts := strings.Split(size, ":")
		if len(parts) != 2 {
			return fmt.Errorf("gpt-image-2 aspect ratio must be WIDTH:HEIGHT, got %q", size)
		}
		width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
		height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
		if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
			return fmt.Errorf("gpt-image-2 aspect ratio must use positive integers, got %q", size)
		}
		longEdge, shortEdge := width, height
		if shortEdge > longEdge {
			longEdge, shortEdge = shortEdge, longEdge
		}
		if longEdge > shortEdge*3 {
			return fmt.Errorf("gpt-image-2 aspect ratio must not exceed 3:1, got %q", size)
		}
		return nil
	}

	dimensions := strings.Split(size, "x")
	if len(dimensions) != 2 {
		return fmt.Errorf("gpt-image-2 size must be auto or WIDTHxHEIGHT, got %q", size)
	}
	width, err := strconv.Atoi(dimensions[0])
	if err != nil {
		return fmt.Errorf("gpt-image-2 size width is invalid: %q", dimensions[0])
	}
	height, err := strconv.Atoi(dimensions[1])
	if err != nil {
		return fmt.Errorf("gpt-image-2 size height is invalid: %q", dimensions[1])
	}
	if width <= 0 || height <= 0 {
		return fmt.Errorf("gpt-image-2 size dimensions must be positive, got %q", size)
	}
	if width%16 != 0 || height%16 != 0 {
		return fmt.Errorf("gpt-image-2 size dimensions must be multiples of 16, got %q", size)
	}
	if width > 3840 || height > 3840 {
		return fmt.Errorf("gpt-image-2 size dimensions must not exceed 3840px on either edge, got %q", size)
	}
	pixels := width * height
	if pixels < 655360 || pixels > 8294400 {
		return fmt.Errorf("gpt-image-2 size must contain 655360 to 8294400 pixels, got %q", size)
	}
	longEdge, shortEdge := width, height
	if shortEdge > longEdge {
		longEdge, shortEdge = shortEdge, longEdge
	}
	if longEdge > shortEdge*3 {
		return fmt.Errorf("gpt-image-2 size aspect ratio must not exceed 3:1, got %q", size)
	}
	return nil
}

type gptImage2SizeKey struct {
	AspectRatio string
	Tier        string
}

// gptImage2SizePresets are valid OpenAI pixel dimensions selected for the
// frontend's ratio + resolution controls. The upstream API accepts any size
// satisfying its constraints; these presets keep the UI semantic (ratio and
// 1K/2K/4K) while ensuring the wire request is always pixel-based.
var gptImage2SizePresets = map[gptImage2SizeKey]string{
	{AspectRatio: "1:1", Tier: "1K"}:  "1024x1024",
	{AspectRatio: "16:9", Tier: "1K"}: "1536x864",
	{AspectRatio: "9:16", Tier: "1K"}: "864x1536",
	{AspectRatio: "4:3", Tier: "1K"}:  "1152x864",
	{AspectRatio: "3:4", Tier: "1K"}:  "864x1152",
	{AspectRatio: "3:2", Tier: "1K"}:  "1536x1024",
	{AspectRatio: "2:3", Tier: "1K"}:  "1024x1536",
	{AspectRatio: "5:4", Tier: "1K"}:  "1280x1024",
	{AspectRatio: "4:5", Tier: "1K"}:  "1024x1280",
	{AspectRatio: "21:9", Tier: "1K"}: "1344x576",
	{AspectRatio: "1:1", Tier: "2K"}:  "2048x2048",
	{AspectRatio: "16:9", Tier: "2K"}: "2048x1152",
	{AspectRatio: "9:16", Tier: "2K"}: "1152x2048",
	{AspectRatio: "4:3", Tier: "2K"}:  "2048x1536",
	{AspectRatio: "3:4", Tier: "2K"}:  "1536x2048",
	{AspectRatio: "3:2", Tier: "2K"}:  "2304x1536",
	{AspectRatio: "2:3", Tier: "2K"}:  "1536x2304",
	{AspectRatio: "5:4", Tier: "2K"}:  "2560x2048",
	{AspectRatio: "4:5", Tier: "2K"}:  "2048x2560",
	{AspectRatio: "21:9", Tier: "2K"}: "2688x1152",
	{AspectRatio: "1:1", Tier: "4K"}:  "2880x2880",
	{AspectRatio: "16:9", Tier: "4K"}: "3840x2160",
	{AspectRatio: "9:16", Tier: "4K"}: "2160x3840",
	{AspectRatio: "4:3", Tier: "4K"}:  "3264x2448",
	{AspectRatio: "3:4", Tier: "4K"}:  "2448x3264",
	{AspectRatio: "3:2", Tier: "4K"}:  "3456x2304",
	{AspectRatio: "2:3", Tier: "4K"}:  "2304x3456",
	{AspectRatio: "5:4", Tier: "4K"}:  "3200x2560",
	{AspectRatio: "4:5", Tier: "4K"}:  "2560x3200",
	{AspectRatio: "21:9", Tier: "4K"}: "3696x1584",
}

// NormalizeGptImage2Size converts the internal frontend ratio + resolution
// contract into an official pixel size. Explicit WIDTHxHEIGHT and auto are
// preserved after validation. The resolution tier is read from the existing
// imageSize/resolution aliases and defaults to 1K when omitted.
func NormalizeGptImage2Size(request ImageRequest) (ImageRequest, error) {
	size := strings.TrimSpace(request.Size)
	if err := ValidateGptImage2Size(size); err != nil {
		return request, err
	}
	if size == "" || strings.EqualFold(size, "auto") || !strings.Contains(size, ":") {
		return request, nil
	}

	tier := gptImage2ResolutionTier(request)
	resolved, ok := gptImage2SizePresets[gptImage2SizeKey{
		AspectRatio: strings.ToLower(size),
		Tier:        tier,
	}]
	if !ok {
		return request, fmt.Errorf("gpt-image-2 aspect ratio %q is not supported by the frontend size contract", size)
	}
	request.Size = resolved
	return request, nil
}

// CanonicalizeGptImage2SizeAliases maps legacy ratio fields into the canonical
// size field. It is intentionally separate from NormalizeGptImage2Size so
// channel-specific adaptors can opt in without changing working providers that
// assign their own semantics to aspect_ratio.
func CanonicalizeGptImage2SizeAliases(request ImageRequest) ImageRequest {
	if strings.TrimSpace(request.Size) != "" {
		return request
	}
	for _, key := range []string{"aspect_ratio", "aspectRatio"} {
		if aspectRatio := stringExtraValue(request.Extra[key]); aspectRatio != "" {
			request.Size = aspectRatio
			return request
		}
	}
	if raw := request.Extra["metadata"]; len(raw) > 0 {
		var metadata map[string]json.RawMessage
		if err := common.Unmarshal(raw, &metadata); err == nil {
			for _, key := range []string{"aspect_ratio", "aspectRatio"} {
				if aspectRatio := stringExtraValue(metadata[key]); aspectRatio != "" {
					request.Size = aspectRatio
					return request
				}
			}
		}
	}
	return request
}

func gptImage2ResolutionTier(request ImageRequest) string {
	for _, key := range []string{"resolution", "imageSize", "image_size"} {
		if tier := stringExtraValue(request.Extra[key]); tier != "" {
			return normalizeGptImage2ResolutionTier(tier)
		}
	}
	if raw := request.Extra["metadata"]; len(raw) > 0 {
		var metadata map[string]json.RawMessage
		if err := common.Unmarshal(raw, &metadata); err == nil {
			for _, key := range []string{"resolution", "imageSize", "image_size"} {
				if tier := stringExtraValue(metadata[key]); tier != "" {
					return normalizeGptImage2ResolutionTier(tier)
				}
			}
		}
	}
	if strings.EqualFold(strings.TrimSpace(request.Quality), "high") || strings.EqualFold(strings.TrimSpace(request.Quality), "hd") {
		return "2K"
	}
	return "1K"
}

func stringExtraValue(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value string
	if err := common.Unmarshal(raw, &value); err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func normalizeGptImage2ResolutionTier(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "2K":
		return "2K"
	case "4K":
		return "4K"
	default:
		return "1K"
	}
}

func (i *ImageRequest) IsStream(c *gin.Context) bool {
	return false
}

func (i *ImageRequest) SetModelName(modelName string) {
	if modelName != "" {
		i.Model = modelName
	}
}

type ImageResponse struct {
	Data     []ImageData     `json:"data"`
	Created  int64           `json:"created"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}
type ImageData struct {
	Url           string `json:"url"`
	B64Json       string `json:"b64_json"`
	RevisedPrompt string `json:"revised_prompt"`
}
