package apimart

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// apimartModelBase strips vendor routing suffixes so per-model branches match
// both the canonical name and its channel aliases (e.g. kling-v3-omni-apimart).
func apimartModelBase(name string) string {
	base := strings.TrimSpace(strings.ToLower(name))
	for _, suffix := range []string{"-apimart", "-suchuang", "-all"} {
		base = strings.TrimSuffix(base, suffix)
	}
	return base
}

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
	return klingMotionControlModels[apimartModelBase(name)]
}

// klingV3OmniModels accept the full omni request schema: image_with_roles
// (first_frame/last_frame/reference) + video_list + multi_shot + element_list.
// Doc: https://docs.apimart.ai/cn/api-reference/videos/kling-v3-omni/generation
var klingV3OmniModels = map[string]bool{
	"kling-v3-omni": true,
}

// klingV3BaseModels share mode/audio/duration/aspect_ratio with omni but only
// take plain image_urls (1-2 entries, first frame first / end frame last) and
// have no video_list. Doc: https://docs.apimart.ai/cn/api-reference/videos/kling-v3/generation
var klingV3BaseModels = map[string]bool{
	"kling-v3": true,
}

func isKlingV3OmniModel(name string) bool {
	return klingV3OmniModels[apimartModelBase(name)]
}

func isKlingV3FamilyModel(name string) bool {
	base := apimartModelBase(name)
	return klingV3OmniModels[base] || klingV3BaseModels[base]
}

// wan27VideoEditModels are APIMart wan2.7 video-editing SKUs. Unlike kling models
// which use video_list[], wan2.7-videoedit takes video_urls[] (string array).
// Doc: https://docs.apimart.ai/cn/api-reference/videos/wan2.7-videoedit/generation
var wan27VideoEditModels = map[string]bool{
	"wan2.7-videoedit": true,
}

func isWan27VideoEditModel(name string) bool {
	return wan27VideoEditModels[apimartModelBase(name)]
}

// pixverse-v6 supports native synchronized audio; default it ON (apimart `audio`
// param) so generated clips aren't silent. Caller can override via metadata.audio.
func isPixverseModel(name string) bool {
	return strings.HasPrefix(apimartModelBase(name), "pixverse")
}

// grok-imagine uses a `quality` knob (480p/720p) instead of the generic
// `resolution` field — sending `resolution` is silently ignored upstream, the
// same trap kling-v3 closes via klingV3ModeFromResolution. We keep our catalog
// `resolution` for spec_key/billing but translate it to `quality` on the wire.
// Doc: https://docs.apimart.ai/cn/api-reference/videos/grok-imagine/generation
func isGrokImagineModel(name string) bool {
	return strings.HasPrefix(apimartModelBase(name), "grok-imagine")
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
	Model                     string           `json:"model"`
	Prompt                    string           `json:"prompt,omitempty"`
	Size                      string           `json:"size,omitempty"`
	Resolution                string           `json:"resolution,omitempty"`
	AspectRatio               string           `json:"aspect_ratio,omitempty"`
	Duration                  int              `json:"duration,omitempty"`
	N                         int              `json:"n,omitempty"`
	ImageUrls                 []string         `json:"image_urls,omitempty"`
	VideoUrls                 []string         `json:"video_urls,omitempty"`
	VideoList                 []VideoListItem  `json:"video_list,omitempty"`
	Watermark                 *bool            `json:"watermark,omitempty"`
	Seed                      *int64           `json:"seed,omitempty"`
	SequentialImageGeneration string           `json:"sequential_image_generation,omitempty"`
	OptimizePromptOptions     map[string]any   `json:"optimize_prompt_options,omitempty"`
	ImageWithRoles            []map[string]any `json:"image_with_roles,omitempty"`
	Extras                    map[string]any   `json:"-"`
}

// internalMetadataKeys are fields set by the gateway for routing/billing
// that must not be forwarded to the upstream provider.
var internalMetadataKeys = map[string]bool{
	"vendor":   true,
	"taskKind": true,
	"content":  true,
	// prevTaskId 是 hono 透传的通用「上一镜引用」，仅用于渠道续写映射（如 pixverse → extend_from_task_id），
	// 不是上游直接参数；统一在此排除原样透传，由各模型分支按需转成上游参数。
	"prevTaskId": true,
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
	if isKlingV3FamilyModel(req.Model) {
		return buildKlingV3Payload(req, isKlingV3OmniModel(req.Model))
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
	// pixverse-v6 默认开启原生音频（否则成片静音）；调用方可用 metadata.audio 覆盖。
	if isPixverseModel(req.Model) {
		if p.Extras == nil {
			p.Extras = map[string]any{}
		}
		if _, ok := p.Extras["audio"]; !ok {
			p.Extras["audio"] = true
		}
		// 视频续写闭环：hono 经 metadata.prevTaskId 透传上一镜上游 task_id（apimart 任务），
		// 转成 pixverse 官方 extend_from_task_id，让本镜从上一镜结尾无缝续演（镜间连续，对标 liblib 001）。
		// prevTaskId 已在 internalMetadataKeys 排除原样透传，仅在此映射为上游参数。
		if pid, ok := req.Metadata["prevTaskId"].(string); ok {
			if pid = strings.TrimSpace(pid); pid != "" {
				p.Extras["extend_from_task_id"] = pid
			}
		}
	}
	// grok-imagine: the catalog ships a `resolution` enum (480p/720p) for spec_key
	// billing, but upstream expects it under `quality`. Translate and drop the
	// ignored `resolution` field so the chosen tier actually takes effect.
	if isGrokImagineModel(req.Model) {
		if res := strings.TrimSpace(p.Resolution); res != "" {
			if p.Extras == nil {
				p.Extras = map[string]any{}
			}
			if _, ok := p.Extras["quality"]; !ok {
				p.Extras["quality"] = strings.ToLower(res)
			}
		}
		p.Resolution = ""
	}
	p.ImageUrls = uniqueStrings(p.ImageUrls)
	return p, nil
}

// klingV3NegativePromptMaxChars is the documented negative_prompt cap; longer
// strings are hard-rejected upstream, so truncate instead of failing the task.
const klingV3NegativePromptMaxChars = 2500

// klingV3AspectRatioRe matches "W:H" ratio strings (hono sends the ratio in the
// `size` field per params_def; upstream only understands aspect_ratio).
var klingV3AspectRatioRe = regexp.MustCompile(`^\d+:\d+$`)

func normalizeKlingV3Mode(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "std", "pro", "4k":
		return strings.ToLower(strings.TrimSpace(v))
	}
	return ""
}

// klingV3ModeFromResolution translates our catalog resolution tiers into the
// upstream `mode` knob (std=720P, pro=1080P, 4k). kling has no `resolution`
// field — sending it is silently ignored, which is exactly the trap this
// translation closes (see sql/patch/20260427_kling_v3_spec_fix.sql).
func klingV3ModeFromResolution(res string) string {
	switch strings.ToLower(strings.TrimSpace(res)) {
	case "720p", "720":
		return "std"
	case "1080p", "1080":
		return "pro"
	case "4k", "2160p", "2160":
		return "4k"
	}
	return ""
}

// normalizeKlingVideoReferType maps the unified gateway `video_refer_type`
// metadata onto the upstream video_list refer_type enum. "feature" = motion
// transfer (动作迁移: extract motion/camera/style from the reference video and
// apply it to a new subject); anything else falls back to "base" (edit/restyle
// or continue the source footage) — the pre-existing default.
func normalizeKlingVideoReferType(v any) string {
	if s, ok := v.(string); ok && strings.EqualFold(strings.TrimSpace(s), "feature") {
		return "feature"
	}
	return "base"
}

// normalizeKlingKeepOriginalSound coerces bool/string forms onto the upstream
// "yes"/"no" enum, defaulting to "no" (matching the previous hardcoded value).
func normalizeKlingKeepOriginalSound(v any) string {
	switch t := v.(type) {
	case bool:
		if t {
			return "yes"
		}
	case string:
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "yes", "true", "1":
			return "yes"
		}
	}
	return "no"
}

// buildKlingV3Payload constructs the APIMart kling-v3 / kling-v3-omni submit
// body per https://docs.apimart.ai/cn/api-reference/videos/kling-v3-omni/generation:
//
//   - resolution → mode (std|pro|4k); explicit metadata.mode wins.
//   - first/last frame images become image_with_roles (omni) or ordered
//     image_urls capped at 2 (kling-v3). Roles arrive via metadata.content[]
//     items (role: first_frame|last_frame|reference_image — the same vocabulary
//     hono uses for ARK) or flat metadata.first_frame_url / last_frame_url.
//   - image_urls and image_with_roles are mutually exclusive upstream; we emit
//     image_with_roles only when at least one image carries a frame role.
//   - video reference (metadata.content video_url / metadata.video_url) maps to
//     video_list (omni only; kling-v3 has no video editing mode).
//   - video_list and audio are mutually exclusive upstream — video wins.
//   - duration is clamped to the documented 3..15s range.
//   - multi_shot / shot_type / multi_prompt / element_list / watermark pass
//     through via metadata → Extras untouched.
func buildKlingV3Payload(req *relaycommon.TaskSubmitReq, omni bool) (*SubmitPayload, error) {
	p := &SubmitPayload{
		Model:  req.Model,
		Prompt: req.Prompt,
	}

	if req.Duration > 0 {
		d := req.Duration
		if d < 3 {
			d = 3
		}
		if d > 15 {
			d = 15
		}
		p.Duration = d
	}

	aspectRatio := strings.TrimSpace(req.AspectRatio)
	if aspectRatio == "" {
		if s := strings.TrimSpace(req.Size); klingV3AspectRatioRe.MatchString(s) {
			aspectRatio = s
		}
	}
	p.AspectRatio = aspectRatio

	type klingImage struct{ url, role string }
	var imgs []klingImage
	seenImage := map[string]bool{}
	addImage := func(url, role string) {
		url = strings.TrimSpace(url)
		if url == "" || seenImage[url] {
			return
		}
		seenImage[url] = true
		imgs = append(imgs, klingImage{url: url, role: role})
	}

	extras := map[string]any{}
	mode := ""
	var videoList []VideoListItem
	if md := req.Metadata; md != nil {
		for k, v := range md {
			if internalMetadataKeys[k] {
				continue
			}
			extras[k] = v
		}
		if v, ok := md["mode"].(string); ok {
			mode = normalizeKlingV3Mode(v)
		}
		if u, ok := md["first_frame_url"].(string); ok {
			addImage(u, "first_frame")
		}
		if u, ok := md["last_frame_url"].(string); ok {
			addImage(u, "last_frame")
		}
		// 统一「参考视频用途」参数（hono extras.videoReferType → metadata.video_refer_type）：
		// feature = 动作迁移（提取参考视频的动作/运镜/风格应用到新主体），base（默认）= 对原片重绘/续演。
		// keep_original_sound 同理是 video_list 条目字段而非顶层参数。两者均支持 content[] 条目级覆盖。
		defaultReferType := normalizeKlingVideoReferType(md["video_refer_type"])
		defaultKeepSound := normalizeKlingKeepOriginalSound(md["keep_original_sound"])
		if u, ok := md["video_url"].(string); ok && strings.TrimSpace(u) != "" {
			videoList = append(videoList, VideoListItem{
				VideoURL:          strings.TrimSpace(u),
				ReferType:         defaultReferType,
				KeepOriginalSound: defaultKeepSound,
			})
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
						if vu, ok := m["video_url"].(map[string]any); ok {
							if u, _ := vu["url"].(string); u != "" {
								referType := defaultReferType
								if v, ok := m["refer_type"]; ok {
									referType = normalizeKlingVideoReferType(v)
								}
								keepSound := defaultKeepSound
								if v, ok := m["keep_original_sound"]; ok {
									keepSound = normalizeKlingKeepOriginalSound(v)
								}
								videoList = append(videoList, VideoListItem{
									VideoURL:          u,
									ReferType:         referType,
									KeepOriginalSound: keepSound,
								})
							}
						}
					case "image_url":
						if iu, ok := m["image_url"].(map[string]any); ok {
							if u, _ := iu["url"].(string); u != "" {
								role, _ := m["role"].(string)
								switch strings.ToLower(strings.TrimSpace(role)) {
								case "first_frame":
									addImage(u, "first_frame")
								case "last_frame", "end_frame":
									addImage(u, "last_frame")
								default:
									addImage(u, "")
								}
							}
						}
					}
				}
			}
		}
		// Consumed flat keys must not leak into the upstream JSON.
		delete(extras, "first_frame_url")
		delete(extras, "last_frame_url")
		delete(extras, "video_url")
		delete(extras, "video_refer_type")
		delete(extras, "keep_original_sound")
		if mode == "" {
			if v, ok := md["resolution"].(string); ok {
				mode = klingV3ModeFromResolution(v)
			}
		}
		delete(extras, "resolution")
		delete(extras, "mode")
	}
	if mode == "" {
		mode = klingV3ModeFromResolution(req.Resolution)
	}
	if mode != "" {
		extras["mode"] = mode
	}

	for _, u := range req.Images {
		addImage(u, "")
	}
	addImage(req.InputReference, "")
	addImage(req.Image, "")

	hasFrameRole := false
	for _, im := range imgs {
		if im.role != "" {
			hasFrameRole = true
			break
		}
	}

	switch {
	case omni && hasFrameRole:
		for _, im := range imgs {
			role := im.role
			if role == "" {
				role = "reference"
			}
			p.ImageWithRoles = append(p.ImageWithRoles, map[string]any{
				"url":  im.url,
				"role": role,
			})
		}
	case omni:
		for _, im := range imgs {
			p.ImageUrls = append(p.ImageUrls, im.url)
		}
	default:
		// kling-v3 takes 1-2 plain image_urls; upstream reads them positionally
		// (first frame first, end frame last), so frame roles decide the order.
		var first, last string
		var rest []string
		for _, im := range imgs {
			switch im.role {
			case "first_frame":
				if first == "" {
					first = im.url
				} else {
					rest = append(rest, im.url)
				}
			case "last_frame":
				if last == "" {
					last = im.url
				} else {
					rest = append(rest, im.url)
				}
			default:
				rest = append(rest, im.url)
			}
		}
		ordered := make([]string, 0, 2)
		if first != "" {
			ordered = append(ordered, first)
		}
		for _, u := range rest {
			if len(ordered) >= 2 || (last != "" && len(ordered) >= 1) {
				break
			}
			ordered = append(ordered, u)
		}
		if last != "" && len(ordered) < 2 {
			ordered = append(ordered, last)
		}
		p.ImageUrls = ordered
	}

	if omni && len(videoList) > 0 {
		p.VideoList = videoList
		delete(extras, "audio") // video_list 与 audio 互斥，视频参考优先
	}

	if np, ok := extras["negative_prompt"].(string); ok {
		if runes := []rune(np); len(runes) > klingV3NegativePromptMaxChars {
			extras["negative_prompt"] = string(runes[:klingV3NegativePromptMaxChars])
		}
	}

	if len(extras) > 0 {
		p.Extras = extras
	}
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
		// edit_operation/edit_selections are TapCanvas' internal operation contract.
		// Wan2.7-VideoEdit's public APIMart request only accepts video_urls,
		// prompt, resolution (and optional documented generation fields); sending
		// internal control keys at the provider boundary can be rejected or ignored.
		skipKeys := map[string]bool{
			"vendor":          true,
			"taskKind":        true,
			"content":         true,
			"video_url":       true,
			"edit_operation":  true,
			"edit_selections": true,
		}
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

	// toapis (OpenAI-style "generation.task") flat form: the task id is at the
	// top level with no `code`/`data` wrapper. See toapis.go for the helpers
	// that let this struct parse both envelopes.
	ID          string `json:"id,omitempty"`
	TaskIDValue string `json:"task_id,omitempty"`
	Object      string `json:"object,omitempty"`
	Status      string `json:"status,omitempty"`
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
	if s.TaskIDValue != "" {
		return s.TaskIDValue
	}
	return s.ID // flat task forms may carry the task id in `id`
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
		ID            string          `json:"id"`
		Status        string          `json:"status"`
		Progress      ProgressValue   `json:"progress"`
		Result        *DetailResult   `json:"result,omitempty"`
		Data          []FlatImageData `json:"data,omitempty"`
		Created       int64           `json:"created,omitempty"`
		Completed     int64           `json:"completed,omitempty"`
		EstimatedTime int64           `json:"estimated_time,omitempty"`
		ActualTime    int64           `json:"actual_time,omitempty"`
		FailReason    string          `json:"fail_reason,omitempty"`
		Error         *APIError       `json:"error,omitempty"`
	} `json:"data,omitempty"`

	// toapis (OpenAI-style "generation.task") flat form (see toapis.go): status,
	// progress and result live at the top level with no `code`/`data` wrapper,
	// and the top-level `error` carries the failure message. These keys never
	// appear in the APIMart envelope, so they stay zero for APIMart responses.
	ID        string        `json:"id,omitempty"`
	TaskID    string        `json:"task_id,omitempty"`
	Object    string        `json:"object,omitempty"`
	Status    string        `json:"status,omitempty"`
	Progress  ProgressValue `json:"progress,omitempty"`
	ResultURL string        `json:"result_url,omitempty"`
	Result    *FlatResult   `json:"result,omitempty"`
}

// ProgressValue accepts both numeric progress and percentage strings such as
// "50%". OpenAI-compatible asynchronous image gateways use both forms.
type ProgressValue int

func (p *ProgressValue) UnmarshalJSON(data []byte) error {
	var number int
	if err := json.Unmarshal(data, &number); err == nil {
		*p = ProgressValue(number)
		return nil
	}
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return fmt.Errorf("apimart: progress must be a number or percentage string: %s", data)
	}
	trimmed := strings.TrimSuffix(strings.TrimSpace(text), "%")
	parsed, err := strconv.Atoi(trimmed)
	if err != nil {
		return fmt.Errorf("apimart: invalid progress %q: %w", text, err)
	}
	*p = ProgressValue(parsed)
	return nil
}

func (p ProgressValue) Int() int { return int(p) }

type FlatImageData struct {
	URL     string `json:"url,omitempty"`
	B64JSON string `json:"b64_json,omitempty"`
}

// FlatResult is the toapis poll result shape: { "type": "image",
// "data": [ { "url": "https://..." } ] }.
type FlatResult struct {
	Type string `json:"type,omitempty"`
	Data []struct {
		URL string `json:"url,omitempty"`
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
	if d == nil {
		return nil
	}
	out := []string{}
	if strings.TrimSpace(d.ResultURL) != "" {
		out = append(out, strings.TrimSpace(d.ResultURL))
	}
	if d.Data != nil && d.Data.Result != nil {
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
	}
	if d.Data != nil {
		for _, item := range d.Data.Data {
			if strings.TrimSpace(item.URL) != "" {
				out = append(out, strings.TrimSpace(item.URL))
			} else if strings.TrimSpace(item.B64JSON) != "" {
				out = append(out, "data:image/png;base64,"+strings.TrimSpace(item.B64JSON))
			}
		}
	}
	// toapis flat form: result.data[].url
	if d.Result != nil {
		for _, item := range d.Result.Data {
			if item.URL != "" {
				out = append(out, item.URL)
			}
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

	// toapis uses different non-terminal labels for the same lifecycle:
	//   queued      ≈ pending, in_progress ≈ processing.
	// Terminal states (completed/failed) match APIMart, so IsTerminal needs no
	// extra cases — these are listed for status normalization/readability only.
	StatusQueued     = "queued"
	StatusInProgress = "in_progress"
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
	if d == nil {
		return ""
	}
	if d.Data != nil {
		if d.Data.FailReason != "" {
			return d.Data.FailReason
		}
		if d.Data.Error != nil && d.Data.Error.Message != "" {
			return d.Data.Error.Message
		}
	}
	// toapis flat form (and any APIMart error envelope without `data`) puts the
	// message in the top-level `error`.
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
