package apimart

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// klingMotionControlModels are upstream kling motion-control SKUs that share
// the same flat upstream schema (image_url + video_url + character_orientation
// + mode), unlike kling-v3-omni which takes image_urls[] + video_list[].
// v2.6 and v3 differ only in per-second price; the request shape is identical.
// Doc: https://docs.apimart.ai/cn/api-reference/videos/kling-v2-6/kling-v2-6-motion-control-generation
var klingMotionControlModels = map[string]bool{
	"kling-v2-6-motion-control": true,
	"kling-v3-motion-control":   true,
}

func isKlingMotionControlModel(name string) bool {
	base := strings.TrimSpace(strings.ToLower(name))
	for _, suffix := range []string{"-apimart", "-suchuang", "-all"} {
		base = strings.TrimSuffix(base, suffix)
	}
	return klingMotionControlModels[base]
}

// wan27VideoEditModels are APIMart wan2.7 video-editing SKUs. Unlike kling models
// which use video_list[], wan2.7-videoedit takes video_urls[] (string array).
// Doc: https://docs.apimart.ai/cn/api-reference/videos/wan2.7-videoedit/generation
var wan27VideoEditModels = map[string]bool{
	"wan2.7-videoedit": true,
}

func isWan27VideoEditModel(name string) bool {
	base := strings.TrimSpace(strings.ToLower(name))
	for _, suffix := range []string{"-apimart", "-suchuang", "-all"} {
		base = strings.TrimSuffix(base, suffix)
	}
	return wan27VideoEditModels[base]
}

// VideoListItem is one entry in the kling-v3-omni video_list parameter.
// refer_type: "base" (default). keep_original_sound: "yes"/"no" (default "no").
type VideoListItem struct {
	VideoURL          string `json:"video_url"`
	ReferType         string `json:"refer_type,omitempty"`
	KeepOriginalSound string `json:"keep_original_sound,omitempty"`
}

// SubmitPayload is the JSON body for both POST /v1/images/generations and
// POST /v1/videos/generations. The upstream accepts/ignores the model-specific
// fields (e.g. duration is video-only, sequential_image_generation is
// Seedream-only). Unknown fields are dropped silently.
//
// Any caller-supplied `metadata` object is merged on top of the canonical
// fields so power users can pass model-specific params without the adaptor
// needing to enumerate every variant.
type SubmitPayload struct {
	Model                     string                 `json:"model"`
	Prompt                    string                 `json:"prompt,omitempty"`
	Size                      string                 `json:"size,omitempty"`
	Resolution                string                 `json:"resolution,omitempty"`
	AspectRatio               string                 `json:"aspect_ratio,omitempty"`
	Duration                  int                    `json:"duration,omitempty"`
	N                         int                    `json:"n,omitempty"`
	ImageUrls                 []string               `json:"image_urls,omitempty"`
	VideoUrls                 []string               `json:"video_urls,omitempty"`
	VideoList                 []VideoListItem        `json:"video_list,omitempty"`
	Watermark                 *bool                  `json:"watermark,omitempty"`
	Seed                      *int64                 `json:"seed,omitempty"`
	SequentialImageGeneration string                 `json:"sequential_image_generation,omitempty"`
	OptimizePromptOptions     map[string]any         `json:"optimize_prompt_options,omitempty"`
	ImageWithRoles            []map[string]any       `json:"image_with_roles,omitempty"`
	Extras                    map[string]any         `json:"-"`
}

// internalMetadataKeys are fields set by the gateway for routing/billing
// that must not be forwarded to the upstream provider.
var internalMetadataKeys = map[string]bool{
	"vendor":   true,
	"taskKind": true,
	"content":  true,
}

// MarshalJSON emits the canonical fields plus any Extras keys (metadata
// overrides). Extras keys always win over the canonical defaults.
func (p SubmitPayload) MarshalJSON() ([]byte, error) {
	type base SubmitPayload
	canonical, err := common.Marshal(base(p))
	if err != nil {
		return nil, err
	}
	if len(p.Extras) == 0 {
		return canonical, nil
	}
	var merged map[string]any
	if err := common.Unmarshal(canonical, &merged); err != nil {
		return nil, err
	}
	for k, v := range p.Extras {
		if k == "model" {
			continue // never let metadata override the billable model
		}
		merged[k] = v
	}
	return common.Marshal(merged)
}

// BuildSubmitPayload translates a TaskSubmitReq into the APIMart submit body.
// Non-empty TaskSubmitReq.Images / InputReference / Image entries are merged
// into `image_urls` in order. Video references from metadata.content are
// mapped to `video_list` (kling format) or `video_urls` (wan2.7-videoedit).
func BuildSubmitPayload(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	if req == nil {
		return nil, fmt.Errorf("apimart: nil task request")
	}
	if isKlingMotionControlModel(req.Model) {
		return buildKlingMotionControlPayload(req)
	}
	if isWan27VideoEditModel(req.Model) {
		return buildWan27VideoEditPayload(req)
	}
	p := &SubmitPayload{
		Model:      req.Model,
		Prompt:     req.Prompt,
		Size:       req.Size,
		Duration:   req.Duration,
		Resolution: req.Resolution,
	}
	if len(req.Images) > 0 {
		p.ImageUrls = append(p.ImageUrls, req.Images...)
	}
	if req.InputReference != "" {
		p.ImageUrls = append(p.ImageUrls, req.InputReference)
	}
	if req.Image != "" {
		p.ImageUrls = append(p.ImageUrls, req.Image)
	}
	if len(req.Metadata) > 0 {
		extras := make(map[string]any, len(req.Metadata))
		for k, v := range req.Metadata {
			if internalMetadataKeys[k] {
				continue
			}
			extras[k] = v
		}
		p.Extras = extras

		// Translate metadata.content[] items into apimart native fields.
		// content is the VolcEngine/doubao internal format; apimart uses
		// image_urls / video_urls instead.
		if raw, ok := req.Metadata["content"]; ok {
			if items, ok := raw.([]any); ok {
				for _, item := range items {
					m, ok := item.(map[string]any)
					if !ok {
						continue
					}
					typ, _ := m["type"].(string)
					switch typ {
					case "video_url":
						if vu, ok := m["video_url"].(map[string]any); ok {
							if u, _ := vu["url"].(string); u != "" {
								p.VideoList = append(p.VideoList, VideoListItem{
									VideoURL:          u,
									ReferType:         "base",
									KeepOriginalSound: "no",
								})
							}
						}
					case "image_url":
						if iu, ok := m["image_url"].(map[string]any); ok {
							if u, _ := iu["url"].(string); u != "" {
								p.ImageUrls = append(p.ImageUrls, u)
							}
						}
					}
				}
			}
		}
	}
	p.ImageUrls = uniqueStrings(p.ImageUrls)
	return p, nil
}

// buildWan27VideoEditPayload constructs the APIMart wan2.7-videoedit submit body.
// Unlike kling models that use video_list[], wan2.7-videoedit expects video_urls[]
// (an array of strings; only the first element is used upstream).
// Doc: https://docs.apimart.ai/cn/api-reference/videos/wan2.7-videoedit/generation
func buildWan27VideoEditPayload(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	p := &SubmitPayload{
		Model:      req.Model,
		Prompt:     req.Prompt,
		Size:       req.Size,
		Duration:   req.Duration,
		Resolution: req.Resolution,
	}

	// Collect image URLs from standard fields.
	if len(req.Images) > 0 {
		p.ImageUrls = append(p.ImageUrls, req.Images...)
	}
	if req.InputReference != "" {
		p.ImageUrls = append(p.ImageUrls, req.InputReference)
	}
	if req.Image != "" {
		p.ImageUrls = append(p.ImageUrls, req.Image)
	}

	// Walk metadata for video_url (flat) and content[] items.
	if md := req.Metadata; md != nil {
		if u, ok := md["video_url"].(string); ok && strings.TrimSpace(u) != "" {
			p.VideoUrls = []string{strings.TrimSpace(u)}
		}
		if raw, ok := md["content"]; ok {
			if items, ok := raw.([]any); ok {
				for _, item := range items {
					m, ok := item.(map[string]any)
					if !ok {
						continue
					}
					typ, _ := m["type"].(string)
					switch typ {
					case "video_url":
						if len(p.VideoUrls) == 0 {
							if vu, ok := m["video_url"].(map[string]any); ok {
								if u, _ := vu["url"].(string); u != "" {
									p.VideoUrls = []string{u}
								}
							}
						}
					case "image_url":
						if iu, ok := m["image_url"].(map[string]any); ok {
							if u, _ := iu["url"].(string); u != "" {
								p.ImageUrls = append(p.ImageUrls, u)
							}
						}
					}
				}
			}
		}

		// Forward remaining metadata keys as Extras (skip internal and already-handled keys).
		skipKeys := map[string]bool{"vendor": true, "taskKind": true, "content": true, "video_url": true}
		extras := make(map[string]any, len(md))
		for k, v := range md {
			if skipKeys[k] {
				continue
			}
			extras[k] = v
		}
		if len(extras) > 0 {
			p.Extras = extras
		}
	}

	if len(p.VideoUrls) == 0 {
		return nil, fmt.Errorf("apimart wan2.7-videoedit: video_urls is required (model=%s)", req.Model)
	}
	p.ImageUrls = uniqueStrings(p.ImageUrls)
	return p, nil
}

// buildKlingMotionControlPayload constructs the APIMart kling motion-control
// submit body. Upstream expects FLAT single-value `image_url` + `video_url`
// (NOT the kling-v3-omni `image_urls[]` / `video_list[]` shape) plus
// `character_orientation` (image|video) and `mode` (std|pro).
//
// Inputs are accepted from multiple shapes so this works regardless of which
// hono-api code path constructed the request:
//  1. flat metadata: metadata.{image_url, video_url, ...} — preferred path,
//     emitted by the motion-control branch in apps/hono-api/.../task.service.ts.
//  2. content[]: metadata.content[{type:"image_url",image_url:{url}}, ...] —
//     emitted by the generic video path when the model isn't recognised as
//     motion-control upstream.
//  3. req.Images / req.InputReference / req.Image fallback for image only.
//
// Missing image_url or video_url is a hard error — motion-control has no
// text-only mode upstream.
func buildKlingMotionControlPayload(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	p := &SubmitPayload{
		Model:    req.Model,
		Prompt:   req.Prompt,
		Duration: req.Duration,
	}

	var imageURL, videoURL string
	orientation := "image"
	mode := "std"
	keepSound := "yes"
	var watermarkInfo any = map[string]any{"enabled": false}
	var negativePrompt string

	if md := req.Metadata; md != nil {
		if u, ok := md["image_url"].(string); ok && strings.TrimSpace(u) != "" {
			imageURL = strings.TrimSpace(u)
		}
		if u, ok := md["video_url"].(string); ok && strings.TrimSpace(u) != "" {
			videoURL = strings.TrimSpace(u)
		}
		if v, ok := md["character_orientation"].(string); ok && strings.TrimSpace(v) != "" {
			orientation = strings.TrimSpace(v)
		}
		if v, ok := md["mode"].(string); ok && strings.TrimSpace(v) != "" {
			mode = strings.TrimSpace(v)
		}
		if v, ok := md["keep_original_sound"].(string); ok && strings.TrimSpace(v) != "" {
			keepSound = strings.TrimSpace(v)
		}
		if wm, ok := md["watermark_info"]; ok && wm != nil {
			watermarkInfo = wm
		}
		if v, ok := md["negative_prompt"].(string); ok && strings.TrimSpace(v) != "" {
			negativePrompt = strings.TrimSpace(v)
		}
		if d, ok := md["duration"].(float64); ok && d > 0 && p.Duration == 0 {
			p.Duration = int(d)
		}

		// Fallback: walk metadata.content[] if flat fields were absent.
		if imageURL == "" || videoURL == "" {
			if raw, ok := md["content"]; ok {
				if items, ok := raw.([]any); ok {
					for _, item := range items {
						m, ok := item.(map[string]any)
						if !ok {
							continue
						}
						typ, _ := m["type"].(string)
						switch typ {
						case "video_url":
							if videoURL != "" {
								continue
							}
							if vu, ok := m["video_url"].(map[string]any); ok {
								if u, _ := vu["url"].(string); u != "" {
									videoURL = u
								}
							}
						case "image_url":
							if imageURL != "" {
								continue
							}
							if iu, ok := m["image_url"].(map[string]any); ok {
								if u, _ := iu["url"].(string); u != "" {
									imageURL = u
								}
							}
						}
					}
				}
			}
		}
	}

	if imageURL == "" {
		if len(req.Images) > 0 {
			imageURL = req.Images[0]
		} else if strings.TrimSpace(req.InputReference) != "" {
			imageURL = strings.TrimSpace(req.InputReference)
		} else if strings.TrimSpace(req.Image) != "" {
			imageURL = strings.TrimSpace(req.Image)
		}
	}

	if imageURL == "" {
		return nil, fmt.Errorf("apimart kling motion-control: image_url is required (model=%s)", req.Model)
	}
	if videoURL == "" {
		return nil, fmt.Errorf("apimart kling motion-control: video_url is required (model=%s)", req.Model)
	}

	extras := map[string]any{
		"image_url":             imageURL,
		"video_url":             videoURL,
		"character_orientation": orientation,
		"mode":                  mode,
		"keep_original_sound":   keepSound,
		"watermark_info":        watermarkInfo,
	}
	if negativePrompt != "" {
		extras["negative_prompt"] = negativePrompt
	}
	p.Extras = extras
	return p, nil
}

// SubmitResponse mirrors APIMart's submit response shape:
//
//	{ "code": 200, "data": [ { "status": "submitted", "task_id": "task_..." } ] }
type SubmitResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg,omitempty"`
	Data []struct {
		Status string `json:"status"`
		TaskID string `json:"task_id"`
	} `json:"data"`
	Error *APIError `json:"error,omitempty"`
}

// APIError is the upstream error shape:
//
//	{ "code": "...", "message": "...", "type": "..." }
type APIError struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
	Type    string `json:"type,omitempty"`
}

// TaskID returns the first task_id from the submit response, or "".
func (s *SubmitResponse) TaskID() string {
	if s == nil {
		return ""
	}
	for _, d := range s.Data {
		if d.TaskID != "" {
			return d.TaskID
		}
	}
	return ""
}

// ErrorMessage returns a human-readable summary for logging/billing.
func (s *SubmitResponse) ErrorMessage() string {
	if s == nil {
		return ""
	}
	if s.Error != nil && s.Error.Message != "" {
		return s.Error.Message
	}
	return s.Msg
}

// DetailResponse mirrors GET /v1/tasks/{task_id}:
//
//	{
//	  "code": 200,
//	  "data": {
//	    "id": "...",
//	    "status": "pending|processing|completed|failed|cancelled",
//	    "progress": 0..100,
//	    "result": {
//	      "images": [ { "url": ["..."], "expires_at": ... } ],
//	      "videos": [ { "url": "..." } ],
//	      "thumbnail_url": "..."
//	    },
//	    "created": ...,
//	    "completed": ...
//	  }
//	}
type DetailResponse struct {
	Code  int       `json:"code"`
	Msg   string    `json:"msg,omitempty"`
	Error *APIError `json:"error,omitempty"`
	Data  *struct {
		ID            string        `json:"id"`
		Status        string        `json:"status"`
		Progress      int           `json:"progress"`
		Result        *DetailResult `json:"result,omitempty"`
		Created       int64         `json:"created,omitempty"`
		Completed     int64         `json:"completed,omitempty"`
		EstimatedTime int64         `json:"estimated_time,omitempty"`
		ActualTime    int64         `json:"actual_time,omitempty"`
		FailReason    string        `json:"fail_reason,omitempty"`
		Error         *APIError     `json:"error,omitempty"`
	} `json:"data,omitempty"`
}

type DetailResult struct {
	Images       []ImageResult `json:"images,omitempty"`
	Videos       []VideoResult `json:"videos,omitempty"`
	ThumbnailURL string        `json:"thumbnail_url,omitempty"`
}

// ImageResult handles APIMart's `url` field which ships as a string array per
// docs example: `{"url": ["https://..."], "expires_at": ...}`.
type ImageResult struct {
	URL       []string `json:"url,omitempty"`
	ExpiresAt int64    `json:"expires_at,omitempty"`
}

// VideoResult accepts `url` as either a string (common) or a []string (some
// models, for variants/frames). Use FirstURL to unwrap.
type VideoResult struct {
	URL       FlexURL `json:"url,omitempty"`
	ExpiresAt int64   `json:"expires_at,omitempty"`
}

// FlexURL decodes a field that upstream returns as either string or []string.
type FlexURL struct {
	One  string
	Many []string
}

func (f *FlexURL) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	var one string
	if err := json.Unmarshal(data, &one); err == nil {
		f.One = one
		return nil
	}
	var many []string
	if err := json.Unmarshal(data, &many); err == nil {
		f.Many = many
		return nil
	}
	return fmt.Errorf("apimart: url field not string nor []string: %s", data)
}

// First returns the first non-empty URL in a FlexURL.
func (f FlexURL) First() string {
	if f.One != "" {
		return f.One
	}
	for _, u := range f.Many {
		if u != "" {
			return u
		}
	}
	return ""
}

// AllURLs returns every URL in the response, images first then videos.
func (d *DetailResponse) AllURLs() []string {
	if d == nil || d.Data == nil || d.Data.Result == nil {
		return nil
	}
	out := []string{}
	for _, img := range d.Data.Result.Images {
		for _, u := range img.URL {
			if u != "" {
				out = append(out, u)
			}
		}
	}
	for _, v := range d.Data.Result.Videos {
		if u := v.URL.First(); u != "" {
			out = append(out, u)
		}
	}
	return out
}

// FirstURL returns the first non-empty result URL, or "" if none yet.
func (d *DetailResponse) FirstURL() string {
	urls := d.AllURLs()
	if len(urls) == 0 {
		return ""
	}
	return urls[0]
}

// Task lifecycle enum values as documented at /cn/api-reference/tasks/status.
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
	StatusCancelled  = "cancelled"
)

// IsTerminal reports whether the status is a final (non-polling) state.
func IsTerminal(status string) bool {
	switch status {
	case StatusCompleted, StatusFailed, StatusCancelled:
		return true
	}
	return false
}

// FailureReason pulls a human message when the task ends unsuccessfully.
func (d *DetailResponse) FailureReason() string {
	if d == nil || d.Data == nil {
		return ""
	}
	if d.Data.FailReason != "" {
		return d.Data.FailReason
	}
	if d.Data.Error != nil && d.Data.Error.Message != "" {
		return d.Data.Error.Message
	}
	if d.Error != nil && d.Error.Message != "" {
		return d.Error.Message
	}
	return d.Msg
}

// uniqueStrings returns a new slice with duplicates removed, preserving order.
func uniqueStrings(ss []string) []string {
	if len(ss) == 0 {
		return ss
	}
	seen := make(map[string]struct{}, len(ss))
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}
