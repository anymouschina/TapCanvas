package ali

var ModelList = []string{
	"qwen-turbo",
	"qwen-plus",
	"qwen-max",
	"qwen-max-longcontext",
	"qwq-32b",
	"qwen3-235b-a22b",
	"text-embedding-v1",
	"text-embedding-v4",
	"gte-rerank-v2",
	// 通义千问图像生成/编辑（同步图像模型，详见 setting/model_setting/qwen.go SyncImageModels）
	"qwen-image-2.0-pro",
	"qwen-image-2.0",
	"qwen-image-edit-max",
	"qwen-image-edit-plus",
	"qwen-image-edit",
}

var ChannelName = "ali"
