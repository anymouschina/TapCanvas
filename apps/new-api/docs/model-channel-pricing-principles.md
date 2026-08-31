# new-api 原理说明：从新增渠道/模型，到请求解析、路由分发与计价结算

这份文档面向工程阅读，目标是用当前仓库里的真实实现，解释 `apps/new-api` 里一条 AI 请求是如何从“后台新增渠道与模型配置”一路走到“被解析、路由、转发并扣费”的。

本文不讨论部署、运营后台界面细节，也不描述理想架构；只描述当前代码的真实工作方式。

## 1. 系统本质

`new-api` 本质上是一个统一 AI 网关，做了五层事情：

1. 提供统一的外部 API 入口，兼容多种协议和模型类型。
2. 根据 token、group、模型名和 channel 能力，给请求选一个实际可用的上游渠道。
3. 在选中的渠道上解析该模型显式绑定的上游协议。
4. 将统一请求格式转换成该协议所需的上游请求格式。
5. 按模型配置和用户分组倍率统一预扣费、结算、退款。

代码层的主链路可以先看这几处：

- 路由入口：[router/relay-router.go](../router/relay-router.go)
- 请求分发：[middleware/distributor.go](../middleware/distributor.go)
- 统一 relay 主流程：[controller/relay.go](../controller/relay.go)
- 价格计算：[relay/helper/price.go](../relay/helper/price.go)
- 文本结算：[service/text_quota.go](../service/text_quota.go)
- 统一预扣费与结算会话：[service/billing_session.go](../service/billing_session.go)

## 2. 新增渠道与模型时，系统实际在配置什么

### 2.1 Channel 是“上游连接定义”

后台新增渠道的 API 在 [router/api-router.go](../router/api-router.go)：

- `POST /api/channel/` -> [controller.AddChannel](../controller/channel.go)
- `PUT /api/channel/` -> [controller.UpdateChannel](../controller/channel.go)
- `POST /api/channel/fetch_models` -> [controller.FetchModels](../controller/channel.go)

新增渠道的请求结构见 [controller/channel.go](../controller/channel.go) 中的 `AddChannelRequest`。它的核心是一个 `channel` 对象，里面通常包含：

- `type`: 商业渠道/账号类型，决定凭据、连接和供应商运维语义。
- `base_url`: 上游请求地址。
- `key`: 上游 API key 或多 key 配置。
- `group`: 这个 channel 属于哪些逻辑分组。
- `models`: 这个 channel 声明自己支持哪些模型名。
- `priority` / `weight`: 选路优先级和加权随机参数。
- `model_mapping`: 用户请求模型名和上游真实模型名的映射表。

其中 `type` 只表达商业渠道/账号类型及其连接、鉴权和运维语义，不再决定上游 wire protocol。一个 OpenAI 类型渠道可以给不同模型绑定 OpenAI、Anthropic 或 task 协议；运行时禁止从 `Channel.Type` 推断协议。

`AddChannel` 与 `UpdateChannel` 都会校验显式协议配置，在保存后刷新 channel cache，并最终影响请求分发：

- [controller/channel.go](../controller/channel.go)
- [model/channel_cache.go](../model/channel_cache.go)

渠道记录与 Ability 展开在同一数据库事务中写入；新增、编辑、删除、标签批量修改与停用渠道清理都不会再留下半更新或孤立 Ability。事务提交后再重建内存 channel cache 与模型/定价缓存，两个缓存都会各自尝试刷新；若任一查询失败，API 会返回“数据库变更已保存，但运行时缓存刷新失败”的部分成功状态，不会继续宣称普通成功。OAuth 凭据与多密钥管理同样向调用方暴露缓存刷新失败；后台任务无法直接响应用户时会记录可检索错误。服务启动时缓存构建失败会直接终止，不再捕获异常后自动清空并重建 Ability 表，也不再保留只记日志、吞掉错误的 `InitChannelCache` 双轨入口。

### 2.2 Protocol binding 是“该模型在这个渠道上说哪种协议”

协议目录只有一个真源：[constant/protocol.go](../constant/protocol.go)。每个注册项声明：

- 稳定协议 ID、名称与 family。
- `relay`、`task` 或 `native` transport。
- 支持公开的 endpoint 类型。
- 是否支持 stream options。
- 内部 adaptor 所需的 API type 或 task platform。
- `recommended_channel_types`，仅用于控制台排序提示，不参与运行时决策。
- 来自该协议真实 adaptor 的模型建议列表；它只辅助录入，不限制管理员填写新模型。

协议目录只允许公开可执行项。服务启动和控制台目录生成都会验证 relay adaptor、task adaptor 或 native handler 是否真实存在；缺失实现会显式失败，不能以空模型列表伪装成可用协议。

异步任务 adaptor 也使用稳定的语义化 `TaskPlatform`，不再把渠道类型数字当作 adaptor key。任务平台由 protocol registry 决定并写入任务记录；增加商业渠道不会迫使任务协议复制一套渠道类型分支。OpenRouter 的请求转换、响应封装与缓存计费等 wire semantics 同样只读取 `ProtocolID`，把 OpenRouter 商业渠道改绑为普通 OpenAI 协议时不会继续暗中套用 OpenRouter 规则。

绑定结果复用现有 `channels.setting` JSON，不新增数据库列：

```json
{
  "default_protocol": {
    "protocol": "openai",
    "options": {}
  },
  "model_protocols": {
    "claude-opus-4": {
      "protocol": "anthropic",
      "options": {}
    },
    "sora-2": {
      "protocol": "task.openai-video"
    }
  }
}
```

`default_protocol` 是渠道默认协议；`model_protocols` 是按模型覆盖。`options` 只允许保存协议目录声明的协议级事实；凭据、Base URL 和连接配置仍归 channel 管理。当前目录会按需声明 Azure/Gemini API version、Anthropic version header、Vertex region 等参数，控制台根据同一份 schema 动态渲染，不维护第二套参数表。

提交时，未声明参数、空参数、重复参数和缺失的必填参数都会明确失败。运行时 adaptor 直接读取已校验 binding options；它们不是只存不生效的备注字段。模型级更新只定点改写 `model_protocols`，会原样保留 `channel.setting` 中其它模型、未来版本和插件写入的未知 JSON 字段。

解析实现在 [model/channel_protocol.go](../model/channel_protocol.go)，顺序固定为：

1. 精确或规范化模型键命中的 `model_protocols`。
2. 渠道的 `default_protocol`。
3. 两者都不存在时明确失败。

没有 `Channel.Type -> APIType` 兼容映射，也没有默认协议或隐式降级。管理员写入新配置时，每个已声明模型都必须能解析协议，且陈旧的模型覆盖会被拒绝。运行时遇到历史 SQL 或旧渠道留下的无协议绑定时，只记录兼容性 warning 并跳过该绑定；如果模型没有任何可执行端点，则不发布到公开定价目录，避免阻断 schema 初始化或把空端点暴露给文档。模型控制台的按渠道覆盖允许逐模型迁移旧渠道，但未迁移模型在真正路由时仍会明确失败。

管理员控制面与运行时共用同一份目录和解析器：

- `GET /api/models/protocols`：返回动态协议目录，控制台不得写死候选协议。
- `PUT /api/models/:id/protocols`：以 `inherit` 或 `override` 原子更新该模型在多个已绑定渠道上的决策。
- `GET /api/models/:id`：`bound_channels` 会返回默认 binding、模型覆盖、生效协议、来源、transport 与解析错误。

`inherit` 只在渠道存在 `default_protocol` 时有效；`override` 只修改当前模型，不会复制渠道或改动凭据。

模型协议页会列出已启用和已停用的绑定渠道，并分别展示渠道停用、Ability 路由停用和协议配置错误，避免失效绑定因为被过滤而无法修复。模型名称是 Ability、protocol binding 与定价 map 共用的稳定键，因此创建后不可重命名；需要新名称时应新建模型并显式配置。

模型详情把持久化的 `endpoints`（管理员显式覆盖）与 `effective_endpoints`（协议和运行时配置推导结果）分开返回。读取详情或修改其它元数据不会再把动态端点快照写回 `endpoints`。

### 2.3 Ability 是“某个 group 下某个模型可否走某个 channel”的展开结果

系统运行时真正依赖的不是 `channel.Models` 字符串本身，而是 `abilities` 表。

数据结构在 [model/ability.go](../model/ability.go)：

- `group`
- `model`
- `channel_id`
- `enabled`
- `priority`
- `weight`

当一个 channel 被新增或更新时，系统会把：

- `channel.Group`
- `channel.Models`

做组合展开，写成多条 `Ability` 记录。具体逻辑在：

- [model.Channel.AddAbilities](../model/ability.go)
- [model.Channel.UpdateAbilities](../model/ability.go)

例如一个 channel 配了：

```text
group = default,vip
models = gpt-4o,gpt-4.1-mini
```

就会展开成四条能力：

- `default + gpt-4o + channel_id`
- `default + gpt-4.1-mini + channel_id`
- `vip + gpt-4o + channel_id`
- `vip + gpt-4.1-mini + channel_id`

后面的请求分发本质上就是在这些能力里找“符合当前用户 group 和模型名的 channel”。

### 2.4 FetchModels 只是辅助填模型，不参与运行时决策

后台提供了 `FetchModels` 接口去从上游抓取模型列表，代码在 [controller/channel.go](../controller/channel.go)。

它做的事情是：

1. 根据 `type` 和 `base_url` 组装请求。
2. 调上游的 `/v1/models` 或 provider 特定接口。
3. 返回模型名列表给后台界面使用。

它的作用是“辅助配置”，而不是运行时动态发现模型。真正运行时是否能路由某个模型，依赖的仍然是 `abilities` 和当前 channel cache。

控制台模型候选只读取协议注册表、系统模型目录或上游真实发现结果。标签批量编辑器不再按渠道数字维护 Midjourney、Suno 等硬编码列表，也不再从 `localStorage` 静默恢复旧候选；目录加载失败会展示真实错误并锁定保存。管理员仍可显式创建自定义模型名，因此新模型录入不要求先发布前端版本。

## 3. 一个请求进入系统后的完整主流程

### 3.1 统一入口：路由先按入站格式和资源类型分类

统一 relay 路由定义在 [router/relay-router.go](../router/relay-router.go)。

典型入口包括：

- `/v1/chat/completions`
- `/v1/completions`
- `/v1/responses`
- `/v1/images/generations`
- `/v1/audio/*`
- `/v1/embeddings`
- `/v1beta/models/*`（Gemini）
- `/mj/*`（Midjourney）
- `/suno/*`
- `/v1/videos` 与 `/v1/video/generations`

这些入口最终都会先走：

1. `TokenAuth()`
2. `ModelRequestRateLimit()`
3. `Distribute()`

然后才进入 [controller.Relay](../controller/relay.go) 或 [controller.RelayTask](../controller/relay.go)。

这里识别的是客户端请求进入网关时使用的格式。它不等于选中渠道后的上游协议：上游协议必须等选路完成后，从该渠道对当前模型的显式 protocol binding 中解析。

### 3.2 Distribute：先从请求里取出模型名，再决定选哪个 channel

`Distribute()` 在 [middleware/distributor.go](../middleware/distributor.go)。

它做三件事：

1. 从请求路径和 body 中提取出当前请求的 `model`。
2. 校验 token 是否允许访问这个模型。
3. 为这次请求选择一个实际 channel，并把 channel 的上下文写入 gin context。

#### 模型名提取不是只看 JSON body

`getModelRequest()` 在 [middleware/distributor.go](../middleware/distributor.go) 中处理了很多特殊路径：

- 普通 OpenAI 兼容请求：从 body 中读 `model`
- Gemini 路径：从 `/v1beta/models/{model}:{action}` 中提取模型名
- 图片接口：提供默认模型，例如 `dall-e`
- 音频接口：提供默认模型，例如 `tts-1`、`whisper-1`
- Moderations / Embeddings / Realtime：从不同位置兜底取模型名
- `responses/compact`：会先在模型名后追加 compact 后缀

这一步的目标不是做上游协议转换，而是先统一得到一个“当前用户想调用的逻辑模型名”。

#### 选 channel 时真正依据的是 ability + group + retry 状态

`Distribute()` 拿到模型名后，会：

1. 检查 token 的模型白名单限制。
2. 如果存在 channel affinity，优先复用历史命中的 channel。
3. 否则调用 [service.CacheGetRandomSatisfiedChannel](../service/channel_select.go) 随机选一个满足条件的 channel。

选 channel 的核心依据是：

- 当前 token 使用的 group
- 当前请求的模型名
- `abilities` 中是否存在 `group + model + channel_id`
- priority
- weight
- auto-group / cross-group retry 状态

具体实现可看：

- [middleware/distributor.go](../middleware/distributor.go)
- [service/channel_select.go](../service/channel_select.go)
- [model/ability.go](../model/ability.go)
- [model/channel_satisfy.go](../model/channel_satisfy.go)

#### auto group 不是单独一条路，而是“跨 group 逐个尝试”

当 token group 是 `auto` 时，`CacheGetRandomSatisfiedChannel()` 会：

1. 取出当前用户可用的 auto groups。
2. 先在第一个 group 内按 priority 尝试。
3. 当前 group 用尽后，再切到下一个 group。

这解释了为什么同一个模型在不同 group 下可以绑定不同 channel，而 `auto` 组仍然能工作。

### 3.3 SetupContextForSelectedChannel：把选中的 channel 环境注入上下文

选中 channel 后，`SetupContextForSelectedChannel()` 会把后续转发所需的元信息都写进 context，见 [middleware/distributor.go](../middleware/distributor.go)。

这里会注入：

- `channel_id`
- `channel_name`
- `channel_type`
- `channel_protocol`
- `channel_protocol_binding`
- `channel_key`
- `channel_base_url`
- `model_mapping`
- `status_code_mapping`
- 组织、区域、版本号等 provider 特定参数

如果协议缺失、ID 未注册或配置 JSON 非法，请求会以不可重试的渠道协议错误结束，不会尝试从 `channel_type` 猜测。成功后，本次请求才同时绑定到一个确定的实际上游 channel 和一个确定的协议定义。

## 4. 请求体是怎么被解析成统一内部请求对象的

真正进入 relay 主流程后，`controller.Relay()` 会先调用：

- [helper.GetAndValidateRequest](../relay/helper/valid_request.go)

这一步会根据 `RelayFormat` 把请求解析成统一的 DTO：

- OpenAI text -> `GeneralOpenAIRequest`
- Claude -> `ClaudeRequest`
- Gemini -> `GeminiRequest`
- Responses -> `OpenAIResponsesRequest`
- Image -> `ImageRequest`
- Audio -> `AudioRequest`
- Embedding -> `EmbeddingRequest`
- Rerank -> `RerankRequest`

这一步既做了解析，也做了最小必要校验，例如：

- `model` 是否存在
- `messages` / `input` 是否为空
- 图片尺寸是否合法
- 某些接口是否需要补默认值

也就是说，请求解析不是在 `Distribute()` 里完成的。`Distribute()` 只负责“先知道要找哪个模型”；真正结构化解析在 `GetAndValidateRequest()`。

## 5. RelayInfo：把一次请求压缩成统一运行时上下文

请求结构化后，`controller.Relay()` 会调用：

- [relaycommon.GenRelayInfo](../relay/common/relay_info.go)

`RelayInfo` 是一次 relay 请求的统一运行时上下文，里面会收敛：

- 用户信息
- token 信息
- 当前模型名
- 最终 channel
- 已校验的 protocol ID、transport 与 binding options
- 由协议目录提供的内部 API type 或 task platform
- relay mode
- price data
- retry 状态
- usage 信息
- 预扣费与结算状态

后续无论是文本、图片、音频还是 Gemini/Claude，都会围绕 `RelayInfo` 往下跑。`APIType`、stream capability、task platform 与价格页 endpoint 发布都来自同一个协议目录，不再分别维护渠道类型映射。Azure deployment URL 与 `api-key`、Cloudflare Gateway 路径、OpenRouter 请求语义、Gemini thought signature、Xinference rerank 响应、usage 后处理和协议内任务动作也都读取 `ProtocolID`；`Channel.Type` 只保留供应商账号、连接和运维能力。

## 6. model_mapping 在哪里生效

这是新增模型配置时最容易误解的点。

用户请求的模型名，不一定等于上游真实模型名。解决方式就是 channel 上的 `model_mapping`。

实际生效逻辑在：

- [relay/helper/model_mapped.go](../relay/helper/model_mapped.go)

它会做这些事：

1. 从 context 里读取当前 channel 的 `model_mapping` JSON。
2. 以 `OriginModelName` 为起点做映射。
3. 支持链式映射，例如 `a -> b -> c`，最终使用链尾。
4. 检测循环映射，避免死循环。
5. 把最终上游模型名写入 `info.UpstreamModelName`，并同步更新 request 的 `model` 字段。

这意味着：

- 用户侧模型名用于权限、路由、定价的第一阶段决策。
- 上游真正收到的模型名，可能在转发前被换成 channel 专属的名字。

这是“统一模型名入口”和“provider 差异适配”之间的关键隔离层。

## 7. 真正的转发发生在哪里

`controller.Relay()` 在完成解析、生成 `RelayInfo`、计算预扣费之后，会进入 retry 循环，并按 `relayFormat` 调对应 handler：

- 文本：`relay.TextHelper`
- Claude：`relay.ClaudeHelper`
- Gemini：`relay.GeminiHelper`
- Audio：`relay.AudioHelper`
- Image：`relay.ImageHelper`
- Embedding：`relay.EmbeddingHelper`
- Rerank：`relay.RerankHelper`
- Responses：`relay.ResponsesHelper`

代码入口在 [controller/relay.go](../controller/relay.go)。

这些 helper 再根据已解析的 protocol definition 进入对应 adaptor，把统一 DTO 转成具体上游格式。也就是说，真正的协议适配被压在 `relay/` 层；分发层只负责选 channel 并解析显式 binding，计费层也不再通过 `Channel.Type` 猜协议。

## 8. 计价的总原则：按模型名统一计价，而不是按 channel 成本计价

这是整个系统最重要的业务原则之一。

当前实现里，对用户收费主要取决于：

- `OriginModelName`
- 模型是否配置了 `model_price`
- 模型是否配置了 `model_ratio`
- `completion_ratio`
- `cache_ratio`
- `image_ratio`
- `audio_ratio`
- 当前 `group_ratio`
- 某些额外能力价格，如 web search / file search / image generation call

默认不按“最终走的是哪个 channel”来决定对用户收费。

换句话说，同一个逻辑模型名如果同时绑定了多个 channel：

- 路由会因为 priority / weight / affinity 选到不同 channel
- 但用户侧扣费公式一般不变

这点直接体现在 [relay/helper/price.go](../relay/helper/price.go) 和 [service/text_quota.go](../service/text_quota.go) 的公式里，里面读取的都是模型名和 group ratio，而不是 channel 采购成本。

## 9. 模型价格从哪里来

### 9.1 两套核心配置：`model_price` 与 `model_ratio`

价格配置主要在：

- [setting/ratio_setting/model_ratio.go](../setting/ratio_setting/model_ratio.go)

这里维护了两类默认表：

- `defaultModelPrice`
- `defaultModelRatio`

运行时通过 `InitRatioSettings()` 装载进内存 map。

### 9.2 `GetModelPrice()` 与 `GetModelRatio()` 的决策顺序

价格解析顺序大致是：

1. 先查 `model_price`
2. 没有显式价格时，再查 `model_ratio`
3. 两者都没有时：
   - 如果开启 `SelfUseModeEnabled`，允许用默认倍率兜底
   - 否则报“模型未定价”

具体逻辑见：

- [ratio_setting.GetModelPrice](../setting/ratio_setting/model_ratio.go)
- [ratio_setting.GetModelRatio](../setting/ratio_setting/model_ratio.go)
- [relay/helper/modelPriceNotConfiguredError](../relay/helper/price.go)

这就是为什么“只把模型名填进 channel”还不够。若该模型没有价格配置，普通用户是无法正常调用的。

### 9.3 控制台使用统一的模型定价策略

存储层仍复用现有八张 Option JSON map 与 `models.pricing_config`，因此不需要数据库迁移；模型控制台不再要求管理员手工同步维护内部倍率。统一契约实现在 [model/model_pricing_policy.go](../model/model_pricing_policy.go)，对外只暴露人类可读价格：

- `unconfigured`：清空该模型的基础价格。
- `per_token`：输入、输出、缓存读写、图片输入、音频输入/输出，单位均为 USD / 1M tokens。
- `per_request`：通过 `fixed_price + fixed_price_currency` 返回按次价格与明确币种；
  图片/视频模型的 `ModelPrice` 约定为 CNY / request，其他模型类型为 USD / request。
- `spec_pricing`：图片/视频最终规格售价，单位 CNY，支持固定规格价与按分辨率每秒价格。

`fixed_price_currency` 是强制契约，不允许前端根据数值或模型名猜测单位。更新按次价时，
请求必须原样携带币种，后端会根据模型元数据中的 `kind` 校验：图片/视频只能保存 CNY，
其他类型只能保存 USD。旧的 `fixed_price_usd` 字段已硬切移除，避免把媒体人民币基础价
错误展示成美元价格。

规格价不是一个隐藏在“按次计费”后的静态展示字段。管理接口会返回
`spec_pricing_source` 与当前真实生效的 `spec_pricing`：

- `model`：模型自己的 `models.pricing_config`。
- `system_default`：模型没有专属配置，当前实际使用代码内的系统默认媒体价表。
- `disabled`：管理员已显式关闭规格价。
- `none`：当前模型没有规格价。

控制台始终展示“关闭规格价 / 按规格固定价 / 分辨率 × 时长线性价”三种状态。
线性价公式为 `最终价 = 当前分辨率 cny_per_second × 实际 duration_seconds`。
当规格规则命中时，任务结算使用规格价；`per_request` 的基础值只参与预扣换算，
或在请求规格无法匹配时作为按次价格，并不代表所有视频时长都按同一个价格扣费。
线性规格中的 `cny_per_second` 只存在于 `param_pricing` 与规格结算链路，不能覆盖
按请求计量的 `ModelPrice`，避免把每秒费率错当成按次基础值。

为了使“关闭”具有确定语义，保存空 `spec_pricing` 时不会再把
`models.pricing_config` 清成空字符串，而会写入
`{"currency":"CNY","billing_mode":"disabled","specs":[]}`。运行时看到该标记后不会
继续回退到系统默认价表；模型专属配置缺少某个分辨率时也不会从默认价表偷偷补齐。

服务会把价格确定性换算为：

- `ModelPrice`
- `ModelRatio`
- `CompletionRatio`
- `CacheRatio`
- `CreateCacheRatio`
- `ImageRatio`
- `AudioRatio`
- `AudioCompletionRatio`

基础计费模式是互斥的。若旧数据同时存在 `ModelPrice` 与 `ModelRatio`，读取接口会返回冲突标记；下一次保存必须硬切为一个模式。缺字段、负数、非有限数字、规则模型定价、固定补全倍率冲突和无效规格配置都会明确失败。

### 9.4 定价写入是单事务、单次运行时刷新

管理员 API 定义在 [controller/model_meta.go](../controller/model_meta.go)：

- `GET /api/models/:id/pricing`：读取统一策略和诊断信息。
- `PUT /api/models/:id/pricing`：完整替换单模型基础价、派生倍率与规格价。
- `PUT /api/models/pricing`：可视化批量编辑器一次性完整替换八张价格 map。

单模型更新在同一数据库事务里锁定模型、写入全部 Option map 和 `pricing_config`；批量更新也在一个事务内写完八张 map。事务提交后才刷新运行时模型与定价缓存。模型定价页、高级 JSON 编辑器、上游价格同步和恢复默认倍率都走同一原子服务；任何一个 map 缺失、JSON 非法、值类型错误或持久化失败都会整次失败，不再把错误配置静默视为空对象，也不再由前端并发发送八个独立请求形成部分成功状态。

数据库事务与运行时缓存刷新是两个不可伪装成一个原子操作的事实阶段：若数据库已经提交、但缓存因持久化脏数据或查询失败而无法重建，管理 API 会明确返回“数据已保存，但运行时缓存刷新失败”的部分成功状态，不回滚或删除已经保存的数据，也不会继续返回普通成功。模型管理读取接口和公开定价接口同样会暴露刷新错误；服务启动时首次定价缓存构建失败则直接终止启动，避免带着旧缓存或空缓存运行。

通用 `PUT /api/option` 会拒绝对上述八个定价 key 的单项写入，并明确指向统一模型定价 API。这样即使新增了新的后台入口，也不能绕过互斥计费模式和单事务约束重新制造半更新状态。

## 10. 预扣费是怎么计算的

文本类请求在 `controller.Relay()` 中会调用：

- [helper.ModelPriceHelper](../relay/helper/price.go)

这一步会先决定当前模型属于哪种收费模式：

- `UsePrice = true`：按次 / 按固定价格计费
- `UsePrice = false`：按 token 倍率计费

然后它会结合：

- 当前模型名
- 用户 group / using group
- `group_ratio`
- `completion_ratio`
- `cache_ratio`
- `image_ratio`
- `audio_ratio`
- 请求估算 prompt tokens
- `max_tokens`

计算出一个 `PriceData`，其中最重要的是：

- `QuotaToPreConsume`
- `ModelPrice`
- `ModelRatio`
- `UsePrice`

文本请求的预扣费公式大致是：

### 按倍率时

```text
预扣额度 = 预估 token 数 * model_ratio * group_ratio
```

### 按固定价格时

```text
预扣额度 = model_price * QuotaPerUnit * group_ratio
```

这里的换算基准 `QuotaPerUnit` 定义在：

- [common/constants.go](../common/constants.go)

默认值是：

```go
QuotaPerUnit = 500 * 1000.0
```

它相当于系统内部“额度单位”和美元价格之间的换算比例。

## 11. 预扣费、结算、退款由 BillingSession 统一托管

`controller.Relay()` 计算出预扣额度后，会调用：

- [service.PreConsumeBilling](../service/billing.go)

后面实际由 `BillingSession` 接管：

- [service/billing_session.go](../service/billing_session.go)

它负责处理三件事：

1. 预扣费 `preConsume`
2. 成功后的实际结算 `Settle`
3. 失败后的退款 `Refund`

并且统一兼容两种资金来源：

- 钱包额度
- 订阅额度

系统还支持信任额度旁路：

- 用户额度充足时，某些钱包请求可以不实际预扣
- 订阅路径不允许这种旁路

这是为了让“请求发起时先冻结额度”和“请求结束后按实际 usage 校正额度”这两个过程统一起来。

## 12. 文本类请求的最终结算是怎么做的

上游响应回来后，文本相关请求最终会调用：

- [service.PostTextConsumeQuota](../service/text_quota.go)

这一步会基于上游返回的 usage 计算真实消费。核心计算在：

- [calculateTextQuotaSummary](../service/text_quota.go)

它会区分并累计：

- prompt tokens
- completion tokens
- cached tokens
- cache creation tokens
- image tokens
- audio tokens
- web search 次数
- file search 次数
- image generation call

然后按是否 `UsePrice` 走两种结算方式：

### 按倍率计费

```text
真实额度 =
  (prompt 部分
   + cache 加权部分
   + image token 加权部分
   + cache creation 加权部分
   + completion * completion_ratio)
  * model_ratio
  * group_ratio
  + 额外功能费用
```

### 按固定价格计费

```text
真实额度 =
  model_price * QuotaPerUnit * group_ratio
  + 额外功能费用
```

计算完成后会：

1. 更新用户已用额度
2. 更新 channel 已用额度
3. 调 `SettleBilling()` 修正预扣费与实际消费的差值
4. 记录日志

## 13. 图片、视频、任务类请求如何计费

任务类请求不走 `ModelPriceHelper()`，而是走：

- [helper.ModelPriceHelperPerCall](../relay/helper/price.go)

典型场景：

- Midjourney
- Suno
- 视频生成
- 其他异步 task 平台

这类请求的核心思路是：

1. 如果该模型配置了 `model_price`，按固定价格预扣和结算。
2. 如果没有固定价格，则退回到倍率模式，并给一个保守预扣额度。

具体入口可看：

- [relay/relay_task.go](../relay/relay_task.go)
- [relay/mjproxy_handler.go](../relay/mjproxy_handler.go)
- [service/task_billing.go](../service/task_billing.go)

## 14. `/api/pricing` 接口展示的不是 channel 成本，而是“用户可见模型定价视图”

价格页接口在：

- [controller/pricing.go](../controller/pricing.go)
- [model/pricing.go](../model/pricing.go)

它做的事情不是读取某个 channel 的采购价，而是：

1. 遍历当前所有启用的 abilities。
2. 为每条 ability 解析当前模型在对应 channel 上的显式协议。
3. 从协议目录汇总支持端点；协议非法或缺失的能力会记录错误并排除，绝不按渠道类型补猜。
4. 推导当前系统“有哪些模型处于启用状态”。
5. 为这些模型拼接元数据、供应商、支持端点、可用 group。
6. 返回过滤后的模型价格视图。

因此：

- 前台价格页是“逻辑模型视图”
- 不是“渠道成本明细视图”

这和运行时按模型统一计价的原则是一致的。

## 15. 新增模型时的最小正确操作

如果你只是给一个已支持的 provider 新增模型，最小正确步骤是：

1. 找到一个已有 channel，或新增一个 channel。
2. 把模型名加入该 channel 的 `models`。
3. 在 channel 设置默认协议，或在模型控制台为该 channel 建立模型级协议覆盖。
4. 如果用户侧模型名和上游不一致，补 `model_mapping`。
5. 确保该 channel 的 `group` 覆盖到目标用户组。
6. 在模型控制台选择单一计费模式并填写人类可读价格。
7. 必要时测试 `/api/channel/fetch_models`、channel test 和实际调用。

如果缺少第 3 步，请求会在选中 channel 后以渠道协议错误结束；如果缺少第 6 步，系统会在价格计算阶段直接报错。两者都不会被默认值掩盖。

## 16. 新增一个全新的 provider 时，需要改哪几层

先区分商业渠道和 wire protocol：

- 新增 reseller 或账号来源，但它复用已注册协议：只需配置 channel 的连接/凭据、模型和显式协议，不需要新增 adaptor，也不需要复制模型定价。
- 新的账号鉴权、余额查询或模型发现方式：新增 channel type 及对应运维能力，但协议仍绑定已有目录项。
- 新的 wire protocol：在 [constant/protocol.go](../constant/protocol.go) 注册协议，并在 relay/task/native 层实现 adaptor、请求转换、响应解析、endpoint 与 stream 能力；若 usage 特殊，再补结算逻辑。

协议注册表会自动驱动模型控制台候选项、运行时 API type/task platform、stream capability 和价格页 endpoint 发布。新增协议时不应再创建平行的 `Channel.Type -> protocol` 映射。

这三种变更的复杂度不同，不能再用“新增渠道类型”混为一谈。

## 17. 一句话总结

`new-api` 的完整心智模型是：

1. `channel` 定义上游连接。
2. `abilities` 定义哪些 group 下哪些模型可以走哪些 channel。
3. protocol binding 定义这个模型在该 channel 上使用哪种上游协议。
4. `Distribute()` 先抽取模型名、选出 channel，再解析显式协议。
5. `GetAndValidateRequest()` 把请求解析成统一 DTO。
6. `model_mapping` 在真正转发前把逻辑模型名改成上游模型名。
7. `RelayInfo` 承载 channel、协议和整次请求的统一上下文。
8. 模型定价策略把人类价格原子换算为运行时价格 map。
9. `ModelPriceHelper` / `ModelPriceHelperPerCall` 先算预扣费。
10. 下游返回 usage 后，`PostTextConsumeQuota` 或 task billing 计算真实消费。
11. `BillingSession` 统一完成预扣、结算、退款。

如果只记两条：

1. 上游协议由“模型 × 渠道”的显式 binding 决定，绝不由渠道类型推断。
2. 用户收费仍以逻辑模型和分组为核心，由统一模型定价策略写入，不是按最终命中的渠道采购成本临时拼装。
