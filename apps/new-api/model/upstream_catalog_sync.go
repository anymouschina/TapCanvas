package model

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

type upstreamCatalogEnvelope struct {
	Success bool    `json:"success"`
	Message string  `json:"message"`
	Data    []Model `json:"data"`
}
type upstreamPriceEnvelope struct {
	Success bool      `json:"success"`
	Message string    `json:"message"`
	Version string    `json:"pricing_version"`
	Data    []Pricing `json:"data"`
}
type upstreamCatalogPlan struct {
	Models  []Model
	Prices  map[string]Pricing
	Version string
}

func fetchUpstreamCatalogDocument(ctx context.Context, client *http.Client, endpoint string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("catalog GET %s returned %d", endpoint, response.StatusCode)
	}
	const limit = 16 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if len(body) > limit {
		return nil, fmt.Errorf("catalog document exceeds %d bytes", limit)
	}
	return body, nil
}

func loadUpstreamCatalog(ctx context.Context, client *http.Client, base string) (upstreamCatalogPlan, error) {
	result := upstreamCatalogPlan{Prices: make(map[string]Pricing)}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return result, fmt.Errorf("invalid upstream catalog URL")
	}
	body, err := fetchUpstreamCatalogDocument(ctx, client, strings.TrimRight(base, "/")+"/api/models/list?enabled=true")
	if err != nil {
		return result, err
	}
	var catalog upstreamCatalogEnvelope
	if err = common.Unmarshal(body, &catalog); err != nil {
		return result, err
	}
	if !catalog.Success || len(catalog.Data) == 0 {
		return result, fmt.Errorf("upstream model catalog is empty or unsuccessful: %s", catalog.Message)
	}
	body, err = fetchUpstreamCatalogDocument(ctx, client, strings.TrimRight(base, "/")+"/api/pricing")
	if err != nil {
		return result, err
	}
	var prices upstreamPriceEnvelope
	if err = common.Unmarshal(body, &prices); err != nil {
		return result, err
	}
	if !prices.Success || len(prices.Data) == 0 || prices.Version == "" {
		return result, fmt.Errorf("upstream pricing is empty, unversioned or unsuccessful: %s", prices.Message)
	}
	var priceFields struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	if err := common.Unmarshal(body, &priceFields); err != nil {
		return result, err
	}
	for index, price := range prices.Data {
		required := []string{"quota_type"}
		if price.QuotaType == 1 {
			required = append(required, "model_price")
		} else {
			required = append(required, "model_ratio", "completion_ratio")
		}
		for _, field := range required {
			raw := strings.TrimSpace(string(priceFields.Data[index][field]))
			if raw == "" || raw == "null" {
				return result, fmt.Errorf("upstream model %s is missing %s", price.ModelName, field)
			}
		}
		if strings.TrimSpace(price.ModelName) == "" {
			return result, fmt.Errorf("upstream price has empty model name")
		}
		if _, exists := result.Prices[price.ModelName]; exists {
			return result, fmt.Errorf("duplicate upstream price for %s", price.ModelName)
		}
		result.Prices[price.ModelName] = price
	}
	seen := make(map[string]bool)
	for _, entry := range catalog.Data {
		if entry.Status != 1 {
			continue
		}
		if strings.TrimSpace(entry.ModelName) == "" || entry.Kind == "" || seen[entry.ModelName] {
			return result, fmt.Errorf("invalid or duplicate catalog model %q", entry.ModelName)
		}
		seen[entry.ModelName] = true
		price, ok := result.Prices[entry.ModelName]
		if !ok || len(price.SupportedEndpointTypes) == 0 {
			return result, fmt.Errorf("model %s has no executable upstream price", entry.ModelName)
		}
		if price.QuotaType != 0 && price.QuotaType != 1 {
			return result, fmt.Errorf("unsupported quota type for %s", entry.ModelName)
		}
		if entry.ParamsDef != "" {
			var params []json.RawMessage
			if err := common.Unmarshal([]byte(entry.ParamsDef), &params); err != nil {
				return result, fmt.Errorf("invalid params for %s: %w", entry.ModelName, err)
			}
		}
		if _, err := ParseModelPricingConfig(entry.PricingConfig); err != nil {
			return result, fmt.Errorf("model %s: %w", entry.ModelName, err)
		}
		result.Models = append(result.Models, entry)
	}
	if len(result.Models) == 0 {
		return result, fmt.Errorf("upstream has no enabled catalog models")
	}
	result.Version = prices.Version
	return result, nil
}

// SyncConfiguredUpstreamCatalog runs only during normal startup, after seed patches.
// One configured commercial channel owns the imported catalog. No credentials,
// upstream database IDs, usage, balances, or generated assets are copied.
func SyncConfiguredUpstreamCatalog(ctx context.Context) error {
	raw := strings.TrimSpace(os.Getenv("UPSTREAM_CATALOG_CHANNEL_ID"))
	if raw == "" {
		var channels []Channel
		if err := DB.Where("name = ? OR tag = ?", "lluban-recommended", "lluban").Find(&channels).Error; err != nil {
			return err
		}
		if len(channels) == 0 {
			return nil
		}
		if len(channels) != 1 {
			return fmt.Errorf("multiple lluban channels: configure UPSTREAM_CATALOG_CHANNEL_ID explicitly")
		}
		raw = strconv.Itoa(channels[0].Id)
	}
	id, err := strconv.Atoi(raw)
	if err != nil || id <= 0 {
		return fmt.Errorf("UPSTREAM_CATALOG_CHANNEL_ID must be a positive integer")
	}
	var channel Channel
	if err = DB.First(&channel, id).Error; err != nil {
		return err
	}
	if channel.BaseURL == nil || channel.Status != common.ChannelStatusEnabled {
		return fmt.Errorf("catalog channel %d must be enabled with a base URL", id)
	}
	plan, err := loadUpstreamCatalog(ctx, &http.Client{Timeout: 30 * time.Second}, *channel.BaseURL)
	if err != nil {
		return fmt.Errorf("upstream catalog channel %d: %w", id, err)
	}
	if err = applyUpstreamCatalog(DB, channel, plan); err != nil {
		return err
	}
	InitOptionMap()
	common.SysLog(fmt.Sprintf("upstream catalog synchronized: channel=%d models=%d pricing_version=%s", id, len(plan.Models), plan.Version))
	return nil
}

// Endpoint precedence is deterministic even when upstream changes array order.
func upstreamCatalogProtocol(endpoints []constant.EndpointType) (string, error) {
	available := make(map[string]bool)
	for _, endpoint := range endpoints {
		available[string(endpoint)] = true
	}
	for _, candidate := range []struct{ endpoint, protocol string }{
		{"openai-video", constant.ProtocolTaskSora},
		{"image-generation", constant.ProtocolOpenAI},
		{"openai", constant.ProtocolOpenAI},
		{"openai-response", constant.ProtocolOpenAI},
		{"anthropic", constant.ProtocolAnthropic},
		{"gemini", constant.ProtocolGemini},
	} {
		if available[candidate.endpoint] {
			return candidate.protocol, nil
		}
	}
	return "", fmt.Errorf("no supported upstream wire protocol")
}
