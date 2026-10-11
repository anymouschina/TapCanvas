package controller

import (
	"fmt"
	"reflect"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// Validate the distribution receipt against the current pool immediately before
// dispatch. Locks cover only the local read, never the upstream request.
func validateSelectedCredential(c *gin.Context, selected *model.Channel) (*model.Channel, *types.NewAPIError) {
	lock := model.GetChannelPollingLock(selected.Id)
	lock.Lock()
	defer lock.Unlock()
	current, err := model.GetChannelById(selected.Id, true)
	if err != nil || current == nil {
		return nil, types.NewError(fmt.Errorf("reload selected channel #%d before dispatch: %v", selected.Id, err), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if current.Status != common.ChannelStatusEnabled {
		return nil, types.NewError(fmt.Errorf("selected channel #%d is no longer enabled; request was not submitted", current.Id), types.ErrorCodeChannelNoAvailableKey, types.ErrOptionWithSkipRetry())
	}
	settings, hasSettings := common.GetContextKeyType[dto.ChannelSettings](c, constant.ContextKeyChannelSetting)
	binding, hasBinding := common.GetContextKeyType[dto.ProtocolBinding](c, constant.ContextKeyChannelProtocolBinding)
	resolved, resolveErr := current.ResolveProtocol(c.GetString("original_model"))
	if current.Type != common.GetContextKeyInt(c, constant.ContextKeyChannelType) ||
		current.GetBaseURL() != common.GetContextKeyString(c, constant.ContextKeyChannelBaseUrl) ||
		current.ChannelInfo.IsMultiKey != common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey) ||
		resolveErr != nil || !hasSettings || !hasBinding || !reflect.DeepEqual(resolved.ChannelSetting, settings) || !reflect.DeepEqual(resolved.Binding, binding) {
		return nil, types.NewError(fmt.Errorf("selected channel #%d configuration changed before dispatch; request was not submitted", current.Id), types.ErrorCodeChannelProtocolInvalid, types.ErrOptionWithSkipRetry())
	}
	key := common.GetContextKeyString(c, constant.ContextKeyChannelKey)
	if !current.ChannelInfo.IsMultiKey {
		if current.Key != key {
			return nil, types.NewError(fmt.Errorf("selected channel #%d credential changed before dispatch; request was not submitted", current.Id), types.ErrorCodeChannelNoAvailableKey, types.ErrOptionWithSkipRetry())
		}
		return current, nil
	}

	for index, currentKey := range current.GetKeys() {
		if currentKey != key {
			continue
		}
		status, exists := current.ChannelInfo.MultiKeyStatusList[index]
		if exists && status != common.ChannelStatusEnabled {
			break
		}
		common.SetContextKey(c, constant.ContextKeyChannelMultiKeyIndex, index)
		common.SetContextKey(c, constant.ContextKeyChannelIsMultiKey, current.ChannelInfo.IsMultiKey)
		return current, nil
	}
	return nil, types.NewError(fmt.Errorf("selected account in channel #%d was removed or disabled before dispatch; request was not submitted", current.Id), types.ErrorCodeChannelNoAvailableKey, types.ErrOptionWithSkipRetry())
}
