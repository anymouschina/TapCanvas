package model

import (
	"sort"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"gorm.io/gorm"
)

const (
	NameRuleExact = iota
	NameRulePrefix
	NameRuleContains
	NameRuleSuffix
)

type BoundChannel struct {
	ID                int                        `json:"id"`
	Name              string                     `json:"name"`
	Type              int                        `json:"type"`
	Status            int                        `json:"status"`
	AbilityEnabled    bool                       `json:"ability_enabled"`
	EffectiveProtocol string                     `json:"effective_protocol,omitempty"`
	ProtocolTransport constant.ProtocolTransport `json:"protocol_transport,omitempty"`
	ProtocolSource    string                     `json:"protocol_source,omitempty"`
	ProtocolModelKey  string                     `json:"protocol_model_key,omitempty"`
	ProtocolOptions   map[string]string          `json:"protocol_options,omitempty"`
	DefaultProtocol   *dto.ProtocolBinding       `json:"default_protocol,omitempty"`
	ModelProtocol     *dto.ProtocolBinding       `json:"model_protocol,omitempty"`
	ProtocolError     string                     `json:"protocol_error,omitempty"`
}

type Model struct {
	Id           int            `json:"id"`
	ModelName    string         `json:"model_name" gorm:"size:128;not null;uniqueIndex:uk_model_name_delete_at,priority:1"`
	Description  string         `json:"description,omitempty" gorm:"type:text"`
	Icon         string         `json:"icon,omitempty" gorm:"type:varchar(128)"`
	Tags         string         `json:"tags,omitempty" gorm:"type:varchar(255)"`
	VendorID     int            `json:"vendor_id,omitempty" gorm:"index"`
	Endpoints    string         `json:"endpoints,omitempty" gorm:"type:text"`
	Status       int            `json:"status" gorm:"default:1"`
	SyncOfficial int            `json:"sync_official" gorm:"default:1"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index;uniqueIndex:uk_model_name_delete_at,priority:2"`

	BoundChannels []BoundChannel `json:"bound_channels,omitempty" gorm:"-"`
	EnableGroups  []string       `json:"enable_groups,omitempty" gorm:"-"`
	QuotaTypes    []int          `json:"quota_types,omitempty" gorm:"-"`
	NameRule      int            `json:"name_rule" gorm:"default:0"`
	Kind          string         `json:"kind"                   gorm:"type:varchar(32);default:''"`
	Capabilities  string         `json:"capabilities,omitempty" gorm:"type:text"`
	ParamsDef     string         `json:"params_def,omitempty"   gorm:"type:text"`
	PricingConfig string         `json:"pricing_config,omitempty" gorm:"type:text"`

	EffectiveEndpoints []constant.EndpointType `json:"effective_endpoints,omitempty" gorm:"-"`
	MatchedModels      []string                `json:"matched_models,omitempty" gorm:"-"`
	MatchedCount       int                     `json:"matched_count,omitempty" gorm:"-"`
	RoutingAliases     []string                `json:"routing_aliases,omitempty" gorm:"-"`
}

func (mi *Model) Insert() error {
	now := common.GetTimestamp()
	mi.CreatedTime = now
	mi.UpdatedTime = now

	// 保存原始值（因为 Create 后可能被 GORM 的 default 标签覆盖为 1）
	originalStatus := mi.Status
	originalSyncOfficial := mi.SyncOfficial

	// 先创建记录（GORM 会对零值字段应用默认值）
	if err := DB.Create(mi).Error; err != nil {
		return err
	}

	// 使用保存的原始值进行更新，确保零值能正确保存
	return DB.Model(&Model{}).Where("id = ?", mi.Id).Updates(map[string]interface{}{
		"status":        originalStatus,
		"sync_official": originalSyncOfficial,
	}).Error
}

func IsModelNameDuplicated(id int, name string) (bool, error) {
	if name == "" {
		return false, nil
	}
	var cnt int64
	err := DB.Model(&Model{}).Where("model_name = ? AND id <> ?", name, id).Count(&cnt).Error
	return cnt > 0, err
}

func (mi *Model) Update() error {
	mi.UpdatedTime = common.GetTimestamp()
	// 使用 Select 强制更新所有字段，包括零值
	return DB.Model(&Model{}).Where("id = ?", mi.Id).
		Select("model_name", "description", "icon", "tags", "vendor_id", "endpoints", "status", "sync_official", "name_rule",
			"kind", "capabilities", "params_def", "pricing_config",
			"updated_time").
		Updates(mi).Error
}

func (mi *Model) Delete() error {
	return DB.Delete(mi).Error
}

func BatchUpdateModelStatus(ids []int, status int) (int64, error) {
	var matchedCount int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Model{}).Where("id IN ?", ids).Count(&matchedCount).Error; err != nil {
			return err
		}
		return tx.Model(&Model{}).
			Where("id IN ?", ids).
			Updates(map[string]interface{}{
				"status":       status,
				"updated_time": common.GetTimestamp(),
			}).Error
	})
	return matchedCount, err
}

func GetVendorModelCounts() (map[int64]int64, error) {
	var stats []struct {
		VendorID int64
		Count    int64
	}
	if err := DB.Model(&Model{}).
		Select("vendor_id as vendor_id, count(*) as count").
		Group("vendor_id").
		Scan(&stats).Error; err != nil {
		return nil, err
	}
	m := make(map[int64]int64, len(stats))
	for _, s := range stats {
		m[s.VendorID] = s.Count
	}
	return m, nil
}

func GetAllModels(offset int, limit int) ([]*Model, error) {
	var models []*Model
	err := DB.Order("id DESC").Offset(offset).Limit(limit).Find(&models).Error
	return models, err
}

func GetBoundChannelsByModelsMap(modelNames []string) (map[string][]BoundChannel, error) {
	result := make(map[string][]BoundChannel)
	if len(modelNames) == 0 {
		return result, nil
	}
	type row struct {
		Model   string
		ID      int
		Name    string
		Type    int
		Status  int
		Enabled bool
		Setting *string
	}
	var rows []row
	err := DB.Table("channels").
		Select("abilities.model as model, channels.id as id, channels.name as name, channels.type as type, channels.status as status, abilities.enabled as enabled, channels.setting as setting").
		Joins("JOIN abilities ON abilities.channel_id = channels.id").
		Where("abilities.model IN ?", modelNames).
		Distinct().
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		boundChannel := BoundChannel{
			ID:             r.ID,
			Name:           r.Name,
			Type:           r.Type,
			Status:         r.Status,
			AbilityEnabled: r.Enabled,
		}
		settings, parseErr := parseChannelSettings(r.Setting)
		if parseErr != nil {
			boundChannel.ProtocolError = "渠道协议设置不是合法 JSON: " + parseErr.Error()
			result[r.Model] = append(result[r.Model], boundChannel)
			continue
		}
		if settings.DefaultProtocol != nil {
			defaultProtocol := cloneProtocolBinding(*settings.DefaultProtocol)
			boundChannel.DefaultProtocol = &defaultProtocol
		}
		resolved, resolveErr := ResolveProtocolBinding(settings, r.Model)
		if resolveErr != nil {
			boundChannel.ProtocolError = resolveErr.Error()
			result[r.Model] = append(result[r.Model], boundChannel)
			continue
		}
		boundChannel.EffectiveProtocol = resolved.Protocol.ID
		boundChannel.ProtocolTransport = resolved.Protocol.Transport
		boundChannel.ProtocolSource = resolved.Source
		boundChannel.ProtocolModelKey = resolved.ModelKey
		if len(resolved.Binding.Options) > 0 {
			boundChannel.ProtocolOptions = resolved.Binding.Options
		}
		if resolved.Source == ProtocolBindingSourceModel {
			modelProtocol := cloneProtocolBinding(resolved.Binding)
			boundChannel.ModelProtocol = &modelProtocol
		}
		result[r.Model] = append(result[r.Model], boundChannel)
	}
	for modelName := range result {
		sort.Slice(result[modelName], func(i, j int) bool {
			return result[modelName][i].ID < result[modelName][j].ID
		})
	}
	return result, nil
}

func SearchModels(keyword string, vendor string, offset int, limit int) ([]*Model, int64, error) {
	var models []*Model
	db := DB.Model(&Model{})
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("model_name LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}
	if vendor != "" {
		if vid, err := strconv.Atoi(vendor); err == nil {
			db = db.Where("models.vendor_id = ?", vid)
		} else {
			db = db.Joins("JOIN vendors ON vendors.id = models.vendor_id").Where("vendors.name LIKE ?", "%"+vendor+"%")
		}
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("models.id DESC").Offset(offset).Limit(limit).Find(&models).Error; err != nil {
		return nil, 0, err
	}
	return models, total, nil
}
