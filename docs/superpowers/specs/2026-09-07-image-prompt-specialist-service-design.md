# 图片提示词 Specialist 服务设计（HMaigc 单一模型真源）

> 2026-09-07 架构修订：预发布检查确认 HMaigc、Hono 与 new-api 各自维护模型目录会造成重复配置和不可证明的版本一致性。本设计硬切换为 HMaigc 模型目录与加密凭证是图片提示词推理的唯一权威；Hono 和 agents-cli 不再为该链路维护第二份模型配置。

## 1. 业务目标

为 HMaigc 图片节点的“人像质感”等付费编辑命令提供一条可审计、可灰度、可独立回滚的服务端提示词生产链路，替代浏览器内硬编码提示词。

本阶段只解决“把已确认事实转换为可直接交给图片模型执行的提示词”。用户身份、画布修订、报价确认、订单、积分、生成任务、资源落库和失败恢复仍由 HMaigc Go 后端负责。

成功标准：

- 浏览器不保存任何产品级提示词模板，不直接调用模型或 agents 服务。
- Go 后端提交已验证的图片编辑证据，得到严格 `image-prompt/v1` 结果后，才进入现有报价和图片生成链路。
- 相同业务幂等键不会重复消耗提示词模型成本。
- 任一鉴权、模型绑定、证据、输出解析或调用环节失败时显式终止；不使用默认提示词、不切换模型、不跳过 specialist。
- 新链路默认关闭；关闭时“人像质感”入口不可执行，不维护旧硬编码提示词作为备用路径。

## 2. 非目标

- 不替换 HMaigc 的 Go Agent Runtime、任务中心、计费、资源或 CanvasChange。
- 不让 Hono 或 agents-cli 写入 HMaigc 数据库、画布、资源、订单或生成任务。
- 不迁移上游插件中心、绘图节点或通用展示节点。
- 不在本阶段开放新的前端配置开关；产品灰度继续由现有服务端 rollout 控制。
- 不把 `docs/`、`assets/` 或 `ai-metadata/` 作为运行时知识源。
- 不基于命令名、自然语言关键词或正则进行语义路由。

## 3. 架构决策

采用单一链路：

```text
Web 图片节点命令
  -> HMaigc Go（身份、权限、节点事实、报价确认、GenerationTask）
  -> Go 任务执行器读取结构化 imageCommand（浏览器不提交最终 prompt）
  -> Hono internal image-prompt endpoint（协议、鉴权、限流、trace）
  -> agents-cli image_prompt_specialist（技能与语义产出）
  -> agents-cli 使用单次短时 relay grant 回调 Hono internal LLM relay
  -> Hono 以独立 HMAC 调用 HMaigc private model relay
  -> HMaigc 校验父任务、订单和冻结模型运行时后调用既有文本模型渠道
  -> Hono 返回严格 image-prompt/v1
  -> HMaigc Go 把提示词与 trace 冻结到既有付费图片任务并调用供应商
  -> Resource + CanvasChange + BillingOrder + 审计
```

### 3.1 为什么保留 Hono

Hono 只承担服务间协议边界：验证请求、约束可调用 specialist、签发一次性模型 relay grant、管理超时与调用 trace。它不拥有或同步 HMaigc 模型目录，不装配产品 SOP，不决定是否调用 specialist，也不执行画布操作。

### 3.2 为什么不让 Go 直接调用通用 `/chat`

通用 `/chat` 暴露了会话、工具和自主执行能力，无法把“只生产提示词、不得产生副作用”的边界证明清楚。新 endpoint 是显式产品命令的确定性能力入口，不是本地意图路由。

### 3.3 为什么不直接在 Go 或 Web 拼提示词

图片模型提示词属于 `image_prompt_specialist` 的专业语义职责。放在 Web 或 Go 会形成第二套方法论，并继续造成上游升级时的复制与漂移。

## 4. 领域职责

### 4.1 HMaigc Go：商业权威

Go 后端负责：

- 验证登录用户、项目/画布/节点归属和写权限。
- 从当前节点、已确认参数与真实资源记录构造证据；禁止信任浏览器提交的任意资源所有权或提示词证据。
- 请求并确认最终图片生成报价，冻结 `BillingOrder`、结构化 `imageCommand` 与生成配置；浏览器不得提交该命令的最终执行 prompt。
- 创建 `GenerationTask` 后，由同一任务执行器调用 specialist；任务 ID 同时作为 specialist 业务幂等身份，刷新或重试不会绕过任务状态另起调用。
- 在任务创建时冻结提示词模型的 `catalogRecordId + modelKey + configurationRevision + providerEndpointVersionId + providerCredentialVersionId`。这些字段只有身份信息，不包含供应商密钥。
- 暴露仅供 Hono 访问的 private model relay；它必须重新读取父 `GenerationTask/BillingOrder`，核对命令、租户、模型绑定和任务状态后，才解密本地已有凭证并执行一次非流式、无工具文本请求。
- private model relay 记录供应商 request ID、token usage、耗时、父任务和 correlation ID；其成本属于平台内部生产成本，不另建用户账单。
- specialist 成功后先把最终提示词、模型绑定、证据摘要和 trace 写入结构化 `TaskLog`，再调用图片供应商；最终成功结果同时进入任务结果和节点命令证据。
- 回填 `GenerationTask`，保存全部已生成资源、节点结果、提示词和 trace。
- 把 specialist 失败与生成失败区分为稳定错误码，并写入结构化审计日志。

### 4.2 Hono：协议与推理网关

Hono 负责：

- 只暴露内部版本化 endpoint，不接受用户 JWT 或浏览器 API key 直接访问。
- 验证服务身份、时间窗、请求摘要和请求幂等键。
- 将已验证 DTO 交给 agents-cli 的专用 endpoint。
- 为每次 specialist 执行签发一次性、短时、绑定 correlation ID 与冻结模型身份的 relay grant；Redis 只保存 grant 摘要和最小绑定事实，不保存供应商密钥。
- 为 agents-cli 提供只允许单次非流式文本推理的 internal LLM relay，并将已验证请求用独立 HMAC 转发给 HMaigc private model relay。
- 校验 agents-cli 返回的严格 schema、模型身份和证据摘要。
- 记录 request/correlation ID、耗时、有效模型、token usage 和稳定错误码；不得记录密钥、签名、完整私有 URL 或图片二进制。

Hono 不负责：

- 根据命令或文案选择工作流。
- 读取、同步或复制 HMaigc 模型目录与供应商凭证。
- 保存 HMaigc 画布或业务资源。
- 创建、结算或退款 HMaigc 的用户订单。
- 在 specialist 失败时生成模板提示词。

### 4.3 agents-cli：语义 Specialist

agents-cli 负责：

- 注册 `image_prompt_specialist`，加载 `tapcanvas-prompt-specialists`。
- 仅基于本次传入的已确认事实生成提示词。
- 在无工具、无子代理、无工作区写权限的执行域内运行。
- 只使用 Hono 为当前请求签发的 relay grant 调用模型；不得使用普通 Agent 的默认模型、API 地址或 API key。
- 输出 `imagePrompt`；复杂分镜场景可额外输出等价的 `structuredPrompt`。
- 最终自检产物类型、证据约束和必填字段；无法满足时显式失败。

agents-cli 不读取 HMaigc 画布，不调用 TapCanvas public API，不创建媒体任务，不更新节点。

## 5. 请求契约

Go 调用 Hono：`POST /internal/v1/specialists/image-prompt`。

TypeScript 两个服务不得复制各自版本的 parser；请求、响应、错误码与 canonical digest 规则统一放在 `packages/schemas/image-prompt-specialist`。Hono 与 agents-cli 只增加各自的 transport adapter，Go 按同一版本写精确结构体和契约测试。

```ts
interface ImagePromptSpecialistRequestV1 {
  schemaVersion: "image-prompt-request/v1"
  requestId: string
  correlationId: string
  idempotencyKey: string
  actor: {
    tenantId: string
    userId: string
  }
  scope: {
    projectId: string
    canvasId: string
    nodeId: string
    nodeRevision: number
  }
  commercialContext: {
    generationTaskId: string
    billingOrderId: string
    quoteFingerprint: string
  }
  operation: {
    command: "portraitTexture"
    objective: string
    parameters: Record<string, string | number | boolean | null>
  }
  evidence: {
    currentPrompt?: string
    negativePrompt?: string
    references: Array<{
      resourceId: string
      mediaType: "image"
      semanticRole: "source" | "character" | "style" | "scene"
      ordinal: number
      contentDigest: string
      accessUrl: string
    }>
  }
  promptModel: {
    catalogRecordId: string
    modelKey: string
    configurationRevision: string
    providerEndpointVersionId: string
    providerCredentialVersionId: string
  }
}
```

结构性约束：

- `requestId`、`correlationId`、`idempotencyKey` 必须非空并满足长度上限。
- `nodeRevision` 必须是非负整数。
- `generationTaskId`、`billingOrderId` 与 `quoteFingerprint` 必须非空；Hono 只把它们记录为关联证据，不自行查询或修改商业数据。
- `references` 至少包含一个真实 `source` 图片资源；只存在节点连线或 prompt 不成立。
- 引用必须已由 Go 验证归属和可访问性；Hono 只接收短时签名 URL，且日志只保留域名与摘要。
- `objective` 是用户显式选择的编辑目标，不允许 Hono 按关键词改写成另一命令。
- `promptModel` 的五个身份字段全部由 HMaigc 在商业任务创建时冻结。Hono 和 agents-cli 只能透传并逐字回传；不得自行补齐或替换。
- 首版只接受 `portraitTexture`。新增命令必须扩展契约和测试，不得复用字符串后偷偷改变语义。

## 6. 响应契约

```ts
interface ImagePromptSpecialistResponseV1 {
  schemaVersion: "image-prompt/v1"
  imagePrompt: string
  structuredPrompt?: {
    version: "v2"
    shotIntent: string
    spatialLayout: string[]
    cameraPlan: string[]
    lightingPlan: string[]
    continuityConstraints: string[]
    negativeConstraints: string[]
  }
  trace: {
    requestId: string
    correlationId: string
    specialist: "image_prompt_specialist"
    evidenceDigest: string
    model: {
      catalogRecordId: string
      modelKey: string
      configurationRevision: string
      providerEndpointVersionId: string
      providerCredentialVersionId: string
      effectiveModel: string
    }
    usage: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    startedAt: string
    completedAt: string
  }
}
```

`imagePrompt` 是唯一图片模型执行字段。Go 必须原样冻结到命令证据与生成任务，不在本地再次做语义改写。

响应必须通过严格 schema；未知字段、缺失字段、空提示词、模型不一致、证据摘要不一致均失败。JSON 解析失败时不得从自然语言或 Markdown 代码块中“猜”结果。

## 7. 模型与费用边界

提示词推理使用 HMaigc 管理员已经配置的默认 Agent 文本模型，不复用图片生成模型名，也不要求用户在 Hono 或 new-api 中再次配置同一模型。

- Go 在图片商业任务中冻结 `catalogRecordId + modelKey + configurationRevision + providerEndpointVersionId + providerCredentialVersionId`。
- Hono 不查询模型目录，只校验一次性 relay grant 与请求绑定，并把完整冻结身份签名转发给 HMaigc。
- HMaigc private model relay 必须从本地数据库重读父任务、订单、模型记录、端点版本和凭证版本，逐项一致后才允许调用；任何变化都在供应商副作用前失败。
- agents-cli 得到并回传 `effectiveModel`；Hono 与 Go 均再次核对。
- 任一父任务、模型记录、端点、凭证版本或有效模型不一致，返回 `specialist_model_binding_invalid` / `specialist_model_inheritance_failed`；执行失败后不得改用其他默认模型或备用模型。
- 模型供应商密钥只存在于服务端配置，不出现在跨服务 DTO、浏览器响应或日志中。

首版 specialist 推理成本作为平台内部生产成本记录，不向用户单独弹出第二次报价；用户仍只确认最终付费图片任务报价。Hono 必须记录 token usage，供运营核算与后续定价。若未来要向用户独立计费，必须先扩展 Go 的统一报价/订单契约，不能直接在 Hono 扣费。

执行顺序固定在商业状态机内：先由用户确认最终图片报价并创建 `BillingOrder/GenerationTask`，再由任务执行器调用 specialist。specialist 失败时任务进入明确失败态并释放/退款，不得在订单外同步消耗后继续伪装为“尚未创建任务”。

## 8. 安全与幂等

### 8.1 Go 到 Hono

请求使用版本化服务凭据签名：服务 ID、Unix 时间戳、nonce、HTTP 方法、路径、body SHA-256 和 idempotency key 组成 canonical payload，使用 HMAC-SHA256。Hono 使用常量时间比较，并要求时间偏差不超过 60 秒。

生产环境必须使用 Redis `SET NX EX` 保存 nonce 与 idempotency 状态。未配置 Redis 时 internal specialist endpoint 启动失败；不回退到进程内缓存。开发和测试必须显式注入测试 nonce store。

### 8.2 Hono 到 agents-cli

agents-cli 仅绑定私有地址，specialist endpoint 使用独立服务 bearer token，网络层只允许 Hono 服务访问。Hono 同时签发随机高熵的单次 relay grant，Redis 以 grant SHA-256 为键保存 correlation ID、父任务 ID、完整冻结模型身份、过期时间和消费状态。原始 grant 只在 Hono 到 agents-cli 的本次私有请求中出现，不入日志、不持久化到 HMaigc。

agents-cli 调用 Hono LLM relay 时以该 grant 鉴权。Hono 必须原子消费 grant；缺失、过期、重复消费、correlation/model 不匹配均在模型调用前失败。LLM HTTP 重试次数固定为零。

### 8.3 Hono 到 HMaigc model relay

Hono 使用另一组独立服务身份和 HMAC secret 调用 `POST /internal/v1/model-relays/image-prompt/chat-completions`。canonical payload 必须绑定服务 ID、时间戳、nonce、方法、路径、body SHA-256、generation task ID 和 correlation ID；HMaigc 使用常量时间比较并持久化短时 nonce 防重放。

model relay 请求只允许 `schemaVersion`、商业父事实、完整冻结模型身份、`system/user` 两条消息、`tools: []` 与 `stream: false`。HMaigc 必须在一次数据库读取边界中核对父任务和订单；供应商调用使用任务创建时冻结的端点/凭证版本。返回值规范化为严格 chat-completion 结果，只保留文本、effective model、provider request ID 和 token usage。

生产环境必须配置独立的 `IMAGE_PROMPT_MODEL_RELAY_URL`、service ID 与至少 32 UTF-8 字节的 HMAC secret。该 secret 不得与 Go→Hono、Hono→agents-cli 或 relay grant 复用。

### 8.3 幂等状态

幂等记录至少包含：`pending | succeeded | failed`、body digest、response digest、有效模型、开始/完成时间和稳定错误码。

- 相同 key + 相同 body：`succeeded` 返回原响应；`pending` 返回冲突/处理中；`failed` 由 Go 使用新的重试 key 明确重试。
- 相同 key + 不同 body：返回 `idempotency_conflict`。
- Hono 超时但下游最终完成时，后续相同 key 必须能读取已验证结果，不重新推理。
- Go 的结构化 `TaskLog` 是调用已发生的本地审计证据；Hono Redis 中的完整响应是恢复窗口内的幂等真源。两者通过 response digest 互相核对，不新增 HMaigc 数据表。
- 单次 relay grant 不是业务幂等真源；它只限制一次 agents→Hono 模型调用。业务恢复仍以 generation task idempotency key 和已冻结 Hono 结果为准。

## 9. 失败契约

稳定错误码：

- `specialist_auth_invalid`
- `specialist_replay_rejected`
- `specialist_request_invalid`
- `specialist_evidence_invalid`
- `specialist_idempotency_conflict`
- `specialist_model_binding_invalid`
- `specialist_unavailable`
- `specialist_timeout`
- `specialist_output_invalid`
- `specialist_model_inheritance_failed`

每个错误包含 `requestId`、`correlationId` 和可供运维定位的非敏感 `reason`。Web 展示来自 Go 的事实型错误，不显示内部 URL、签名或供应商响应正文。

## 10. 可观测性

三层日志使用同一个 `correlationId`：

- Go：用户/租户、项目/画布/节点、命令、节点修订、业务幂等键、报价/任务/订单 ID、结果状态。
- Hono：服务身份、request ID、evidence digest、relay grant 生命周期、模型记录与 revision、agents-cli/HMaigc 调用耗时、usage、schema 校验结果。
- agents-cli：specialist、required skill、有效模型、输入字符数/参考图数量、输出字符数、最终自检状态。

禁止记录：API key、HMAC、完整带签名资源 URL、图片 data URL、原始图片、完整用户隐私文本。对必须保留的 prompt，由 Go 作为业务生成证据保存，并受项目权限控制。

## 11. 灰度与回滚

- 复用 `canvasToolRegistryV2` 的服务端 rollout；“人像质感”在 specialist 端到端验收前保持不可见/不可执行。
- 不提供“specialist 失败后使用旧硬编码提示词”的兼容路径。
- 回滚顺序：关闭 rollout -> 验证旧已上线工具与画布读写 -> 回滚 specialist 服务部署。
- 回滚不删除已经成功生成的 Resource、GenerationTask、BillingOrder、CanvasChange 或 prompt trace。

## 12. 实施切片

1. 保留现有 agents-cli specialist、Hono 网关和 HMaigc 商业任务接线；先用 focused tests 固定当前行为。
2. 扩展共享模型绑定契约，加入冻结端点/凭证版本；先写跨语言 RED 契约测试。
3. Hono：删除该 Specialist 对 Hono 模型目录/new-api 的依赖，新增一次性 relay grant 与 HMaigc HMAC adapter；同步 README 架构章节。
4. agents-cli：按每个 Specialist 请求构造 relay client，透传一次性 grant 和完整模型身份；普通 Agent 模型配置不受影响。
5. HMaigc Go：新增 private model relay、父任务/订单/冻结运行时校验、无工具非流式供应商调用、usage 与审计证据；不新增用户账单。
6. 验收：定向 RED/GREEN、跨服务契约、两仓构建、无付费错误矩阵、浏览器 E2E；最后一次受控付费生成成功后才允许 rollout。

## 13. 验收矩阵

必须覆盖：

- 正常：真实来源图片 -> specialist prompt -> 报价确认 -> 生成任务 -> 资源 -> 派生节点 -> 刷新恢复。
- 权限：跨用户、跨租户、跨项目、无写权限、已删除节点。
- 并发：双击、相同请求重试、相同 key 不同 body、Hono 超时后重查。
- 模型：记录缺失、revision 变化、模型 key 不匹配、端点/凭证版本漂移、父任务不匹配、供应商返回其他模型、供应商失败。
- relay grant：缺失、过期、重复消费、模型或 correlation 不匹配、Redis 原子消费失败。
- 反向鉴权：Hono→HMaigc 签名错误、时间窗过期、nonce 重放、父任务已经终止。
- 输出：空 JSON、未知字段、空 `imagePrompt`、非法 structured prompt、Markdown 包裹、超长输出。
- 资源：来源 URL 缺失、资源不归属、签名过期、后处理失败但上游已生成资产。
- 计费：用户取消报价、任务成功结算、任务失败释放、重复回调、资源写入失败保留上游生成证据。
- 运维：Redis 缺失、agents-cli 不健康、超时、取消、日志脱敏和 correlation ID 串联。

## 14. 变更预算

- 生产职责：4 个明确 seam（agents-cli specialist、Hono protocol gateway、一次性 relay grant、HMaigc commercial model relay）。
- 当前实现基础上的架构修正预计修改/新增：根仓 7–11 个生产/测试/文档文件；HMaigc 6–10 个生产/测试/配置文件。
- 架构修正预计净新增：600–1,000 行，其中多数为冻结运行时、双向鉴权、严格 DTO、测试和 trace；删除 Hono Specialist 对第二模型目录与 new-api 的依赖会抵消一部分代码。
- 昂贵门禁：两个仓库定向测试 -> 两仓全量测试/类型/构建 -> 本地三服务契约测试 -> 浏览器 E2E -> 单次受控付费生成。
- 暂缓：视频 specialist、pacing reviewer、技能库 UI、创作工作台切换、插件中心、绘图节点。
