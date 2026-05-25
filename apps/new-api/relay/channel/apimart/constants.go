package apimart

import taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"

// ChannelName mirrors the task adaptor identifier so log/admin UI entries stay
// consistent across the sync and task paths.
const ChannelName = taskapimart.ChannelName

// syncModels enumerates the chat / audio models served synchronously through
// POST /v1/chat/completions, /v1/audio/*. Keep aligned with the SQL patch in
// apps/new-api/patches/2026-04-22/008-add-apimart-channel.sql.
var syncModels = []string{
	"gemini-2.5-pro", // Gemini 新版 chat 主力
}

// ModelList is the admin-UI default set for this channel. Combines sync
// (chat/audio) and async (image/video) sets from the task package.
var ModelList = append(append([]string{}, syncModels...), taskapimart.AllAsyncModels()...)
