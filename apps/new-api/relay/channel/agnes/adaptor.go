package agnes

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
)

const (
	ChannelName       = "agnes"
	ModelImage25Flash = "agnes-image-2.5-flash"
	imagePath         = "/v1/images/generations"
)

var (
	ModelList        = []string{ModelImage25Flash}
	pixelSizePattern = regexp.MustCompile(`^[1-9][0-9]*x[1-9][0-9]*$`)
	imageRatios      = map[string]struct{}{
		"1:1": {}, "3:4": {}, "4:3": {}, "16:9": {}, "9:16": {},
		"2:3": {}, "3:2": {}, "21:9": {},
	}
)

type Adaptor struct {
	openai.Adaptor
}

type imagePayload struct {
	Model        string          `json:"model"`
	Prompt       string          `json:"prompt"`
	Size         string          `json:"size"`
	Ratio        string          `json:"ratio,omitempty"`
	ReturnBase64 *bool           `json:"return_base64,omitempty"`
	ExtraBody    *imageExtraBody `json:"extra_body,omitempty"`
}

type imageExtraBody struct {
	Image          []string `json:"image,omitempty"`
	ResponseFormat string   `json:"response_format,omitempty"`
}

type imageExtraBodyInput struct {
	Image          json.RawMessage `json:"image,omitempty"`
	ResponseFormat string          `json:"response_format,omitempty"`
	ReturnBase64   *bool           `json:"return_base64,omitempty"`
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info.RelayMode == relayconstant.RelayModeImagesGenerations ||
		info.RelayMode == relayconstant.RelayModeImagesEdits {
		return strings.TrimRight(info.ChannelBaseUrl, "/") + imagePath, nil
	}
	return a.Adaptor.GetRequestURL(info)
}

func (a *Adaptor) ConvertImageRequest(_ *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	if info.RelayMode != relayconstant.RelayModeImagesGenerations &&
		info.RelayMode != relayconstant.RelayModeImagesEdits {
		return nil, errors.New("agnes only supports OpenAI image generation requests")
	}
	if request.Mask != nil {
		return nil, errors.New("agnes-image-2.5-flash does not support mask")
	}
	if request.N != nil && *request.N != 1 {
		return nil, errors.New("agnes-image-2.5-flash n must be 1")
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return nil, errors.New("agnes-image-2.5-flash prompt is required")
	}

	modelName := strings.TrimSpace(info.UpstreamModelName)
	if modelName == "" {
		modelName = strings.TrimSpace(request.Model)
	}
	if modelName != ModelImage25Flash {
		return nil, fmt.Errorf("agnes: unsupported image model %q", modelName)
	}

	size, ratio, err := resolveImageSizeAndRatio(request)
	if err != nil {
		return nil, err
	}
	references, err := imageReferences(request)
	if err != nil {
		return nil, err
	}
	if info.RelayMode == relayconstant.RelayModeImagesEdits && len(references) == 0 {
		return nil, errors.New("agnes image edits require at least one reference image")
	}

	extraInput, err := parseImageExtraBody(request.Extra["extra_body"])
	if err != nil {
		return nil, err
	}
	responseFormat := strings.ToLower(strings.TrimSpace(request.ResponseFormat))
	if responseFormat == "" {
		responseFormat = strings.ToLower(strings.TrimSpace(extraInput.ResponseFormat))
	}
	if responseFormat == "" {
		responseFormat = "url"
	}
	if responseFormat != "url" && responseFormat != "b64_json" {
		return nil, errors.New("agnes-image-2.5-flash response_format must be url or b64_json")
	}
	explicitReturnBase64, hasExplicitReturnBase64 := rawBoolPointer(request.Extra["return_base64"])
	if !hasExplicitReturnBase64 && extraInput.ReturnBase64 != nil {
		explicitReturnBase64 = extraInput.ReturnBase64
		hasExplicitReturnBase64 = true
	}
	if hasExplicitReturnBase64 {
		if *explicitReturnBase64 {
			responseFormat = "b64_json"
		}
	}

	payload := imagePayload{
		Model:  modelName,
		Prompt: strings.TrimSpace(request.Prompt),
		Size:   size,
		Ratio:  ratio,
	}
	extraBody := &imageExtraBody{Image: references}
	if responseFormat == "b64_json" && len(references) == 0 {
		value := true
		payload.ReturnBase64 = &value
	} else {
		extraBody.ResponseFormat = responseFormat
		if hasExplicitReturnBase64 && responseFormat == "url" {
			payload.ReturnBase64 = explicitReturnBase64
		}
	}
	if len(extraBody.Image) > 0 || extraBody.ResponseFormat != "" {
		payload.ExtraBody = extraBody
	}
	return payload, nil
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }

func resolveImageSizeAndRatio(request dto.ImageRequest) (string, string, error) {
	tier := ""
	for _, key := range []string{"resolution", "image_size", "imageSize"} {
		if value, ok := rawString(request.Extra[key]); ok && value != "" {
			tier = strings.ToUpper(value)
			break
		}
	}
	size := strings.TrimSpace(request.Size)
	if isImageTier(size) {
		tier = strings.ToUpper(size)
		size = ""
	}
	if tier != "" && !isImageTier(tier) {
		return "", "", fmt.Errorf("agnes-image-2.5-flash size must be 1K, 2K, 3K, or 4K, got %q", tier)
	}

	ratio := ""
	for _, key := range []string{"ratio", "aspect_ratio", "aspectRatio"} {
		if value, ok := rawString(request.Extra[key]); ok && value != "" {
			ratio = value
			break
		}
	}
	if strings.Contains(size, ":") {
		if ratio == "" {
			ratio = size
		}
		size = ""
	}
	if ratio != "" {
		if _, ok := imageRatios[ratio]; !ok {
			return "", "", fmt.Errorf("agnes-image-2.5-flash unsupported ratio %q", ratio)
		}
	}

	if tier != "" {
		size = tier
	} else if size == "" || strings.EqualFold(size, "auto") {
		size = "1K"
	} else if !pixelSizePattern.MatchString(strings.ToLower(size)) {
		return "", "", fmt.Errorf("agnes-image-2.5-flash size must be a resolution tier or WIDTHxHEIGHT, got %q", size)
	}

	if isImageTier(size) && ratio == "" {
		ratio = "1:1"
	}
	return size, ratio, nil
}

func isImageTier(value string) bool {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "1K", "2K", "3K", "4K":
		return true
	default:
		return false
	}
}

func imageReferences(request dto.ImageRequest) ([]string, error) {
	values := make([]string, 0, 1+len(request.Images))
	appendValue := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		for _, existing := range values {
			if existing == value {
				return
			}
		}
		values = append(values, value)
	}
	if len(request.Image) > 0 && string(request.Image) != "null" {
		var single string
		if common.Unmarshal(request.Image, &single) == nil {
			appendValue(single)
		} else {
			var many []string
			if common.Unmarshal(request.Image, &many) == nil {
				for _, value := range many {
					appendValue(value)
				}
			} else {
				var references []dto.ImageURLReference
				if err := common.Unmarshal(request.Image, &references); err != nil {
					return nil, errors.New("image must be a URL, URL array, or image_url object array")
				}
				for _, reference := range references {
					imageURL, err := agnesImageReferenceURL(reference)
					if err != nil {
						return nil, err
					}
					appendValue(imageURL)
				}
			}
		}
	}
	for _, reference := range request.Images {
		imageURL, err := agnesImageReferenceURL(reference)
		if err != nil {
			return nil, err
		}
		appendValue(imageURL)
	}
	extraInput, err := parseImageExtraBody(request.Extra["extra_body"])
	if err != nil {
		return nil, err
	}
	if len(extraInput.Image) > 0 && string(extraInput.Image) != "null" {
		if err := appendImageReferenceRaw(extraInput.Image, appendValue); err != nil {
			return nil, fmt.Errorf("extra_body.image: %w", err)
		}
	}
	for _, key := range []string{"image_urls", "urls"} {
		raw := request.Extra[key]
		if len(raw) == 0 {
			continue
		}
		var many []string
		if err := common.Unmarshal(raw, &many); err != nil {
			return nil, fmt.Errorf("%s must be an array of URLs", key)
		}
		for _, value := range many {
			appendValue(value)
		}
	}
	return values, nil
}

func appendImageReferenceRaw(raw json.RawMessage, appendValue func(string)) error {
	var single string
	if common.Unmarshal(raw, &single) == nil {
		appendValue(single)
		return nil
	}
	var many []string
	if common.Unmarshal(raw, &many) == nil {
		for _, value := range many {
			appendValue(value)
		}
		return nil
	}
	var references []dto.ImageURLReference
	if err := common.Unmarshal(raw, &references); err != nil {
		return errors.New("must be a URL, URL array, or image_url object array")
	}
	for _, reference := range references {
		imageURL, err := agnesImageReferenceURL(reference)
		if err != nil {
			return err
		}
		appendValue(imageURL)
	}
	return nil
}

func agnesImageReferenceURL(reference dto.ImageURLReference) (string, error) {
	imageURL := strings.TrimSpace(reference.ImageURL)
	if imageURL == "" {
		return "", errors.New("agnes image_url must not be empty")
	}
	return imageURL, nil
}

func parseImageExtraBody(raw json.RawMessage) (imageExtraBodyInput, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return imageExtraBodyInput{}, nil
	}
	var input imageExtraBodyInput
	if err := common.Unmarshal(raw, &input); err != nil {
		return imageExtraBodyInput{}, errors.New("extra_body must be an object")
	}
	return input, nil
}

func rawString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 {
		return "", false
	}
	var value string
	if common.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return strings.TrimSpace(value), true
}

func rawBoolPointer(raw json.RawMessage) (*bool, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var value bool
	if common.Unmarshal(raw, &value) != nil {
		return nil, false
	}
	return &value, true
}
