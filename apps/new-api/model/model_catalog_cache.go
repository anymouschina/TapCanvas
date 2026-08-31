package model

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// ModelMetaStatusEnabled is the "enabled" value of the model catalog Status
// column. The catalog toggle writes 1 for enabled and 0 for disabled, so any
// value other than this is treated as disabled.
const ModelMetaStatusEnabled = 1

// disabledModelSet holds the canonical names of models whose catalog Status is
// disabled. A model present here is hard-blocked at the distributor regardless
// of channel availability — catalog disable takes priority over channels.
//
// The set is keyed by canonical name (CanonicalModelKey), so disabling a
// canonical catalog entry also blocks every upstream alias that routes to it
// (e.g. disabling "gpt-image-2" blocks "gpt-image-2-apimart" too).
//
// Only the canonical-named row's own status decides a canonical's disabled
// state: a disabled ALIAS row (e.g. the "-official"/"-magic666" pricing/channel
// tiers that canonicalize onto a base model) MUST NOT poison an enabled base.
// Otherwise disabling "gemini-3.1-flash-image-preview-official" would strip to
// "gemini-3.1-flash-image-preview" and 403-block the still-enabled base model.
var disabledModelSet = make(map[string]struct{})
var modelCatalogSyncLock sync.RWMutex

// RefreshModelCatalogCache reloads the disabled-model set from the models
// table. It swaps state only after a successful query.
func RefreshModelCatalogCache() error {
	var names []string
	if err := DB.Model(&Model{}).
		Where("status <> ?", ModelMetaStatusEnabled).
		Pluck("model_name", &names).Error; err != nil {
		return fmt.Errorf("读取已停用模型失败: %w", err)
	}
	newSet := make(map[string]struct{}, len(names))
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		canonical := CanonicalModelKey(trimmed)
		if canonical == "" {
			continue
		}
		// Skip disabled ALIAS rows — only a disabled canonical-named row
		// (model_name == its own canonical key) disables the canonical.
		if canonical != trimmed {
			continue
		}
		newSet[canonical] = struct{}{}
	}
	modelCatalogSyncLock.Lock()
	disabledModelSet = newSet
	modelCatalogSyncLock.Unlock()
	return nil
}

// SyncModelCatalogCache periodically refreshes the disabled-model set so that a
// catalog toggle on another replica propagates within `frequency` seconds.
func SyncModelCatalogCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		if err := RefreshModelCatalogCache(); err != nil {
			common.SysError("periodic model catalog cache refresh failed: " + err.Error())
		}
	}
}

// IsModelDisabled reports whether the given model has been disabled in the model
// catalog. The input is canonicalized so any alias of a disabled canonical model
// is blocked. When memory cache is off it falls back to a direct DB scan.
func IsModelDisabled(modelName string) (bool, error) {
	canonical := CanonicalModelKey(strings.TrimSpace(modelName))
	if canonical == "" {
		return false, nil
	}
	if !common.MemoryCacheEnabled {
		// Mirror RefreshModelCatalogCache: only the canonical-named row's own
		// status disables the canonical; disabled alias rows never poison it.
		var count int64
		if err := DB.Model(&Model{}).
			Where("model_name = ? AND status <> ?", canonical, ModelMetaStatusEnabled).
			Count(&count).Error; err != nil {
			return false, fmt.Errorf("读取模型 %q 的启停状态失败: %w", canonical, err)
		}
		return count > 0, nil
	}
	modelCatalogSyncLock.RLock()
	defer modelCatalogSyncLock.RUnlock()
	_, ok := disabledModelSet[canonical]
	return ok, nil
}
