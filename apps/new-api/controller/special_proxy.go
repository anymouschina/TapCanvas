package controller

import (
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// ProxyMinimaxMusic forwards POST /v1/music_generation to the `minimax-music`
// channel (api.minimaxi.com). MiniMax music has no OpenAI-compatible relay
// shape, so it is passed through verbatim with the channel's Bearer key.
func ProxyMinimaxMusic(c *gin.Context) {
	ch, err := getChannelByName("minimax-music")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no minimax-music channel: " + err.Error()})
		return
	}
	proxySpecialRequest(c, ch, ch.GetBaseURL()+"/v1/music_generation")
}

// ProxyMinimaxSpeech forwards /minimaxi/v1/* to the `kapon-speech` channel
// (models.kapon.cloud/minimaxi). Path kept as-is for MiniMax speech SDK
// compatibility — covers native t2a_v2 / t2a_async_v2 / query endpoints that
// the OpenAI-compatible relay does not expose. Falls back to a channel named
// `minimax-official` (api.minimaxi.com) when kapon is absent.
func ProxyMinimaxSpeech(c *gin.Context) {
	ch, err := getChannelByName("kapon-speech")
	if err != nil {
		ch, err = getChannelByName("minimax-official")
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no minimax speech channel: " + err.Error()})
		return
	}
	subpath := c.Param("path")
	upstream := ch.GetBaseURL() + "/v1" + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}
	proxySpecialRequest(c, ch, upstream)
}

// ProxyRemoveBg forwards /proxy/remove-bg/*path to the `remove-bg` channel
// (api.remove.bg). remove.bg uses X-Api-Key auth + multipart/form-data and
// returns a binary PNG, so it has no OpenAI-compatible relay shape and must be
// passed through verbatim. Falls back to env REMOVE_BG_API_KEY / REMOVE_BG_BASE_URL
// when no `remove-bg` channel is configured.
func ProxyRemoveBg(c *gin.Context) {
	subpath := c.Param("path")
	if subpath == "" {
		subpath = "/v1.0/removebg"
	}

	var baseURL, apiKey, proxyURL string
	ch, err := getChannelByName("remove-bg")
	if err == nil && ch != nil && ch.Key != "" {
		baseURL = strings.TrimRight(ch.GetBaseURL(), "/")
		apiKey = ch.Key
		proxyURL = ch.GetSetting().Proxy
	} else {
		baseURL = strings.TrimRight(os.Getenv("REMOVE_BG_BASE_URL"), "/")
		apiKey = os.Getenv("REMOVE_BG_API_KEY")
	}
	if baseURL == "" {
		baseURL = "https://api.remove.bg"
	}
	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "remove-bg not configured: add a 'remove-bg' channel or set REMOVE_BG_API_KEY"})
		return
	}

	upstream := baseURL + subpath
	if q := c.Request.URL.RawQuery; q != "" {
		upstream += "?" + q
	}
	proxyRemoveBgRequest(c, apiKey, proxyURL, upstream)
}

// proxyRemoveBgRequest forwards the multipart request using remove.bg's
// X-Api-Key auth, preserving the incoming Content-Type, and streams the binary
// image response back unmodified.
func proxyRemoveBgRequest(c *gin.Context, apiKey, proxyURL, upstreamURL string) {
	req, err := http.NewRequest(c.Request.Method, upstreamURL, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Preserve Content-Length so the multipart body is sent with a fixed length
	// instead of chunked transfer-encoding (remove.bg rejects chunked uploads).
	req.ContentLength = c.Request.ContentLength
	req.Header.Set("X-Api-Key", apiKey)
	if ct := c.Request.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}

	httpClient, err := service.GetHttpClientWithProxy(proxyURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/png"
	}
	c.Status(resp.StatusCode)
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, resp.Body)
}

// getChannelByName returns the first active channel with the given name.
func getChannelByName(name string) (*model.Channel, error) {
	var ch model.Channel
	err := model.DB.
		Where("name = ? AND status = 1", name).
		First(&ch).Error
	return &ch, err
}

// proxySpecialRequest forwards the request using Bearer auth and JSON content type.
func proxySpecialRequest(c *gin.Context, ch *model.Channel, upstreamURL string) {
	req, err := http.NewRequest(c.Request.Method, upstreamURL, c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Authorization", "Bearer "+ch.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	httpClient, err := service.GetHttpClientWithProxy(ch.GetSetting().Proxy)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	c.Status(resp.StatusCode)
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, resp.Body)
}
