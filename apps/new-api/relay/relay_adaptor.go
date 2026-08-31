package relay

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/ali"
	"github.com/QuantumNous/new-api/relay/channel/amux"
	"github.com/QuantumNous/new-api/relay/channel/apimart"
	"github.com/QuantumNous/new-api/relay/channel/aws"
	"github.com/QuantumNous/new-api/relay/channel/baidu"
	"github.com/QuantumNous/new-api/relay/channel/baidu_v2"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/cloudflare"
	"github.com/QuantumNous/new-api/relay/channel/code0ai"
	"github.com/QuantumNous/new-api/relay/channel/codex"
	"github.com/QuantumNous/new-api/relay/channel/cohere"
	"github.com/QuantumNous/new-api/relay/channel/coze"
	"github.com/QuantumNous/new-api/relay/channel/deepseek"
	"github.com/QuantumNous/new-api/relay/channel/dify"
	"github.com/QuantumNous/new-api/relay/channel/evolink"
	"github.com/QuantumNous/new-api/relay/channel/gemini"
	"github.com/QuantumNous/new-api/relay/channel/jimeng"
	"github.com/QuantumNous/new-api/relay/channel/jina"
	"github.com/QuantumNous/new-api/relay/channel/kiro"
	"github.com/QuantumNous/new-api/relay/channel/lingjing"
	"github.com/QuantumNous/new-api/relay/channel/magic666"
	"github.com/QuantumNous/new-api/relay/channel/minimax"
	"github.com/QuantumNous/new-api/relay/channel/mistral"
	"github.com/QuantumNous/new-api/relay/channel/mokaai"
	"github.com/QuantumNous/new-api/relay/channel/moonshot"
	"github.com/QuantumNous/new-api/relay/channel/ollama"
	"github.com/QuantumNous/new-api/relay/channel/onefourseven"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	"github.com/QuantumNous/new-api/relay/channel/palm"
	"github.com/QuantumNous/new-api/relay/channel/perplexity"
	"github.com/QuantumNous/new-api/relay/channel/replicate"
	"github.com/QuantumNous/new-api/relay/channel/rightcode"
	"github.com/QuantumNous/new-api/relay/channel/runninghub"
	"github.com/QuantumNous/new-api/relay/channel/siliconflow"
	"github.com/QuantumNous/new-api/relay/channel/submodel"
	taskali "github.com/QuantumNous/new-api/relay/channel/task/ali"
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	taskdoubao "github.com/QuantumNous/new-api/relay/channel/task/doubao"
	taskevolink "github.com/QuantumNous/new-api/relay/channel/task/evolink"
	taskfunai "github.com/QuantumNous/new-api/relay/channel/task/funai"
	taskGemini "github.com/QuantumNous/new-api/relay/channel/task/gemini"
	"github.com/QuantumNous/new-api/relay/channel/task/hailuo"
	taskjimeng "github.com/QuantumNous/new-api/relay/channel/task/jimeng"
	"github.com/QuantumNous/new-api/relay/channel/task/kling"
	taskmagic666 "github.com/QuantumNous/new-api/relay/channel/task/magic666"
	taskmegaby "github.com/QuantumNous/new-api/relay/channel/task/megaby"
	tasksora "github.com/QuantumNous/new-api/relay/channel/task/sora"
	"github.com/QuantumNous/new-api/relay/channel/task/suno"
	taskvertex "github.com/QuantumNous/new-api/relay/channel/task/vertex"
	taskVidu "github.com/QuantumNous/new-api/relay/channel/task/vidu"
	taskvolcmediakit "github.com/QuantumNous/new-api/relay/channel/task/volcmediakit"
	taskwuyinkeji "github.com/QuantumNous/new-api/relay/channel/task/wuyinkeji"
	"github.com/QuantumNous/new-api/relay/channel/tencent"
	"github.com/QuantumNous/new-api/relay/channel/vertex"
	"github.com/QuantumNous/new-api/relay/channel/volcengine"
	"github.com/QuantumNous/new-api/relay/channel/wuyinkeji"
	"github.com/QuantumNous/new-api/relay/channel/xai"
	"github.com/QuantumNous/new-api/relay/channel/xunfei"
	"github.com/QuantumNous/new-api/relay/channel/zhipu"
	"github.com/QuantumNous/new-api/relay/channel/zhipu_4v"
	"github.com/gin-gonic/gin"
)

func GetAdaptor(apiType int) channel.Adaptor {
	switch apiType {
	case constant.APITypeAli:
		return &ali.Adaptor{}
	case constant.APITypeAnthropic:
		return &claude.Adaptor{}
	case constant.APITypeBaidu:
		return &baidu.Adaptor{}
	case constant.APITypeGemini:
		return &gemini.Adaptor{}
	case constant.APITypeOpenAI:
		return &openai.Adaptor{}
	case constant.APITypePaLM:
		return &palm.Adaptor{}
	case constant.APITypeTencent:
		return &tencent.Adaptor{}
	case constant.APITypeXunfei:
		return &xunfei.Adaptor{}
	case constant.APITypeZhipu:
		return &zhipu.Adaptor{}
	case constant.APITypeZhipuV4:
		return &zhipu_4v.Adaptor{}
	case constant.APITypeOllama:
		return &ollama.Adaptor{}
	case constant.APITypePerplexity:
		return &perplexity.Adaptor{}
	case constant.APITypeAws:
		return &aws.Adaptor{}
	case constant.APITypeCohere:
		return &cohere.Adaptor{}
	case constant.APITypeDify:
		return &dify.Adaptor{}
	case constant.APITypeJina:
		return &jina.Adaptor{}
	case constant.APITypeCloudflare:
		return &cloudflare.Adaptor{}
	case constant.APITypeSiliconFlow:
		return &siliconflow.Adaptor{}
	case constant.APITypeVertexAi:
		return &vertex.Adaptor{}
	case constant.APITypeMistral:
		return &mistral.Adaptor{}
	case constant.APITypeDeepSeek:
		return &deepseek.Adaptor{}
	case constant.APITypeMokaAI:
		return &mokaai.Adaptor{}
	case constant.APITypeVolcEngine:
		return &volcengine.Adaptor{}
	case constant.APITypeBaiduV2:
		return &baidu_v2.Adaptor{}
	case constant.APITypeOpenRouter:
		return &openai.Adaptor{}
	case constant.APITypeXinference:
		return &openai.Adaptor{}
	case constant.APITypeXai:
		return &xai.Adaptor{}
	case constant.APITypeCoze:
		return &coze.Adaptor{}
	case constant.APITypeJimeng:
		return &jimeng.Adaptor{}
	case constant.APITypeMoonshot:
		return &moonshot.Adaptor{} // Moonshot uses Claude API
	case constant.APITypeSubmodel:
		return &submodel.Adaptor{}
	case constant.APITypeMiniMax:
		return &minimax.Adaptor{}
	case constant.APITypeReplicate:
		return &replicate.Adaptor{}
	case constant.APITypeCodex:
		return &codex.Adaptor{}
	case constant.APITypeWuyinkeji:
		return &wuyinkeji.Adaptor{}
	case constant.APITypeApimart:
		return &apimart.Adaptor{}
	case constant.APITypeRightCode:
		return &rightcode.Adaptor{}
	case constant.APITypeMagic666:
		return &magic666.Adaptor{}
	case constant.APIType147AI:
		return &onefourseven.Adaptor{}
	case constant.APITypeAmux:
		return &amux.Adaptor{}
	case constant.APITypeCode0AI:
		return &code0ai.Adaptor{}
	case constant.APITypeLingjing:
		return &lingjing.Adaptor{}
	case constant.APITypeEvolink:
		return &evolink.Adaptor{}
	case constant.APITypeRunningHub:
		return &runninghub.Adaptor{}
	case constant.APITypeKiro:
		return &kiro.Adaptor{}
	case constant.APITypeFlow2API:
		return &openai.Adaptor{}
	}
	return nil
}

func GetTaskPlatform(c *gin.Context) constant.TaskPlatform {
	protocol, ok := common.GetContextKeyType[constant.ProtocolDefinition](c, constant.ContextKeyChannelProtocol)
	if !ok || protocol.Transport != constant.ProtocolTransportTask {
		return ""
	}
	return protocol.TaskPlatform
}

func GetTaskAdaptor(platform constant.TaskPlatform) channel.TaskAdaptor {
	switch platform {
	//case constant.APITypeAIProxyLibrary:
	//	return &aiproxy.Adaptor{}
	case constant.TaskPlatformSuno:
		return &suno.TaskAdaptor{}
	case constant.TaskPlatformAli:
		return &taskali.TaskAdaptor{}
	case constant.TaskPlatformKling:
		return &kling.TaskAdaptor{}
	case constant.TaskPlatformJimeng:
		return &taskjimeng.TaskAdaptor{}
	case constant.TaskPlatformVertex:
		return &taskvertex.TaskAdaptor{}
	case constant.TaskPlatformVidu:
		return &taskVidu.TaskAdaptor{}
	case constant.TaskPlatformDoubao:
		return &taskdoubao.TaskAdaptor{}
	case constant.TaskPlatformSora:
		return &tasksora.TaskAdaptor{}
	case constant.TaskPlatformGemini:
		return &taskGemini.TaskAdaptor{}
	case constant.TaskPlatformMiniMax:
		return &hailuo.TaskAdaptor{}
	case constant.TaskPlatformMiniMaxV2:
		return &hailuo.V2TaskAdaptor{}
	case constant.TaskPlatformWuyinkeji:
		return &taskwuyinkeji.TaskAdaptor{}
	case constant.TaskPlatformAPIMart:
		return &taskapimart.TaskAdaptor{}
	case constant.TaskPlatformEvolink:
		return &taskevolink.TaskAdaptor{}
	case constant.TaskPlatformFunAI:
		return &taskfunai.TaskAdaptor{}
	case constant.TaskPlatformMegaby:
		return &taskmegaby.TaskAdaptor{}
	case constant.TaskPlatformMagic666:
		return &taskmagic666.TaskAdaptor{}
	case constant.TaskPlatformMediaKit:
		return &taskvolcmediakit.TaskAdaptor{}
	}
	return nil
}
