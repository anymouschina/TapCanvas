package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	vertexchannel "github.com/QuantumNous/new-api/relay/channel/vertex"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

type vertexCredentialImportRequest struct {
	Credential  string   `json:"credential"`
	Credentials []string `json:"credentials"`
}

func normalizeVertexCredentialRequest(request vertexCredentialImportRequest) ([]string, error) {
	credentials := make([]string, 0, len(request.Credentials)+1)
	if strings.TrimSpace(request.Credential) != "" {
		credentials = append(credentials, request.Credential)
	}
	for _, credential := range request.Credentials {
		if strings.TrimSpace(credential) != "" {
			credentials = append(credentials, credential)
		}
	}
	if len(credentials) == 0 {
		return nil, errors.New("必须提供 Vertex AI API Key 或服务账号 JSON")
	}
	return credentials, nil
}

func AddVertexChannelCredentials(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, fmt.Errorf("invalid channel id: %w", err))
		return
	}
	request := vertexCredentialImportRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	credentials, err := normalizeVertexCredentialRequest(request)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	result, err := service.ImportVertexChannelCredentials(channelID, credentials)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	vertexchannel.ResetAccessTokenCache(channelID)
	service.ResetProxyClientCache()
	if !refreshChannelCacheAfterWrite(c, "Vertex AI 渠道账号已导入") {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"account_count":  result.AccountCount,
			"added_count":    result.AddedCount,
			"replaced_count": result.ReplacedCount,
		},
	})
}
