package evolink

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// SubmitPayload is the JSON body for POST /v1/videos/generations. Field usage
// varies per model family (Seedance vs Kling-o3); builders below set only the
// fields a given model accepts. Any remaining caller metadata is merged via
// Extras so power-user params pass through without enumerating every variant.
type SubmitPayload struct {
	Model             string         `json:"model"`
	Prompt            string         `json:"prompt,omitempty"`
	ImageUrls         []string       `json:"image_urls,omitempty"`
	VideoUrls         []string       `json:"video_urls,omitempty"`
	AudioUrls         []string       `json:"audio_urls,omitempty"`
	VideoURL          string         `json:"video_url,omitempty"`   // kling-o3 single reference/source video
	ImageStart        string         `json:"image_start,omitempty"` // kling-o3 image-to-video first frame
	ImageEnd          string         `json:"image_end,omitempty"`   // kling-o3 image-to-video end frame
	Duration          int            `json:"duration,omitempty"`
	Quality           string         `json:"quality,omitempty"` // 480p/720p/1080p
	AspectRatio       string         `json:"aspect_ratio,omitempty"`
	GenerateAudio     *bool          `json:"generate_audio,omitempty"`      // seedance
	ContentFilter     *bool          `json:"content_filter,omitempty"`      // seedance
	KeepOriginalSound *bool          `json:"keep_original_sound,omitempty"` // kling-o3 reference/edit
	Sound             string         `json:"sound,omitempty"`               // kling-o3 image-to-video (on/off)
	ModelParams       map[string]any `json:"model_params,omitempty"`        // kling-o3 advanced (element_list, watermark_info)
	Extras            map[string]any `json:"-"`
}

// internalMetadataKeys are gateway routing/billing fields that must never reach
// the upstream, plus keys consumed explicitly by the builders below.
var internalMetadataKeys = map[string]bool{
	"vendor": true, "taskKind": true, "content": true, "prevTaskId": true,
	"first_frame_url": true, "last_frame_url": true, "image_start": true, "image_end": true,
	"video_url": true, "video_urls": true, "audio_urls": true,
	"sound": true, "keep_original_sound": true, "generate_audio": true, "content_filter": true,
	"quality": true, "resolution": true, "aspect_ratio": true, "duration": true,
	"model_params": true,
}

// MarshalJSON emits the canonical fields plus any Extras (metadata overrides win,
// except `model` which is never overridable).
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
			continue
		}
		merged[k] = v
	}
	return common.Marshal(merged)
}

// BuildSubmitPayload dispatches to the per-family builder for req.Model.
func BuildSubmitPayload(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	if req == nil {
		return nil, fmt.Errorf("evolink: nil task request")
	}
	switch {
	case isKlingImageToVideo(req.Model):
		return buildKlingImageToVideo(req)
	case isKlingReferenceToVideo(req.Model):
		return buildKlingReferenceToVideo(req)
	case isKlingVideoEdit(req.Model):
		return buildKlingVideoEdit(req)
	case isSeedanceModel(req.Model):
		return buildSeedance(req)
	default:
		// Unknown video model: fall back to the generic Seedance-shaped body.
		return buildSeedance(req)
	}
}

// --- Seedance 2.0 family -----------------------------------------------------

func buildSeedance(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	p := &SubmitPayload{
		Model:       req.Model,
		Prompt:      req.Prompt,
		Quality:     resolveQuality(req, "720p"),
		AspectRatio: resolveAspectRatio(req, "16:9"),
		Duration:    req.Duration,
	}
	imgs, vids, auds := collectMedia(req)
	p.ImageUrls = imgs
	p.VideoUrls = vids
	p.AudioUrls = auds

	// generate_audio / content_filter default to true (matching Evolink docs);
	// callers can override via metadata.
	p.GenerateAudio = boolPtrFromMeta(req.Metadata, "generate_audio", true)
	p.ContentFilter = boolPtrFromMeta(req.Metadata, "content_filter", true)

	p.Extras = passthroughExtras(req.Metadata)
	if (len(p.ImageUrls) == 0) && (len(p.VideoUrls) == 0) && !isReferenceModel(req.Model) {
		// image-to-video variants require at least one image; reference/text
		// variants may run from prompt alone — only hard-fail the i2v shape.
		if strings.Contains(modelBase(req.Model), "image-to-video") {
			return nil, fmt.Errorf("evolink %s: image_urls is required for image-to-video", req.Model)
		}
	}
	return p, nil
}

func isReferenceModel(name string) bool {
	return strings.Contains(modelBase(name), "reference-to-video")
}

// --- Kling-o3 family ---------------------------------------------------------

// buildKlingImageToVideo: first/last frame → image_start/image_end, extra refs →
// image_urls, sound knob (on/off, default off per docs).
func buildKlingImageToVideo(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	p := &SubmitPayload{
		Model:       req.Model,
		Prompt:      req.Prompt,
		Duration:    req.Duration,
		Quality:     resolveQuality(req, ""),
		AspectRatio: resolveAspectRatio(req, ""),
		Sound:       resolveSound(req.Metadata, "off"),
	}

	start, end, refs := collectFramedImages(req)
	p.ImageStart = start
	p.ImageEnd = end
	p.ImageUrls = refs
	p.ModelParams = modelParamsFromMeta(req.Metadata)
	p.Extras = passthroughExtras(req.Metadata)

	if p.ImageStart == "" && len(p.ImageUrls) == 0 {
		return nil, fmt.Errorf("evolink %s: an input image (image_start) is required", req.Model)
	}
	return p, nil
}

// buildKlingReferenceToVideo: prompt-driven with an optional reference video and
// style/scene reference images.
func buildKlingReferenceToVideo(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	p := &SubmitPayload{
		Model:             req.Model,
		Prompt:            req.Prompt,
		Duration:          req.Duration,
		Quality:           resolveQuality(req, "720p"),
		AspectRatio:       resolveAspectRatio(req, ""),
		KeepOriginalSound: boolPtrFromMeta(req.Metadata, "keep_original_sound", true),
	}
	imgs, vids, _ := collectMedia(req)
	p.ImageUrls = imgs
	if len(vids) > 0 {
		p.VideoURL = vids[0]
	}
	p.ModelParams = modelParamsFromMeta(req.Metadata)
	p.Extras = passthroughExtras(req.Metadata)

	if strings.TrimSpace(p.Prompt) == "" {
		return nil, fmt.Errorf("evolink %s: prompt is required", req.Model)
	}
	return p, nil
}

// buildKlingVideoEdit: edits a source video; video_url is required.
func buildKlingVideoEdit(req *relaycommon.TaskSubmitReq) (*SubmitPayload, error) {
	p := &SubmitPayload{
		Model:             req.Model,
		Prompt:            req.Prompt,
		Quality:           resolveQuality(req, "720p"),
		KeepOriginalSound: boolPtrFromMeta(req.Metadata, "keep_original_sound", true),
	}
	imgs, vids, _ := collectMedia(req)
	p.ImageUrls = imgs
	if len(vids) > 0 {
		p.VideoURL = vids[0]
	}
	p.ModelParams = modelParamsFromMeta(req.Metadata)
	p.Extras = passthroughExtras(req.Metadata)

	if strings.TrimSpace(p.VideoURL) == "" {
		return nil, fmt.Errorf("evolink %s: video_url is required for video editing", req.Model)
	}
	return p, nil
}

// --- shared collectors / resolvers ------------------------------------------

// collectMedia gathers image/video/audio URLs from the standard request fields
// and from metadata (flat keys + the VolcEngine-style content[] array hono uses).
func collectMedia(req *relaycommon.TaskSubmitReq) (images, videos, audios []string) {
	addImg := func(u string) { images = appendURL(images, u) }
	addVid := func(u string) { videos = appendURL(videos, u) }
	addAud := func(u string) { audios = appendURL(audios, u) }

	for _, u := range req.Images {
		addImg(u)
	}
	addImg(req.InputReference)
	addImg(req.Image)

	if md := req.Metadata; md != nil {
		for _, u := range stringSliceFromMeta(md, "video_urls") {
			addVid(u)
		}
		if u, ok := md["video_url"].(string); ok {
			addVid(u)
		}
		for _, u := range stringSliceFromMeta(md, "audio_urls") {
			addAud(u)
		}
		walkContent(md, func(typ, url string) {
			switch typ {
			case "image_url":
				addImg(url)
			case "video_url":
				addVid(url)
			case "audio_url":
				addAud(url)
			}
		})
	}
	return uniqueStrings(images), uniqueStrings(videos), uniqueStrings(audios)
}

// collectFramedImages resolves kling image-to-video first/end frames and any
// remaining reference images. first_frame: metadata.first_frame_url /
// metadata.image_start / req.Image / req.Images[0]. end_frame:
// metadata.last_frame_url / metadata.image_end.
func collectFramedImages(req *relaycommon.TaskSubmitReq) (start, end string, refs []string) {
	md := req.Metadata
	if md != nil {
		start = firstString(md, "image_start", "first_frame_url")
		end = firstString(md, "image_end", "last_frame_url")
	}

	var pool []string
	for _, u := range req.Images {
		pool = appendURL(pool, u)
	}
	pool = appendURL(pool, req.InputReference)
	pool = appendURL(pool, req.Image)
	if md != nil {
		walkContent(md, func(typ, url string) {
			if typ == "image_url" {
				pool = appendURL(pool, url)
			}
		})
	}
	pool = uniqueStrings(pool)

	for _, u := range pool {
		if u == start || u == end {
			continue
		}
		if start == "" {
			start = u
			continue
		}
		refs = append(refs, u)
	}
	return start, end, refs
}

func resolveQuality(req *relaycommon.TaskSubmitReq, def string) string {
	if v := strings.TrimSpace(req.Resolution); v != "" {
		return strings.ToLower(v)
	}
	if req.Metadata != nil {
		if v := firstString(req.Metadata, "quality", "resolution"); v != "" {
			return strings.ToLower(v)
		}
	}
	return def
}

func resolveAspectRatio(req *relaycommon.TaskSubmitReq, def string) string {
	if v := strings.TrimSpace(req.AspectRatio); v != "" {
		return v
	}
	if v := strings.TrimSpace(req.Size); strings.Contains(v, ":") {
		return v
	}
	if req.Metadata != nil {
		if v := firstString(req.Metadata, "aspect_ratio"); v != "" {
			return v
		}
	}
	return def
}

func resolveSound(md map[string]any, def string) string {
	if md != nil {
		if v, ok := md["sound"].(string); ok && strings.TrimSpace(v) != "" {
			return strings.ToLower(strings.TrimSpace(v))
		}
		// allow boolean form
		if b, ok := md["sound"].(bool); ok {
			if b {
				return "on"
			}
			return "off"
		}
	}
	return def
}

func modelParamsFromMeta(md map[string]any) map[string]any {
	if md == nil {
		return nil
	}
	if mp, ok := md["model_params"].(map[string]any); ok && len(mp) > 0 {
		return mp
	}
	return nil
}

// passthroughExtras forwards caller metadata that isn't internal or already
// consumed by a builder, so model-specific upstream params still reach Evolink.
func passthroughExtras(md map[string]any) map[string]any {
	if len(md) == 0 {
		return nil
	}
	extras := make(map[string]any, len(md))
	for k, v := range md {
		if internalMetadataKeys[k] {
			continue
		}
		extras[k] = v
	}
	if len(extras) == 0 {
		return nil
	}
	return extras
}

// walkContent iterates the VolcEngine-style metadata.content[] array, invoking fn
// with (type, url) for image_url / video_url / audio_url items.
func walkContent(md map[string]any, fn func(typ, url string)) {
	raw, ok := md["content"]
	if !ok {
		return
	}
	items, ok := raw.([]any)
	if !ok {
		return
	}
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		typ, _ := m["type"].(string)
		if obj, ok := m[typ].(map[string]any); ok {
			if u, _ := obj["url"].(string); u != "" {
				fn(typ, u)
			}
		}
	}
}

func appendURL(dst []string, u string) []string {
	if u = strings.TrimSpace(u); u != "" {
		return append(dst, u)
	}
	return dst
}

func firstString(md map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := md[k].(string); ok {
			if v = strings.TrimSpace(v); v != "" {
				return v
			}
		}
	}
	return ""
}

func stringSliceFromMeta(md map[string]any, key string) []string {
	raw, ok := md[key]
	if !ok {
		return nil
	}
	switch t := raw.(type) {
	case []any:
		var out []string
		for _, v := range t {
			if s, ok := v.(string); ok {
				out = appendURL(out, s)
			}
		}
		return out
	case []string:
		return t
	case string:
		return appendURL(nil, t)
	}
	return nil
}

func boolPtrFromMeta(md map[string]any, key string, def bool) *bool {
	val := def
	if md != nil {
		if v, ok := md[key]; ok {
			switch t := v.(type) {
			case bool:
				val = t
			case string:
				switch strings.ToLower(strings.TrimSpace(t)) {
				case "true", "yes", "1", "on":
					val = true
				case "false", "no", "0", "off":
					val = false
				}
			}
		}
	}
	return &val
}

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
