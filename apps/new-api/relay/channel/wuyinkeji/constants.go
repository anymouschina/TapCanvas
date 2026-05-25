package wuyinkeji

import taskwuyinkeji "github.com/QuantumNous/new-api/relay/channel/task/wuyinkeji"

// ChannelName mirrors the task adaptor identifier so log/admin UI entries stay
// consistent across the sync and task paths of the same upstream vendor.
const ChannelName = taskwuyinkeji.ChannelName

// ModelList enumerates models served by this synchronous adaptor. Video models
// remain on the task path and are intentionally absent here.
var ModelList = taskwuyinkeji.ImageModels()
