package model

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/require"
)

func TestLoadUpstreamCatalogUsesLivePriceAndRejectsIncompleteSnapshot(t *testing.T) {
	priceBody := `{"success":true,"pricing_version":"live-v1","data":[{"model_name":"live-image","quota_type":1,"model_price":0.2,"supported_endpoint_types":["image-generation"]}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/models/list" {
			_, _ = w.Write([]byte(`{"success":true,"data":[{"id":999,"model_name":"live-image","status":1,"kind":"image","params_def":"[]"}]}`))
			return
		}
		_, _ = w.Write([]byte(priceBody))
	}))
	defer server.Close()
	plan, err := loadUpstreamCatalog(context.Background(), server.Client(), server.URL)
	require.NoError(t, err)
	require.Equal(t, "live-v1", plan.Version)
	require.Equal(t, 0.2, plan.Prices["live-image"].ModelPrice)
	priceBody = `{"success":true,"pricing_version":"broken","data":[]}`
	_, err = loadUpstreamCatalog(context.Background(), server.Client(), server.URL)
	require.Error(t, err)
}

func TestApplyUpstreamCatalogAtomicIdempotentAndPreservesOtherChannels(t *testing.T) {
	db := useInternalRelayTestDB(t)
	require.NoError(t, db.AutoMigrate(&Model{}, &Channel{}, &Ability{}, &Option{}))
	base := "https://catalog.example"
	channel := Channel{Id: 1, Name: "source", Key: "retained-secret", Status: 1, Models: "removed", Group: "default", BaseURL: &base}
	other := Channel{Id: 2, Name: "untouched", Key: "other-secret", Status: 1, Models: "other", Group: "default"}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&other).Error)
	require.NoError(t, db.Create(&Model{ModelName: "removed", Kind: "image", Status: 1}).Error)
	require.NoError(t, db.Create(&Option{Key: "ModelPrice", Value: `{"removed":9,"other":7}`}).Error)
	plan := upstreamCatalogPlan{Version: "v1", Models: []Model{{Id: 999, ModelName: "live", Kind: "image", Status: 1, ParamsDef: "[]"}}, Prices: map[string]Pricing{"live": {ModelName: "live", QuotaType: 1, ModelPrice: 0.2, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointType("image-generation")}}}}
	require.NoError(t, applyUpstreamCatalog(db, channel, plan))
	require.NoError(t, db.First(&channel, 1).Error)
	require.NoError(t, applyUpstreamCatalog(db, channel, plan))
	var imported Model
	require.NoError(t, db.Where("model_name = ?", "live").First(&imported).Error)
	require.NotEqual(t, 999, imported.Id)
	var option Option
	require.NoError(t, db.Where("key = ?", "ModelPrice").First(&option).Error)
	var prices map[string]float64
	require.NoError(t, common.Unmarshal([]byte(option.Value), &prices))
	require.Equal(t, map[string]float64{"live": 0.2, "other": 7}, prices)
	var after Channel
	require.NoError(t, db.First(&after, 2).Error)
	require.Equal(t, other.Key, after.Key)
	require.Equal(t, "other", after.Models)
	require.Equal(t, "retained-secret", channel.Key)
	require.Equal(t, "passthrough", channel.GetSetting().ModelProtocols["live"].Options["image_size_transport"])
	var count int64
	require.NoError(t, db.Model(&Ability{}).Where("channel_id = ?", 1).Count(&count).Error)
	require.Equal(t, int64(1), count)
	// A deterministic protocol failure midway through an import rolls back all writes.
	plan.Models = append(plan.Models, Model{ModelName: "invalid-protocol", Kind: "image", Status: 1})
	plan.Prices["live"] = Pricing{ModelName: "live", QuotaType: 1, ModelPrice: 99, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointType("image-generation")}}
	plan.Prices["invalid-protocol"] = Pricing{ModelName: "invalid-protocol", QuotaType: 1, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointType("unknown")}}
	require.Error(t, applyUpstreamCatalog(db, channel, plan))
	require.NoError(t, db.Where("key = ?", "ModelPrice").First(&option).Error)
	require.NoError(t, common.Unmarshal([]byte(option.Value), &prices))
	require.Equal(t, 0.2, prices["live"])
}

func TestConfiguredUpstreamCatalogAutomaticallyFindsLluban(t *testing.T) {
	db := useInternalRelayTestDB(t)
	require.NoError(t, db.AutoMigrate(&Model{}, &Channel{}, &Ability{}, &Option{}))
	t.Setenv("UPSTREAM_CATALOG_CHANNEL_ID", "")
	require.NoError(t, SyncConfiguredUpstreamCatalog(context.Background()))
	channel := Channel{Name: "lluban-recommended", Status: 2}
	require.NoError(t, db.Create(&channel).Error)
	require.ErrorContains(t, SyncConfiguredUpstreamCatalog(context.Background()), "must be enabled")
	require.NoError(t, db.Create(&Channel{Name: "second", Tag: func() *string { v := "lluban"; return &v }(), Status: 1}).Error)
	require.ErrorContains(t, SyncConfiguredUpstreamCatalog(context.Background()), "multiple lluban")
}

func TestUpstreamProtocolOrderDoesNotChangeBinding(t *testing.T) {
	first, err := upstreamCatalogProtocol([]constant.EndpointType{"openai-video", "openai"})
	require.NoError(t, err)
	second, err := upstreamCatalogProtocol([]constant.EndpointType{"openai", "openai-video"})
	require.NoError(t, err)
	require.Equal(t, constant.ProtocolTaskSora, first)
	require.Equal(t, first, second)
}
