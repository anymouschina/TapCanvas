package controller

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
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

// ProxyRemoveBg serves /proxy/remove-bg/*path. Callers keep sending the
// remove.bg request (multipart or JSON with image_file / image_file_b64 /
// image_url plus options) and still get the cutout image bytes back.
//
// remove.bg's API moved to Leonardo.Ai on December 1, 2026, so the request is
// translated to Leonardo's sync remove-bg endpoint, following
// https://docs.leonardo.ai/docs/migrate-from-the-removebg-api-to-leonardoai
// remove.bg keys don't work there: the key comes from the `leonardo-remove-bg`
// channel, or env LEONARDO_API_KEY / LEONARDO_BASE_URL when no such channel is
// configured.
func ProxyRemoveBg(c *gin.Context) {
	if subpath := strings.TrimRight(c.Param("path"), "/"); subpath != "" && subpath != "/v1.0/removebg" {
		c.JSON(http.StatusNotFound, gin.H{"error": "only /v1.0/removebg is available: remove.bg's API moved to Leonardo.Ai"})
		return
	}

	var baseURL, apiKey, proxyURL string
	ch, err := getChannelByName("leonardo-remove-bg")
	if err == nil && ch != nil && ch.Key != "" {
		// Only an explicit base URL: GetBaseURL would fall back to the channel type's default host.
		if ch.BaseURL != nil {
			baseURL = strings.TrimRight(*ch.BaseURL, "/")
		}
		apiKey = ch.Key
		proxyURL = ch.GetSetting().Proxy
	} else {
		baseURL = strings.TrimRight(os.Getenv("LEONARDO_BASE_URL"), "/")
		apiKey = os.Getenv("LEONARDO_API_KEY")
	}
	if baseURL == "" {
		baseURL = "https://cloud.leonardo.ai"
	}
	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "remove-bg not configured: remove.bg's API moved to Leonardo.Ai, add a 'leonardo-remove-bg' channel or set LEONARDO_API_KEY (remove.bg keys don't work there)"})
		return
	}
	proxyLeonardoRemoveBg(c, apiKey, proxyURL, baseURL+"/api/rest/v2/generationssync")
}

// remove.bg options Leonardo accepts under `parameters` with the same names and
// values. Leonardo rejects unknown parameters, so nothing else is forwarded.
var (
	leonardoRemoveBgStringParams = []string{"size", "type", "type_level", "format", "roi", "crop_margin", "scale", "position", "channels", "bg_color", "shadow_type"}
	leonardoRemoveBgBoolParams   = []string{"crop", "semitransparency"}
)

// buildLeonardoRemoveBgBody turns a remove.bg request into Leonardo's JSON body.
func buildLeonardoRemoveBgBody(c *gin.Context) ([]byte, error) {
	fields := map[string]any{}
	if strings.HasPrefix(c.ContentType(), "application/json") {
		if err := common.DecodeJson(c.Request.Body, &fields); err != nil {
			return nil, fmt.Errorf("invalid JSON body: %w", err)
		}
	} else {
		if err := c.Request.ParseMultipartForm(32 << 20); err != nil && !errors.Is(err, http.ErrNotMultipart) {
			return nil, fmt.Errorf("invalid form body: %w", err)
		}
		for key, values := range c.Request.Form {
			if len(values) > 0 {
				fields[key] = values[0]
			}
		}
	}
	field := func(key string) string {
		if v, ok := fields[key]; ok && v != nil {
			return strings.TrimSpace(fmt.Sprint(v))
		}
		return ""
	}

	var image map[string]any
	if file, _, err := c.Request.FormFile("image_file"); err == nil {
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil {
			return nil, fmt.Errorf("reading image_file: %w", err)
		}
		image = map[string]any{"type": "BASE64", "data": base64.StdEncoding.EncodeToString(data)}
	} else if b64 := field("image_file_b64"); b64 != "" {
		image = map[string]any{"type": "BASE64", "data": b64}
	} else if url := field("image_url"); url != "" {
		image = map[string]any{"type": "URL", "url": url}
	} else {
		return nil, errors.New("one of image_file, image_file_b64 or image_url is required")
	}

	params := map[string]any{}
	for _, key := range leonardoRemoveBgStringParams {
		if v := field(key); v != "" {
			params[key] = v
		}
	}
	for _, key := range leonardoRemoveBgBoolParams {
		if v := field(key); v != "" {
			b, err := strconv.ParseBool(v)
			if err != nil {
				return nil, fmt.Errorf("%s must be true or false", key)
			}
			params[key] = b
		}
	}
	if v := field("shadow_opacity"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, errors.New("shadow_opacity must be an integer")
		}
		params["shadow_opacity"] = n
	}
	switch params["format"] {
	case "auto":
		delete(params, "format") // Leonardo has no auto format, PNG is its default
	case "zip":
		return nil, errors.New("format=zip is not supported by Leonardo.Ai, use png or webp")
	}
	guidances := map[string]any{"image_reference": []any{map[string]any{"image": image}}}
	if bg := field("bg_image_url"); bg != "" {
		guidances["background_image_reference"] = []any{map[string]any{"image": map[string]any{"type": "URL", "url": bg}}}
	}
	params["guidances"] = guidances

	return common.Marshal(map[string]any{
		"model": "remove-bg",
		// Like remove.bg, keep nothing in the Leonardo library.
		"ephemeral":  true,
		"parameters": params,
	})
}

// proxyLeonardoRemoveBg calls Leonardo's sync endpoint, downloads results[0].url
// and writes the image bytes back, so callers see the same response as before.
// Leonardo answers with JSON and often reports errors as HTTP 200 with errors[],
// which are turned into a non-2xx JSON error here.
func proxyLeonardoRemoveBg(c *gin.Context, apiKey, proxyURL, syncURL string) {
	body, err := buildLeonardoRemoveBgBody(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req, err := http.NewRequest(http.MethodPost, syncURL, bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

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

	var result struct {
		Results []struct {
			URL         string `json:"url"`
			ContentType string `json:"contentType"`
		} `json:"results"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
		Error string `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = common.Unmarshal(raw, &result)
	if len(result.Results) == 0 || result.Results[0].URL == "" {
		status := resp.StatusCode
		if status < http.StatusBadRequest {
			status = http.StatusBadGateway
		}
		message := fmt.Sprintf("Leonardo.Ai returned no image (HTTP %d)", resp.StatusCode)
		if len(result.Errors) > 0 && result.Errors[0].Message != "" {
			message = result.Errors[0].Message
		} else if result.Error != "" {
			message = result.Error
		}
		c.JSON(status, gin.H{"error": message})
		return
	}

	imageResp, err := httpClient.Get(result.Results[0].URL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer imageResp.Body.Close()
	if imageResp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("downloading the Leonardo.Ai result failed: HTTP %d", imageResp.StatusCode)})
		return
	}

	contentType := result.Results[0].ContentType
	if contentType == "" {
		contentType = "image/png"
	}
	c.Header("Content-Type", contentType)
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, imageResp.Body)
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
