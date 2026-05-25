package imageutil

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service"
)

// ExtractReferenceImages returns every non-empty reference image URL provided
// in OpenAI-compatible image request fields.
func ExtractReferenceImages(request *dto.ImageRequest) []string {
	if request == nil {
		return []string{}
	}

	out := make([]string, 0)
	appendFromRaw := func(raw json.RawMessage) {
		if len(raw) == 0 {
			return
		}
		var many []string
		if err := common.Unmarshal(raw, &many); err == nil {
			for _, value := range many {
				value = strings.TrimSpace(value)
				if value != "" {
					out = append(out, value)
				}
			}
			return
		}

		var one string
		if err := common.Unmarshal(raw, &one); err == nil {
			one = strings.TrimSpace(one)
			if one != "" {
				out = append(out, one)
			}
		}
	}

	appendFromRaw(request.Image)
	for _, key := range []string{"images", "urls", "image_urls", "input_reference"} {
		if raw, ok := request.Extra[key]; ok {
			appendFromRaw(raw)
		}
	}
	return out
}

// ExtractRequestedImageSize returns the vendor-specific image_size hint from
// extra fields when present.
func ExtractRequestedImageSize(request *dto.ImageRequest) string {
	if request == nil {
		return ""
	}
	for _, key := range []string{"image_size", "imageSize"} {
		raw, ok := request.Extra[key]
		if !ok || len(raw) == 0 {
			continue
		}
		var value string
		if err := common.Unmarshal(raw, &value); err == nil {
			value = strings.TrimSpace(value)
			if value != "" {
				return value
			}
		}
	}
	return ""
}

// NormalizeGeminiImageSize converts user-facing size aliases to Gemini's
// accepted imageSize values.
func NormalizeGeminiImageSize(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "1080p", "1k":
		return "1K"
	case "2k":
		return "2K"
	default:
		return strings.TrimSpace(value)
	}
}

// DownloadReferenceImagesAsGeminiInlineData converts remote image URLs into
// Gemini inlineData parts so image references survive Gemini adaptors.
func DownloadReferenceImagesAsGeminiInlineData(urls []string) ([]dto.GeminiPart, error) {
	parts := make([]dto.GeminiPart, 0, len(urls))
	for _, imageURL := range urls {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			continue
		}
		mimeType := ""
		data := ""
		var err error
		if strings.HasPrefix(imageURL, "data:") {
			mimeType, data, err = service.DecodeBase64FileData(imageURL)
		} else {
			mimeType, data, err = service.GetImageFromUrl(imageURL)
		}
		if err != nil {
			return nil, err
		}
		parts = append(parts, dto.GeminiPart{
			InlineData: &dto.GeminiInlineData{
				MimeType: mimeType,
				Data:     data,
			},
		})
	}
	return parts, nil
}
