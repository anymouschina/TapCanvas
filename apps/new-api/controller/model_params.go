package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetModelParams returns every enabled model's kind, capabilities, and params_def
// as a map keyed by model_name.
// GET /api/models/params  —  TryUserAuth (anonymous access allowed)
func GetModelParams(c *gin.Context) {
	var models []model.Model
	if err := model.DB.
		Where("status = ? AND kind != ''", 1).
		Select("model_name", "kind", "capabilities", "params_def").
		Find(&models).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildCanonicalModelParamsCatalog(models))
}
