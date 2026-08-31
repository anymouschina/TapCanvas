package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

// CooldownChannelKey 把多 key 渠道内指定账号(key)置入限额冷却:标记为自动禁用并记录
// 解封时刻(unix 秒)，由对应 provider 的恢复任务到点自动解禁。
func CooldownChannelKey(channelId int, keyIndex int, until int64, reason string) error {
	lock := GetChannelPollingLock(channelId)
	lock.Lock()
	defer lock.Unlock()

	channel, err := GetChannelById(channelId, true)
	if err != nil {
		return err
	}
	if channel == nil {
		return fmt.Errorf("channel not found")
	}
	if !channel.ChannelInfo.IsMultiKey {
		return nil
	}
	if keyIndex < 0 || (channel.ChannelInfo.MultiKeySize > 0 && keyIndex >= channel.ChannelInfo.MultiKeySize) {
		return fmt.Errorf("invalid key index %d", keyIndex)
	}

	info := &channel.ChannelInfo
	if info.MultiKeyStatusList == nil {
		info.MultiKeyStatusList = make(map[int]int)
	}
	if info.MultiKeyDisabledReason == nil {
		info.MultiKeyDisabledReason = make(map[int]string)
	}
	if info.MultiKeyDisabledTime == nil {
		info.MultiKeyDisabledTime = make(map[int]int64)
	}
	if info.MultiKeyCooldownUntil == nil {
		info.MultiKeyCooldownUntil = make(map[int]int64)
	}
	if status, exists := info.MultiKeyStatusList[keyIndex]; exists && status == common.ChannelStatusManuallyDisabled {
		return nil
	}
	info.MultiKeyStatusList[keyIndex] = common.ChannelStatusAutoDisabled
	info.MultiKeyDisabledReason[keyIndex] = reason
	info.MultiKeyDisabledTime[keyIndex] = common.GetTimestamp()
	info.MultiKeyCooldownUntil[keyIndex] = until

	channelDisabled := false
	if info.MultiKeySize > 0 && len(info.MultiKeyStatusList) >= info.MultiKeySize && channel.Status == common.ChannelStatusEnabled {
		channel.Status = common.ChannelStatusAutoDisabled
		oi := channel.GetOtherInfo()
		oi["status_reason"] = "All keys are disabled"
		oi["status_time"] = common.GetTimestamp()
		channel.SetOtherInfo(oi)
		channelDisabled = true
	}
	if err := channel.SaveWithoutKey(); err != nil {
		return err
	}
	if channelDisabled {
		if err := UpdateAbilityStatus(channelId, false); err != nil {
			return fmt.Errorf(
				"渠道 %d 的密钥冷却状态已保存，但停用能力记录失败: %w",
				channelId,
				err,
			)
		}
	}
	if err := RefreshChannelCache(); err != nil {
		return fmt.Errorf(
			"渠道 %d 的密钥冷却状态已保存，但刷新运行时渠道缓存失败: %w",
			channelId,
			err,
		)
	}
	return nil
}

// RecoverCooledChannelKeys 保留 Claude 现有调用入口。
func RecoverCooledChannelKeys(now int64) (int, error) {
	return RecoverCooledChannelKeysForType(constant.ChannelTypeAnthropic, now)
}

// RecoverCooledChannelKeysForType 扫描指定 provider 的多 key 渠道，把冷却到期的账号
// 解禁；渠道曾因「全部账号禁用」整体自动禁用的一并恢复启用。只解禁仍处于自动禁用
// 状态的账号，手动禁用的不动。返回本次解禁的账号数。
func RecoverCooledChannelKeysForType(channelType int, now int64) (int, error) {
	var channels []*Channel
	if err := DB.Where("type = ?", channelType).Find(&channels).Error; err != nil {
		return 0, err
	}
	recovered := 0
	changedAny := false
	for _, scanned := range channels {
		if !scanned.ChannelInfo.IsMultiKey || len(scanned.ChannelInfo.MultiKeyCooldownUntil) == 0 {
			continue
		}
		lock := GetChannelPollingLock(scanned.Id)
		lock.Lock()
		channel, err := GetChannelById(scanned.Id, true)
		if err != nil {
			lock.Unlock()
			return recovered, fmt.Errorf("读取待恢复渠道 %d 失败: %w", scanned.Id, err)
		}
		if channel == nil {
			lock.Unlock()
			return recovered, fmt.Errorf("待恢复渠道 %d 不存在", scanned.Id)
		}
		info := &channel.ChannelInfo
		changed := false
		for idx, until := range info.MultiKeyCooldownUntil {
			if until > now {
				continue
			}
			delete(info.MultiKeyCooldownUntil, idx)
			changed = true
			if info.MultiKeyStatusList[idx] == common.ChannelStatusAutoDisabled {
				delete(info.MultiKeyStatusList, idx)
				delete(info.MultiKeyDisabledReason, idx)
				delete(info.MultiKeyDisabledTime, idx)
				recovered++
			}
		}
		if !changed {
			lock.Unlock()
			continue
		}
		channelEnabled := false
		if channel.Status == common.ChannelStatusAutoDisabled && (info.MultiKeySize == 0 || len(info.MultiKeyStatusList) < info.MultiKeySize) {
			oi := channel.GetOtherInfo()
			if statusReason, _ := oi["status_reason"].(string); statusReason == "All keys are disabled" {
				channel.Status = common.ChannelStatusEnabled
				delete(oi, "status_reason")
				delete(oi, "status_time")
				channel.SetOtherInfo(oi)
				channelEnabled = true
			}
		}
		err = channel.SaveWithoutKey()
		lock.Unlock()
		if err != nil {
			return recovered, err
		}
		if channelEnabled {
			if err := UpdateAbilityStatus(channel.Id, true); err != nil {
				return recovered, fmt.Errorf(
					"渠道 %d 的密钥冷却已恢复，但启用能力记录失败: %w",
					channel.Id,
					err,
				)
			}
		}
		changedAny = true
	}
	if changedAny {
		if err := RefreshChannelCache(); err != nil {
			return recovered, fmt.Errorf(
				"密钥冷却恢复结果已保存，但刷新运行时渠道缓存失败: %w",
				err,
			)
		}
	}
	return recovered, nil
}
