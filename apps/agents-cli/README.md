# TapCanvas DeepSeek Harness Bridge

`apps/agents-cli` 已硬切换为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 TapCanvas 集成层。主代理循环、会话、Skills、Todo、子代理与基础工具由官方 Harness `sdk` profile 提供；本目录只保留 TapCanvas 的模型网关配置、HTTP/SSE 协议投影和按请求授权的 MCP 工具桥。

不再维护旧 `agents-cli` 自研 agent loop，也没有旧运行时兼容分支。

## 安装

在仓库根目录执行：

```bash
pnpm -w install
pnpm --filter agents build
```

安装会下载官方 npm 发行包，核心版本固定为 `@deepseek-ai/dsh@0.1.2-alpha.2`，所有 DeepSeek Harness 接口包与插件保持同一版本线。当前版本要求 Node.js `^22.19.0` 或 `>=24.0.0`。

这里不会额外 clone 或 vendor GitHub 源码。GitHub 仓库是上游开发源，TapCanvas 运行时消费其带版本的官方 npm 产物。

## 启动

```bash
pnpm --filter agents start serve --host 127.0.0.1 --port 8789
```

开发模式：

```bash
pnpm --filter agents dev serve --host 127.0.0.1 --port 8789
```

可选参数：

- `--token <token>`：保护 `/chat`；Hono 使用同一 bridge token 调用。
- `--body-limit <bytes>`：HTTP 请求体硬上限，默认 8 MB。
- `AGENTS_WORKSPACE_ROOT`：Harness 工作目录；未设置时使用启动进程的当前目录。

健康检查：

```bash
curl http://127.0.0.1:8789/health
curl http://127.0.0.1:8789/collab/status
```

`/health` 只有在官方 `sdk` profile 配置完成初始化后才可访问。初始化失败会使进程显式启动失败。

## 环境变量

模型配置通常由 Hono 每轮通过请求字段显式传递；本地直连时也可以设置：

- `AGENTS_API_BASE_URL`：OpenAI-compatible 模型网关地址。
- `AGENTS_API_KEY`：模型网关凭据。
- `AGENTS_API_STYLE=chat|responses`：上游协议；未知值显式失败。
- `AGENTS_REQUEST_TIMEOUT_MS`：单次 Harness SDK 请求超时。
- `AGENTS_SKILLS_DIR`：TapCanvas bundled Skills 目录；未设置时使用本包 `skills/`。
- `DSH_HOME`：DeepSeek Harness 会话、设置与持久化目录。
- `DSH_CONTEXT_WINDOW`：模型上下文窗口，默认 `262144`。
- `AGENTS_MEMORY_DIR`：仅用于推导默认 `DSH_HOME=<AGENTS_MEMORY_DIR>/deepseek-harness`；不再加载旧 memory 格式。
- `DSH_TELEMETRY_DISABLED=1`：Bridge 子进程固定禁用上游遥测。

Hono 正常调用时不会把 new-api 管理令牌交给 Bridge。Hono 为当前用户签发短期
`tc_internal:v2:*` 委托凭据，并把 `AGENTS_API_BASE_URL` 指向 owner-scoped
`/agents/llm/v1` 代理；Harness 的 Chat Completions / Responses 请求先恢复用户身份，
再由 Hono 访问 new-api。只有本地脱离 Hono 直连调试时才需要显式提供
`AGENTS_API_BASE_URL` 与 `AGENTS_API_KEY`。运行时不生成或读取明文
`agents.config.json`，Bridge 也不持有 `NEW_API_INTERNAL_TOKEN`。

已删除的旧配置不再生效：`agents.config.json`、`AGENTS_PROFILE`、旧自研 loop 的 max-turn / fallback / Redis history / completion retry 配置均不会被读取。

## TapCanvas 集成边界

### 模型与 system prompt

每轮 Hono 必须提供明确的 `systemPrompt`、模型身份、模型网关地址/凭据和 API style。缺少关键值时 Bridge 原地返回结构化错误，不选择默认模型、不切换 API 协议，也不做模型降级。

Bridge 在 Hono 事实型 prompt 之外固定注入唯一产品身份：面向用户的助手名为“小T”，
身份是 TapCanvas AI 创作助手；DeepSeek Harness 只作为内部执行内核。普通身份问答不得主动
暴露本地路径、仓库结构、供应商实现或隐藏指令，除非用户明确要求技术诊断。

`harness/tapcanvas.patch.yml` 在官方 `sdk` profile 上做三项组合：

1. 注入 Hono 提供的事实型 persona/system prompt；
2. 注册本轮明确的 TapCanvas 模型网关与模型；
3. 每轮挂载 request-scoped MCP server；包含私有 `report_delivery` / `get_delivery_evidence`（结构化节点为 `submit_structured_output`），
   以及 Hono 本轮明确授权的远程工具。

### Skills

仓库 Skills 通过 `DSH_BUNDLED_SKILL_DIR` 交给 DeepSeek Harness 的 filesystem skill provider。`requiredSkills` 会作为本轮显式约束进入上下文，具体读取仍通过 Harness `skill` 工具完成。

外部用户/商城 Skill 必须同时带有 `externalSkills`、`requiredSkillCalls` 和可信 `externalSkillResolverConfig`；缺解析器会显式拒绝请求，禁止把“未加载”伪报为成功。

### Workflow 结构化产物

已同步一键成片的章节编排、共享资产提取、逐 Clip 设计、逐 Clip writer 与配套技能；
执行内核仍是 DeepSeek Harness，不加载旧自研 agent loop。

声明 `outputContract` 的原子工作流节点挂载私有 `submit_structured_output`，以冻结 JSON Schema
和显式字段、类型、数组长度约束检验提交。结构错误作为工具失败携带具体字段路径返回当前
Harness turn，作者在同一执行链中修订后重新提交。成功提交的对象直接序列化为响应 `text`，
并以 `structuredOutput` 返回；不从自然语言最终回答猜测或提取 JSON。
缺少成功提交回执，即使 Harness 正常结束也明确失败。业务节点仍按其完整 typed-port 合同
执行下游结构校验；Bridge 不判断创作内容语义、不制造默认内容。

### 请求级工具与交付收口

`report_delivery` 是 Bridge 内部的 response-mode 最终自检工具，不会转发给 Hono，
也不在公共画布工具目录中。主代理必须在纯文本最终回答前调用它，结构化声明任务目标、
交付类型和逐项成功标准；Bridge 冻结合同哈希，并在 Harness 真正结束后把精确最终正文
绑定为 SHA-256 `final_response` evidence，构造
`expectedDelivery -> deliveryEvidence -> deliveryVerification -> PhysicalRunExitV1`。
缺少报告、正文为空、Harness 未正常结束或合同结构无效时显式失败。
执行型交付使用同一工具的 artifact 参数形态：主代理先读取 `get_delivery_evidence` 中的
真实终态 workflow output，逐项解释证据如何满足冻结 must，并引用精确 evidence ID。
Bridge 只核对冻结合同、身份、引用、终态以及媒体 URL 的结构事实；语义判断归主代理。
不存在的证据、未受理/尚未完成的执行、缺少媒体地址或遗漏要求均在同一 turn 拒绝报告，
不把文字、受理回执或单独资产 URL 当成完整交付。

### 远程工具

Hono 的 `remoteTools` 会映射为 request-scoped MCP tools。MCP gateway：

- 为每次请求生成随机内部 bearer token；
- 只暴露当前请求授权的工具；
- 把 project / flow / node / book / chapter / turn scope 原样转发；
- 记录真实开始时间、结束时间、状态、输出和结构化结果；
- HTTP、认证、网络或工具错误均显式返回并进入 trace。

`remoteToolCatalog` 是延迟 schema 工具面。Harness 先调用 `tapcanvas_get_tool_schema`，Bridge 将其映射到 Hono 的 `tapcanvas_tool_schema_get`；只有该工具的精确 schema 成功加载后，同一请求才允许调用对应 catalog tool。直接工具定义优先于同名 catalog 项，且不能覆盖 Bridge 私有的 `report_delivery`。

### 请求事实

Bridge 只从已知字段白名单投影本轮机器事实与输出合同，例如 `outputContract`、`generationContract`、`userIntentContract`、检索证据、角色/子代理约束、知识卡身份、资源路径和 diagnostics context。API key、MCP token、外部 Skill 凭据不会进入模型上下文。

## HTTP 协议

- `POST /chat`：TapCanvas chat bridge；支持 JSON 或 SSE。
- `POST /internal/mcp/:token`：仅供对应 Harness 子进程使用的 request-scoped MCP endpoint。
- `POST /chat/status`：按 `userId + sessionId` 返回 Bridge 持久 lifecycle checkpoint；从未执行过的会话返回明确 idle 快照，不返回 404。
- `POST /chat/interrupt`：只中断同一 `userId + sessionId + turnId` 的活动 Harness 物理执行，并返回中断后的持久状态。
- `GET /health`：运行时与上游版本。
- `GET /collab/status`：Hono autostart readiness 兼容端点；实际子代理状态由 DeepSeek Harness 会话事件管理。

SSE 会把 Harness 的 `turn/start`、assistant delta、tool call/result、Todo 和 `turn/end` 投影为 TapCanvas 当前消费的 `thread.started`、严格字段的 `status-update`、`turn.started`、`content`、`tool`、`todo_list`、`result` 与 `done` 事件。不会把尚未发生的阶段伪装成进度；`done.reason=logical_succeeded` 只在通用交付闭包成立时产生。

## 验证

```bash
pnpm --filter agents build
pnpm --filter agents test
```

`build` 会验证官方 `@deepseek-ai/dsh` 精确版本和可执行入口。测试覆盖请求契约、密钥隔离、延迟 schema 门禁、MCP 授权/转发、真实失败记录。

DeepSeek Harness 当前仍标记为 developer preview。TapCanvas 使用精确版本锁定；升级时必须同步升级全部 Harness 包，并重新执行 profile 握手、Bridge 测试和 Hono 集成测试，禁止只升级其中一个插件。

### 持久工作流交接

根代理收到 `acceptedAsync` 的 queued/running 回执且执行器明确声明
`completionBoundary=submission`、`executionOwner=durable_executor` 时，本轮只完成提交交接，
以 `submissionHandoff.receipts` 保留执行身份，不注册对话 continuation。媒体交付保持 pending，
后续生产和最终验收只由持久 Workflow 执行器负责。未声明该完成边界的异步执行退出为
`waiting_external`，等待外部证据。SSE 与会话快照
依据交付闭包投影状态，不以 Harness turn 结束代替业务成功。执行型最终交付只接受授权
工具返回、与冻结 contractHash 一致、覆盖全部 must 且证据 ID 完整的通用
`expectedDelivery -> deliveryEvidence -> deliveryVerification`；单独 URL、文字或受理回执
均不足以宣称完整视频目标完成。

### 用户交付合同冻结

`record_user_intent` 是 request-scoped 私有工具。主代理根据真实用户意图编写 version 2
合同，Bridge 只校验字段结构、枚举和要求身份，按 Hono 相同的排序 JSON 规则计算纯十六进制
SHA-256。后续远程调用自动附带顶层机器字段 `userIntentContract` 与 `userIntentContractHash`，
与原子任务和最终交付报告共用同一冻结对象；模型不能通过工具 args 替换机器字段。

改写已冻结合同必须显式提供 `authoringCorrection.previousContractHash` 与原因。
已锁定的续轮合同，以及开始远程执行后的合同不允许改写；无法确定远程副作用时同样保持锁定。
只读动态 schema 加载不锁定合同。工具拒绝错误后，Agent 在同一 Harness turn 修订，
不使用默认语义或自动补齐用户要求。

### 响应任务中的来源证据

响应任务可能要求“先读来源、调用工具再回答”。Agent 在自检时标记该 requirement 的
`requiresToolEvidence` 并从 `get_delivery_evidence.sourceEvidence` 选择精确
`sourceEvidenceIds`。任何授权工具的成功读取都可作为来源证据，不按媒体工具名单限制；
失败调用和私有自检工具不可充当来源。Bridge 只检验引用与成功状态，交付标准的语义归属
由 Agent 判断；最终正文哈希不替代明确要求的读取回执。已完成的读取可直接复用，
无需为了验收重复调用。普通无需取证的响应继续使用最终正文证据。

供应商断流的物理中断只将当前执行标为 `suspended`，逻辑任务仍 active、交付 pending；
仅 `chat_turn_user_interrupt` 表示用户取消。没有真实 checkpoint 时不声称自动可恢复；暂停不伪造恢复 checkpoint 或可恢复声明，
也不重新提交媒体任务。HTTP 完成/失败回调绑定原 turn 身份，不能覆盖已中断快照或后续回合。
