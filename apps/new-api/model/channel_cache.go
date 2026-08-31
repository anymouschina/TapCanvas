package model

import (
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

var group2model2channels map[string]map[string][]int // enabled channel
var channelsIDM map[int]*Channel                     // all channels include disabled
var channelSyncLock sync.RWMutex

func RefreshChannelCache() error {
	if !common.MemoryCacheEnabled {
		return nil
	}
	newChannelId2channel := make(map[int]*Channel)
	var channels []*Channel
	if err := DB.Find(&channels).Error; err != nil {
		return fmt.Errorf("读取渠道缓存源数据失败: %w", err)
	}
	for _, channel := range channels {
		newChannelId2channel[channel.Id] = channel
	}
	var abilities []*Ability
	if err := DB.Find(&abilities).Error; err != nil {
		return fmt.Errorf("读取渠道能力缓存源数据失败: %w", err)
	}
	groups := make(map[string]bool)
	for _, ability := range abilities {
		groups[ability.Group] = true
	}
	newGroup2model2channels := make(map[string]map[string][]int)
	for group := range groups {
		newGroup2model2channels[group] = make(map[string][]int)
	}
	for _, ability := range abilities {
		if !ability.Enabled {
			continue
		}
		channel, ok := newChannelId2channel[ability.ChannelId]
		if !ok || channel.Status != common.ChannelStatusEnabled {
			continue
		}
		group := strings.TrimSpace(ability.Group)
		model := strings.TrimSpace(ability.Model)
		if group == "" || model == "" {
			continue
		}
		if _, ok := newGroup2model2channels[group]; !ok {
			newGroup2model2channels[group] = make(map[string][]int)
		}
		if _, ok := newGroup2model2channels[group][model]; !ok {
			newGroup2model2channels[group][model] = make([]int, 0)
		}
		if !isChannelIDInList(newGroup2model2channels[group][model], channel.Id) {
			newGroup2model2channels[group][model] = append(newGroup2model2channels[group][model], channel.Id)
		}
	}
	// sort by priority
	for group, model2channels := range newGroup2model2channels {
		for model, channels := range model2channels {
			sort.Slice(channels, func(i, j int) bool {
				return newChannelId2channel[channels[i]].GetPriority() > newChannelId2channel[channels[j]].GetPriority()
			})
			newGroup2model2channels[group][model] = channels
		}
	}

	channelSyncLock.Lock()
	group2model2channels = newGroup2model2channels
	//channelsIDM = newChannelId2channel
	for i, channel := range newChannelId2channel {
		if channel.ChannelInfo.IsMultiKey {
			channel.Keys = channel.GetKeys()
			if channel.ChannelInfo.MultiKeyMode == constant.MultiKeyModePolling {
				if oldChannel, ok := channelsIDM[i]; ok {
					// 存在旧的渠道，如果是多key且轮询，保留轮询索引信息
					if oldChannel.ChannelInfo.IsMultiKey && oldChannel.ChannelInfo.MultiKeyMode == constant.MultiKeyModePolling {
						channel.ChannelInfo.MultiKeyPollingIndex = oldChannel.ChannelInfo.MultiKeyPollingIndex
					}
				}
			}
		}
	}
	channelsIDM = newChannelId2channel
	channelSyncLock.Unlock()
	common.SysLog("channels synced from database")
	return nil
}

func SyncChannelCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		common.SysLog("syncing channels from database")
		if err := RefreshChannelCache(); err != nil {
			common.SysError("periodic channel cache refresh failed: " + err.Error())
		}
	}
}

func GetRandomSatisfiedChannel(group string, model string, retry int, excludeIds []int) (*Channel, error) {
	// if memory cache is disabled, get channel directly from database
	if !common.MemoryCacheEnabled {
		return GetChannel(group, model, retry, excludeIds)
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	model2channels := group2model2channels[group]
	seenChannelIds := make(map[int]bool)
	channels := make([]int, 0)
	appendChannels := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		for _, channelId := range model2channels[candidate] {
			if seenChannelIds[channelId] {
				continue
			}
			seenChannelIds[channelId] = true
			channels = append(channels, channelId)
		}
		normalizedModel := ratio_setting.FormatMatchingModelName(candidate)
		if normalizedModel == "" || normalizedModel == candidate {
			return
		}
		for _, channelId := range model2channels[normalizedModel] {
			if seenChannelIds[channelId] {
				continue
			}
			seenChannelIds[channelId] = true
			channels = append(channels, channelId)
		}
	}
	for _, candidate := range RoutingModelSelectionCandidates(model) {
		appendChannels(candidate)
	}

	if len(channels) == 0 {
		return nil, nil
	}

	// Filter out already-tried channels so each channel is used at most once.
	if len(excludeIds) > 0 {
		excludeSet := make(map[int]bool, len(excludeIds))
		for _, id := range excludeIds {
			excludeSet[id] = true
		}
		filtered := channels[:0:0]
		for _, id := range channels {
			if !excludeSet[id] {
				filtered = append(filtered, id)
			}
		}
		channels = filtered
	}

	if len(channels) == 0 {
		return nil, nil
	}

	if len(channels) == 1 {
		if channel, ok := channelsIDM[channels[0]]; ok {
			return channel, nil
		}
		return nil, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channels[0])
	}

	uniquePriorities := make(map[int]bool)
	for _, channelId := range channels {
		if channel, ok := channelsIDM[channelId]; ok {
			uniquePriorities[int(channel.GetPriority())] = true
		} else {
			return nil, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channelId)
		}
	}
	var sortedUniquePriorities []int
	for priority := range uniquePriorities {
		sortedUniquePriorities = append(sortedUniquePriorities, priority)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(sortedUniquePriorities)))

	// When channels are excluded, always pick from the highest available priority
	// so we don't skip to a lower tier while higher-priority channels remain untried.
	targetRetry := retry
	if len(excludeIds) > 0 {
		targetRetry = 0
	}
	if targetRetry >= len(sortedUniquePriorities) {
		targetRetry = len(sortedUniquePriorities) - 1
	}
	targetPriority := int64(sortedUniquePriorities[targetRetry])

	// get the priority for the given retry number
	var sumWeight = 0
	var targetChannels []*Channel
	for _, channelId := range channels {
		if channel, ok := channelsIDM[channelId]; ok {
			if channel.GetPriority() == targetPriority {
				sumWeight += channel.GetWeight()
				targetChannels = append(targetChannels, channel)
			}
		} else {
			return nil, fmt.Errorf("数据库一致性错误，渠道# %d 不存在，请联系管理员修复", channelId)
		}
	}

	if len(targetChannels) == 0 {
		return nil, errors.New(fmt.Sprintf("no channel found, group: %s, model: %s, priority: %d", group, model, targetPriority))
	}

	// smoothing factor and adjustment
	smoothingFactor := 1
	smoothingAdjustment := 0

	if sumWeight == 0 {
		// when all channels have weight 0, set sumWeight to the number of channels and set smoothing adjustment to 100
		// each channel's effective weight = 100
		sumWeight = len(targetChannels) * 100
		smoothingAdjustment = 100
	} else if sumWeight/len(targetChannels) < 10 {
		// when the average weight is less than 10, set smoothing factor to 100
		smoothingFactor = 100
	}

	// Calculate the total weight of all channels up to endIdx
	totalWeight := sumWeight * smoothingFactor

	// Generate a random value in the range [0, totalWeight)
	randomWeight := rand.Intn(totalWeight)

	// Find a channel based on its weight
	for _, channel := range targetChannels {
		randomWeight -= channel.GetWeight()*smoothingFactor + smoothingAdjustment
		if randomWeight < 0 {
			return channel, nil
		}
	}
	// return null if no channel is not found
	return nil, errors.New("channel not found")
}

func CacheGetChannel(id int) (*Channel, error) {
	if !common.MemoryCacheEnabled {
		return GetChannelById(id, true)
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	c, ok := channelsIDM[id]
	if !ok {
		return nil, fmt.Errorf("渠道# %d，已不存在", id)
	}
	return c, nil
}

// CacheGetUniqueChannelByNameAndType resolves an operationally named channel
// without relying on a database id that differs between deployments. Duplicate
// names are rejected because a global forced route must have exactly one target.
func CacheGetUniqueChannelByNameAndType(name string, channelType int) (*Channel, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" || channelType <= 0 {
		return nil, errors.New("channel name and type are required")
	}
	if !common.MemoryCacheEnabled {
		var channels []*Channel
		if err := DB.Where("name = ? AND type = ?", trimmedName, channelType).Limit(2).Find(&channels).Error; err != nil {
			return nil, fmt.Errorf("读取渠道 %q 失败: %w", trimmedName, err)
		}
		if len(channels) != 1 {
			return nil, fmt.Errorf("渠道 %q(type=%d) 数量为 %d，必须且只能配置一个", trimmedName, channelType, len(channels))
		}
		return channels[0], nil
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()
	var matched *Channel
	for _, channel := range channelsIDM {
		if channel == nil || channel.Name != trimmedName || channel.Type != channelType {
			continue
		}
		if matched != nil {
			return nil, fmt.Errorf("渠道 %q(type=%d) 配置重复", trimmedName, channelType)
		}
		matched = channel
	}
	if matched == nil {
		return nil, fmt.Errorf("渠道 %q(type=%d) 不存在", trimmedName, channelType)
	}
	return matched, nil
}

func CacheGetChannelInfo(id int) (*ChannelInfo, error) {
	if !common.MemoryCacheEnabled {
		channel, err := GetChannelById(id, true)
		if err != nil {
			return nil, err
		}
		return &channel.ChannelInfo, nil
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	c, ok := channelsIDM[id]
	if !ok {
		return nil, fmt.Errorf("渠道# %d，已不存在", id)
	}
	return &c.ChannelInfo, nil
}

func CacheUpdateChannelStatus(id int, status int) {
	if !common.MemoryCacheEnabled {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	if channel, ok := channelsIDM[id]; ok {
		channel.Status = status
	}
	if status != common.ChannelStatusEnabled {
		// delete the channel from group2model2channels
		for group, model2channels := range group2model2channels {
			for model, channels := range model2channels {
				for i, channelId := range channels {
					if channelId == id {
						// remove the channel from the slice
						group2model2channels[group][model] = append(channels[:i], channels[i+1:]...)
						break
					}
				}
			}
		}
	}
}

func CacheUpdateChannel(channel *Channel) {
	if !common.MemoryCacheEnabled {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	if channel == nil {
		return
	}

	println("CacheUpdateChannel:", channel.Id, channel.Name, channel.Status, channel.ChannelInfo.MultiKeyPollingIndex)

	println("before:", channelsIDM[channel.Id].ChannelInfo.MultiKeyPollingIndex)
	channelsIDM[channel.Id] = channel
	println("after :", channelsIDM[channel.Id].ChannelInfo.MultiKeyPollingIndex)
}
