package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"time"
)

// GetPublicStats 返回指定分类中最近 24h 调用量最高的 10 个模型的公开运行指标，无需鉴权。
func GetPublicStats(c *gin.Context) {
	category, err := model.ParsePublicModelCategory(c.DefaultQuery("category", string(model.PublicModelCategoryAll)))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stats, err := model.GetPublicModelStats(category)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"generated_at": time.Now().Unix(),
		"window_hours": 24,
		"category":     category,
		"models":       stats,
	})
}

// GetPublicModelChartStats 返回最近 24h 全模型调用量与成功率，并按真实请求规格拆分。
func GetPublicModelChartStats(c *gin.Context) {
	stats, err := model.GetPublicModelChartStats()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"generated_at": time.Now().Unix(),
		"window_hours": 24,
		"models":       stats,
	})
}

// GetAdminChannelModelSuccessRates 返回过去 24h 各渠道各模型成功率（仅 admin）
func GetAdminChannelModelSuccessRates(c *gin.Context) {
	stats, err := model.GetChannelModelSuccessRates()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stats)
}
