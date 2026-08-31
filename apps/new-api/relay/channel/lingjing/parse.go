package lingjing

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// Normalized terminal states. The upstream status field name/value is not
// documented, so parseTaskResult maps any of the common conventions onto these.
const (
	taskStatusRunning = "running"
	taskStatusSuccess = "success"
	taskStatusFailed  = "failed"
)

// extractTaskID pulls the task id out of the submit envelope. 灵镜's exact
// shape is unconfirmed, so we scan for the first plausible id field at any depth
// (taskId / task_id / id), tolerating both string and numeric values.
func extractTaskID(body []byte) (string, error) {
	var root any
	if err := common.Unmarshal(body, &root); err != nil {
		return "", fmt.Errorf("lingjing: unmarshal submit body failed: %w, body=%s", err, string(body))
	}
	if id := findFirstByKeys(root, map[string]struct{}{
		"taskid": {}, "task_id": {}, "id": {},
	}); id != "" {
		return id, nil
	}
	return "", errors.New("lingjing: no task id in submit response")
}

// parseTaskResult returns the normalized status and any result image URLs found
// in a query response. URL extraction is recursive and key/shape agnostic, so
// it survives schema changes as long as the result URLs are http(s) strings.
func parseTaskResult(body []byte) (status string, urls []string) {
	var root any
	if err := common.Unmarshal(body, &root); err != nil {
		return taskStatusRunning, nil
	}
	urls = collectResultURLs(root)
	status = normalizeStatus(findStatus(root))
	// Result URLs are the strongest success signal regardless of status field.
	if status == "" && len(urls) > 0 {
		status = taskStatusSuccess
	}
	if status == "" {
		status = taskStatusRunning
	}
	return status, urls
}

// extractFailureReason digs out a human-readable error string from common
// message fields (msg / message / failReason / error).
func extractFailureReason(body []byte) string {
	var root any
	if err := common.Unmarshal(body, &root); err != nil {
		return ""
	}
	return findFirstByKeys(root, map[string]struct{}{
		"failreason": {}, "failurereason": {}, "errmsg": {},
		"errormsg": {}, "message": {}, "msg": {}, "error": {}, "reason": {},
	})
}

// --- generic JSON walkers ---

// findFirstBykeys returns the first string/number value whose (lowercased) key
// is in keys, searching depth-first.
func findFirstByKeys(node any, keys map[string]struct{}) string {
	var found string
	var walk func(any)
	walk = func(n any) {
		if found != "" {
			return
		}
		switch t := n.(type) {
		case map[string]any:
			for k, v := range t {
				if _, ok := keys[strings.ToLower(k)]; ok {
					if s := scalarToString(v); s != "" {
						found = s
						return
					}
				}
			}
			for _, v := range t {
				walk(v)
				if found != "" {
					return
				}
			}
		case []any:
			for _, v := range t {
				walk(v)
				if found != "" {
					return
				}
			}
		}
	}
	walk(node)
	return found
}

func findStatus(node any) string {
	return findFirstByKeys(node, map[string]struct{}{
		"status": {}, "taskstatus": {}, "state": {}, "taskstate": {},
	})
}

// collectResultURLs gathers http(s) strings that either look like image URLs or
// sit under a URL-ish key (url / imageUrl / images / output / result / file …).
func collectResultURLs(node any) []string {
	seen := make(map[string]struct{})
	var out []string
	var walk func(any, string)
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
	walk(node, "")
	return out
}

func scalarToString(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%v", t)
	case bool:
		if t {
			return "true"
		}
		return "false"
	}
	return ""
}

func normalizeStatus(raw string) string {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "SUCCESS", "SUCCEED", "SUCCEEDED", "SUCCESSFUL", "FINISH", "FINISHED",
		"COMPLETE", "COMPLETED", "DONE", "OK", "2":
		return taskStatusSuccess
	case "FAIL", "FAILED", "FAILURE", "ERROR", "REJECT", "REJECTED", "CANCEL",
		"CANCELLED", "CANCELED", "3", "4":
		return taskStatusFailed
	case "":
		return ""
	default:
		return taskStatusRunning
	}
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
