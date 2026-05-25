package model

import (
	"encoding/json"
	"strings"
)

var canonicalModelAliasSuffixes = []string{
	"-apimart",
	"-suchuang",
	"-all",
	"-official",
	"-rightcodes",
	"-147ai",
	"-magic666",
	"-yunwu",
	"-vip",
}

var canonicalModelAliasMap = map[string]string{
	"gpt-image-2-apimart":                    "gpt-image-2",
	"gpt-image-2-suchuang":                   "gpt-image-2",
	"gpt-image-2-all":                        "gpt-image-2",
	"gpt-image-2-rightcodes":                 "gpt-image-2",
	"gpt-image-2-vip":                        "gpt-image-2", // internal fallback tier, must not appear in external model list
	"gpt-image-2-pro":                        "gpt-image-2", // internal fallback tier, must not appear in external model list
	"gpt-image-2-magic666":                   "gpt-image-2",
	"gpt-image-2-pro-magic666":               "gpt-image-2",
	"gpt-image-2-vip-magic666":               "gpt-image-2",
	"sora-2":                                 "sora2",
	"sora-2-8s":                              "sora2",
	"sora-2-12s":                             "sora2",
	"sora-2-oai":                             "sora2",
	"gemini-2.5-flash-image-preview-apimart": "gemini-2.5-flash-image-preview",
	"gemini-3-pro-image-preview-apimart":     "gemini-3-pro-image-preview",
	"gemini-3.1-flash-image-preview-apimart": "gemini-3.1-flash-image-preview",
	"veo3.1-fast-apimart":                    "veo-3.1",
	"veo3.1-fast-suchuang":                   "veo-3.1",
	"veo3.1-pro-suchuang":                    "veo-3.1",
	"veo3.1-fast":                            "veo-3.1",
	"veo3.1-pro":                             "veo-3.1",
	"veo_3_1-4K":                             "veo-3.1",
	"veo_3_1-fast":                           "veo-3.1",
	"veo_3_1":                                "veo-3.1",
	"kling-v3-apimart":                       "kling-v3",
	"kling-v2-6-motion-control-apimart":      "kling-v2-6-motion-control",
	"kling-v3-motion-control-apimart":        "kling-v3-motion-control",
	// Short alias falls back to v2.6 (cheaper of the two motion-control SKUs)
	// so users typing the un-versioned name don't accidentally get billed at
	// v3 rates. v3 is ~80%/50% more expensive than v2.6 per second.
	"kling-motion-control":                  "kling-v2-6-motion-control",
	"kling-motion-control-apimart":          "kling-v2-6-motion-control",
	"wan2.7-videoedit-apimart":              "wan2.7-videoedit",
	"doubao-seedance-2.0-apimart":           "doubao-seedance-2.0",
	"doubao-seedance-2.0-fast-apimart":      "doubao-seedance-2.0-fast",
	"doubao-seedance-2.0-face-apimart":      "doubao-seedance-2.0-face",
	"doubao-seedance-2.0-fast-face-apimart": "doubao-seedance-2.0-fast-face",
	// Official Doubao ARK API names (dash-separated with date suffix) → APIMart canonical.
	// This links ark-doubao-video channel entries to the apimart channel pool so that
	// both are candidates for the same request and can serve as each other's fallback.
	"doubao-seedance-2-0-260128":      "doubao-seedance-2.0",
	"doubao-seedance-2-0-fast-260128": "doubao-seedance-2.0-fast",
	// Doubao Seedream 5.0 (image) — ARK date-suffixed names → canonical
	"doubao-seedream-5-0-260128":      "doubao-seedream-5-0",
	"doubao-seedream-5-0-lite-260128": "doubao-seedream-5-0-lite",
	"nano-banana-fast-suchuang":       "nano-banana-fast",
	"nano-banana-pro-suchuang":        "nano-banana-pro",
	"nanobanana2-suchuang":            "nanobanana2",
	// Identity mappings for -official models that are independent pricing tiers,
	// NOT aliases of their base model. Without these, the "-official" suffix
	// in canonicalModelAliasSuffixes would strip them to the base model key,
	// merging them into the base model's pricing entry.
	"gpt-image-2-official":                "gpt-image-2-official",
	"gemini-3-pro-image-preview-official": "gemini-3-pro-image-preview-official",
	// ultra = beqlee 极速渠道对外名称，identity-mapped 以保留独立定价，不合并到普通渠道。
	"gemini-3-pro-image-preview-ultra":     "gemini-3-pro-image-preview-ultra",
	"gemini-3.1-flash-image-preview-ultra": "gemini-3.1-flash-image-preview-ultra",
}

var strictCanonicalRoutingModels = map[string]struct{}{
	"veo-3.1": {},
	"sora2":   {},
}

var canonicalToInternalAliasMap = func() map[string][]string {
	out := make(map[string][]string)
	for alias, canonical := range canonicalModelAliasMap {
		if alias == canonical {
			continue
		}
		if _, strict := strictCanonicalRoutingModels[canonical]; strict {
			continue
		}
		out[canonical] = append(out[canonical], alias)
	}
	return out
}()

func CanonicalModelKey(model string) string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return ""
	}
	if canonical, ok := canonicalModelAliasMap[trimmed]; ok && canonical != "" {
		return canonical
	}
	for _, suffix := range canonicalModelAliasSuffixes {
		if !strings.HasSuffix(trimmed, suffix) {
			continue
		}
		base := strings.TrimSpace(strings.TrimSuffix(trimmed, suffix))
		if base != "" {
			return base
		}
	}
	return trimmed
}

func RoutingModelCandidates(model string) []string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return []string{}
	}
	canonical := CanonicalModelKey(trimmed)
	if _, strict := strictCanonicalRoutingModels[canonical]; strict {
		return []string{trimmed}
	}
	seen := make(map[string]struct{})
	out := make([]string, 0, 1+len(canonicalToInternalAliasMap[canonical]))
	push := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	push(canonical)
	push(trimmed)
	for _, alias := range canonicalToInternalAliasMap[canonical] {
		push(alias)
	}
	return out
}

func RoutingModelSelectionCandidates(model string) []string {
	trimmed := strings.TrimSpace(model)
	if trimmed == "" {
		return []string{}
	}
	canonical := CanonicalModelKey(trimmed)
	if canonical != "" && canonical != trimmed {
		return []string{trimmed}
	}
	if _, strict := strictCanonicalRoutingModels[canonical]; strict {
		return []string{canonical}
	}
	return RoutingModelCandidates(trimmed)
}

func BuildImplicitModelMapping(channel *Channel) string {
	if channel == nil {
		return ""
	}
	base := map[string]string{}
	if raw := strings.TrimSpace(channel.GetModelMapping()); raw != "" {
		_ = json.Unmarshal([]byte(raw), &base)
	}
	if base == nil {
		base = map[string]string{}
	}
	channelModels := channel.GetModels()
	channelModelSet := make(map[string]struct{}, len(channelModels))
	for _, model := range channelModels {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		channelModelSet[model] = struct{}{}
	}
	for _, internalModel := range channel.GetModels() {
		internalModel = strings.TrimSpace(internalModel)
		if internalModel == "" {
			continue
		}
		for _, candidate := range RoutingModelCandidates(internalModel) {
			candidate = strings.TrimSpace(candidate)
			if candidate == "" || candidate == internalModel {
				continue
			}
			if _, exists := channelModelSet[candidate]; exists {
				continue
			}
			if _, exists := base[candidate]; !exists {
				base[candidate] = internalModel
			}
		}
	}
	if len(base) == 0 {
		return ""
	}
	data, err := json.Marshal(base)
	if err != nil {
		return channel.GetModelMapping()
	}
	return string(data)
}
