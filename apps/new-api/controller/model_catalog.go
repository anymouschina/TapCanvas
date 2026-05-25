package controller

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

type canonicalModelRow struct {
	value         model.Model
	sourceName    string
	fromCanonical bool
}

func buildCanonicalModelList(models []model.Model) []model.Model {
	if len(models) == 0 {
		return []model.Model{}
	}

	rowsByCanonical := make(map[string]*canonicalModelRow, len(models))
	order := make([]string, 0, len(models))

	for _, raw := range models {
		canonicalName := model.CanonicalModelKey(raw.ModelName)
		if canonicalName == "" {
			continue
		}

		entry, exists := rowsByCanonical[canonicalName]
		if !exists {
			normalized := raw
			normalized.ModelName = canonicalName
			rowsByCanonical[canonicalName] = &canonicalModelRow{
				value:         normalized,
				sourceName:    raw.ModelName,
				fromCanonical: raw.ModelName == canonicalName,
			}
			order = append(order, canonicalName)
			continue
		}

		mergeCanonicalModelRow(entry, raw, canonicalName)
	}

	result := make([]model.Model, 0, len(order))
	for _, canonicalName := range order {
		result = append(result, rowsByCanonical[canonicalName].value)
	}
	return result
}

func buildCanonicalModelParamsCatalog(models []model.Model) map[string]dto.ModelParamsCatalogEntry {
	result := make(map[string]dto.ModelParamsCatalogEntry, len(models))
	if len(models) == 0 {
		return result
	}

	for _, raw := range models {
		canonicalName := model.CanonicalModelKey(raw.ModelName)
		if canonicalName == "" {
			continue
		}

		entry := result[canonicalName]
		if entry.Kind == "" && strings.TrimSpace(raw.Kind) != "" {
			entry.Kind = raw.Kind
		}
		entry.Capabilities = mergeCapabilities(entry.Capabilities, raw.Capabilities)
		if len(entry.Params) == 0 && strings.TrimSpace(raw.ParamsDef) != "" {
			var params []dto.ModelParamSpec
			if err := common.Unmarshal([]byte(raw.ParamsDef), &params); err == nil {
				entry.Params = params
			}
		}
		if entry.Params == nil {
			entry.Params = []dto.ModelParamSpec{}
		}
		result[canonicalName] = entry
	}

	return result
}

func mergeCanonicalModelRow(entry *canonicalModelRow, raw model.Model, canonicalName string) {
	if entry == nil {
		return
	}

	shouldReplaceBase := raw.ModelName == canonicalName && !entry.fromCanonical
	if shouldReplaceBase {
		replacement := raw
		replacement.ModelName = canonicalName
		replacement.Capabilities = chooseMergedCapabilities(raw.Capabilities, entry.value.Capabilities)
		replacement.ParamsDef = chooseMergedParamsDef(raw.ParamsDef, entry.value.ParamsDef)
		replacement.Description = choosePreferredString(raw.Description, entry.value.Description)
		replacement.Icon = choosePreferredString(raw.Icon, entry.value.Icon)
		replacement.Tags = choosePreferredString(raw.Tags, entry.value.Tags)
		replacement.Endpoints = choosePreferredString(raw.Endpoints, entry.value.Endpoints)
		replacement.Kind = choosePreferredString(raw.Kind, entry.value.Kind)
		if replacement.VendorID == 0 {
			replacement.VendorID = entry.value.VendorID
		}
		entry.value = replacement
		entry.sourceName = raw.ModelName
		entry.fromCanonical = true
		return
	}

	entry.value.Capabilities = chooseMergedCapabilities(entry.value.Capabilities, raw.Capabilities)
	entry.value.ParamsDef = chooseMergedParamsDef(entry.value.ParamsDef, raw.ParamsDef)
	entry.value.Description = choosePreferredString(entry.value.Description, raw.Description)
	entry.value.Icon = choosePreferredString(entry.value.Icon, raw.Icon)
	entry.value.Tags = choosePreferredString(entry.value.Tags, raw.Tags)
	entry.value.Endpoints = choosePreferredString(entry.value.Endpoints, raw.Endpoints)
	entry.value.Kind = choosePreferredString(entry.value.Kind, raw.Kind)
	if entry.value.VendorID == 0 {
		entry.value.VendorID = raw.VendorID
	}
}

func choosePreferredString(primary string, fallback string) string {
	if strings.TrimSpace(primary) != "" {
		return primary
	}
	return fallback
}

func chooseMergedCapabilities(primary string, secondary string) string {
	merged := mergeCapabilities(nil, primary)
	merged = mergeCapabilities(merged, secondary)
	if len(merged) == 0 {
		return ""
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return primary
	}
	return string(data)
}

func chooseMergedParamsDef(primary string, secondary string) string {
	if strings.TrimSpace(primary) != "" {
		return primary
	}
	return secondary
}

func mergeCapabilities(existing []string, raw string) []string {
	result := append([]string{}, existing...)
	if strings.TrimSpace(raw) == "" {
		return result
	}

	var parsed []string
	if err := common.Unmarshal([]byte(raw), &parsed); err != nil {
		return result
	}

	seen := make(map[string]struct{}, len(result)+len(parsed))
	for _, item := range result {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		seen[trimmed] = struct{}{}
	}
	for _, item := range parsed {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	sort.Strings(result)
	return result
}
