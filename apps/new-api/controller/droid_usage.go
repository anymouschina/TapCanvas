package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetDroidChannelUsage(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid channel id"})
		return
	}
	result, err := service.RefreshDroidChannelUsage(c.Request.Context(), channelID)
	message := ""
	if err != nil {
		message = err.Error()
	}
	c.JSON(http.StatusOK, gin.H{"success": err == nil, "message": message, "data": result})
}
