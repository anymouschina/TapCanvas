package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetPublicStats 返回最近 24h 各模型调用次数与成功次数，无需鉴权
func GetPublicStats(c *gin.Context) {
	stats, err := model.GetPublicModelStats()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, stats)
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
