package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/require"
	"math"
	"testing"
)

func TestUpstreamSellingPriceScalesAllPriceDimensionsWithoutCompounding(t *testing.T) {
	maps := modelPricingOptionMaps{}
	for _, key := range modelPricingOptionKeys {
		maps[key] = map[string]float64{}
	}
	source := UpstreamModelPricing{Multiplier: 2, Price: Pricing{QuotaType: 0, ModelRatio: 3, CompletionRatio: 4, CacheRatio: float64Pointer(0.1), AudioRatio: float64Pointer(2), AudioCompletionRatio: float64Pointer(3)}, Spec: &ModelPricingConfig{Currency: "CNY", BillingMode: PricingBillingModeFixedBySpec, ReferenceImageFreeCount: 1, ReferenceImagePriceCNY: 0.2, Specs: []ModelPricingSpec{{Resolution: "2k", PriceCNY: 0.5}}}}
	for i := 0; i < 2; i++ {
		raw, err := applyUpstreamSellingPrice(maps, "test", source)
		require.NoError(t, err)
		require.Equal(t, 6.0, maps["ModelRatio"]["test"])
		require.Equal(t, 4.0, maps["CompletionRatio"]["test"])
		require.Equal(t, 0.1, maps["CacheRatio"]["test"])
		require.Equal(t, 3.0, maps["AudioCompletionRatio"]["test"])
		config, err := ParseModelPricingConfig(raw)
		require.NoError(t, err)
		require.Equal(t, 1.0, config.Specs[0].PriceCNY)
		require.Equal(t, 0.4, config.ReferenceImagePriceCNY)
	}
	require.Equal(t, 0.5, source.Spec.Specs[0].PriceCNY)
	source.Price = Pricing{QuotaType: 1, ModelPrice: 0.7}
	source.Spec = &ModelPricingConfig{Currency: "CNY", BillingMode: PricingBillingModeLinearBySpec, Specs: []ModelPricingSpec{{Resolution: "1080p", CNYPerSecond: 0.3}}}
	raw, err := applyUpstreamSellingPrice(maps, "test", source)
	require.NoError(t, err)
	require.Equal(t, 1.4, maps["ModelPrice"]["test"])
	require.NotContains(t, maps["ModelRatio"], "test")
	config, err := ParseModelPricingConfig(raw)
	require.NoError(t, err)
	require.Equal(t, 0.6, config.Specs[0].CNYPerSecond)
	for _, invalid := range []float64{0, -1, math.Inf(1), math.NaN()} {
		source.Multiplier = invalid
		_, err := applyUpstreamSellingPrice(maps, "test", source)
		require.Error(t, err)
	}
}

func TestUpstreamMultiplierPersistsAcrossSyncAndUsesNewOriginalPrice(t *testing.T) {
	db := useInternalRelayTestDB(t)
	require.NoError(t, db.AutoMigrate(&Model{}, &Channel{}, &Ability{}, &Option{}))
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	oldMaps := loadModelPricingOptionMaps()
	t.Cleanup(func() {
		for key, values := range oldMaps {
			raw, err := common.Marshal(values)
			require.NoError(t, err)
			require.NoError(t, updateOptionMap(key, string(raw)))
		}
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	base := "https://catalog.example"
	channel := Channel{Name: "lluban-recommended", Key: "test", Status: 1, Models: "live", Group: "default", BaseURL: &base}
	require.NoError(t, db.Create(&channel).Error)
	plan := upstreamCatalogPlan{Version: "v1", Models: []Model{{ModelName: "live", Kind: "image", Status: 1}}, Prices: map[string]Pricing{"live": {ModelName: "live", QuotaType: 1, ModelPrice: 0.2, SupportedEndpointTypes: []constant.EndpointType{"image-generation"}}}}
	require.NoError(t, applyUpstreamCatalog(db, channel, plan))
	InitOptionMap()
	var meta Model
	require.NoError(t, db.Where("model_name = ?", "live").First(&meta).Error)
	policy, err := UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{SellingMultiplier: float64Pointer(2.5)})
	require.NoError(t, err)
	require.Equal(t, 0.5, *policy.FixedPrice)
	require.Equal(t, 2.5, policy.Upstream.Multiplier)
	_, err = UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{BillingMode: ModelPricingModeUnconfigured})
	require.ErrorContains(t, err, "售价倍率")
	price := plan.Prices["live"]
	price.ModelPrice = 0.4
	plan.Prices["live"] = price
	plan.Version = "v2"
	require.NoError(t, applyUpstreamCatalog(db, channel, plan))
	InitOptionMap()
	policy, err = GetModelPricingPolicy(meta.Id)
	require.NoError(t, err)
	require.Equal(t, 1.0, *policy.FixedPrice)
	require.Equal(t, 2.5, policy.Upstream.Multiplier)
	require.Equal(t, "v2", policy.Upstream.Version)
	_, err = UpdateModelPricingPolicy(meta.Id, ModelPricingPolicyUpdate{SellingMultiplier: float64Pointer(0)})
	require.Error(t, err)
	policy, err = GetModelPricingPolicy(meta.Id)
	require.NoError(t, err)
	require.Equal(t, 1.0, *policy.FixedPrice)
}

func TestUpstreamPublishedSpecRejectsNonLinearPriceTable(t *testing.T) {
	p := Pricing{ParamPricing: &ParamPricing{Currency: "CNY", BillingMode: PricingBillingModeLinearBySpec, Results: []ParamPricingResult{{Resolution: "720p", DurationSeconds: 5, PriceCNY: 1}, {Resolution: "720p", DurationSeconds: 10, PriceCNY: 2}}}}
	spec, err := upstreamPublishedSpec(p)
	require.NoError(t, err)
	require.Len(t, spec.Specs, 1)
	require.Equal(t, 0.2, spec.Specs[0].CNYPerSecond)
	p.ParamPricing.Results[1].PriceCNY = 3
	_, err = upstreamPublishedSpec(p)
	require.ErrorContains(t, err, "inconsistent")
}
