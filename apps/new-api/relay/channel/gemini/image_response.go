package gemini

import (
	"strings"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/imageutil"
)

func extractGeminiImagineImageData(response *dto.GeminiChatResponse) []dto.ImageData {
	images := make([]dto.ImageData, 0)
	for _, candidate := range response.Candidates {
		candidateInlineImages := make([]dto.ImageData, 0)
		candidateURLImages := make([]dto.ImageData, 0)
		candidateURLSet := make(map[string]struct{})
		appendCandidateURL := func(imageURL string) {
			if _, exists := candidateURLSet[imageURL]; exists {
				return
			}
			candidateURLSet[imageURL] = struct{}{}
			candidateURLImages = append(candidateURLImages, dto.ImageData{Url: imageURL})
		}
		for _, part := range candidate.Content.Parts {
			if part.InlineData != nil && strings.HasPrefix(part.InlineData.MimeType, "image/") {
				if base64Data := strings.TrimSpace(part.InlineData.Data); base64Data != "" {
					candidateInlineImages = append(candidateInlineImages, dto.ImageData{B64Json: base64Data})
				}
			}
			if part.FileData != nil && strings.HasPrefix(part.FileData.MimeType, "image/") {
				if imageURL, ok := imageutil.NormalizeHTTPImageURL(part.FileData.FileUri); ok {
					appendCandidateURL(imageURL)
				}
			}

			for _, imageURL := range imageutil.ExtractHTTPMarkdownImageURLs(part.Text) {
				appendCandidateURL(imageURL)
			}
		}
		// Some Gemini-compatible providers return the same generated image twice:
		// inlineData plus fileData or a persisted Markdown URL. Prefer deduplicated
		// URL representations for that candidate so an n=1 request remains one image.
		if len(candidateURLImages) > 0 {
			images = append(images, candidateURLImages...)
		} else {
			images = append(images, candidateInlineImages...)
		}
	}
	return images
}

// extractMarkdownImageURLs reads explicit Markdown image destinations from an
// upstream text part. Some Gemini-compatible providers persist generated image
// bytes themselves and return only a signed URL in the form ![alt](https://...).
func extractMarkdownImageURLs(text string) []string {
	return imageutil.ExtractHTTPMarkdownImageURLs(text)
}
