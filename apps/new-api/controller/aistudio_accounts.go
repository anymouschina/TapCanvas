package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type importAIStudioAccountRequest struct {
	Name         string          `json:"name"`
	Proxy        string          `json:"proxy"`
	Note         string          `json:"note"`
	StorageState json.RawMessage `json:"storage_state"`
	DryRun       bool            `json:"dry_run,omitempty"`
}

type onboardAIStudioAccountRequest struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	Password      string `json:"password"`
	RecoveryEmail string `json:"recovery_email"`
	TOTPSecret    string `json:"totp_secret"`
	Proxy         string `json:"proxy"`
	Note          string `json:"note"`
}

func GetAIStudioAccounts(c *gin.Context) {
	channel, settings, err := getAIStudioChannelSettings(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	accounts, err := service.ListAIStudioImporterAccounts(c.Request.Context(), settings)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
		return
	}
	redacted := service.RedactAIStudioImporterAccounts(accounts)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"channel_id":   channel.Id,
			"channel_name": channel.Name,
			"accounts":     redacted.Accounts,
			"proxy_pool":   redacted.ProxyPool,
			"balancing": gin.H{
				"runtime":        "aistudio-to-api",
				"strategy":       "runtime_round_robin",
				"one_account_ip": true,
			},
		},
	})
}

func ImportAIStudioAccount(c *gin.Context) {
	channel, settings, err := getAIStudioChannelSettings(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2*1024*1024+64*1024)
	var request importAIStudioAccountRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": fmt.Sprintf("导入请求格式错误: %v", err)})
		return
	}
	result, err := service.ImportAIStudioAccount(c.Request.Context(), settings, service.AIStudioAccountImport{
		Name:         request.Name,
		Proxy:        request.Proxy,
		Note:         request.Note,
		StorageState: request.StorageState,
		DryRun:       request.DryRun,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	model.RecordLog(
		c.GetInt("id"),
		model.LogTypeSystem,
		fmt.Sprintf("导入 AI Studio 账号 (渠道ID: %d, 文件: %s, 账号: %s, dry_run: %t)", channel.Id, result.File, result.Name, result.DryRun),
	)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "AI Studio 账号导入成功",
		"data":    result,
	})
}

func OnboardAIStudioAccount(c *gin.Context) {
	channel, settings, err := getAIStudioChannelSettings(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	var request onboardAIStudioAccountRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": fmt.Sprintf("自动登录请求格式错误: %v", err)})
		return
	}
	result, err := service.OnboardAIStudioAccount(c.Request.Context(), settings, service.AIStudioAccountOnboarding{
		Name:          request.Name,
		Email:         request.Email,
		Password:      request.Password,
		RecoveryEmail: request.RecoveryEmail,
		TOTPSecret:    request.TOTPSecret,
		Proxy:         request.Proxy,
		Note:          request.Note,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}

	model.RecordLog(
		c.GetInt("id"),
		model.LogTypeSystem,
		fmt.Sprintf("自动登录并导入 AI Studio 账号 (渠道ID: %d, 文件: %s, 账号: %s)", channel.Id, result.File, result.Name),
	)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "AI Studio 账号已登录并导入，等待 Runtime 验证 Session",
		"data":    result,
	})
}

func getAIStudioChannelSettings(c *gin.Context) (*model.Channel, dto.ChannelSettings, error) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelID <= 0 {
		return nil, dto.ChannelSettings{}, errorsForAIStudioChannel("渠道 ID 无效")
	}
	channel, err := model.GetChannelById(channelID, false)
	if err != nil {
		return nil, dto.ChannelSettings{}, fmt.Errorf("读取渠道失败: %w", err)
	}
	if channel == nil {
		return nil, dto.ChannelSettings{}, errorsForAIStudioChannel("渠道不存在")
	}
	if channel.Type != constant.ChannelTypeAIStudioToAPI {
		return nil, dto.ChannelSettings{}, errorsForAIStudioChannel("该渠道不是 AI Studio To API 类型")
	}
	settings := channel.GetSetting()
	if err := settings.ValidateAIStudioImporter(); err != nil {
		return nil, dto.ChannelSettings{}, fmt.Errorf("AI Studio Importer 配置无效: %w", err)
	}
	return channel, settings, nil
}

func errorsForAIStudioChannel(message string) error {
	return fmt.Errorf("AI Studio 账号池不可用: %s", message)
}
