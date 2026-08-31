package evolink

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// collectResultURLs is a schema-agnostic fallback that recursively gathers
// http(s) result URLs from a poll body. It is used only when the struct-based
// parser (reused from the APIMart task package) finds none — so it survives any
// result shape Evolink returns as long as the URLs are http(s) strings sitting
// under a URL-ish key or ending in an image extension.
func collectResultURLs(body []byte) []string {
	var root any
	if err := common.Unmarshal(body, &root); err != nil {
		return nil
	}
	seen := make(map[string]struct{})
	var out []string
	var walk func(n any, keyHint string)
	walk = func(n any, keyHint string) {
		switch t := n.(type) {
		case map[string]any:
			for k, v := range t {
				walk(v, strings.ToLower(k))
			}
		case []any:
			for _, v := range t {
				walk(v, keyHint)
			}
		case string:
			s := strings.TrimSpace(t)
			if !isHTTPURL(s) {
				return
			}
			if !looksLikeImageURL(s) && !isURLKey(keyHint) {
				return
			}
			if _, dup := seen[s]; dup {
				return
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	walk(root, "")
	return out
}

func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

func looksLikeImageURL(s string) bool {
	lower := strings.ToLower(s)
	if i := strings.IndexAny(lower, "?#"); i >= 0 {
		lower = lower[:i]
	}
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".avif"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

func isURLKey(key string) bool {
	if key == "" {
		return false
	}
	for _, frag := range []string{"url", "image", "img", "output", "result", "file", "cover", "pic", "photo"} {
		if strings.Contains(key, frag) {
			return true
		}
	}
	return false
}
