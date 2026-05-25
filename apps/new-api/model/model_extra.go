package model

func GetModelEnableGroups(modelName string) []string {
	// 确保缓存最新
	GetPricing()

	modelName = CanonicalModelKey(modelName)
	if modelName == "" {
		return make([]string, 0)
	}

	modelEnableGroupsLock.RLock()
	groups, ok := modelEnableGroups[modelName]
	modelEnableGroupsLock.RUnlock()
	if !ok {
		return make([]string, 0)
	}
	return groups
}

// GetModelQuotaTypes 返回指定模型的计费类型集合（来自缓存）
func GetModelQuotaTypes(modelName string) []int {
	GetPricing()
	modelName = CanonicalModelKey(modelName)

	modelEnableGroupsLock.RLock()
	quota, ok := modelQuotaTypeMap[modelName]
	modelEnableGroupsLock.RUnlock()
	if !ok {
		return []int{}
	}
	return []int{quota}
}

// GetModelKind 返回模型的 kind（"image"/"video" 等），来自 DB 缓存。
func GetModelKind(modelName string) string {
	GetPricing()
	modelEnableGroupsLock.RLock()
	kind := modelKindMap[modelName]
	modelEnableGroupsLock.RUnlock()
	return kind
}
