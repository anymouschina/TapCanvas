package model

// RefreshPricing 强制立即重新计算与定价相关的缓存。
// 该方法用于需要最新数据的内部管理 API，
// 因此会绕过默认的 1 分钟延迟刷新。
func RefreshPricing() error {
	updatePricingLock.Lock()
	defer updatePricingLock.Unlock()

	modelSupportEndpointsLock.Lock()
	defer modelSupportEndpointsLock.Unlock()

	if err := updatePricing(); err != nil {
		return err
	}

	// 模型目录发生变更（新增/编辑/删除/启停）后，同步刷新"已禁用模型"集合，
	// 让"模型管理"里的禁用开关立即在路由层生效。
	return RefreshModelCatalogCache()
}
