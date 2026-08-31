package controller

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const maxBatchModelStatusIDs = 1000

type batchModelStatusRequest struct {
	IDs    []int `json:"ids" binding:"required"`
	Status *int  `json:"status" binding:"required"`
}

type modelProtocolBindingRequest struct {
	ChannelID int                            `json:"channel_id"`
	Mode      model.ModelProtocolBindingMode `json:"mode"`
	Binding   *dto.ProtocolBinding           `json:"binding"`
}

type updateModelProtocolsRequest struct {
	Bindings []modelProtocolBindingRequest `json:"bindings" binding:"required"`
}

type modelPricingPolicyRequest struct {
	BillingMode                   string                    `json:"billing_mode"`
	FixedPrice                    *float64                  `json:"fixed_price"`
	FixedPriceCurrency            *string                   `json:"fixed_price_currency"`
	InputPriceUSDPerMillion       *float64                  `json:"input_price_usd_per_million"`
	OutputPriceUSDPerMillion      *float64                  `json:"output_price_usd_per_million"`
	CacheReadPriceUSDPerMillion   *float64                  `json:"cache_read_price_usd_per_million"`
	CacheWritePriceUSDPerMillion  *float64                  `json:"cache_write_price_usd_per_million"`
	ImageInputPriceUSDPerMillion  *float64                  `json:"image_input_price_usd_per_million"`
	AudioInputPriceUSDPerMillion  *float64                  `json:"audio_input_price_usd_per_million"`
	AudioOutputPriceUSDPerMillion *float64                  `json:"audio_output_price_usd_per_million"`
	SpecPricing                   *model.ModelPricingConfig `json:"spec_pricing"`
}

type replaceModelPricingRequest struct {
	Options map[string]map[string]float64 `json:"options" binding:"required"`
}

type modelProtocolCatalogItem struct {
	constant.ProtocolDefinition
	Models []string `json:"models"`
}

// refreshPricingAfterWrite reports partial success when persistence completed
// but the runtime cache could not be rebuilt. Callers must stop after false so
// they do not claim that the saved change is already effective.
func refreshPricingAfterWrite(c *gin.Context, completedAction string) bool {
	if err := model.RefreshPricing(); err != nil {
		common.ApiErrorMsg(
			c,
			fmt.Sprintf("%s，但刷新运行时模型与定价缓存失败: %v", completedAction, err),
		)
		return false
	}
	return true
}

func refreshChannelCacheAfterWrite(c *gin.Context, completedAction string) bool {
	if err := model.RefreshChannelCache(); err != nil {
		common.ApiErrorMsg(
			c,
			fmt.Sprintf("%s，但刷新运行时渠道缓存失败: %v", completedAction, err),
		)
		return false
	}
	return true
}

// rebuildChannelRuntimeCaches rebuilds both runtime views derived from a
// channel/Ability mutation. Both refreshes are attempted so one failed cache
// never prevents the other from catching up to the committed database state.
func rebuildChannelRuntimeCaches() error {
	failures := make([]string, 0, 2)
	if err := model.RefreshChannelCache(); err != nil {
		failures = append(failures, "运行时渠道缓存刷新失败: "+err.Error())
	}
	if err := model.RefreshPricing(); err != nil {
		failures = append(failures, "运行时模型与定价缓存刷新失败: "+err.Error())
	}
	if len(failures) == 0 {
		return nil
	}
	return errors.New(strings.Join(failures, "；"))
}

func refreshChannelRuntimeAfterWrite(c *gin.Context, completedAction string) bool {
	err := rebuildChannelRuntimeCaches()
	if err == nil {
		return true
	}
	common.ApiErrorMsg(
		c,
		fmt.Sprintf("%s，但%s", completedAction, err.Error()),
	)
	return false
}

func buildModelProtocolCatalog() ([]modelProtocolCatalogItem, error) {
	definitions := constant.ListProtocolDefinitions()
	catalog := make([]modelProtocolCatalogItem, 0, len(definitions))
	for _, definition := range definitions {
		rawModels, _, err := getProtocolModels(definition)
		if err != nil {
			return nil, err
		}
		models := appendCanonicalModels(make([]string, 0, len(rawModels)), rawModels)
		sort.Strings(models)
		catalog = append(catalog, modelProtocolCatalogItem{
			ProtocolDefinition: definition,
			Models:             models,
		})
	}
	return catalog, nil
}

// GetModelProtocolCatalog returns the single protocol registry consumed by
// runtime routing and the admin console.
func GetModelProtocolCatalog(c *gin.Context) {
	catalog, err := buildModelProtocolCatalog()
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, catalog)
}

// UpdateModelProtocols atomically changes the protocol used by one model on
// each selected channel. Channel credentials and provider identity are not
// modified.
func UpdateModelProtocols(c *gin.Context) {
	modelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || modelID <= 0 {
		common.ApiErrorMsg(c, "模型 ID 必须是正整数")
		return
	}

	var request updateModelProtocolsRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	updates := make([]model.ModelChannelProtocolUpdate, 0, len(request.Bindings))
	for _, binding := range request.Bindings {
		updates = append(updates, model.ModelChannelProtocolUpdate{
			ChannelID: binding.ChannelID,
			Mode:      binding.Mode,
			Binding:   binding.Binding,
		})
	}

	updatedModel, err := model.UpdateModelProtocolBindings(modelID, updates)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if !refreshChannelRuntimeAfterWrite(c, "协议已保存") {
		return
	}
	if err := enrichModels([]*model.Model{updatedModel}); err != nil {
		common.ApiErrorMsg(c, "协议已保存，但读取模型渠道摘要失败: "+err.Error())
		return
	}
	common.ApiSuccess(c, updatedModel)
}

func GetModelPricingPolicy(c *gin.Context) {
	modelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || modelID <= 0 {
		common.ApiErrorMsg(c, "模型 ID 必须是正整数")
		return
	}
	policy, err := model.GetModelPricingPolicy(modelID)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, policy)
}

func UpdateModelPricingPolicy(c *gin.Context) {
	modelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || modelID <= 0 {
		common.ApiErrorMsg(c, "模型 ID 必须是正整数")
		return
	}
	var request modelPricingPolicyRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	policy, err := model.UpdateModelPricingPolicy(modelID, model.ModelPricingPolicyUpdate{
		BillingMode:                   request.BillingMode,
		FixedPrice:                    request.FixedPrice,
		FixedPriceCurrency:            request.FixedPriceCurrency,
		InputPriceUSDPerMillion:       request.InputPriceUSDPerMillion,
		OutputPriceUSDPerMillion:      request.OutputPriceUSDPerMillion,
		CacheReadPriceUSDPerMillion:   request.CacheReadPriceUSDPerMillion,
		CacheWritePriceUSDPerMillion:  request.CacheWritePriceUSDPerMillion,
		ImageInputPriceUSDPerMillion:  request.ImageInputPriceUSDPerMillion,
		AudioInputPriceUSDPerMillion:  request.AudioInputPriceUSDPerMillion,
		AudioOutputPriceUSDPerMillion: request.AudioOutputPriceUSDPerMillion,
		SpecPricing:                   request.SpecPricing,
	})
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if !refreshPricingAfterWrite(c, "模型定价已保存") {
		return
	}
	common.ApiSuccess(c, policy)
}

func ReplaceModelPricing(c *gin.Context) {
	var request replaceModelPricingRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ReplaceModelPricingOptionMaps(request.Options); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if !refreshPricingAfterWrite(c, "批量定价已保存") {
		return
	}
	common.ApiSuccess(c, nil)
}

// GetAllModelsMeta 获取模型列表（分页）
func GetAllModelsMeta(c *gin.Context) {

	pageInfo := common.GetPageQuery(c)
	modelsMeta, err := model.GetAllModels(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 批量填充附加字段，提升列表接口性能
	if err := enrichModels(modelsMeta); err != nil {
		common.ApiError(c, err)
		return
	}
	var total int64
	if err := model.DB.Model(&model.Model{}).Count(&total).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	// 统计供应商计数（全部数据，不受分页影响）
	vendorCounts, err := model.GetVendorModelCounts()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(modelsMeta)
	common.ApiSuccess(c, gin.H{
		"items":         modelsMeta,
		"total":         total,
		"page":          pageInfo.GetPage(),
		"page_size":     pageInfo.GetPageSize(),
		"vendor_counts": vendorCounts,
	})
}

// SearchModelsMeta 搜索模型列表
func SearchModelsMeta(c *gin.Context) {

	keyword := c.Query("keyword")
	vendor := c.Query("vendor")
	pageInfo := common.GetPageQuery(c)

	modelsMeta, total, err := model.SearchModels(keyword, vendor, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 批量填充附加字段，提升列表接口性能
	if err := enrichModels(modelsMeta); err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(modelsMeta)
	common.ApiSuccess(c, pageInfo)
}

// GetModelMeta 根据 ID 获取单条模型信息
func GetModelMeta(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var m model.Model
	if err := model.DB.First(&m, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if err := enrichModels([]*model.Model{&m}); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, &m)
}

// CreateModelMeta 新建模型
func CreateModelMeta(c *gin.Context) {
	var m model.Model
	if err := c.ShouldBindJSON(&m); err != nil {
		common.ApiError(c, err)
		return
	}
	m.ModelName = strings.TrimSpace(m.ModelName)
	if m.ModelName == "" {
		common.ApiErrorMsg(c, "模型名称不能为空")
		return
	}
	if _, err := model.ParseModelPricingConfig(m.PricingConfig); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.ValidateModelEndpoints(m.Endpoints); err != nil {
		common.ApiErrorMsg(c, "端点配置无效: "+err.Error())
		return
	}
	// 名称冲突检查
	if dup, err := model.IsModelNameDuplicated(0, m.ModelName); err != nil {
		common.ApiError(c, err)
		return
	} else if dup {
		common.ApiErrorMsg(c, "模型名称已存在")
		return
	}

	if err := m.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	if !refreshPricingAfterWrite(c, "模型已创建") {
		return
	}
	common.ApiSuccess(c, &m)
}

// UpdateModelMeta 更新模型
func UpdateModelMeta(c *gin.Context) {
	statusOnly := c.Query("status_only") == "true"

	var m model.Model
	if err := c.ShouldBindJSON(&m); err != nil {
		common.ApiError(c, err)
		return
	}
	if m.Id == 0 {
		common.ApiErrorMsg(c, "缺少模型 ID")
		return
	}
	if !statusOnly {
		m.ModelName = strings.TrimSpace(m.ModelName)
		if m.ModelName == "" {
			common.ApiErrorMsg(c, "模型名称不能为空")
			return
		}
		if _, err := model.ParseModelPricingConfig(m.PricingConfig); err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		if err := model.ValidateModelEndpoints(m.Endpoints); err != nil {
			common.ApiErrorMsg(c, "端点配置无效: "+err.Error())
			return
		}
	}

	if statusOnly {
		// 只更新状态，防止误清空其他字段
		if err := model.DB.Model(&model.Model{}).Where("id = ?", m.Id).Update("status", m.Status).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	} else {
		// 名称冲突检查
		if dup, err := model.IsModelNameDuplicated(m.Id, m.ModelName); err != nil {
			common.ApiError(c, err)
			return
		} else if dup {
			common.ApiErrorMsg(c, "模型名称已存在")
			return
		}
		var persistedModel model.Model
		if err := model.DB.Select("model_name").First(&persistedModel, m.Id).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		if persistedModel.ModelName != m.ModelName {
			common.ApiErrorMsg(c, "模型名称是协议、渠道能力与定价的稳定键，创建后不可修改；请新建模型")
			return
		}

		if err := m.Update(); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if !refreshPricingAfterWrite(c, "模型已更新") {
		return
	}
	common.ApiSuccess(c, &m)
}

// BatchUpdateModelStatus 批量启用或禁用模型。
func BatchUpdateModelStatus(c *gin.Context) {
	var request batchModelStatusRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(request.IDs) == 0 {
		common.ApiErrorMsg(c, "模型 ID 列表不能为空")
		return
	}
	if len(request.IDs) > maxBatchModelStatusIDs {
		common.ApiErrorMsg(c, "单次最多操作 1000 个模型")
		return
	}
	if request.Status == nil || (*request.Status != 0 && *request.Status != 1) {
		common.ApiErrorMsg(c, "模型状态只能是 0 或 1")
		return
	}

	uniqueIDs := make([]int, 0, len(request.IDs))
	seenIDs := make(map[int]struct{}, len(request.IDs))
	for _, id := range request.IDs {
		if id <= 0 {
			common.ApiErrorMsg(c, "模型 ID 必须是正整数")
			return
		}
		if _, exists := seenIDs[id]; exists {
			continue
		}
		seenIDs[id] = struct{}{}
		uniqueIDs = append(uniqueIDs, id)
	}

	updatedCount, err := model.BatchUpdateModelStatus(uniqueIDs, *request.Status)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !refreshPricingAfterWrite(c, "模型状态已批量更新") {
		return
	}
	common.ApiSuccess(c, gin.H{
		"requested_count": len(uniqueIDs),
		"updated_count":   updatedCount,
		"status":          *request.Status,
	})
}

// DeleteModelMeta 删除模型
func DeleteModelMeta(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DB.Delete(&model.Model{}, id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	if !refreshPricingAfterWrite(c, "模型已删除") {
		return
	}
	common.ApiSuccess(c, nil)
}

// enrichModels 批量填充附加信息：端点、渠道、分组、计费类型，避免 N+1 查询。
// 读取失败必须返回给调用方，不能把“没有渠道”伪装成正常空结果。
func enrichModels(models []*model.Model) error {
	if len(models) == 0 {
		return nil
	}

	pricings, err := model.GetPricingWithError()
	if err != nil {
		return fmt.Errorf("刷新运行时模型与定价缓存失败: %w", err)
	}

	// 1) 拆分精确与规则匹配
	exactNames := make([]string, 0)
	exactIdx := make(map[string][]int) // modelName -> indices in models
	ruleIndices := make([]int, 0)
	for i, m := range models {
		if m == nil {
			continue
		}
		if m.NameRule == model.NameRuleExact {
			exactNames = append(exactNames, m.ModelName)
			exactIdx[m.ModelName] = append(exactIdx[m.ModelName], i)
		} else {
			ruleIndices = append(ruleIndices, i)
		}
	}

	// 2) 批量查询精确模型的绑定渠道
	channelsByModel, err := model.GetBoundChannelsByModelsMap(exactNames)
	if err != nil {
		return fmt.Errorf("读取精确模型绑定渠道失败: %w", err)
	}

	// 3) 精确模型：端点从缓存、渠道批量映射、分组/计费类型从缓存
	for name, indices := range exactIdx {
		chs := channelsByModel[name]
		for _, idx := range indices {
			mm := models[idx]
			mm.EffectiveEndpoints = model.GetModelSupportEndpointTypes(mm.ModelName)
			mm.BoundChannels = chs
			mm.EnableGroups = model.GetModelEnableGroups(mm.ModelName)
			mm.QuotaTypes = model.GetModelQuotaTypes(mm.ModelName)
		}
	}

	if len(ruleIndices) == 0 {
		return nil
	}

	// 为全部规则模型收集匹配名集合、端点并集、分组并集、配额集合
	matchedNamesByIdx := make(map[int][]string)
	endpointSetByIdx := make(map[int]map[constant.EndpointType]struct{})
	groupSetByIdx := make(map[int]map[string]struct{})
	quotaSetByIdx := make(map[int]map[int]struct{})

	for _, p := range pricings {
		for _, idx := range ruleIndices {
			mm := models[idx]
			var matched bool
			switch mm.NameRule {
			case model.NameRulePrefix:
				matched = strings.HasPrefix(p.ModelName, mm.ModelName)
			case model.NameRuleSuffix:
				matched = strings.HasSuffix(p.ModelName, mm.ModelName)
			case model.NameRuleContains:
				matched = strings.Contains(p.ModelName, mm.ModelName)
			}
			if !matched {
				continue
			}
			matchedNamesByIdx[idx] = append(matchedNamesByIdx[idx], p.ModelName)

			es := endpointSetByIdx[idx]
			if es == nil {
				es = make(map[constant.EndpointType]struct{})
				endpointSetByIdx[idx] = es
			}
			for _, et := range p.SupportedEndpointTypes {
				es[et] = struct{}{}
			}

			gs := groupSetByIdx[idx]
			if gs == nil {
				gs = make(map[string]struct{})
				groupSetByIdx[idx] = gs
			}
			for _, g := range p.EnableGroup {
				gs[g] = struct{}{}
			}

			qs := quotaSetByIdx[idx]
			if qs == nil {
				qs = make(map[int]struct{})
				quotaSetByIdx[idx] = qs
			}
			qs[p.QuotaType] = struct{}{}
		}
	}

	// 5) 汇总所有匹配到的模型名称，批量查询一次渠道
	allMatchedSet := make(map[string]struct{})
	for _, names := range matchedNamesByIdx {
		for _, n := range names {
			allMatchedSet[n] = struct{}{}
		}
	}
	allMatched := make([]string, 0, len(allMatchedSet))
	for n := range allMatchedSet {
		allMatched = append(allMatched, n)
	}
	matchedChannelsByModel, err := model.GetBoundChannelsByModelsMap(allMatched)
	if err != nil {
		return fmt.Errorf("读取规则模型绑定渠道失败: %w", err)
	}

	// 6) 回填每个规则模型的并集信息
	for _, idx := range ruleIndices {
		mm := models[idx]

		// 端点并集只回填运行时视图，绝不覆盖持久化的显式端点配置。
		if es, ok := endpointSetByIdx[idx]; ok {
			eps := make([]constant.EndpointType, 0, len(es))
			for et := range es {
				eps = append(eps, et)
			}
			sort.Slice(eps, func(i, j int) bool {
				return eps[i] < eps[j]
			})
			mm.EffectiveEndpoints = eps
		}

		// 分组并集
		if gs, ok := groupSetByIdx[idx]; ok {
			groups := make([]string, 0, len(gs))
			for g := range gs {
				groups = append(groups, g)
			}
			mm.EnableGroups = groups
		}

		// 配额类型集合（保持去重并排序）
		if qs, ok := quotaSetByIdx[idx]; ok {
			arr := make([]int, 0, len(qs))
			for k := range qs {
				arr = append(arr, k)
			}
			sort.Ints(arr)
			mm.QuotaTypes = arr
		}

		// 渠道并集
		names := matchedNamesByIdx[idx]
		channelSet := make(map[string]model.BoundChannel)
		for _, n := range names {
			for _, ch := range matchedChannelsByModel[n] {
				key := strconv.Itoa(ch.ID)
				channelSet[key] = ch
			}
		}
		if len(channelSet) > 0 {
			chs := make([]model.BoundChannel, 0, len(channelSet))
			for _, ch := range channelSet {
				chs = append(chs, ch)
			}
			mm.BoundChannels = chs
		}

		// 匹配信息
		mm.MatchedModels = names
		mm.MatchedCount = len(names)
	}
	return nil
}
