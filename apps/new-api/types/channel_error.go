package types

type ChannelError struct {
	ChannelId   int    `json:"channel_id"`
	ChannelType int    `json:"channel_type"`
	ChannelName string `json:"channel_name"`
	IsMultiKey  bool   `json:"is_multi_key"`
	AutoBan     bool   `json:"auto_ban"`
	UsingKey    string `json:"using_key"`
	// KeyIndex is the selected account index when the relay has one. It is
	// optional because older callers may only have the raw credential string.
	// A stable index prevents a refreshed OAuth JSON line from being attributed
	// to account 0 when an in-flight request reports an error.
	KeyIndex *int `json:"key_index,omitempty"`
}

func NewChannelError(channelId int, channelType int, channelName string, isMultiKey bool, usingKey string, autoBan bool) *ChannelError {
	return &ChannelError{
		ChannelId:   channelId,
		ChannelType: channelType,
		ChannelName: channelName,
		IsMultiKey:  isMultiKey,
		AutoBan:     autoBan,
		UsingKey:    usingKey,
	}
}

func NewChannelErrorWithKeyIndex(channelId int, channelType int, channelName string, isMultiKey bool, usingKey string, autoBan bool, keyIndex int) *ChannelError {
	channelError := NewChannelError(channelId, channelType, channelName, isMultiKey, usingKey, autoBan)
	channelError.KeyIndex = &keyIndex
	return channelError
}
