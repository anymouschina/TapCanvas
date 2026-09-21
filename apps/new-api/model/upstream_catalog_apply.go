package model

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"time"
)

func applyUpstreamCatalog(db *gorm.DB, channel Channel, plan upstreamCatalogPlan) error {
	modelPricingPolicyMutex.Lock()
	defer modelPricingPolicyMutex.Unlock()
	return db.Transaction(func(tx *gorm.DB) error {
		oldNames := strings.Split(channel.Models, ",")
		names := make([]string, 0, len(plan.Models))
		settings := channel.GetSetting()
		settings.PriceRatio = 1
		settings.MinVideoPriceCNYPerSecond = 0
		settings.ImagePricingOverrides = nil
		settings.PricingModelMapping = nil
		settings.ModelProtocols = make(map[string]dto.ProtocolBinding)
		optionMaps := make(map[string]map[string]float64)
		for _, key := range modelPricingOptionKeys {
			var option Option
			err := tx.Where("key = ?", key).First(&option).Error
			values := make(map[string]float64)
			if err == nil && option.Value != "" {
				if err = common.Unmarshal([]byte(option.Value), &values); err != nil {
					return err
				}
				if values == nil {
					return fmt.Errorf("pricing option %s must be an object", key)
				}
			} else if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}

			optionMaps[key] = values
		}
		for _, incoming := range plan.Models {
			price := plan.Prices[incoming.ModelName]
			names = append(names, incoming.ModelName)
			// Protocol selection follows the upstream wire endpoint contract, never model names.
			protocol, err := upstreamCatalogProtocol(price.SupportedEndpointTypes)
			if err != nil {
				return fmt.Errorf("catalog model %s: %w", incoming.ModelName, err)
			}
			binding := dto.ProtocolBinding{Protocol: protocol}
			if protocol == "openai" {
				binding.Options = map[string]string{"image_size_transport": "passthrough"}
			}
			settings.ModelProtocols[incoming.ModelName] = binding
			endpoints, err := common.Marshal(price.SupportedEndpointTypes)
			if err != nil {
				return err
			}
			var existing Model
			err = tx.Where("model_name = ?", incoming.ModelName).First(&existing).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			incoming.Id = existing.Id
			incoming.VendorID = existing.VendorID
			incoming.Tags = existing.Tags
			incoming.SyncOfficial = 0
			incoming.Endpoints = string(endpoints)
			incoming.UpdatedTime = time.Now().Unix()
			if existing.Id == 0 {
				incoming.CreatedTime = incoming.UpdatedTime
			}
			source, err := loadUpstreamModelPricing(tx, incoming.ModelName)
			if err != nil {
				return err
			}
			multiplier := 1.0
			if source != nil {
				if source.ChannelID != channel.Id {
					return fmt.Errorf("model %s already owned by upstream channel %d", incoming.ModelName, source.ChannelID)
				}
				multiplier = source.Multiplier
			}
			spec, err := upstreamPublishedSpec(price)
			if err != nil {
				return fmt.Errorf("model %s: %w", incoming.ModelName, err)
			}
			source = &UpstreamModelPricing{ChannelID: channel.Id, Version: plan.Version, Multiplier: multiplier, Price: price, Spec: spec}
			incoming.PricingConfig, err = applyUpstreamSellingPrice(optionMaps, incoming.ModelName, *source)
			if err != nil {
				return err
			}
			if err := tx.Save(&incoming).Error; err != nil {
				return err
			}
			if err := saveUpstreamModelPricing(tx, incoming.ModelName, *source); err != nil {
				return err
			}
		}
		channel.Models = strings.Join(names, ",")
		channel.SetSetting(settings)
		if err := tx.Model(&channel).Select("Models", "Setting").Updates(&channel).Error; err != nil {
			return err
		}
		if err := channel.UpdateAbilities(tx); err != nil {
			return err
		}
		for _, name := range oldNames {
			retained := false
			for _, current := range names {
				if current == name {
					retained = true
					break
				}
			}
			if retained || name == "" {
				continue
			}
			var count int64
			if err := tx.Model(&Ability{}).Where("model = ? AND enabled = ?", name, true).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				clearModelPricingOptionValues(optionMaps, name)
				if err := tx.Model(&Model{}).Where("model_name = ?", name).Update("status", 2).Error; err != nil {
					return err
				}
			}
		}
		for key, values := range optionMaps {
			encoded, err := common.Marshal(values)
			if err != nil {
				return err
			}
			if err = tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&Option{Key: key, Value: string(encoded)}).Error; err != nil {
				return err
			}
		}
		receipt, err := common.Marshal(struct {
			ChannelID int    `json:"channel_id"`
			Source    string `json:"source"`
			Version   string `json:"pricing_version"`
			Count     int    `json:"model_count"`
			SyncedAt  string `json:"synced_at"`
		}{channel.Id, *channel.BaseURL, plan.Version, len(plan.Models), time.Now().UTC().Format(time.RFC3339)})
		if err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).Create(&Option{Key: "UpstreamCatalogSyncReceipt", Value: string(receipt)}).Error
	})
}
