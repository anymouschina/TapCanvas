package controller

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// filterPricingByVendorAlias removes vendor channel-routing alias models whose
// canonical key differs from their own name (e.g. gpt-image-2-147ai → gpt-image-2).
// "-official" models are kept because they have identity mappings in canonicalModelAliasMap.
func filterPricingByVendorAlias(pricing []model.Pricing) []model.Pricing {
	filtered := make([]model.Pricing, 0, len(pricing))
	for _, item := range pricing {
		if model.CanonicalModelKey(item.ModelName) == item.ModelName {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func filterPricingByUsableGroups(pricing []model.Pricing, usableGroup map[string]string) []model.Pricing {
	if len(pricing) == 0 {
		return pricing
	}
	if len(usableGroup) == 0 {
		return []model.Pricing{}
	}

	filtered := make([]model.Pricing, 0, len(pricing))
	for _, item := range pricing {
		if common.StringsContains(item.EnableGroup, "all") {
			filtered = append(filtered, item)
			continue
		}
		for _, group := range item.EnableGroup {
			if _, ok := usableGroup[group]; ok {
				filtered = append(filtered, item)
				break
			}
		}
	}
	return filtered
}

func projectSupportedEndpoints(
	pricing []model.Pricing,
	endpointCatalog map[string]common.EndpointInfo,
) (map[string]common.EndpointInfo, error) {
	projected := make(map[string]common.EndpointInfo)
	for _, item := range pricing {
		for _, endpointType := range item.SupportedEndpointTypes {
			key := strings.TrimSpace(string(endpointType))
			if key == "" {
				return nil, fmt.Errorf("model %s contains an empty endpoint type", item.ModelName)
			}
			if _, exists := projected[key]; exists {
				continue
			}

			info, exists := endpointCatalog[key]
			if !exists {
				return nil, fmt.Errorf("endpoint %s referenced by model %s is missing", key, item.ModelName)
			}
			path := strings.TrimSpace(info.Path)
			if path == "" {
				return nil, fmt.Errorf("endpoint %s referenced by model %s has an empty path", key, item.ModelName)
			}
			method := strings.ToUpper(strings.TrimSpace(info.Method))
			if method == "" {
				return nil, fmt.Errorf("endpoint %s referenced by model %s has an empty method", key, item.ModelName)
			}
			projected[key] = common.EndpointInfo{Path: path, Method: method}
		}
	}
	return projected, nil
}

func GetPricing(c *gin.Context) {
	catalog, err := model.GetPricingCatalogSnapshotWithError()
	if err != nil {
		common.ApiErrorMsg(c, "刷新定价缓存失败: "+err.Error())
		return
	}
	pricing := catalog.Pricing
	userId, exists := c.Get("id")
	usableGroup := map[string]string{}
	groupRatio := map[string]float64{}
	for s, f := range ratio_setting.GetGroupRatioCopy() {
		groupRatio[s] = f
	}
	var group string
	if exists {
		resolvedUserID, ok := userId.(int)
		if !ok {
			common.ApiErrorMsg(c, "用户 ID 类型无效")
			return
		}
		user, err := model.GetUserCache(resolvedUserID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		group = user.Group
		for g := range groupRatio {
			ratio, ok := ratio_setting.GetGroupGroupRatio(group, g)
			if ok {
				groupRatio[g] = ratio
			}
		}
	}

	usableGroup = service.GetUserUsableGroups(group)
	pricing = filterPricingByVendorAlias(pricing)
	pricing = filterPricingByUsableGroups(pricing, usableGroup)
	// check groupRatio contains usableGroup
	for group := range ratio_setting.GetGroupRatioCopy() {
		if _, ok := usableGroup[group]; !ok {
			delete(groupRatio, group)
		}
	}
	supportedEndpoints, err := projectSupportedEndpoints(pricing, catalog.SupportedEndpoints)
	if err != nil {
		common.ApiErrorMsg(c, "定价端点协议无效: "+err.Error())
		return
	}

	c.JSON(200, gin.H{
		"success":            true,
		"data":               pricing,
		"vendors":            catalog.Vendors,
		"group_ratio":        groupRatio,
		"usable_group":       usableGroup,
		"supported_endpoint": supportedEndpoints,
		"auto_groups":        service.GetUserAutoGroup(group),
		"pricing_version":    "a42d372ccf0b5dd13ecf71203521f9d2",
	})
}

func ResetModelRatio(c *gin.Context) {
	defaultStr := ratio_setting.DefaultModelRatio2JSONString()
	if err := model.ResetModelRatioToDefault(defaultStr); err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if !refreshPricingAfterWrite(c, "模型倍率已重置") {
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "重置模型倍率成功",
	})
}
