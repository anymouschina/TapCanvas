package imageutil

import (
	"net/url"
	"strings"
)

// ExtractHTTPMarkdownImageURLs reads explicit Markdown image destinations.
// Plain links, relative paths, data URLs, and URLs containing credentials are
// intentionally excluded because the image relay contract requires a real,
// remotely retrievable asset URL.
func ExtractHTTPMarkdownImageURLs(text string) []string {
	urls := make([]string, 0)
	remaining := text
	for {
		imageStart := strings.Index(remaining, "![")
		if imageStart < 0 {
			break
		}

		altEndOffset := strings.Index(remaining[imageStart+2:], "](")
		if altEndOffset < 0 {
			break
		}
		destinationStart := imageStart + 2 + altEndOffset + 2
		destinationEndOffset := strings.IndexByte(remaining[destinationStart:], ')')
		if destinationEndOffset < 0 {
			break
		}
		destinationEnd := destinationStart + destinationEndOffset
		destination := strings.TrimSpace(remaining[destinationStart:destinationEnd])
		if len(destination) >= 2 && destination[0] == '<' && destination[len(destination)-1] == '>' {
			destination = strings.TrimSpace(destination[1 : len(destination)-1])
		}
		if isHTTPImageDestination(destination) {
			urls = append(urls, destination)
		}

		remaining = remaining[destinationEnd+1:]
	}
	return urls
}

// NormalizeHTTPImageURL accepts only an absolute HTTP(S) URL without embedded
// credentials. It is shared by Markdown and Gemini fileData image responses so
// every remotely hosted image follows the same relay safety boundary.
func NormalizeHTTPImageURL(destination string) (string, bool) {
	destination = strings.TrimSpace(destination)
	if !isHTTPImageDestination(destination) {
		return "", false
	}
	return destination, true
}

func isHTTPImageDestination(destination string) bool {
	parsed, err := url.Parse(destination)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")
}
