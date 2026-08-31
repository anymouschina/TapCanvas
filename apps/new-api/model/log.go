package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

type Log struct {
	Id               int    `json:"id" gorm:"index:idx_created_at_id,priority:1;index:idx_user_id_id,priority:2"`
	UserId           int    `json:"user_id" gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;index:idx_created_at_id,priority:2;index:idx_created_at_type"`
	Type             int    `json:"type" gorm:"index:idx_created_at_type"`
	Content          string `json:"content"`
	Username         string `json:"username" gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName        string `json:"token_name" gorm:"index;default:''"`
	ModelName        string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota            int    `json:"quota" gorm:"default:0"`
	DisplayQuota     int    `json:"-" gorm:"default:0"` // 对外展示额度快照 = round(quota × token.display_ratio)，仅用于自助端显示
	PromptTokens     int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens int    `json:"completion_tokens" gorm:"default:0"`
	UseTime          int    `json:"use_time" gorm:"default:0"`
	IsStream         bool   `json:"is_stream"`
	ChannelId        int    `json:"channel" gorm:"index"`
	ChannelName      string `json:"channel_name" gorm:"->"`
	TokenId          int    `json:"token_id" gorm:"default:0;index"`
	Group            string `json:"group" gorm:"index"`
	Ip               string `json:"ip" gorm:"index;default:''"`
	RequestId        string `json:"request_id,omitempty" gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	ConversationId   string `json:"conversation_id,omitempty" gorm:"type:varchar(64);index:idx_logs_conversation_id;default:''"`
	Other            string `json:"other"`
}

// don't use iota, avoid change log type value
const (
	LogTypeUnknown    = 0
	LogTypeRedemption = 1
	LogTypeConsume    = 2
	LogTypeManage     = 3
	LogTypeSystem     = 4
	LogTypeError      = 5
	LogTypeRefund     = 6
)

func formatUserLogs(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].ChannelName = ""
		var otherMap map[string]interface{}
		otherMap, _ = common.StrToMap(logs[i].Other)
		if otherMap != nil {
			// Remove admin-only debug fields.
			delete(otherMap, "admin_info")
			// delete(otherMap, "reject_reason")
			delete(otherMap, "stream_status")
		}
		logs[i].Other = common.MapToJsonStr(otherMap)
		// 自助端（用户视角）展示对外价：有快照就用快照替换真实额；管理员走 GetAllLogs 不经过此函数，仍看真实额。
		if logs[i].DisplayQuota > 0 {
			logs[i].Quota = logs[i].DisplayQuota
		}
		logs[i].Id = startIdx + i + 1
	}
}

func GetLogByTokenId(tokenId int) (logs []*Log, err error) {
	err = LOG_DB.Model(&Log{}).Where("token_id = ?", tokenId).Order("id desc").Limit(common.MaxRecentItems).Find(&logs).Error
	formatUserLogs(logs, 0)
	return logs, err
}

func RecordLog(userId int, logType int, content string) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// RecordLogWithAdminInfo 记录操作日志，并将管理员相关信息存入 Other.admin_info，
func RecordLogWithAdminInfo(userId int, logType int, content string, adminInfo map[string]interface{}) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	if len(adminInfo) > 0 {
		other := map[string]interface{}{
			"admin_info": adminInfo,
		}
		log.Other = common.MapToJsonStr(other)
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

func RecordErrorLog(c *gin.Context, userId int, channelId int, modelName string, tokenName string, content string, tokenId int, useTimeSeconds int,
	isStream bool, group string, other map[string]interface{}) {
	logger.LogInfo(c, fmt.Sprintf("record error log: userId=%d, channelId=%d, modelName=%s, tokenName=%s, content=%s", userId, channelId, modelName, tokenName, content))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	otherStr := common.MapToJsonStr(other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeError,
		Content:          content,
		PromptTokens:     0,
		CompletionTokens: 0,
		TokenName:        tokenName,
		ModelName:        modelName,
		Quota:            0,
		ChannelId:        channelId,
		TokenId:          tokenId,
		UseTime:          useTimeSeconds,
		IsStream:         isStream,
		Group:            group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId: requestId,
		Other:     otherStr,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
}

// tokenDisplayRatio 读取指定令牌的对外展示系数；令牌不存在 / id 为 0 时按 1.0（不折算）。
func tokenDisplayRatio(tokenId int) float64 {
	if tokenId <= 0 {
		return 1.0
	}
	token, err := GetTokenById(tokenId)
	if err != nil || token == nil {
		return 1.0
	}
	return common.NormalizePriceRatio(token.DisplayRatio)
}

type RecordConsumeLogParams struct {
	ChannelId        int                    `json:"channel_id"`
	PromptTokens     int                    `json:"prompt_tokens"`
	CompletionTokens int                    `json:"completion_tokens"`
	ModelName        string                 `json:"model_name"`
	TokenName        string                 `json:"token_name"`
	Quota            int                    `json:"quota"`
	Content          string                 `json:"content"`
	TokenId          int                    `json:"token_id"`
	UseTimeSeconds   int                    `json:"use_time_seconds"`
	IsStream         bool                   `json:"is_stream"`
	Group            string                 `json:"group"`
	Other            map[string]interface{} `json:"other"`
	ConversationId   string                 `json:"conversation_id"`
	DisplayRatio     float64                `json:"display_ratio"`
}

func RecordConsumeLog(c *gin.Context, userId int, params RecordConsumeLogParams) {
	if !common.LogConsumeEnabled {
		return
	}
	logger.LogInfo(c, fmt.Sprintf("record consume log: userId=%d, params=%s", userId, common.GetJsonString(params)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	conversationId := c.GetHeader("x-tapcanvas-conversation-id")
	otherStr := common.MapToJsonStr(params.Other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	displayRatio := params.DisplayRatio
	if displayRatio <= 0 {
		displayRatio = tokenDisplayRatio(params.TokenId)
	}
	displayQuota := common.ApplyDisplayRatio(params.Quota, displayRatio)
	if params.Quota > 0 && displayQuota == 0 {
		displayQuota = 1 // 折后不足1的计费镜像真实账单的最低1，且让 DisplayQuota==0 明确表示"无快照/免费"
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeConsume,
		Content:          params.Content,
		PromptTokens:     params.PromptTokens,
		CompletionTokens: params.CompletionTokens,
		TokenName:        params.TokenName,
		ModelName:        params.ModelName,
		Quota:            params.Quota,
		DisplayQuota:     displayQuota,
		ChannelId:        params.ChannelId,
		TokenId:          params.TokenId,
		UseTime:          params.UseTimeSeconds,
		IsStream:         params.IsStream,
		Group:            params.Group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:      requestId,
		ConversationId: conversationId,
		Other:          otherStr,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
	if common.DataExportEnabled {
		gopool.Go(func() {
			LogQuotaData(userId, username, params.ModelName, params.Quota, common.GetTimestamp(), params.PromptTokens+params.CompletionTokens)
		})
	}
}

type RecordTaskBillingLogParams struct {
	UserId    int
	LogType   int
	Content   string
	ChannelId int
	ModelName string
	Quota     int
	TokenId   int
	Group     string
	Other     map[string]interface{}
}

func RecordTaskBillingLog(params RecordTaskBillingLogParams) {
	if params.LogType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(params.UserId, false)
	tokenName := ""
	displayRatio := 1.0
	if params.TokenId > 0 {
		if token, err := GetTokenById(params.TokenId); err == nil {
			tokenName = token.Name
			displayRatio = common.NormalizePriceRatio(token.DisplayRatio)
		}
	}
	displayQuota := common.ApplyDisplayRatio(params.Quota, displayRatio)
	if params.Quota > 0 && displayQuota == 0 {
		displayQuota = 1
	}
	log := &Log{
		UserId:       params.UserId,
		Username:     username,
		CreatedAt:    common.GetTimestamp(),
		Type:         params.LogType,
		Content:      params.Content,
		TokenName:    tokenName,
		ModelName:    params.ModelName,
		Quota:        params.Quota,
		DisplayQuota: displayQuota,
		ChannelId:    params.ChannelId,
		TokenId:      params.TokenId,
		Group:        params.Group,
		Other:        common.MapToJsonStr(params.Other),
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		common.SysLog("failed to record task billing log: " + err.Error())
	}
}

func GetAllLogs(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, startIdx int, num int, channel int, group string, requestId string, conversationId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB
	} else {
		tx = LOG_DB.Where("logs.type = ?", logType)
	}

	if modelName != "" {
		tx = tx.Where("logs.model_name like ?", modelName)
	}
	if username != "" {
		tx = tx.Where("logs.username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if conversationId != "" {
		tx = tx.Where("logs.conversation_id = ?", conversationId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if channel != 0 {
		tx = tx.Where("logs.channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	err = tx.Order("logs.id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}

	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}

	if channelIds.Len() > 0 {
		var channels []struct {
			Id   int    `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		if common.MemoryCacheEnabled {
			// Cache get channel
			for _, channelId := range channelIds.Items() {
				if cacheChannel, err := CacheGetChannel(channelId); err == nil {
					channels = append(channels, struct {
						Id   int    `gorm:"column:id"`
						Name string `gorm:"column:name"`
					}{
						Id:   channelId,
						Name: cacheChannel.Name,
					})
				}
			}
		} else {
			// Bulk query channels from DB
			if err = DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
				return logs, total, err
			}
		}
		channelMap := make(map[int]string, len(channels))
		for _, channel := range channels {
			channelMap[channel.Id] = channel.Name
		}
		for i := range logs {
			logs[i].ChannelName = channelMap[logs[i].ChannelId]
		}
	}

	return logs, total, err
}

const logSearchCountLimit = 10000

func GetUserLogs(userId int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, group string, requestId string, conversationId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB.Where("logs.user_id = ?", userId)
	} else {
		tx = LOG_DB.Where("logs.user_id = ? and logs.type = ?", userId, logType)
	}

	if modelName != "" {
		modelNamePattern, err := sanitizeLikePattern(modelName)
		if err != nil {
			return nil, 0, err
		}
		tx = tx.Where("logs.model_name LIKE ? ESCAPE '!'", modelNamePattern)
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if conversationId != "" {
		tx = tx.Where("logs.conversation_id = ?", conversationId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError("failed to count user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}
	err = tx.Order("logs.id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError("failed to search user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}

	formatUserLogs(logs, startIdx)
	return logs, total, err
}

type Stat struct {
	Quota int `json:"quota"`
	Rpm   int `json:"rpm"`
	Tpm   int `json:"tpm"`
}

func SumUsedQuota(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string) (stat Stat, err error) {
	tx := LOG_DB.Table("logs").Select("sum(quota) quota")

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, sum(prompt_tokens) + sum(completion_tokens) tpm")

	if username != "" {
		tx = tx.Where("username = ?", username)
		rpmTpmQuery = rpmTpmQuery.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		modelNamePattern, err := sanitizeLikePattern(modelName)
		if err != nil {
			return stat, err
		}
		tx = tx.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
		rpmTpmQuery = rpmTpmQuery.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
		rpmTpmQuery = rpmTpmQuery.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	if err := tx.Scan(&stat).Error; err != nil {
		common.SysError("failed to query log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	if err := rpmTpmQuery.Scan(&stat).Error; err != nil {
		common.SysError("failed to query rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	return stat, nil
}

// SumUsedQuotaSelf 与 SumUsedQuota 一致，但按对外展示价（display_quota 优先，回退真实 quota）汇总，仅供自助端统计使用。
func SumUsedQuotaSelf(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string) (stat Stat, err error) {
	tx := LOG_DB.Table("logs").Select("sum(coalesce(nullif(display_quota,0), quota)) quota")

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, sum(prompt_tokens) + sum(completion_tokens) tpm")

	if username != "" {
		tx = tx.Where("username = ?", username)
		rpmTpmQuery = rpmTpmQuery.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		modelNamePattern, err := sanitizeLikePattern(modelName)
		if err != nil {
			return stat, err
		}
		tx = tx.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
		rpmTpmQuery = rpmTpmQuery.Where("model_name LIKE ? ESCAPE '!'", modelNamePattern)
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
		rpmTpmQuery = rpmTpmQuery.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	if err := tx.Scan(&stat).Error; err != nil {
		common.SysError("failed to query log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	if err := rpmTpmQuery.Scan(&stat).Error; err != nil {
		common.SysError("failed to query rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	return stat, nil
}

// SumConversationQuota sums the consumed quota of chat-consume log rows for a single
// tapcanvas conversation (x-tapcanvas-conversation-id), optionally only rows created at or
// after sinceUnixSec. Used by hono-api to bill the end user for exactly what a chat turn
// consumed. type = LogTypeConsume excludes error rows (which carry quota 0). COALESCE keeps
// it cross-DB safe (SQLite/MySQL/PostgreSQL). Indexed by idx_logs_conversation_id.
func SumConversationQuota(conversationId string, sinceUnixSec int64) (int, error) {
	if conversationId == "" {
		return 0, nil
	}
	var quota int
	tx := LOG_DB.Table("logs").
		Select("COALESCE(sum(quota),0)").
		Where("type = ?", LogTypeConsume).
		Where("conversation_id = ?", conversationId)
	if sinceUnixSec != 0 {
		tx = tx.Where("created_at >= ?", sinceUnixSec)
	}
	if err := tx.Scan(&quota).Error; err != nil {
		return 0, err
	}
	return quota, nil
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	tx := LOG_DB.Table("logs").Select("ifnull(sum(prompt_tokens),0) + ifnull(sum(completion_tokens),0)")
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

// financialLogTypes 是对账必须保留的日志类型，不参与自动清理。
var financialLogTypes = []int{LogTypeRedemption, LogTypeConsume, LogTypeRefund}

func DeleteOldLog(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	var total int64 = 0

	for {
		if nil != ctx.Err() {
			return total, ctx.Err()
		}

		result := LOG_DB.Where("created_at < ? AND type NOT IN ?", targetTimestamp, financialLogTypes).Limit(limit).Delete(&Log{})
		if nil != result.Error {
			return total, result.Error
		}

		total += result.RowsAffected

		if result.RowsAffected < int64(limit) {
			break
		}
	}

	return total, nil
}

// VacuumLogTables 对 logs 和 tasks 表执行 VACUUM ANALYZE，回收 PostgreSQL 死元组占用的空间。
// VACUUM 不能在事务中执行，需要通过底层 *sql.DB 直接发送。
func VacuumLogTables(ctx context.Context) {
	vacuumTable := func(db *gorm.DB, table string) {
		sqlDB, err := db.DB()
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("vacuum: get sql.DB failed for %s: %v", table, err))
			return
		}
		if _, err := sqlDB.ExecContext(ctx, "VACUUM ANALYZE "+table); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("vacuum: VACUUM ANALYZE %s failed: %v", table, err))
		}
	}
	vacuumTable(LOG_DB, "logs")
	vacuumTable(DB, "tasks")
}

// PublicModelStat 公开统计：单个模型 24h 调用数据
type PublicModelStat struct {
	ModelName               string   `json:"model_name"`
	CallCount               int64    `json:"call_count"`
	SuccessCount            int64    `json:"success_count"`
	AverageLatencySeconds   float64  `json:"average_latency_seconds"`
	MaximumLatencySeconds   int      `json:"maximum_latency_seconds"`
	AveragePromptTokens     float64  `json:"average_prompt_tokens"`
	AverageCompletionTokens float64  `json:"average_completion_tokens"`
	LastCalledAt            int64    `json:"last_called_at"`
	ModelKind               string   `json:"model_kind"`
	Specifications          []string `json:"specifications"`
	Available               bool     `json:"available"`
	HealthStatus            string   `json:"health_status"`
}

// PublicModelCategory 是首页公开榜单支持的模型分类。
// 分类只依据模型库 kind 字段，不根据模型名称推断。
type PublicModelCategory string

const (
	PublicModelCategoryAll   PublicModelCategory = "all"
	PublicModelCategoryText  PublicModelCategory = "text"
	PublicModelCategoryVideo PublicModelCategory = "video"
	PublicModelCategoryImage PublicModelCategory = "image"
)

// ParsePublicModelCategory 校验首页公开榜单的分类参数。
func ParsePublicModelCategory(raw string) (PublicModelCategory, error) {
	category := PublicModelCategory(strings.TrimSpace(raw))
	switch category {
	case PublicModelCategoryAll, PublicModelCategoryText, PublicModelCategoryVideo, PublicModelCategoryImage:
		return category, nil
	default:
		return "", errors.New("模型分类参数无效")
	}
}

func publicModelCategoryKinds(category PublicModelCategory) ([]string, error) {
	switch category {
	case PublicModelCategoryText:
		return []string{"chat", "text"}, nil
	case PublicModelCategoryVideo:
		return []string{"video"}, nil
	case PublicModelCategoryImage:
		return []string{"image"}, nil
	case PublicModelCategoryAll:
		return []string{}, nil
	default:
		return nil, errors.New("模型分类参数无效")
	}
}

func publicModelNamesForCategory(category PublicModelCategory) ([]string, error) {
	kinds, err := publicModelCategoryKinds(category)
	if err != nil {
		return nil, err
	}
	if category == PublicModelCategoryAll {
		return []string{}, nil
	}

	modelNames := make([]string, 0)
	if err := DB.Model(&Model{}).
		Distinct("model_name").
		Where("kind IN ? AND model_name != ''", kinds).
		Pluck("model_name", &modelNames).Error; err != nil {
		common.SysError("failed to query public model category: " + err.Error())
		return nil, errors.New("查询模型分类失败")
	}
	return modelNames, nil
}

type publicModelCatalogRow struct {
	ModelName     string `gorm:"column:model_name"`
	Kind          string `gorm:"column:kind"`
	PricingConfig string `gorm:"column:pricing_config"`
	Status        int    `gorm:"column:status"`
}

type publicModelAvailabilityRow struct {
	Model        string `gorm:"column:model"`
	EnabledCount int64  `gorm:"column:enabled_count"`
}

func publicModelHealthStatus(available bool, callCount int64, successCount int64) string {
	if !available {
		return "unavailable"
	}
	if callCount <= 0 {
		return "no_data"
	}
	successRate := float64(successCount) / float64(callCount)
	if successRate >= 0.98 {
		return "operational"
	}
	if successRate >= 0.90 {
		return "degraded"
	}
	return "unstable"
}

func publicModelSpecifications(rawPricingConfig string) ([]string, error) {
	config, err := ParseModelPricingConfig(rawPricingConfig)
	if err != nil {
		return nil, err
	}
	if config == nil || config.IsDisabled() {
		return []string{}, nil
	}
	specifications := make([]string, 0, len(config.Specs))
	seen := make(map[string]struct{}, len(config.Specs))
	for _, spec := range config.Specs {
		parts := make([]string, 0, 3)
		if spec.SpecKey != "" {
			parts = append(parts, spec.SpecKey)
		}
		if spec.Resolution != "" {
			parts = append(parts, spec.Resolution)
		}
		if spec.DurationSeconds > 0 {
			parts = append(parts, fmt.Sprintf("%ds", spec.DurationSeconds))
		}
		label := strings.Join(parts, " · ")
		if label == "" {
			continue
		}
		if _, exists := seen[label]; exists {
			continue
		}
		seen[label] = struct{}{}
		specifications = append(specifications, label)
	}
	return specifications, nil
}

// GetPublicModelStats 查询指定分类中最近 24 小时调用量最高的 10 个模型，
// 并补充真实耗时、规格与可用状态。每个分类独立排名，不从全部 Top 10 二次筛选。
func GetPublicModelStats(category PublicModelCategory) ([]PublicModelStat, error) {
	since := time.Now().Add(-24 * time.Hour).Unix()
	modelNamesForCategory, err := publicModelNamesForCategory(category)
	if err != nil {
		return nil, err
	}
	if category != PublicModelCategoryAll && len(modelNamesForCategory) == 0 {
		return []PublicModelStat{}, nil
	}

	stats := make([]PublicModelStat, 0)
	query := LOG_DB.Table("logs").
		Select(
			"model_name, COUNT(*) AS call_count, "+
				"SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS success_count, "+
				"AVG(use_time) AS average_latency_seconds, MAX(use_time) AS maximum_latency_seconds, "+
				"AVG(CASE WHEN type = ? THEN prompt_tokens ELSE NULL END) AS average_prompt_tokens, "+
				"AVG(CASE WHEN type = ? THEN completion_tokens ELSE NULL END) AS average_completion_tokens, "+
				"MAX(created_at) AS last_called_at",
			LogTypeConsume,
			LogTypeConsume,
			LogTypeConsume,
		).
		Where("created_at >= ? AND type IN (?, ?) AND model_name != ''", since, LogTypeConsume, LogTypeError)
	if category != PublicModelCategoryAll {
		query = query.Where("model_name IN ?", modelNamesForCategory)
	}
	err = query.
		Group("model_name").
		Order("call_count DESC, model_name ASC").
		Limit(10).
		Scan(&stats).Error
	if err != nil {
		common.SysError("failed to query public model stats: " + err.Error())
		return nil, errors.New("查询模型统计失败")
	}
	if len(stats) == 0 {
		return stats, nil
	}

	modelNames := make([]string, 0, len(stats))
	for _, stat := range stats {
		modelNames = append(modelNames, stat.ModelName)
	}

	var catalogRows []publicModelCatalogRow
	if err := DB.Model(&Model{}).
		Select("model_name", "kind", "pricing_config", "status").
		Where("model_name IN ?", modelNames).
		Scan(&catalogRows).Error; err != nil {
		common.SysError("failed to query public model catalog: " + err.Error())
		return nil, errors.New("查询模型规格失败")
	}
	catalogByName := make(map[string]publicModelCatalogRow, len(catalogRows))
	for _, row := range catalogRows {
		catalogByName[row.ModelName] = row
	}

	var availabilityRows []publicModelAvailabilityRow
	if err := DB.Model(&Ability{}).
		Select("model, COUNT(*) AS enabled_count").
		Where("model IN ? AND enabled = ?", modelNames, true).
		Group("model").
		Scan(&availabilityRows).Error; err != nil {
		common.SysError("failed to query public model availability: " + err.Error())
		return nil, errors.New("查询模型可用状态失败")
	}
	enabledCountByName := make(map[string]int64, len(availabilityRows))
	for _, row := range availabilityRows {
		enabledCountByName[row.Model] = row.EnabledCount
	}

	for index := range stats {
		stat := &stats[index]
		catalog, hasCatalog := catalogByName[stat.ModelName]
		stat.Available = enabledCountByName[stat.ModelName] > 0 && (!hasCatalog || catalog.Status == ModelMetaStatusEnabled)
		stat.HealthStatus = publicModelHealthStatus(stat.Available, stat.CallCount, stat.SuccessCount)
		stat.Specifications = []string{}
		if !hasCatalog {
			continue
		}
		stat.ModelKind = strings.TrimSpace(catalog.Kind)
		specifications, err := publicModelSpecifications(catalog.PricingConfig)
		if err != nil {
			common.SysError(fmt.Sprintf("failed to parse public model specification for %s: %v", stat.ModelName, err))
			return nil, errors.New("解析模型规格失败")
		}
		stat.Specifications = specifications
	}
	return stats, nil
}

// ChannelModelSuccessRate 单条渠道+模型成功率数据
type ChannelModelSuccessRate struct {
	ModelName    string  `json:"model_name"`
	ChannelId    int     `json:"channel_id"`
	ChannelName  string  `json:"channel_name"`
	Total        int64   `json:"total"`
	SuccessCount int64   `json:"success_count"`
	SuccessRate  float64 `json:"success_rate"` // 0.0–1.0
}

// GetChannelModelSuccessRates 查询过去 24h 各渠道各模型成功率
func GetChannelModelSuccessRates() ([]ChannelModelSuccessRate, error) {
	since := time.Now().Add(-24 * time.Hour).Unix()

	type rawRow struct {
		ModelName    string `gorm:"column:model_name"`
		ChannelId    int    `gorm:"column:channel_id"`
		Total        int64  `gorm:"column:total"`
		SuccessCount int64  `gorm:"column:success_count"`
	}

	var rows []rawRow
	err := LOG_DB.Table("logs").
		Select("model_name, channel_id, COUNT(*) AS total, SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS success_count", LogTypeConsume).
		Where("created_at >= ? AND type IN (?, ?) AND model_name != '' AND channel_id != 0", since, LogTypeConsume, LogTypeError).
		Group("model_name, channel_id").
		Order("model_name ASC, total DESC").
		Scan(&rows).Error
	if err != nil {
		common.SysError("failed to query channel model success rates: " + err.Error())
		return nil, errors.New("查询渠道模型成功率失败")
	}
	if len(rows) == 0 {
		return []ChannelModelSuccessRate{}, nil
	}

	// 收集所有 channel_id，批量查名字
	channelIdSet := make(map[int]struct{}, len(rows))
	for _, r := range rows {
		channelIdSet[r.ChannelId] = struct{}{}
	}
	channelIds := make([]int, 0, len(channelIdSet))
	for id := range channelIdSet {
		channelIds = append(channelIds, id)
	}

	type channelRow struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	var channels []channelRow
	if err2 := DB.Table("channels").Select("id, name").Where("id IN ?", channelIds).Scan(&channels).Error; err2 != nil {
		common.SysError("failed to query channel names: " + err2.Error())
		// 不影响主流程，仅名字为空
	}
	channelNameMap := make(map[int]string, len(channels))
	for _, ch := range channels {
		channelNameMap[ch.Id] = ch.Name
	}

	result := make([]ChannelModelSuccessRate, 0, len(rows))
	for _, r := range rows {
		rate := float64(0)
		if r.Total > 0 {
			rate = float64(r.SuccessCount) / float64(r.Total)
		}
		name := channelNameMap[r.ChannelId]
		if name == "" {
			name = fmt.Sprintf("渠道%d", r.ChannelId)
		}
		result = append(result, ChannelModelSuccessRate{
			ModelName:    r.ModelName,
			ChannelId:    r.ChannelId,
			ChannelName:  name,
			Total:        r.Total,
			SuccessCount: r.SuccessCount,
			SuccessRate:  rate,
		})
	}
	return result, nil
}
