package model

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

func TestRefreshPricingSurfacesInvalidPersistedPricingConfig(t *testing.T) {
	if err := DB.AutoMigrate(&Ability{}, &Model{}, &Vendor{}); err != nil {
		t.Fatalf("failed to migrate pricing cache dependencies: %v", err)
	}

	meta := Model{
		ModelName:     "invalid-pricing-cache-refresh-test",
		Status:        1,
		PricingConfig: "{",
	}
	if err := DB.Create(&meta).Error; err != nil {
		t.Fatalf("failed to create invalid pricing fixture: %v", err)
	}
	t.Cleanup(func() {
		if err := DB.Unscoped().Delete(&Model{}, meta.Id).Error; err != nil {
			t.Errorf("failed to delete invalid pricing fixture: %v", err)
		}
	})

	err := RefreshPricing()
	if err == nil {
		t.Fatal("expected invalid persisted pricing config to fail cache refresh")
	}
	if !strings.Contains(err.Error(), meta.ModelName) {
		t.Fatalf("refresh error %q does not identify model %q", err, meta.ModelName)
	}
	if !strings.Contains(err.Error(), "定价配置无效") {
		t.Fatalf("refresh error %q does not explain invalid pricing config", err)
	}
}

func TestRefreshPricingSkipsInvalidCompatibilityDataWithoutBlocking(t *testing.T) {
	if err := DB.AutoMigrate(&Ability{}, &Channel{}, &Model{}, &Vendor{}); err != nil {
		t.Fatalf("failed to migrate pricing cache dependencies: %v", err)
	}

	modelName := "pricing-refresh-atomicity-test"
	channelSetting := `{"default_protocol":{"protocol":"openai"}}`
	channel := Channel{
		Name:    "pricing refresh atomicity test",
		Key:     "test-key",
		Status:  1,
		Models:  modelName,
		Group:   "default",
		Setting: &channelSetting,
	}
	if err := DB.Create(&channel).Error; err != nil {
		t.Fatalf("failed to create channel fixture: %v", err)
	}
	secondChannel := Channel{
		Name:    "pricing refresh atomicity second channel test",
		Key:     "test-key",
		Status:  common.ChannelStatusEnabled,
		Models:  modelName,
		Group:   "default",
		Setting: &channelSetting,
	}
	if err := DB.Create(&secondChannel).Error; err != nil {
		t.Fatalf("failed to create second channel fixture: %v", err)
	}
	meta := Model{
		ModelName: modelName,
		Status:    1,
		Endpoints: `{"openai":{"path":null}}`,
	}
	if err := DB.Create(&meta).Error; err != nil {
		t.Fatalf("failed to create model fixture: %v", err)
	}
	ability := Ability{
		Group:     "default",
		Model:     modelName,
		ChannelId: channel.Id,
		Enabled:   true,
	}
	if err := DB.Create(&ability).Error; err != nil {
		t.Fatalf("failed to create ability fixture: %v", err)
	}
	secondAbility := Ability{
		Group:     "default",
		Model:     modelName,
		ChannelId: secondChannel.Id,
		Enabled:   true,
	}
	if err := DB.Create(&secondAbility).Error; err != nil {
		t.Fatalf("failed to create second ability fixture: %v", err)
	}
	t.Cleanup(func() {
		if err := DB.Where("channel_id IN ? AND model = ?", []int{channel.Id, secondChannel.Id}, modelName).Delete(&Ability{}).Error; err != nil {
			t.Errorf("failed to delete ability fixture: %v", err)
		}
		if err := DB.Unscoped().Delete(&Model{}, meta.Id).Error; err != nil {
			t.Errorf("failed to delete model fixture: %v", err)
		}
		if err := DB.Delete(&Channel{}, []int{channel.Id, secondChannel.Id}).Error; err != nil {
			t.Errorf("failed to delete channel fixture: %v", err)
		}
	})

	sentinelPricing := []Pricing{{
		ModelName:              "sentinel-model",
		EnableGroup:            []string{"sentinel"},
		SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI},
	}}
	sentinelVendors := []PricingVendor{{ID: 777, Name: "sentinel-vendor"}}
	sentinelEndpoints := map[string]common.EndpointInfo{
		"openai": {Path: "/sentinel", Method: "POST"},
	}
	sentinelSupportTypes := map[string][]constant.EndpointType{
		"sentinel-model": {constant.EndpointTypeOpenAI},
	}
	sentinelConfiguredPricing := map[string]ModelPricingConfig{
		"sentinel-model": DisabledModelPricingConfig(),
	}
	sentinelEnableGroups := map[string][]string{"sentinel-model": {"sentinel"}}
	sentinelQuotaTypes := map[string]int{"sentinel-model": 1}
	sentinelKinds := map[string]string{"sentinel-model": "chat"}
	sentinelRefreshTime := time.Now()

	updatePricingLock.Lock()
	modelSupportEndpointsLock.Lock()
	configuredPricingLock.Lock()
	modelEnableGroupsLock.Lock()
	previousPricing := pricingMap
	previousVendors := vendorsList
	previousEndpoints := supportedEndpointMap
	previousSupportTypes := modelSupportEndpointTypes
	previousConfiguredPricing := configuredPricingByModel
	previousEnableGroups := modelEnableGroups
	previousQuotaTypes := modelQuotaTypeMap
	previousKinds := modelKindMap
	previousRefreshTime := lastGetPricingTime
	pricingMap = sentinelPricing
	vendorsList = sentinelVendors
	supportedEndpointMap = sentinelEndpoints
	modelSupportEndpointTypes = sentinelSupportTypes
	configuredPricingByModel = sentinelConfiguredPricing
	modelEnableGroups = sentinelEnableGroups
	modelQuotaTypeMap = sentinelQuotaTypes
	modelKindMap = sentinelKinds
	lastGetPricingTime = sentinelRefreshTime
	modelEnableGroupsLock.Unlock()
	configuredPricingLock.Unlock()
	modelSupportEndpointsLock.Unlock()
	updatePricingLock.Unlock()

	defer func() {
		updatePricingLock.Lock()
		modelSupportEndpointsLock.Lock()
		configuredPricingLock.Lock()
		modelEnableGroupsLock.Lock()
		pricingMap = previousPricing
		vendorsList = previousVendors
		supportedEndpointMap = previousEndpoints
		modelSupportEndpointTypes = previousSupportTypes
		configuredPricingByModel = previousConfiguredPricing
		modelEnableGroups = previousEnableGroups
		modelQuotaTypeMap = previousQuotaTypes
		modelKindMap = previousKinds
		lastGetPricingTime = previousRefreshTime
		modelEnableGroupsLock.Unlock()
		configuredPricingLock.Unlock()
		modelSupportEndpointsLock.Unlock()
		updatePricingLock.Unlock()
	}()

	if err := RefreshPricing(); err != nil {
		t.Fatalf("invalid compatibility endpoint override must not block cache refresh: %v", err)
	}

	modelSupportEndpointsLock.RLock()
	publishedEndpointTypes := cloneEndpointTypes(modelSupportEndpointTypes[modelName])
	publishedEndpoint := supportedEndpointMap[string(constant.EndpointTypeOpenAI)]
	modelSupportEndpointsLock.RUnlock()
	hasOpenAIEndpoint := false
	for _, endpointType := range publishedEndpointTypes {
		if endpointType == constant.EndpointTypeOpenAI {
			hasOpenAIEndpoint = true
			break
		}
	}
	if !hasOpenAIEndpoint {
		t.Fatalf("published endpoint types = %v, want %q", publishedEndpointTypes, constant.EndpointTypeOpenAI)
	}
	if publishedEndpoint.Path != "/v1/chat/completions" || publishedEndpoint.Method != "POST" {
		t.Fatalf("invalid override leaked into published endpoint catalog: %#v", publishedEndpoint)
	}

	if err := DB.Model(&Model{}).Where("id = ?", meta.Id).Update("endpoints", "").Error; err != nil {
		t.Fatalf("failed to clear model endpoint override: %v", err)
	}
	missingProtocolSetting := `{}`
	if err := DB.Model(&Channel{}).Where("id = ?", channel.Id).Update("setting", missingProtocolSetting).Error; err != nil {
		t.Fatalf("failed to remove channel protocol fixture: %v", err)
	}
	if err := RefreshPricing(); err != nil {
		t.Fatalf("one invalid active channel protocol must not block cache refresh: %v", err)
	}
	modelSupportEndpointsLock.RLock()
	publishedEndpointTypes = cloneEndpointTypes(modelSupportEndpointTypes[modelName])
	publishedEndpoint = supportedEndpointMap[string(constant.EndpointTypeOpenAI)]
	modelSupportEndpointsLock.RUnlock()
	hasOpenAIEndpoint = false
	for _, endpointType := range publishedEndpointTypes {
		if endpointType == constant.EndpointTypeOpenAI {
			hasOpenAIEndpoint = true
			break
		}
	}
	if !hasOpenAIEndpoint {
		t.Fatalf("valid channel endpoint was lost after compatibility warning: %v", publishedEndpointTypes)
	}
	if strings.TrimSpace(publishedEndpoint.Path) == "" || strings.TrimSpace(publishedEndpoint.Method) == "" {
		t.Fatalf("published endpoint became incomplete after compatibility warning: %#v", publishedEndpoint)
	}

	if err := DB.Model(&Channel{}).Where("id = ?", channel.Id).Update("setting", channelSetting).Error; err != nil {
		t.Fatalf("failed to restore explicit channel protocol fixture: %v", err)
	}
	if err := RefreshPricing(); err != nil {
		t.Fatalf("model without endpoint override should inherit its channel protocol: %v", err)
	}
	modelSupportEndpointsLock.RLock()
	publishedEndpointTypes = cloneEndpointTypes(modelSupportEndpointTypes[modelName])
	publishedEndpoint = supportedEndpointMap[string(constant.EndpointTypeOpenAI)]
	modelSupportEndpointsLock.RUnlock()
	hasOpenAIEndpoint = false
	for _, endpointType := range publishedEndpointTypes {
		if endpointType == constant.EndpointTypeOpenAI {
			hasOpenAIEndpoint = true
			break
		}
	}
	if !hasOpenAIEndpoint {
		t.Fatalf("published endpoint types = %v, want %q", publishedEndpointTypes, constant.EndpointTypeOpenAI)
	}
	if strings.TrimSpace(publishedEndpoint.Path) == "" || strings.TrimSpace(publishedEndpoint.Method) == "" {
		t.Fatalf("published OpenAI endpoint is incomplete: %#v", publishedEndpoint)
	}
}

func TestResolveAbilityEndpointTypesRequiresExplicitProtocol(t *testing.T) {
	tests := []struct {
		name         string
		setting      string
		wantError    string
		wantEndpoint string
	}{
		{
			name:      "missing channel setting",
			setting:   "",
			wantError: "no explicit protocol setting",
		},
		{
			name:      "invalid channel setting JSON",
			setting:   "{",
			wantError: "invalid setting",
		},
		{
			name:      "missing protocol binding",
			setting:   `{}`,
			wantError: "未配置协议",
		},
		{
			name:      "unknown protocol",
			setting:   `{"default_protocol":{"protocol":"not-registered"}}`,
			wantError: "未注册",
		},
		{
			name:      "invalid protocol option",
			setting:   `{"default_protocol":{"protocol":"openai","options":{"unknown":"value"}}}`,
			wantError: "不属于协议",
		},
		{
			name:         "explicit OpenAI protocol",
			setting:      `{"default_protocol":{"protocol":"openai"}}`,
			wantEndpoint: string(constant.EndpointTypeOpenAI),
		},
		{
			name:         "model protocol overrides default",
			setting:      `{"default_protocol":{"protocol":"openai"},"model_protocols":{"endpoint-contract-test":{"protocol":"anthropic"}}}`,
			wantEndpoint: string(constant.EndpointTypeAnthropic),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			endpointTypes, err := resolveAbilityEndpointTypes(AbilityWithChannel{
				Ability: Ability{
					ChannelId: 41,
					Model:     "endpoint-contract-test",
				},
				ChannelSetting: test.setting,
			})
			if test.wantError != "" {
				if err == nil {
					t.Fatalf("resolveAbilityEndpointTypes() error = nil, want %q", test.wantError)
				}
				if !strings.Contains(err.Error(), test.wantError) {
					t.Fatalf("resolveAbilityEndpointTypes() error = %q, want substring %q", err, test.wantError)
				}
				if !strings.Contains(err.Error(), "channel 41") || !strings.Contains(err.Error(), "endpoint-contract-test") {
					t.Fatalf("resolveAbilityEndpointTypes() error lacks channel/model context: %q", err)
				}
				return
			}

			if err != nil {
				t.Fatalf("resolveAbilityEndpointTypes() error = %v", err)
			}
			if !common.StringsContains(endpointTypes, test.wantEndpoint) {
				t.Fatalf("resolveAbilityEndpointTypes() = %v, want endpoint %q", endpointTypes, test.wantEndpoint)
			}
		})
	}
}

func TestGetAllEnableAbilityWithChannelsOnlyReturnsActiveEnabledPairs(t *testing.T) {
	if err := DB.AutoMigrate(&Ability{}, &Channel{}); err != nil {
		t.Fatalf("failed to migrate ability query dependencies: %v", err)
	}

	setting := `{"default_protocol":{"protocol":"openai"}}`
	activeChannel := Channel{
		Name:    "active ability query test",
		Key:     "test-key",
		Status:  common.ChannelStatusEnabled,
		Models:  "active-query-model,disabled-ability-query-model",
		Group:   "ability-query-test",
		Setting: &setting,
	}
	disabledChannel := Channel{
		Name:    "disabled ability query test",
		Key:     "test-key",
		Status:  common.ChannelStatusManuallyDisabled,
		Models:  "disabled-channel-query-model",
		Group:   "ability-query-test",
		Setting: &setting,
	}
	if err := DB.Create(&activeChannel).Error; err != nil {
		t.Fatalf("failed to create active channel fixture: %v", err)
	}
	if err := DB.Create(&disabledChannel).Error; err != nil {
		t.Fatalf("failed to create disabled channel fixture: %v", err)
	}
	orphanChannelID := disabledChannel.Id + 1_000_000
	fixtures := []Ability{
		{Group: "ability-query-test", Model: "active-query-model", ChannelId: activeChannel.Id, Enabled: true},
		{Group: "ability-query-test", Model: "disabled-ability-query-model", ChannelId: activeChannel.Id, Enabled: false},
		{Group: "ability-query-test", Model: "disabled-channel-query-model", ChannelId: disabledChannel.Id, Enabled: true},
		{Group: "ability-query-test", Model: "orphan-query-model", ChannelId: orphanChannelID, Enabled: true},
	}
	if err := DB.Create(&fixtures).Error; err != nil {
		t.Fatalf("failed to create ability query fixtures: %v", err)
	}
	t.Cleanup(func() {
		if err := DB.Where("`group` = ?", "ability-query-test").Delete(&Ability{}).Error; err != nil {
			t.Errorf("failed to delete ability query fixtures: %v", err)
		}
		if err := DB.Delete(&Channel{}, []int{activeChannel.Id, disabledChannel.Id}).Error; err != nil {
			t.Errorf("failed to delete ability query channel fixtures: %v", err)
		}
	})

	abilities, err := GetAllEnableAbilityWithChannels()
	if err != nil {
		t.Fatalf("GetAllEnableAbilityWithChannels() error = %v", err)
	}
	found := make(map[string]AbilityWithChannel)
	for _, ability := range abilities {
		if ability.Group == "ability-query-test" {
			found[ability.Model] = ability
		}
	}
	if len(found) != 1 {
		t.Fatalf("active enabled ability query returned %v, want only active-query-model", found)
	}
	activeAbility, exists := found["active-query-model"]
	if !exists {
		t.Fatalf("active enabled ability missing from query result: %v", found)
	}
	if activeAbility.ChannelSetting != setting {
		t.Fatalf("channel setting = %q, want %q", activeAbility.ChannelSetting, setting)
	}
}

func TestBuildParamPricingForSeedance(t *testing.T) {
	meta := &Model{
		ModelName: "doubao-seedance-2-0-260128",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":6,"label":"6s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"480p",
			 "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("doubao-seedance-2-0-260128", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}
	if pricing.BillingMode != "linear_by_duration_and_resolution" {
		t.Fatalf("billing mode = %q", pricing.BillingMode)
	}
	if len(pricing.Results) != 6 {
		t.Fatalf("len(results) = %d", len(pricing.Results))
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:480p:4s", 0.7945*4)
	assertSpecPriceCNY("video:480p:6s", 0.7945*6)
	assertSpecPriceCNY("video:720p:4s", 1.7100*4)
	assertSpecPriceCNY("video:720p:6s", 1.7100*6)
	assertSpecPriceCNY("video:1080p:4s", 3.8544*4)
	assertSpecPriceCNY("video:1080p:6s", 3.8544*6)
}

func TestBuildParamPricingExplicitDisableDoesNotRestoreSystemDefault(t *testing.T) {
	meta := &Model{
		ModelName: "doubao-seedance-2-0-260128",
		PricingConfig: `{
			"currency":"CNY",
			"billing_mode":"disabled",
			"specs":[]
		}`,
	}
	if pricing := buildParamPricing(meta.ModelName, meta); pricing != nil {
		t.Fatalf("disabled param pricing = %#v, want nil", pricing)
	}
}

func TestBuildParamPricingForSeedanceFaceAddsTenPercent(t *testing.T) {
	meta := &Model{
		ModelName: "doubao-seedance-2.0-face",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":6,"label":"6s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"480p",
			 "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("doubao-seedance-2.0-face", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Formula != "480p: price_cny = duration_seconds * 1.09; 720p: price_cny = duration_seconds * 2.34; 1080p: price_cny = duration_seconds * 5.47" {
		t.Fatalf("formula = %q", pricing.Formula)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:480p:4s", 1.0862*4)
	assertSpecPriceCNY("video:480p:6s", 1.0862*6)
	assertSpecPriceCNY("video:720p:4s", 2.3389*4)
	assertSpecPriceCNY("video:720p:6s", 2.3389*6)
	assertSpecPriceCNY("video:1080p:4s", 5.4750*4)
}

func TestBuildParamPricingForSeedanceFastFaceAddsTenPercent(t *testing.T) {
	meta := &Model{
		ModelName: "doubao-seedance-2.0-fast-face",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":6,"label":"6s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"480p",
			 "options":[{"value":"480p","label":"480p"},{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("doubao-seedance-2.0-fast-face", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Formula != "480p: price_cny = duration_seconds * 0.88; 720p: price_cny = duration_seconds * 1.88" {
		t.Fatalf("formula = %q", pricing.Formula)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:480p:4s", 0.8760*4)
	assertSpecPriceCNY("video:480p:6s", 0.8760*6)
	assertSpecPriceCNY("video:720p:4s", 1.8834*4)
	assertSpecPriceCNY("video:720p:6s", 1.8834*6)
}

func TestBuildParamPricingForMiniMaxH3PublishesMetasoTimePrices(t *testing.T) {
	meta := &Model{
		ModelName: "minimax-h3",
		ParamsDef: `[{"key":"duration","options":[{"value":5,"label":"5s"}]}]`,
	}
	pricing := buildParamPricing(meta.ModelName, meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.ReferenceImageFreeCount != 5 || math.Abs(pricing.ReferenceImagePriceCNY-0.065) > 1e-9 {
		t.Fatalf("reference image surcharge: free=%d price=%.6f", pricing.ReferenceImageFreeCount, pricing.ReferenceImagePriceCNY)
	}
	if price, ok := VideoSpecPriceCNY(meta.ModelName, "768p", 5); !ok || math.Abs(price-1.20) > 1e-9 {
		t.Fatalf("768p time price = %.6f, ok=%t", price, ok)
	}
	if price, ok := VideoSpecPriceCNY(meta.ModelName, "1440p", 15); !ok || math.Abs(price-6.00) > 1e-9 {
		t.Fatalf("1440p time price = %.6f, ok=%t", price, ok)
	}
}

func TestBuildParamPricingForGptImage2UsesPremiumQualityMatrix(t *testing.T) {
	pricing := buildParamPricing("gpt-image-2", nil)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	if len(pricing.Results) != 9 {
		t.Fatalf("len(results) = %d, want 9", len(pricing.Results))
	}
	if math.Abs(pricing.ReferenceImagePriceCNY-0.1) > 1e-9 {
		t.Fatalf("reference image price = %.6f, want 0.1", pricing.ReferenceImagePriceCNY)
	}
	assertSpecPriceCNY("image:1k:low", 0.3)
	assertSpecPriceCNY("image:2k:low", 0.4)
	assertSpecPriceCNY("image:4k:low", 0.5)
	assertSpecPriceCNY("image:1k:medium", 0.6)
	assertSpecPriceCNY("image:2k:medium", 1.2)
	assertSpecPriceCNY("image:4k:medium", 1.9)
	assertSpecPriceCNY("image:1k:high", 2.3)
	assertSpecPriceCNY("image:2k:high", 4.6)
	assertSpecPriceCNY("image:4k:high", 7.6)
}

func TestBuildParamPricingForGemini31UsesStableRoutePricing(t *testing.T) {
	pricing := buildParamPricing("gemini-3.1-flash-image-preview-official", nil)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("image:0.5k", 0.45)
	assertSpecPriceCNY("image:1k", 0.65)
	assertSpecPriceCNY("image:2k", 1.0)
	assertSpecPriceCNY("image:4k", 1.55)
}

func TestFixedImageBasePriceCNYUsesLowestSpec(t *testing.T) {
	gptImage2Price, ok := fixedImageBasePriceCNY("gpt-image-2")
	if !ok {
		t.Fatal("expected gpt-image-2 base price")
	}
	if math.Abs(gptImage2Price-0.3) > 1e-9 {
		t.Fatalf("gpt-image-2 base price = %.6f", gptImage2Price)
	}

	officialPrice, ok := fixedImageBasePriceCNY("gpt-image-2-official")
	if !ok {
		t.Fatal("expected gpt-image-2-official base price")
	}
	if math.Abs(officialPrice-0.3) > 1e-9 {
		t.Fatalf("gpt-image-2-official base price = %.6f", officialPrice)
	}
}

func TestBuildParamPricingForGptImage2OfficialUsesPremiumQualityMatrix(t *testing.T) {
	pricing := buildParamPricing("gpt-image-2-official", nil)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	if len(pricing.Results) != 9 {
		t.Fatalf("len(results) = %d, want 9", len(pricing.Results))
	}
	assertSpecPriceCNY("image:1k:low", 0.3)
	assertSpecPriceCNY("image:2k:medium", 1.2)
	assertSpecPriceCNY("image:4k:high", 7.6)
}

func TestBuildParamPricingForSora2UsesFixedDurationPrices(t *testing.T) {
	meta := &Model{
		ModelName: "sora2",
		ParamsDef: `[
			{"key":"duration","type":"enum","label":"时长","default":4,
			 "options":[
			   {"value":4,"label":"4s"},
			   {"value":8,"label":"8s"},
			   {"value":12,"label":"12s"}
			 ]},
			{"key":"resolution","type":"enum","label":"分辨率","default":"720p",
			 "options":[{"value":"720p","label":"720p"}]}
		]`,
	}

	pricing := buildParamPricing("sora2", meta)
	if pricing == nil {
		t.Fatal("expected param pricing")
	}
	if pricing.Currency != "CNY" {
		t.Fatalf("currency = %q", pricing.Currency)
	}

	assertSpecPriceCNY := func(specKey string, want float64) {
		t.Helper()
		for _, item := range pricing.Results {
			if item.SpecKey != specKey {
				continue
			}
			if math.Abs(item.PriceCNY-want) > 1e-9 {
				t.Fatalf("%s price_cny = %.6f, want %.6f", specKey, item.PriceCNY, want)
			}
			return
		}
		t.Fatalf("spec %s not found", specKey)
	}

	assertSpecPriceCNY("video:720p:4s", 0.4)
	assertSpecPriceCNY("video:720p:8s", 0.8)
	assertSpecPriceCNY("video:720p:12s", 1.2)
}
