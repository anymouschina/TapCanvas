package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// GetModelList returns all non-deleted models with every field including kind/capabilities/params_def.
// GET /api/models/list  —  TryUserAuth (anonymous access allowed)
// Used by internal services (e.g. hono-api) to replace direct SQL access.
//
// Optional ?require_video_spec=true filters out video models that lack a
// `resolution` enum in params_def. Without resolution options, the consumer
// (e.g. hono-api's buildSyntheticVideoSpecCosts) cannot generate spec-level
// pricing — the model would surface as a flat fallback cost (e.g. 14 credits
// regardless of duration), which is meaningless to end users.
func GetModelList(c *gin.Context) {
	// Default: only return enabled models so disabled models are never exposed externally.
	// Pass ?enabled=false explicitly (requires InternalTokenAuth on a separate route) to see disabled.
	query := model.DB.Where("status = ?", 1).Order("id DESC")
	var models []model.Model
	if err := query.Find(&models).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	canonical := buildCanonicalModelList(models)
	if strings.EqualFold(strings.TrimSpace(c.Query("require_video_spec")), "true") {
		canonical = filterVideoModelsWithSpecPricing(canonical)
	}
	common.ApiSuccess(c, canonical)
}

// filterVideoModelsWithSpecPricing drops video models whose params_def lacks a
// non-empty `resolution` enum. Non-video models pass through unchanged.
func filterVideoModelsWithSpecPricing(models []model.Model) []model.Model {
	if len(models) == 0 {
		return models
	}
	out := make([]model.Model, 0, len(models))
	for i := range models {
		m := &models[i]
		if strings.EqualFold(strings.TrimSpace(m.Kind), "video") && !hasResolutionEnum(m.ParamsDef) {
			continue
		}
		out = append(out, *m)
	}
	return out
}

// hasResolutionEnum reports whether a params_def JSON string contains a
// `resolution` param with at least one option entry.
func hasResolutionEnum(paramsDef string) bool {
	trimmed := strings.TrimSpace(paramsDef)
	if trimmed == "" {
		return false
	}
	var params []map[string]any
	if err := common.UnmarshalJsonStr(trimmed, &params); err != nil {
		return false
	}
	for _, p := range params {
		key, _ := p["key"].(string)
		if !strings.EqualFold(strings.TrimSpace(key), "resolution") {
			continue
		}
		options, _ := p["options"].([]any)
		if len(options) > 0 {
			return true
		}
	}
	return false
}

// UpdateModelStatus sets the enabled/disabled status of a model by id.
// PATCH /api/models/list/:id/status  —  InternalTokenAuth
func UpdateModelStatus(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		c.JSON(400, gin.H{"success": false, "message": "invalid model id"})
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}

	var m model.Model
	if err := model.DB.Where("id = ? AND deleted_at IS NULL", id).First(&m).Error; err != nil {
		c.JSON(404, gin.H{"success": false, "message": "model not found"})
		return
	}

	status := 0
	if req.Enabled {
		status = 1
	}
	if err := model.DB.Model(&model.Model{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":       status,
			"updated_time": common.GetTimestamp(),
		}).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	if err := model.DB.Where("id = ? AND deleted_at IS NULL", id).First(&m).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, &m)
}
