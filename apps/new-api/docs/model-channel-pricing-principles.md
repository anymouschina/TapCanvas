# new-api 原理说明：从新增渠道/模型，到请求解析、路由分发与计价结算

这份文档面向工程阅读，目标是用当前仓库里的真实实现，解释 `apps/new-api` 里一条 AI 请求是如何从“后台新增渠道与模型配置”一路走到“被解析、路由、转发并扣费”的。

本文不讨论部署、运营后台界面细节，也不描述理想架构；只描述当前代码的真实工作方式。

## 1. 系统本质

`new-api` 本质上是一个统一 AI 网关，做了四层事情：

1. 提供统一的外部 API 入口，兼容多种协议和模型类型。
2. 根据 token、group、模型名和 channel 能力，给请求选一个实际可用的上游渠道。
3. 将统一请求格式转换成具体 provider 所需的上游请求格式。
4. 按模型配置和用户分组倍率统一预扣费、结算、退款。

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

- `type`: 渠道类型，决定这是 OpenAI-compatible、Gemini、Claude、Ollama、Vertex AI 还是其他 provider。
- `base_url`: 上游请求地址。
- `key`: 上游 API key 或多 key 配置。
- `group`: 这个 channel 属于哪些逻辑分组。
- `models`: 这个 channel 声明自己支持哪些模型名。
- `priority` / `weight`: 选路优先级和加权随机参数。
- `model_mapping`: 用户请求模型名和上游真实模型名的映射表。

`AddChannel` 与 `UpdateChannel` 都会在保存后刷新 channel cache，并最终影响请求分发：

- [controller/channel.go](../controller/channel.go)
- [model/channel_cache.go](../model/channel_cache.go)

### 2.2 Ability 是“某个 group 下某个模型可否走某个 channel”的展开结果

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

### 2.3 FetchModels 只是辅助填模型，不参与运行时决策

后台提供了 `FetchModels` 接口去从上游抓取模型列表，代码在 [controller/channel.go](../controller/channel.go)。

它做的事情是：

1. 根据 `type` 和 `base_url` 组装请求。
2. 调上游的 `/v1/models` 或 provider 特定接口。
3. 返回模型名列表给后台界面使用。

它的作用是“辅助配置”，而不是运行时动态发现模型。真正运行时是否能路由某个模型，依赖的仍然是 `abilities` 和当前 channel cache。

## 3. 一个请求进入系统后的完整主流程

### 3.1 统一入口：路由先按协议和资源类型分类

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
- `channel_key`
- `channel_base_url`
- `model_mapping`
- `status_code_mapping`
- 组织、区域、版本号等 provider 特定参数

从这一刻开始，本次请求已经绑定到了一个确定的实际上游 channel。

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
- relay mode
- price data
- retry 状态
- usage 信息
- 预扣费与结算状态

后续无论是文本、图片、音频还是 Gemini/Claude，都会围绕 `RelayInfo` 往下跑。

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

这些 helper 再继续走 provider-specific adaptor，把统一 DTO 转成具体上游格式。也就是说，真正的协议适配被压在 `relay/` 层，而不是分发层或计费层。

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
2. 推导当前系统“有哪些模型处于启用状态”。
3. 为这些模型拼接元数据、供应商、支持端点、可用 group。
4. 返回过滤后的模型价格视图。

因此：

- 前台价格页是“逻辑模型视图”
- 不是“渠道成本明细视图”

这和运行时按模型统一计价的原则是一致的。

## 15. 新增模型时的最小正确操作

如果你只是给一个已支持的 provider 新增模型，最小正确步骤是：

1. 找到一个已有 channel，或新增一个 channel。
2. 把模型名加入该 channel 的 `models`。
3. 如果用户侧模型名和上游不一致，补 `model_mapping`。
4. 确保该 channel 的 `group` 覆盖到目标用户组。
5. 为该模型配置 `model_price` 或 `model_ratio`。
6. 必要时测试 `/api/channel/fetch_models`、channel test 和实际调用。

如果缺少第 5 步，系统很可能在价格计算阶段直接报错，而不是在分发阶段报错。

## 16. 新增一个全新的 provider 时，需要改哪几层

如果要新增的是“当前系统尚未支持的渠道类型”，那就不是只改后台配置了，而是需要补代码：

1. 新增 channel type 常量。
2. 在 `relay/channel/` 下增加 provider adaptor。
3. 在 relay 层增加该 provider 的请求转换与响应解析。
4. 确认它支持的 endpoint 类型。
5. 如果 usage 返回格式特殊，补结算逻辑。
6. 补 `fetch_models`、测试、余额查询等运维能力。

这一步和“只新增模型名”的复杂度完全不同，不能混为一谈。

## 17. 一句话总结

`new-api` 的完整心智模型是：

1. `channel` 定义上游连接。
2. `abilities` 定义哪些 group 下哪些模型可以走哪些 channel。
3. `Distribute()` 先抽取模型名，再从能力集中选出一个实际 channel。
4. `GetAndValidateRequest()` 把请求解析成统一 DTO。
5. `model_mapping` 在真正转发前把逻辑模型名改成上游模型名。
6. `RelayInfo` 承载整次请求的统一上下文。
7. `ModelPriceHelper` / `ModelPriceHelperPerCall` 先算预扣费。
8. 下游返回 usage 后，`PostTextConsumeQuota` 或 task billing 计算真实消费。
9. `BillingSession` 统一完成预扣、结算、退款。

如果只记一条：这套系统的收费核心是“按模型名和分组倍率统一计费”，不是“按最终命中的 channel 采购成本动态计费”。
