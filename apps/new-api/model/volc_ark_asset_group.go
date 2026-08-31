package model

import "time"

// VolcArkAssetGroup 记录 seedance 视频审核期间创建的 ARK 素材组，供后台任务在
// 视频早已生成完毕后删除。持久化以便 new-api 重启后仍能清理遗留组（不产生孤儿）。
type VolcArkAssetGroup struct {
	GroupID   string `json:"group_id" gorm:"primaryKey;type:varchar(191)"`
	CreatedAt int64  `json:"created_at" gorm:"index"`
}

func (VolcArkAssetGroup) TableName() string { return "volc_ark_asset_groups" }

// RecordArkAssetGroup 登记一个素材组（已存在则忽略）。
func RecordArkAssetGroup(groupID string) error {
	if groupID == "" {
		return nil
	}
	row := VolcArkAssetGroup{GroupID: groupID, CreatedAt: time.Now().Unix()}
	return DB.Where(VolcArkAssetGroup{GroupID: groupID}).FirstOrCreate(&row).Error
}

// ListStaleArkAssetGroups 返回创建时间早于 (now - maxAgeSeconds) 的组 ID。
func ListStaleArkAssetGroups(maxAgeSeconds int64) ([]string, error) {
	cutoff := time.Now().Unix() - maxAgeSeconds
	var groups []VolcArkAssetGroup
	if err := DB.Where("created_at < ?", cutoff).Find(&groups).Error; err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(groups))
	for _, g := range groups {
		ids = append(ids, g.GroupID)
	}
	return ids, nil
}

// ForgetArkAssetGroup 删除一条素材组记录。
func ForgetArkAssetGroup(groupID string) error {
	return DB.Where("group_id = ?", groupID).Delete(&VolcArkAssetGroup{}).Error
}
