package apimart

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
)

const (
	assetSubmitPath  = "/v1/seedance2/private-avatar"
	assetPollTimeout = 3 * time.Minute
	assetPollInterval = 4 * time.Second
)

// seedanceAssetModels are the doubao-seedance models that require http/https
// URLs to be pre-converted to asset:// references before video generation.
// Face models (-face suffix) accept direct URLs and must NOT go through the
// private-avatar asset endpoint — doing so causes [12002] url格式不正确.
var seedanceAssetModels = map[string]bool{
	"doubao-seedance-2.0":      true,
	"doubao-seedance-2.0-fast": true,
}

func requiresAssetConversion(model string) bool {
	return seedanceAssetModels[model]
}

func isAssetURL(u string) bool {
	return strings.HasPrefix(u, "asset://")
}

// ---- wire types for the private-avatar endpoint ----

type assetSubmitReq struct {
	AssetType string      `json:"asset_type"`
	Assets    []assetItem `json:"assets"`
}

type assetItem struct {
	URL  string `json:"url"`
	Name string `json:"name"`
}

type assetSubmitResp struct {
	Code int    `json:"code"`
	Msg  string `json:"msg,omitempty"`
	Data *struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"data,omitempty"`
}

type assetEntry struct {
	AssetID  string `json:"asset_id"`
	AssetURL string `json:"asset_url"`
	Status   string `json:"status"`
}

type assetPollResp struct {
	Code int    `json:"code"`
	Msg  string `json:"msg,omitempty"`
	Data *struct {
		Status string `json:"status"`
		Result *struct {
			UsableAssets []assetEntry `json:"usable_assets"`
			FailedAssets []assetEntry `json:"failed_assets"`
		} `json:"result,omitempty"`
	} `json:"data,omitempty"`
}

// convertToAssetURL converts one http/https URL to an asset:// URL by calling
// POST /v1/seedance2/private-avatar and polling until the asset is ready.
// Already asset:// URLs are returned unchanged.
func convertToAssetURL(baseURL, apiKey, rawURL, assetType string) (string, error) {
	if isAssetURL(rawURL) {
		return rawURL, nil
	}

	client, err := service.GetHttpClientWithProxy("")
	if err != nil {
		return "", fmt.Errorf("apimart asset: get http client: %w", err)
	}

	// 1. Submit asset
	body, err := common.Marshal(assetSubmitReq{
		AssetType: assetType,
		Assets:    []assetItem{{URL: rawURL, Name: "ref"}},
	})
	if err != nil {
		return "", fmt.Errorf("apimart asset: marshal submit: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, baseURL+assetSubmitPath, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("apimart asset: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("apimart asset: submit request: %w", err)
	}
	respBody, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()

	var sResp assetSubmitResp
	if err := common.Unmarshal(respBody, &sResp); err != nil {
		return "", fmt.Errorf("apimart asset: parse submit response: %w (body: %s)", err, respBody)
	}
	if sResp.Code != 200 || sResp.Data == nil || sResp.Data.ID == "" {
		return "", fmt.Errorf("apimart asset: submit failed code=%d msg=%s", sResp.Code, sResp.Msg)
	}
	taskID := sResp.Data.ID

	// 2. Poll until completed or timed out
	deadline := time.Now().Add(assetPollTimeout)
	for time.Now().Before(deadline) {
		time.Sleep(assetPollInterval)

		pollReq, err := http.NewRequest(http.MethodGet, baseURL+PollPath(taskID), nil)
		if err != nil {
			continue
		}
		pollReq.Header.Set("Authorization", "Bearer "+apiKey)

		pollResp, err := client.Do(pollReq)
		if err != nil {
			continue
		}
		pollBody, _ := io.ReadAll(pollResp.Body)
		_ = pollResp.Body.Close()

		var pResp assetPollResp
		if err := common.Unmarshal(pollBody, &pResp); err != nil {
			continue
		}
		if pResp.Data == nil {
			continue
		}

		switch pResp.Data.Status {
		case StatusCompleted, StatusFailed:
			// Both statuses may carry usable_assets — check first.
			if pResp.Data.Result != nil {
				for _, a := range pResp.Data.Result.UsableAssets {
					if a.AssetURL != "" {
						return a.AssetURL, nil
					}
				}
				if len(pResp.Data.Result.FailedAssets) > 0 {
					return "", fmt.Errorf("apimart asset: task %s rejected url %s (asset_id=%s)",
						taskID, rawURL, pResp.Data.Result.FailedAssets[0].AssetID)
				}
			}
			return "", fmt.Errorf("apimart asset: task %s status=%s no usable_assets for %s",
				taskID, pResp.Data.Status, rawURL)
		case StatusCancelled:
			return "", fmt.Errorf("apimart asset: task %s cancelled for %s", taskID, rawURL)
		}
		// still pending / processing — keep polling
	}

	return "", fmt.Errorf("apimart asset: timed out after %s for url %s (task %s)", assetPollTimeout, rawURL, taskID)
}

// resolvePayloadAssets converts all http/https URLs inside payload.ImageUrls
// to asset:// references in-place. VideoList entries are passed through as-is.
func resolvePayloadAssets(payload *SubmitPayload, baseURL, apiKey string) error {
	for i, u := range payload.ImageUrls {
		if isAssetURL(u) {
			continue
		}
		assetURL, err := convertToAssetURL(baseURL, apiKey, u, "Image")
		if err != nil {
			return fmt.Errorf("image_urls[%d]: %w", i, err)
		}
		payload.ImageUrls[i] = assetURL
	}
	return nil
}
