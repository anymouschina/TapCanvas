package model

import (
	"crypto/sha256"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// RestoreAutoDisabledMultiKey resumes scheduling only when an account is
// enabled. A channel explicitly disabled by its administrator stays disabled.
func (channel *Channel) RestoreAutoDisabledMultiKey() bool {
	if !channel.ChannelInfo.IsMultiKey || channel.Status != common.ChannelStatusAutoDisabled {
		return false
	}
	if !channel.hasEnabledMultiKey() {
		return false
	}
	channel.Status = common.ChannelStatusEnabled
	info := channel.GetOtherInfo()
	delete(info, "status_reason")
	delete(info, "status_time")
	channel.SetOtherInfo(info)
	return true
}

func (channel *Channel) hasEnabledMultiKey() bool {
	for index, key := range channel.GetKeys() {
		status, exists := channel.ChannelInfo.MultiKeyStatusList[index]
		if strings.TrimSpace(key) != "" && (!exists || status == common.ChannelStatusEnabled) {
			return true
		}
	}
	return false
}

// RetainMultiKeys applies the same index mapping to every per-account field.
// Callers hold the channel polling lock while editing and persisting the pool.
func (channel *Channel) RetainMultiKeys(indices []int) {
	keys := channel.GetKeys()
	remaining := make([]string, 0, len(indices))
	info := &channel.ChannelInfo
	remapMultiKeyMetadata(info, indices)
	for _, index := range indices {
		remaining = append(remaining, keys[index])
	}
	channel.Key = strings.Join(remaining, "\n")
	channel.Keys = nil
	info.MultiKeySize = len(remaining)
	info.MultiKeyPollingIndex = 0
}

// ReconcileMultiKeyMetadata retains per-account data only for the same
// credential. New credentials cannot inherit a removed account's old index.
// Callers hold the polling lock and supply keys read before the mutation.
func (channel *Channel) ReconcileMultiKeyMetadata(previousKeys []string) {
	channel.Keys = nil
	nextKeys := channel.GetKeys()
	previousIndices := make(map[string][]int, len(previousKeys))
	for index, key := range previousKeys {
		identity := strings.TrimSpace(key)
		previousIndices[identity] = append(previousIndices[identity], index)
	}
	indices := make([]int, len(nextKeys))
	for index, key := range nextKeys {
		indices[index] = -1
		identity := strings.TrimSpace(key)
		matches := previousIndices[identity]
		if len(matches) > 0 {
			indices[index] = matches[0]
			previousIndices[identity] = matches[1:]
		}
	}
	oldPollingIndex := channel.ChannelInfo.MultiKeyPollingIndex
	channel.ChannelInfo.MultiKeyPollingIndex = 0
	for index, oldIndex := range indices {
		if oldIndex == oldPollingIndex {
			channel.ChannelInfo.MultiKeyPollingIndex = index
			break
		}
	}
	remapMultiKeyMetadata(&channel.ChannelInfo, indices)
	channel.ChannelInfo.MultiKeySize = len(nextKeys)
}

func remapMultiKeyMetadata(info *ChannelInfo, indices []int) {
	info.MultiKeyStatusList = retainKeyMetadata(info.MultiKeyStatusList, indices)
	info.MultiKeyDisabledTime = retainKeyMetadata(info.MultiKeyDisabledTime, indices)
	info.MultiKeyDisabledReason = retainKeyMetadata(info.MultiKeyDisabledReason, indices)
	info.MultiKeyCooldownUntil = retainKeyMetadata(info.MultiKeyCooldownUntil, indices)
	info.MultiKeyUsage = retainKeyMetadata(info.MultiKeyUsage, indices)
	info.MultiKeyEmail = retainKeyMetadata(info.MultiKeyEmail, indices)
}

func retainKeyMetadata[T int | int64 | string | ChannelKeyUsage](source map[int]T, indices []int) map[int]T {
	retained := make(map[int]T, len(source))
	for nextIndex, previousIndex := range indices {
		if previousIndex < 0 {
			continue
		}
		if value, exists := source[previousIndex]; exists {
			retained[nextIndex] = value
		}
	}
	return retained
}

// ChannelKeyIdentity is request-local credential identity, independent of account positions.
type ChannelKeyIdentity [32]byte

func IdentifyChannelKey(key string) ChannelKeyIdentity {
	return sha256.Sum256([]byte(strings.TrimSpace(key)))
}

func (channel *Channel) TriedKeyIndices(tried map[ChannelKeyIdentity]bool) map[int]bool {
	lock := GetChannelPollingLock(channel.Id)
	lock.Lock()
	defer lock.Unlock()
	excluded := make(map[int]bool, len(tried))
	for index, key := range channel.GetKeys() {
		if tried[IdentifyChannelKey(key)] {
			excluded[index] = true
		}
	}
	return excluded
}
