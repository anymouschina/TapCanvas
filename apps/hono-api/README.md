# TapCanvas API（NestJS + Node.js）

本 API 运行在 NestJS（Express）服务器上，并将现有的 Hono + OpenAPI 路由挂载到同一个 HTTP 服务中。这样可以在标准 Node.js 运行时里继续复用当前的 route / auth / task 逻辑。

BeatSheet 的 `speechLedger.clipIndex` 属于结构坐标：agents-cli 首轮编译器与 Hono admission 编译器统一把非负整数坐标限制在现有 Beat 区间，再执行原有的单调累计投影。超出末拍的尾部台词只会归入最后一个现有 Beat；该过程不重排、不增删、不改写台词，也不吞掉缺失归属、非法类型或非法 `delivery`。

Workflow IR 传递的画布节点身份统一使用 `FLOW_NODE_ID_MAX_LENGTH=512`。工作流、逐项 fan-out、execution family 与输出节点组成的真实派生 ID 可以合法超过旧 UI 的 200 字边界；公开 AI 对话的 `canvasNodeId`、`chatContext.selectedReference/chapterCanvasReference`、`assetInputs[].nodeId`，以及 BeatSheet 的 `referenceImageNodeIds`、站位帧、故事板帧、尾帧和母版分镜父节点均使用同一确定性上限，禁止同一个真实节点在入口通过、在资产输入或 Agent 产物验收时又因另一套长度合同被拒绝。

BeatSheet 的 `beats[].exitState` 是 `storyEvents` 最后一项 `exitState` 的机械副本：Agent 只创作逐事件状态链，agents-cli 首轮编译器与 Hono admission 编译器统一投影 Beat 级退出态。typed output 的逐 Beat 必填字符串合同不再要求模型重复提交该字段，但最终 artifact verifier 仍要求投影后的值与末事件逐字相等；缺少末事件状态仍会显式失败，不会用模板或语义猜测补写。

## 开发

```bash
cp .env.example .env
pnpm prisma:generate
pnpm dev
```

- 默认地址：`http://localhost:8788`
- 可复制的中文说明文档（Markdown）：`GET /`
- OpenAPI 3.1 schema：`GET /openapi.json`

社区版能力边界：

- 默认管理员仅在新数据库首次初始化时创建，账号为 `admin`，密码为 `123456`；部署到共享网络或公网前必须通过环境变量修改密码。
- 认证不提供短信链路：短信发送、短信验证码登录和手机号绑定路由已删除；账号密码、邮箱、GitHub 及已关联账号的微信扫码链路按部署配置启用。未关联账号的微信身份会显式拒绝，不会回退到手机绑定。
- 在线支付、订单、支付回调和自动订阅购买链路已删除；兑换码、管理员额度分配、模型用量计量和管理员手动订阅分配继续保留。
- Compose 中的模型管理台对外显示为“鲁班 API”，其源码目录仍为 `apps/new-api`，并继续保留上游项目标识与 AGPL-3.0 许可证。

模型调用 relay：

- 当前 `/public/tasks`、`/public/draw`、`/public/video`、`/public/vision` 与 `/public/video/understand` 的任务执行链固定通过 `NEW_API_INTERNAL_BASE_URL` + `NEW_API_INTERNAL_TOKEN` 请求 `apps/new-api`。
- `apps/hono-api` 不再按 `vendor` / `vendorCandidates` 做候选渠道分发；外部传入这些字段只作为废弃兼容输入被忽略。模型选择以请求里的 `extras.modelKey` 为准，`extras.modelAlias` 仅在进入 new-api 前转换成 `modelKey`。
- `apps/hono-api` 已删除 `/public/tasks` 运行时的本地多 vendor 尝试与异步候选重试链路；失败会按 new-api / 上游真实错误显式返回，不做静默降级。
- 对外模型目录只投影 `apps/new-api` 当前明确启用的模型；模型/channel 种子补丁只维护能力元数据，不得在冲突更新时覆盖管理员已设置的 `models.status` 或 `abilities.enabled`。现存环境通过后置精确补丁保持 `gemini-3.1-pro` 禁用，因此它不会出现在公开可选目录；Agent API 仍要求调用方显式传入已启用的 `modelKey`（例如 `deepseek-v4-flash`），禁用、缺失或调用失败都原地报错，不自动换模型。
- Docker Compose 默认把 `NEW_API_INTERNAL_BASE_URL` 设为 `http://new-api:4455`；仍需在 `.env` 中提供 `NEW_API_INTERNAL_TOKEN` 与正数 `NEW_API_USD_EXCHANGE_RATE`。汇率由 Hono 的部署配置显式拥有，`apps/new-api` 已不再通过 `/api/status` 发布该字段；缺失或非法配置会在读取价格快照前原地失败，不读取旧字段也不猜测默认值。
- `new-api.channels`（包含 `models`、`key`、`status`、`base_url`）是上游渠道配置来源；新增或修正 Magic666、Apimart 等渠道时应落到 `apps/new-api` 的 channel/model 配置或补丁中，`hono-api` 不再维护平行路由逻辑。

## 数据库（Prisma + Postgres）

当前 Node 运行时通过 `DATABASE_URL` 强制要求使用 Postgres。

```bash
# 1) 生成 Prisma Client
pnpm prisma:generate

# 2) 根据 schema.sql 创建 / 更新 Postgres 表结构
pnpm db:pg:schema

# 3) 执行非覆盖型 seed patches（sql/patch/*.sql）
pnpm db:pg:seed-patches

# 4) 可选：把本地 sqlite 数据迁移到 Postgres
pnpm db:migrate:sqlite-to-pg
```

说明：

- `db:migrate:sqlite-to-pg` 在导入前会先清空目标 Postgres 表。
- 权威 schema 来源仍然是 `apps/hono-api/schema.sql`。
- `db:pg:schema` 内置安全门：会阻止破坏性 SQL（`DROP/TRUNCATE/DELETE/ALTER ... DROP COLUMN`），只允许增量 schema 变更（`CREATE TABLE/INDEX IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN`）。
- 生产链路固定先运行 `db:pg:schema`、再运行 `db:pg:migrate`。同一新增结构若同时进入 `schema.sql` 与 Prisma migration，migration 的 `CREATE TABLE/INDEX` 必须使用 `IF NOT EXISTS`，避免 bootstrap 已创建关系后触发 Prisma `P3018`。
- `db:pg:seed-patches` 会扫描仓库根 `sql/patch/*.sql`，只允许执行 `INSERT ... ON CONFLICT DO NOTHING` 这类“缺数据时填入、已有数据不覆盖”的 seed patch；不允许 `UPDATE/DELETE/TRUNCATE/DROP/ALTER/CREATE`。
- 运行时向量知识检索使用 `prisma/migrations/20260805100000_add_agent_knowledge_vectors/migration.sql` 创建 pgvector 扩展与 `agent_knowledge_vectors` 原始表；该表不进入 Prisma Client，必须由 `db:pg:migrate` 执行，`db:pg:schema` 不会代替它。Compose 的主 Postgres 默认使用 `pgvector/pgvector:pg16`，已有部署切换镜像后再执行正常迁移流程。
- 小T 能力舱使用 `prisma/migrations/20260815093000_agent_capability_attachments/migration.sql` 创建持久装配关系，并由 `prisma/migrations/20260815143000_capability_management_control_plane/migration.sql` 增加单轨路由决策、用户 Skill 开关、能力调用审计与 `project_kind=ai_workflow` 项目分类。它们在每次认证小T对话的工具面装配和能力舱控制面都会读取，因此 `migrate-deploy.mjs` 将这些增量迁移列为已有数据库必须真实执行的 migration；禁止只将其标记为 applied，否则 API 会在运行时显式失败。

### Docker 自动部署时的数据库更新

`apps/hono-api/docker-compose.yml` 当前会让 `api` 服务在启动时执行这条链路：

```bash
pnpm prisma:generate && pnpm db:pg:schema && pnpm db:pg:seed-patches && pnpm build && node dist/main.js
```

这意味着每次容器启动都会：

1. 重新生成 Prisma Client
2. 自动应用安全的增量 schema 更新
3. 如果检测到破坏性 schema 语句则立即失败并拒绝启动
4. `api` 镜像会在构建阶段预装依赖，运行时只在 `/app/node_modules` 卷为空或缺包时才回退执行 `pnpm install`；`agents-bridge` 仍保持轻量镜像，不会额外预装 `apps/hono-api` 依赖
5. 依赖安装层只依赖 `package.json`、`pnpm-lock.yaml` 与 `prisma/`，普通 `src/` 改动不会再次触发整层 `pnpm install`

### 一条命令部署 / 启动（带 Postgres）

在 `apps/hono-api` 目录下执行：

```bash
docker-compose up --build -d
```

共享宿主机目录默认按 monorepo 布局解析，也就是当前文件位于 `<repo>/apps/hono-api` 时，`packages/`、`skills/`、`project-data/` 会从 `../..` 查找。若你的线上部署是扁平目录（例如 `<root>/hono-api`、`<root>/packages`、`<root>/skills`、`<root>/project-data` 同级），启动前显式设置：

```bash
export TAPCANVAS_SHARED_ROOT=..
docker-compose up --build -d
```

如果你的 `.env` 里仍然使用宿主机本地 DSN（`localhost:5432`），可以继续保留给宿主机工具使用，但容器内 DSN 需要单独配置：

```bash
DATABASE_URL_DOCKER=postgresql://tapcanvas:***@postgres:5432/tapcanvas?schema=public
```

内置服务：

1. `postgres`（持久卷：`hono_api_postgres`）
2. `redis`
3. `agents-bridge`
4. `api`

Compose API 健康后，可从宿主机运行真实认证集成测试：

```bash
pnpm test:integration:real-auth
```

该测试要求 `.env` 显式提供 `REAL_AUTH_TEST_LOGIN` 或 `REAL_AUTH_TEST_PHONE`，以及
`REAL_AUTH_TEST_PASSWORD`。测试只请求已经运行在 `127.0.0.1:8788` 的 API，并只读查询
当前 PostgreSQL 账号身份；不会在测试进程中再创建一套 Hono 应用、恢复 Workflow Queue
或启动后台任务。API 不可达、认证失败或受保护接口失败都会原地失败，不回退到进程内应用。

版本对齐：

- Compose 中 Postgres 版本是 `16`
- API 镜像安装了 `pg_dump 16`（`postgresql-client-16`），避免备份时出现版本不匹配

每次 `api` 启动时，部署链路为：

```bash
pnpm prisma:generate && pnpm db:pg:schema && pnpm db:pg:migrate && pnpm db:pg:seed-patches && pnpm build && node dist/main.js
```

开发态 API runtime 不会在普通启动热路径自动执行全库备份：数据库增长后，无界 `pg_dump` 会同时延长不可用窗口并可能耗尽宿主磁盘，使 API、worker 和数据库恢复链一起失效。需要备份时由部署者显式运行 `pnpm db:pg:backup`。生产 compose 的一次性 `api-init` 会在 schema/migration 前执行备份，写入持久备份卷，并默认保留最近 30 份；备份、schema bootstrap、Prisma migration 或 seed patch 任一步失败都会阻止新 API 实例就绪。生产环境仍必须把备份卷复制到独立故障域并定期做恢复演练，本机卷不能单独视为灾备。

生产 compose 对 `POSTGRES_PASSWORD`、`JWT_SECRET`、`INTERNAL_WORKER_TOKEN`、`AGENTS_BRIDGE_TOKEN`、`NEW_API_INTERNAL_TOKEN`、`NEW_API_SESSION_SECRET` 与 `NEW_API_CRYPTO_SECRET` 执行非空启动校验；缺失时显式失败，不使用开发默认值。PostgreSQL 不再发布宿主端口，API、new-api 与 agents bridge 的宿主端口仅绑定 `127.0.0.1`；对外流量应经过已有反向代理。浏览器跨域白名单由 `CORS_ALLOWED_ORIGINS` 精确配置，不支持通配凭据源。

补充：

- `api` 服务当前设置了 `restart: unless-stopped` 和 `init: true`，避免单次异常退出把整组长期停住。
- 由于 `api` 依赖在镜像构建阶段预装，首次 `docker-compose up --build` 创建空白 `api_node_modules` 卷时，Docker 会先用镜像里的 `/app/node_modules` 初始化该卷，通常不再需要在启动热路径里重新跑完整依赖安装。
- `api` 镜像当前会在构建阶段额外安装 Dreamina CLI，并将其固定放在 `/usr/local/bin/dreamina`；compose 同时显式注入 `DREAMINA_CLI_PATH=/usr/local/bin/dreamina`，供后端 Dreamina runner 直接调用。
- Dreamina 登录态与每个账号的本地 session 不放在镜像层内，而是落到 `/app/project-data/users/<userId>/integrations/dreamina/accounts/<accountId>/...`；由于 compose 已挂载 `${TAPCANVAS_SHARED_ROOT:-../..}/project-data:/app/project-data`，容器重建后登录态仍会保留。

### Dreamina CLI（Docker 内）

当前 compose 方案里，只有 `api` 服务会安装 Dreamina CLI，`agents-bridge` 不安装。

这样做的原因是：

1. Dreamina CLI 的实际调用发生在 `apps/hono-api` 进程内部，由后端 `spawn("dreamina", ...)` 执行
2. agents bridge 不直接调用 Dreamina CLI，没有必要增加镜像体积与额外依赖
3. 官方安装脚本当前仅提供 `Linux x86_64` 二进制；在 Apple Silicon / `arm64` 主机上，compose 需要把 `api` 镜像固定到 `linux/amd64` 才能成功安装并运行 Dreamina CLI

如果你修改了 Dockerfile 或首次启用 Dreamina CLI，需要重新构建 `api` 镜像：

```bash
docker-compose build api
docker-compose up -d api
```

当前 `docker-compose.yml` 已为 `api` 与 `credit-finalizer-worker` 默认设置：

```yaml
platform: ${TAPCANVAS_API_PLATFORM:-linux/amd64}
```

也就是说，在 Apple Silicon 机器上会默认通过 Docker 的 `amd64` 仿真来运行 API 镜像；如果未来 Dreamina 官方补充了 `linux arm64` 版本，再把 `TAPCANVAS_API_PLATFORM` 改回原生平台即可。

进入容器检查安装结果：

```bash
docker-compose exec api dreamina version
```

如果容器内二进制不可用，Dreamina 账号探活与任务提交会显式失败，不会静默回退到其他 vendor。

如果备份或 schema 安全检查失败，容器启动会被阻止。

## AI 对话架构（当前）

- `apps/agents-cli` 的执行内核已硬切到 DeepSeek Harness 官方 `sdk` profile（精确锁定 `0.1.2-alpha.2`）：Harness 负责主 agent loop、会话、Todo、Skills 与子代理；TapCanvas bridge 只负责本轮模型网关注入、HTTP/SSE 事件投影和 request-scoped MCP 授权代理。旧自研 agent loop、`agents.config.json` 与 `AGENTS_PROFILE` 不再是运行路径。Hono 每轮从动态模型目录确认唯一模型后，为当前用户签发短期内部委托凭据，并把 Harness 的模型流量统一送入 owner-scoped `/agents/llm/v1/chat/completions` 或原生 `/agents/llm/v1/responses`；只有 Hono 才持有 `NEW_API_INTERNAL_BASE_URL` 与 `NEW_API_INTERNAL_TOKEN`，bridge 不再接触 new-api 管理凭据，也不会绕过用户归属与计费边界。代理地址或委托凭据缺失时显式失败，不在 Harness 内猜测默认地址或模型。内部委托允许由 Harness 的 OpenAI 客户端按标准 `Authorization: Bearer tc_internal:v2:*` 承载，鉴权层只对白名单内部前缀和 `tc_sk_*` 作 API-key 解析，普通 JWT 不会被误判。Hono 每轮传入的真实输出合同、项目/画布事实、角色与检索约束按字段白名单进入上下文，凭据与内部 bearer token 不进入模型消息。`remoteTools` 直接映射为当轮 MCP tools；`remoteToolCatalog` 必须先经 `tapcanvas_get_tool_schema -> tapcanvas_tool_schema_get` 取得精确 schema，同一请求才允许执行该冷工具，网络/认证/schema/业务错误全部进入真实 tool trace，禁止静默降级。Bridge 还固定提供仅在进程内结算的 `report_delivery`：纯文本根任务由 Harness 主代理在最终回答前完成语义自检并声明 response 合同，Bridge 冻结合同后只绑定实际最终正文 SHA-256，构造 `expectedDelivery -> deliveryEvidence -> deliveryVerification -> PhysicalRunExitV1`；该工具不转发 Hono，也不能用于把 state change 或媒体文本声明冒充为真实执行证据。
- TapCanvas 的公开 `sessionKey` 是稳定的产品对话身份，继续用于 Hono 的 `public_chat_sessions/public_chat_messages`、SSE thread 与后续外部恢复；它不再直接复用为 DeepSeek Harness 的内部 session ID。Bridge 每次创建新的 Harness SDK 子进程时，都会根据用户、公开 session 与本次执行 nonce 派生一个新的不透明内部 session ID；因此全新物理进程不会碰撞到已有但不属于该 live session 的 DSH 持久日志，也不会通过删除旧日志掩盖冲突。跨回合产品历史由 Hono 对话存储和已授权记忆层承担，而不是让不同物理进程盲目复用同一份 DSH live-session 日志。
- Bridge 与 Web 对 `status-update` 使用唯一严格合同：`{threadId, turnId, phase, llmTurn, startedAt, timeoutMs?, deadlineAt?, continuationId?, continuationStage?}`，其中 `phase` 只允许 `agent_reasoning | agent_continuation`。旧版 `{status, runtime, promptPreview}` 不是兼容输入，字段漂移必须显式报 `agents_chat_stream_payload_invalid:status-update`。该事件仅表达真实模型轮次/续跑窗口，不是交付完成证据。生产 Bridge 启动时会把只读源码复制到运行快照；源码更新后必须重建或重建容器实例，禁止用仍驻留的旧快照宣称已经切换协议。
- DeepSeek Harness Bridge 原生实现 `/chat/status` 与 `/chat/interrupt`，不再让 Hono 的控制面请求落到通用 404。Bridge 在受理 `/chat` 前按 `userId + TapCanvas sessionId` 原子写入独立 lifecycle checkpoint，运行中状态同时保留精确 `publicTurnId` 与可中断的 Harness 控制器，终态只根据 Harness 的通用 delivery closure 写入 `logicalTaskState`、`finalResponse` 与 `terminalDelivery`；未发生过回合的合法会话返回 `{durable:true, activeTurn:false, turn:null}`，不是接口故障。checkpoint 使用外部会话身份的 SHA-256 文件名持久化在 `DSH_HOME/tapcanvas-chat-status`，与每个物理执行独占的 DSH session log 分离；Bridge 重启后状态查询读取同一 checkpoint，不复用或删除物理日志。若磁盘 checkpoint 仍写着 running、但新进程没有对应内存 owner，状态层会显式收口为 `failed/deepseek_harness_process_restarted`，禁止把孤儿记录伪装成仍在执行。用户中断只接受同一 session 的精确 turnId，并先持久化 cancelled 终态再关闭对应 Harness 进程；身份不匹配返回 `interrupted=false`，禁止误杀较新的回合。
- Bridge 的部署依赖与运行链同样采用单一真源：`apps/agents-cli` 只直接声明实际 import/启动的 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-sdk-client` 与 `commander`，Harness 内部插件统一由 `@deepseek-ai/dsh` 的精确版本传递拥有，不在应用清单重复钉住。workspace 与生产镜像分别使用根 `pnpm-lock.yaml` 和 `apps/agents-cli/pnpm-lock.yaml`；旧 npm lock、`xlsx`、自研 runtime 的同步配置脚本、Redis/任务图/轮询/子代理预算环境变量、`packages`/`docs` bootstrap 和失效 memory/skills volume 均不再属于 Bridge 部署合同。生产镜像只携带当前 `src -> dist`、`harness/tapcanvas.patch.yml`、`skills/` 与只读 `knowledge/` 运行时资产，缺任一真实输入时在 build/start 阶段显式失败。
- Docker API 每次启动都会调和内置资产：数据库结构发生变化时在迁移/seed 后执行，结构指纹未变时跳过迁移但仍从 `apps/agents-cli/skills/` 幂等同步系统 Skill，并对 `apps/agents-cli/knowledge/` 中声明的编译知识卡先核对正文 SHA-256、embedding 模型和 pgvector 维度，再写入 `agent_knowledge_vectors`；同 ID 已存在时只接受哈希、模型与维度完全一致的不可变记录，任何差异、保留 ID 冲突或表维度漂移都会阻断启动，禁止覆盖后台知识。管理员账号确认后，API 再幂等发布 `all_users` 系统工作流及其不可变 Flow 版本。当前内置问候工作流使用稳定工作流身份 `tapcanvas.builtin.greeting-fixed-reply/v1` 与最新不可变定义版本 2；全新空库启动会自动创建系统项目、3 节点 Flow、版本和 `all_users` attachment，已有部署启动时也幂等调和到同一最新版，因此新用户无需人工安装或装配。该能力只把适用范围作为 capability descriptor 的语义证据，由 agents-cli 自主判断是否调用；Hono/Web 不维护“你好”关键词路由。真实图固定为 `workflow.input.text/v1 -> workflow.transform.fixed_text/v1 -> workflow.output/v1`，最终用户输出只从成功的 `workflow.output/v1` 标准边界读取，不依赖本地 JavaScript、默认 route 或 prompt 兜底。
- 公开 AI 对话明确区分三类事实，禁止再用一个字段同时表达三层含义：`AgentLogicalTaskStatusV1 = active|waiting_input|waiting_external|succeeded|failed|cancelled` 表示用户目标；`AgentPhysicalRunStatusV1 = running|completed|handed_off|interrupted` 表示本次模型/进程窗口；`AgentDeliveryStatusV1 = pending|satisfied|unsatisfied` 表示真实交付核验。共享协议 `AgentLogicalTaskStateV1` 同时携带三类状态、稳定 `logicalTaskId`、根任务节点、修订号与结构化原因。
- 唯一生命周期提交链为 `agents-cli durable owner / PhysicalRunExitV1 -> Hono authority projector -> public session or durable Workflow -> Web logicalTaskState`。每个物理执行都必须声明 `terminalAuthority`：公开根任务由 TaskStore 以 `user_delivery` 签发，只有 `logical_terminal + delivery verified` 才能得到用户级 `succeeded`；直接 Workflow Agent 由 durable Workflow 以 `workflow_action` 签发，其 `logical_terminal/satisfied` 只关闭当前原子动作并把 typed 输出交还 Workflow，不能冒充整章视频已经交付。Hono 会核对调用方式与回执裁决权完全一致，缺失、错配或非法回执均显式失败，不从正文、HTTP 200、模型结束或旧状态回退推断。物理窗口耗尽、provider 等待和真实外部异步受理继续按各自结构事实投影；`requestTerminal`、`runOutcome`、`turnVerdict`、completion trace 和历史 `turn.state` 只保留诊断/审计事实。
- 本章后文中为解释历史执行、Workflow 节点或诊断回执而出现的 `requestTerminal/runOutcome/turnVerdict/turn.state`，均不构成公开对话的当前生命周期 API；若与本节顶部的单轨合同表述冲突，以 `logicalTaskState` 为唯一当前实现。
- Hono 按职责拆分：agents bridge 只校验 agents-cli 的物理退出并构造事实信封；`public-chat-logical-task-state.ts` 负责唯一逻辑状态投影，其中 public chat 与 Workflow action 保留各自的 owner/交付校验入口、复用同一套纯物理退出映射，禁止复制出两套状态真相；公开响应模块负责 schema 投影；public chat orchestration 负责 SSE 发布、会话持久化与 durable continuation 归属；Web 只展示和恢复服务端已提交的逻辑状态，不重新执行 delivery verifier，也不通过恒等状态适配层二次投影。Workflow execution family 由最新物理成员的持久状态裁决：仍有 `queued/running` 成员时等待，最新成员 `failed/canceled` 时直接形成确定性依赖失败，最新成员 `success` 时只接受该成员产出的真实交付资产；成功但缺少合同要求的真实资产同样是交付证据缺失，不启动模型纠偏。异步 continuation 发现这些确定性失败时，必须先用精确 `sessionId + turnId` 将根逻辑任务投影为失败，再结算 continuation，禁止调用新模型、只失败子记录或让根聊天悬空。
- 普通闭卷文本采用原子快路径：新根任务首个模型批次只暴露 `record_user_intent`；当 Agent 已确认不需要 Skill、知识、画布事实或外部工具时，同一个原子信封可同时提交 `responseDelivery.candidate` 与交付标准，runtime 在该批次内完成合同冻结、自检和正文交付，不额外启动“总结 Agent”或第二次模型调用。需要专业证据时 Agent 省略 `responseDelivery`，下一批次再按冻结合同渐进加载能力，不能由 Hono 或 Web 猜测快慢路径。
- 普通对话上下文使用版本化 `chapterCanvasReference@1`，只携带不可变 scope key、节点/边数量、可选摘要和选中节点 ID；不再把整份节点 `data/status/prompt/asset` 快照复制进每轮 prompt，Web 也不保留旧快照截断 selector 或其测试自循环。Agent 确实需要画布事实时，通过已认证的画布读取/搜索工具按需获取。只有已经受理并冻结的 Workflow execution 才保存完整 `workflowCallerCanvasSnapshot(nodes + edges + viewport)`，用于历史复现；普通引用与 Workflow 冻结快照不得互相替代。
- 远程工具目录以 `agents-bridge-remote-tool-surface.ts` 的 Capability Registry 为单一事实源；每项能力统一声明工具名、授权 scope、能力门控、执行语义（只读/幂等 mutation/付费生成/未知副作用）、固定端点和 schema 来源。工具暴露、授权和调度不得各自维护平行名称表或通过 prompt 关键词推断能力。
- 新公开回合不登记“五分钟内必须取得视频供应商回执”的整任务 deadline；Workflow Agent 的一次完整结构化生成使用其真实物理请求边界，不能因为媒体尚未提交而被跨阶段墙钟取消。当前动作若命中模型、协议、权限、计费或供应商确定性边界，必须以结构化原因明确失败；仍有 durable owner 的异步执行继续由该 owner 推进。真实 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 满足后，唯一逻辑状态投影立即提交成功。
- 可复用道具资产已经硬切到 agents-cli 的 `tapcanvas-prop-card` 单轨：canonical 基态使用 `prop-card/v1 + prop-board/v1 + prop-function/v1 + materialIdentity.mode=base`，损坏、展开、污染、缺件或充能等状态版使用同名 `materialIdentity.mode=state` 并绑定精确 `canonicalAssetId/stateKey/stateDescription`。Hono 只暴露并持久化视图职责、可见身份锚、方向/交互/受力/可动部件/材质响应和连续性锁等结构事实，不固定三格/六格、X 光、画幅、模型、分辨率或题材 prompt，也不以质量评分、关键词或最低字数阻断生成。分镜和视频只消费已验真的道具 ID 与状态版本，不在下游重写 canonical 结构；已受理或已生成的道具资产只能追加诊断或新版本。
- 已装配工作流工具没有 schema-only、dry-run 或 preflight 调用：每次调用都会真实启动或幂等认领持久 execution。agents-cli 在同一物理工具批次内即以成功 receipt 锁定该启动工具，后续调用即使更换 `idempotencyKey` 也会被结构性拒绝；跨物理续跑继续由 `durableTaskReferences` 锁定同一 execution。工具结构只能通过 `tapcanvas_get_tool_schema` 读取。工作流的普通恢复统一使用 `workflow-recovery:<sourceExecutionId>` 身份，队列、reconciler 或失败回调并发触发时由 start-service 唯一约束收敛到同一个 recovery execution；余额恢复、撤销取消、模型与定义切换仍保留各自更窄的确定性身份。Workflow Agent 的 `json_array` 传输层只把 `items` 投影到 typed port：缺失/非数组、`minItems` 不一致和数量不足仍显式失败；其它根级传输附加字段只记录字段名诊断后丢弃，不参与下游语义，也不能把已成功 Agent 产物升级为整条工作流失败。
- 已装配工作流启动时同时把调用方项目/章节画布的 `nodes + edges + viewport` 冻结为不可变 `workflowCallerCanvasSnapshot`，执行恢复继续继承同一份快照。`GET /executions/:id/snapshot` 将它独立投影为 `canvasData`；Web 历史弹窗默认按原节点、连线、分组、尺寸与视口展示“项目画布”，内部 Workflow IR 仅放在“执行图”页签，不再把工作流原子 DAG 冒充用户项目画布。旧 execution 没有该事实时只如实展示内部执行图并明确提示，禁止读取当前可变画布伪造历史快照。
- Workflow Agent 的 `workflowRequiredSkills` 与 executor、继承模型、typed output contract 一样属于冻结定义事实。唯一作者窗口必须把这些依赖原样传给 agents-cli 预载，不能在节点执行器中清空后再让模型用 `skill_search` 猜回方法；固定依赖节点不暴露 `skill_search`，只允许按预载骨架用 `Skill` 渐进读取 section/resource。服务端认证的 `executeForcedAgentDirectly` 只在用户已授权运行该 Workflow 的本次执行内挂载冻结依赖，不修改账号设置；结构化候选提交后不再开启第二个作者窗口。

### 画布 AI 执行台与 8798 质量控制台

- 画布中的原“AI 管理工作台”已硬切为当前作用域的“AI 执行台”。默认投影本浏览器正在执行或当前项目/章节/画布最近一次任务的真实状态、`AgentAttentionProjectionV1` 等待原因与下一义务、Todo、异步资产/节点交付证据、失败原因、最近过程日志和当前 Trace 摘要；它不再承载跨项目指标、全局 Trace 检索、人工复核、回归数据集或另一套黑盒编排设计。章节画布的普通登录创作者也可打开这一 owner-scoped 执行投影；管理员编辑 Workflow IR 时直接使用画布工作流节点与统一检查器，不再经过独立编排快照页签。
- 画布执行台只调用登录用户范围的 `GET /agents/diagnostics`，通过显式 `traceId/projectId/bookId/chapterId/flowId/nodeId` 查询当前事实；管理员统计页继续使用 `/admin/agents/diagnostics`。两条路由复用同一观测服务、同一 owner 约束与同一响应合同，不维护第二份 Trace 状态。`traceId` 必须同时进入执行 trace 与标准 span 查询，禁止出现执行记录已收窄、span 却仍返回作用域内其它 trace 的混合投影。
- 本机 8798 是跨服务生产 Trace、Token/耗时/成本、评测事实、人工复核和回归数据集的唯一工程质量控制台。画布以结构化作用域深链打开 8798；8798 从根 span 的 `scope` 生成返回项目/章节画布的链接，并携带 `agentWorkbench=execution + traceId + nodeId`。Web 只按这些显式查询事实打开执行台、加载指定画布并定位真实存在的节点，不从 prompt、文案或节点名称推断页面、工作流或动作。
- MemoryCore 是跨会话的记忆检索/管理层，不是 Web 聊天窗口的历史列表：`L0` 保存原始 user/assistant 对话，`L1~L3` 保存后续提炼的原子、场景和核心记忆；Web 对话历史仍由 Hono 的 `public_chat_sessions/public_chat_messages` 提供。agents-cli HTTP 回合在成功返回后把用户可见的 `displayPrompt` 与 assistant 正文写入 MemoryCore（不会把画布快照等内部 prompt 当成用户问题）；本地单团队部署可用 `AGENTS_MEMORY_CORE_TEAM_ID` 固定 Memory Hub 归属，未配置时沿用请求的 `X-Team-Id`。
- 两个界面是同一事实源的不同投影：画布回答“我当前的任务进行到哪、在等什么、交付落在哪里”，8798 回答“系统整体哪里慢、哪里失败、哪些样本需要复核或固化回归”。任一端读取失败都必须显示真实 HTTP/协议错误；不得复制状态、静默回退到另一套本地诊断数据，也不得把无法读取的 Trace 伪装成空闲或成功。
- 8798 的运行详情按物理运行和 `executionSideEffect` 事实拆分互斥耗时：`physicalRuns[].durationMs` 累计记录 Agent 实际活动窗口；已受理异步媒体任务把 execution 延长至权威媒体终态后，端到端总时长中未被物理窗口覆盖的区间计为“资产生成耗时”。物理窗口内 `paid_generation` 工具调用区间的并集也归入资产生成，其余才是“Agent 耗时”；两者相加必须严格等于样本总耗时，并同时保留套件墙钟和样本累计。并发或重复的生成区间不得重复计时；没有已受理异步媒体等待、也没有真实 `paid_generation` 回执时资产生成耗时必须为 0，禁止依据 prompt、工具名或“这是图片任务”推测生成耗时。每个尝试和工具调用表都展示相同分类，使模型续跑超时、Skill/Schema 空转与真实供应商生成等待可以明确区分。
- 性能冒烟的 `timeoutMs` 与端到端性能预算一致：文本样本 60 秒、单图样本 300 秒。预算到期后测试执行器先向当前隔离子进程发送协作终止信号并等待真实退出；宽限期后进程仍未退出则强制终止，且只有收到 `close/error` 事实后才释放串行批次游标。这样超时不能留下一个继续调用模型的孤儿进程，也不能让 8798 把“已发信号”误报成“样本已结束”。这只约束 8798 测试样本，不改变生产任务的完成优先与持久续跑语义。
- 8798 direct eval 依据真实 tool trace、completion signal 与 delivery verification 对样本判定通过或失败；评测失败不反向注入 agents-cli 运行时，也不存在把单个工具回执或第一次语义验收直接升级为用户任务终态的 fail-fast 开关。Hono 不根据错误正文、工具名或用例类型推断例外，也不追加 prompt 补丁。简单媒体验收明确区分“对话父任务完成异步提交”和“媒体资产已经物化”：父任务以 `completionBoundary=submission` 成功后，验收器先冻结本次隔离画布的节点集合，再只读观察同一画布；terminal delivery 带 `nodeId/taskId` 时必须精确关联该节点，旧回执尚未携带这两个字段时则只允许认领冻结集合之外新出现且媒体类型一致的节点。两条路径最终都只接受状态为 `success` 且带真实 HTTP(S) URL 的节点作为追加 artifact evidence；`queued/running` 继续等待，节点失败原地失败，既有节点不能冒充本轮产物，绝不重复提交媒体任务或把 submission receipt 冒充最终资产。
- 8798 的 `workflow_agent_node` 可显式向生产 `/chat` 发送空 `requiredSkills/mountedKnowledgeCardIds`，用来验证“未装载正文但可检索全部授权候选”的路径。执行器显式传入与 session、MemoryCore task 一致的 `logicalTaskId`，避免检索工具脱离当前 Retrieval Sandbox。测试按真实候选回执检查 Skill/知识卡的 `exact` 与 `fuzzy` 模式，并要求随后的 `Skill/knowledge_read` 使用同一个 `candidateSetId` 和候选 id；Hono 只透传空装载范围和真实工具 trace，不代替 Agent 选择候选。搜索回执只含候选身份、排名、分数和匹配视图；读取回执只含候选 id、类型和 candidateSetId，查询正文、选择理由及 Skill/知识正文不会进入 8798 报告。8798 详情页直接在测试输入/实际输出下方展示候选类型、rank、排序分、匹配视图、精确/模糊标签和同候选集读取状态；只有孤立读取回执时明确显示搜索投影缺失，不从 Hono 文案或工具名推断候选。`knowledge_search.cardId` 与 `skill_search.skillName` 都是结构化精确召回入口；自然语言 `query` 是模糊召回入口。
- 生产对话与 direct eval 都由同一 agents-cli 逻辑任务根据失败事实继续修复；8798 只在执行结束后读取事实并裁决测试样本，不能改变任务语义。每份新冻结的 `UserIntentContract` 都必须经过独立语义审查，包含无需外部事实且 `delivery.promptMediaType=null` 的纯闭卷正文；纯闭卷回答仍可把候选正文放在同一次 root 原子协议中，但不能再由同一个 root 响应自证合同正确。`promptMediaType=image|video` 表示最终正文自身是对应媒体模型的可执行生成提示词；它仍是 `mode=response + mediaType=null`，并只提供同媒体案例源范围。Agent 可在有案例信息需要时调用 `prompt_example_search` 获取候选，再选择性调用 `prompt_example_read`；不搜索、读取零条或多条都由当前任务决定。所有搜索、读取、弃选、零命中、工具未注册、索引/检索失败或无效证据写入 trace/diagnostics，`blocking=false`；无正文则继续原创且不得伪称知识来源。Hono 只透传结构化合同与工具事实，不按文案识别媒体类型、不自动注入知识、不追加 prompt 补丁。
- 公开聊天在没有宿主能力清单、画布节点、素材/参考图、生成合同、章节上下文、强制角色或显式工具策略等结构化执行事实时，首轮仅保留已认证的远程工具目录，不注入完整 direct tool schema；目录仍可用于后续按需发现具体能力。这样普通新项目问答不会因空画布被展开成大体积工具提示。只要请求携带上述任一执行事实，或由宿主显式提供能力清单，仍按完整 direct surface 执行。该分支只读取请求结构事实，不解析用户文案、不做关键词路由。
- 对话计费的 reserve/release 以 `team_credit_allocations` 的批次分配为权威事实。定时清理按每条 reserve 的剩余 allocation 扫描 `agents_chat` 与历史 `chat`，不会因为已经存在一笔部分 release 就把任务排除；同一任务的后续 release 会在唯一账务键下追加剩余分配。结算器只扫描有真实批次 allocation 的记录，跳过无批次的迁移前旧账，避免旧账占满有限扫描窗口；迁移生成的 `legacy_frozen_balance` 记录在能从 `personal_<userId>` 结构确定归属且超过最大保留龄后，由结算器写入可审计的系统 release。
- `UserIntentContract.delivery.output` 是用户交付语义，不是宿主执行路径。agents-cli 根提示、`record_user_intent` 工具说明和公开 JSON Schema 使用同一条通用约束：工具名、当前 App/画布上下文、可用持久化能力或执行便利性都不能自行新增画布、项目、节点、附件、存储或 execution identity；只有用户原话或已冻结的权威引用明确要求时才记录对应落点。独立语义审查继续否决未经授权的目的地，Hono 不按 prompt 关键词补写或删除落点。
- root agent 可以语义判定生成请求的正确 `delivery.mode/mediaType/promptMediaType`，并据此填写规范化 `kind/output`；`promptMediaType` 是 provider-facing 必填枚举 `image|video|null`，独立于终态媒体资产类型，不允许 Hono 从 `kind/output` 或正文关键词推断。独立 reviewer 对每份新合同审查完整 delivery specification，尤其核对图片/视频提示词是否被误记成普通问答；普通问答与真实媒体资产使用 `null`，但同样不能跳过独立审查。
- `async_artifact` 合同本身已经要求至少一个真实终态资产，因此新冻结合同的 `artifactCount` 只允许表达用户明确要求的 `2..128` 个独立终态资产；单资产交付必须省略，仍由真实 artifact evidence 保证至少一个。主体、人物、动物、物体数量和供应商内部 Clip 数均不能映射到该字段。该最小值直接进入 `record_user_intent` 的严格 JSON Schema，防止模型把“一只猫/一张图”误记为额外数量约束；它不使用关键词路由，也不改变多资产交付的精确计数验收。
- `terminal=false` 的声明式本地修订只关闭当前内部候选写入，不取消同一模型批次里互不依赖、尚未执行的安全只读准备；Skill/知识召回与 name-only deferred schema 读取可以继续形成真实回执。外部 mutation、付费生成、未知副作用、普通本地异常或缺少 repair 合同的失败仍停止后续并行调度，避免失败后继续发出不安全动作。这样合同修订后不会把“首轮被调度器取消的 schema 读取”误当成已加载目录。
- `record_user_intent` 的副作用仍是可审计的 `local_mutation`，但新的 root 逻辑任务在合同缺失时只向模型暴露这一项协议工具。Skill/知识召回、name-only schema 查询、画布读取与生产动作都在合同通过独立语义复核后的下一回合重新按结构化合同装配；因此供应商即使不支持 `tool_choice=required`，也不能在意图尚未冻结时先浏览无关目录并把对话长期停留在假的“执行中”。这一投影只检查 `UserIntentContract` 是否存在，不读取用户正文、不预判媒体类型；真正的语义分类仍由当前模型通过 `record_user_intent` 完成。`responseDelivery` 只是 Agent 已语义确认“不需要 Skill、知识或外部事实”时可选的一回合闭卷提交；runtime 不再仅凭 `delivery.mode=response + mediaType=null + promptMediaType=null` 这一结构组合强制要求正文，因为该组合也覆盖专业诊断、创作方案等必须先加载 Skill 的任务。Agent 省略 `responseDelivery` 时，合同照常冻结并在下一回合开放已授权 Skill/证据工具，不把专业路径误判成协议失败。合同冻结后的互不依赖只读准备仍可并行，业务 mutation/付费生成继续由意图合同和单轨交付边界约束。
- `record_user_intent` 的 provider-facing schema 是单层原子信封：完整提交直接在工具参数顶层携带 `referenceResolution/delivery/must/forbid/prefer`，并在非初始修订/内部调用中保留可选 `confirmedFacts/unresolved`。初始准入不暴露 `confirmedFacts`，避免模型把当前长请求逐项重复序列化后才开始真实动作；原始请求仍是后续规划事实源，显式义务仍完整冻结在三个 requirement 数组中。新模型调用必须显式填写 `mediaType=image|video|audio|null` 与 `promptMediaType=image|video|null`；真实生成媒体直接使用 `async_artifact`，不能用“执行结果报告”把终态降为 `response`，资产回填画布/项目也不改变该分类。runtime 只消费这个结构化分类，不读取用户正文做本地语义判断；字段进入冻结合同与哈希，物理续跑不得改写。
- `record_user_intent` 在 schema 前只做 wire 等价规范化：`async_artifact` 的单资产语义删除非法的 `artifactCount=1`，媒体/异步交付缺省的 `promptMediaType` 规范为唯一合法的 `null`；普通文本 response 不推断缺失的 prompt 判别器。该步骤不新增、删除或改写用户语义，并写入 diagnostics。语义 reviewer 要求修订时，`repair.patch` 的顶层数组采用原子替换语义：若命名 `must/forbid/prefer/confirmedFacts/unresolved`，必须提交该字段的完整保留数组加本次修改，禁止把“补两项”误当成 append 而丢失已确认要求。
- 延迟 catalog 工具只允许经历一次“名称发现 → exact schema 激活”切换：某个逻辑工具经 `tapcanvas_get_tool_schema` 激活后，runtime 同一原子更新中把它提升为 exact tool、从通用 `tapcanvas_call_tool` selector 移除，并同时从后续 `tapcanvas_get_tool_schema.name` 枚举移除；最后一个冷工具激活后整个 schema-discovery 工具从能力面撤下。这样 provider 只剩唯一可执行路径，不能在 exact tool 已可用时反复重新查询同一个 schema、制造没有业务动作的假运行。未激活的冷工具继续留在 discovery 枚举中；该切换只读取已认证 operation index，不按用户文案、工具描述或错误关键词做语义路由。

### 一键成片结构化输出权威链路

- `single_submission_record_and_fail` 是 Workflow Agent typed output 的唯一提交策略，也是 Hono、agents-cli 与冻结 Workflow IR 的一等合同。每个逻辑 Agent 节点只允许模型提交一次完整 JSON 产物；提交前的整体自检由当前模型负责。运行时不存在字段补丁、局部 correction 信封、候选合并、旧候选重写、整份重生成、structured retry、fresh replan 或模型切换。非空 `selectedAssetIds` 同样是一等执行事实：BeatSheet 首稿必须依据冻结 `selectedAssetSnapshot` 把每个 ID 精确写入恰好一个根级 `objectRegistry[].referenceAssetIds`，再由宿主确定性派生逐 Beat `assetObjectContracts`；宿主不得猜测、补绑或把拒因回灌给模型，遗漏时该次唯一提交立即以精确结构拒因失败。
- verifier 只执行一次。提示词密度、叙事质量、风格、节奏、参数选择、语义连续性和审计完整度等模型责任只形成 `structured_output_diagnostics`，不改写产物、不阻止安全下游动作，也不把诊断返回给模型。对象账本中的别名称谓、`identityInvariant` 以及相邻 Clip 的自然语言 `endState/startState` 差异也属于记录项：下游只解析这些字段是否存在且类型可执行，不再用字符串逐字相等决定失败或重试。只有 schema/类型/数量、冻结身份键、悬空引用、权限、真实资产 URL、计费幂等和供应商硬限制等可验证的执行边界，才会否决当前节点。
- 硬边界失败时，系统原样保存首次候选、字符数、SHA-256、合同版本和精确失败路径，写入 `structuredOutputSubmissionPolicy + outputContractFailure` 后结束该节点；失败候选和错误说明都不会进入新的模型轮次。显式 replay 只在历史输出完全满足当前合同的情况下复用；不满足时由用户发起的新执行从冻结输入获得一次新的首稿机会，历史候选不会被修补或作为新模型上下文。
- 物理恢复只覆盖“尚未形成提交”的网络中断、provider stream 中断、进程重启和已受理异步结果等待；它继承同一冻结模型与输入，但不得在已有结构化候选后重新生成内容。主 Agent 创建的子 Agent 同样继承父链本轮实际模型；继承失败显式报错，不回落默认模型或备用模型。
- Hono 只编译调用方明确拥有、可由冻结事实唯一推导的机器传输字段，例如稳定 `clipId/clipIndex`、逐字 `dialogueScript` 投影和供应商时间覆盖索引。`storyEvents.entryState/exitState`、Beat `exitState`、Shot 时长、动作、镜头、表演、事件引用、`narrativeAudioPlan`、`sourceFidelityAudit` 等作者字段必须由模型首次完整提交；宿主不补齐、不缩放、不重映射、不规范成另一份语义。
- 模型选择按用户本次 AI 对话实际生效并冻结到 `workflowInitiatingAgentExecution.model` 的值继承，不固定为某个 GPT 型号；只有没有父链模型来源时才使用节点显式模型。`deepseek-v4-flash` 是合法 Workflow Agent 模型，也承担用户新发起 GPT 对话的单次前置放行，但不是工作流内部节点的放行条件：同一用户回合通过后，程序启动的 Workflow Agent、内部轮次、子代理与持久物理续跑全部继承冻结模型且不再调用 DeepSeek。Direct forced Workflow Agent 同样不重复启用公开聊天入口复核。
- 正式 `full_video` 不再以首 Clip 验证作为章级生产闸门：完整 BeatSheet 一次冻结后，资产规划/补图分支与逐 Clip writer 分支按真实依赖并行，全部 Clip 的视频提交在生产计划 materialize 后以稳定 item identity 有界并发。独立 `first_video` 仍只用于用户显式选择的局部验收，不是正式整章流程的隐藏前置步骤，也不能向 `full_video` 注入或改写首段。
- 公开 root Agent 冻结 `async_artifact + video` 后，工具面立即收敛到当前已装配的 `tapcanvas_equipped_workflow_run`；若该工具仍在认证目录中潜伏，只允许读取它自己的精确 schema。章节原文、画布节点和参考资产由 Workflow IR 的 source/coverage 节点读取，根对话不再先做一轮重复事实准备后才启动 execution。这个 producer frontier 只由 agents-cli 的结构化 UserIntentContract 驱动，不按 prompt 关键词或 Hono route 判断。工作流 execution 持久受理、供应商任务受理和最终资产交付是三个不同事实层级；Web/agent 文案必须分别陈述，只有 `taskId + providerAcceptedAt` 能证明视频生产已经开始。

本小节是当前一键成片的权威说明；本章后续若仍出现 v44 及更早版本、writer v11/v12、shot 级对白坐标、十五节点图或“缺配音卡时服务端按名字自动挑音色”等历史描述，一律仅作历史背景，不构成运行时合同。

- `media_delivery/full_video` 只有一张持久 DAG 和一个 execution family：`canvas-source -> delivery-contract -> beat-sheet-agent` 一次交付完整章级 BeatSheet 与同源 `assetPlans`，随后 `asset-coverage` 只做确定性投影，`asset-image-generate` 与 `clip-fan-out -> clip-writer-agent` 并行；汇合后经过 Prompt Package、费用、生产交接、并发视频提交、结果合并、concat 和交付验收。供应商使用原生对白音频时，`voice-materialize` 是由触发器直接产生空 `VoiceManifest` 的纯控制节点，不再运行其结果不会被供应商消费的音色目录、选声 Agent 或试听物化。`prompt_only` 是同一节点合同裁出的无媒体子图，不维护另一套编排器。图片、writer 与视频提交 item 并发上限均为 16，使常规整章 Clip 在同一波启动；并发不改变供应商 receipt、幂等 identity、真实资产 URL 和权限边界。
- 无副作用的确定性节点不再对同一输入做无信息增益的自动重放：结构或协议失败一次即记录并结束当前 execution。空 `narrativeAudioPlan.lines` 没有可执行人声，其 strategy/rationale 只是诊断信息，不取得下游生产裁决权。节点 `modelKey` 只记录真实调用语言模型或媒体供应商的边界；纯投影/验证节点即使历史快照保留模型字段，也不得把它伪装成模型调用证据。
- 能力舱的版本描述符从冻结图完整收集每个阶段的 `workflowRequiredSkills`、`workflowSkillId` 与 atomic Skill 依赖，并把排序去重后的全集纳入 descriptor SHA-256；不能再出现“装配页只声明主 Skill、执行时才发现子依赖”的双重事实。任一冻结依赖变化都会使旧附件明确 stale，必须用新版本重装配。章节画布的持久执行卡按 `executionFamilyId` 解析最新物理成员及其真实节点回执；自动 recovery/rerun 仍属于同一用户目标，UI 不得继续钉在已取消或失败的 root execution 上伪装运行中，也不得因为 physical executionId 切换而新建第二张状态卡。
- Workflow collection 中的媒体 item 使用含稳定 `itemId` 的 runtime node identity，不共用画布节点或付费效果身份。同一 worker isolate 内针对同一章节的 agent 画布读-改-写统一进入按 `chapterId` 分区的写队列：后一个 item 必须先看到前一个 item 推进后的权威 revision 再重建 patch；不同章节仍可并行。数据库 CAS 依然是跨 isolate/浏览器写入的最终权威，冲突时重读最新图并重放结构化 patch，禁止提高旧快照的 revision 后覆盖。
- 章节画布的 `revision` 只承担 CAS 并发写围栏，不等同于图内容身份。Web 复用 IndexedDB 快照时必须同时核对 revision 与完整 `nodes/edges` 内容身份；服务端在保存时若为保护已生成媒体或规范化结构而改变了提交图，PUT 必须返回 `authoritativeFlow`，所有章节画布写桥与 SSE 必须继续传播这份最终持久化图，禁止把提交前的 stale 图贴上新 revision 后缓存、广播或返回。
- Workflow collection 的视频子项终态必须投影回其唯一画布节点。孤儿恢复同时扫描 `submitting/running/queued/submitted`：画布已有 taskId 时只对账该供应商任务；taskId 尚未写回但节点携带完整工作流身份时，恢复器按 `workflowExecutionId + workflowRuntimeNodeId + workflowEffectId + canvasNodeId` 四重结构身份读取不可变 node-attempt item receipt，精确回填已有成功、失败或已受理 taskId。身份不匹配或回执缺失只记录恢复事实，不猜镜头序号、不重新提交供应商任务，也不把语义质量作为完成闸门。
- v64 的人物一致性由完整章级对象账本一次冻结：BeatSheet 的每个 character 对象必须提交非空 `physicalIdentityKey`；剧情称谓、人格、灵魂或意识即使不同，只要共享同一可见肉身，就共享该 key、identityInvariant、身体状态链以及唯一角色卡/参考图。执行层只按结构化 key 去重、绑定和跨 Clip 验证，不从姓名或正文猜同一人；不同肉身不得共享 key。伤痕、附体、情绪、服装和故事阶段只是同一身体的表演/妆造状态，不得另建竞争脸或污染基础身份卡。资产 fan-out 从同一冻结对象合同机械投影 `displayName`：图片节点标题按 `displayName + 角色卡/场景卡/道具卡/特效参考/色彩参考/构图参考` 持久化，视频节点标题按逐 Clip 的结构化 `logline` 持久化；禁止把“工作流图片 N / 工作流视频 N”这类执行序号泄漏成用户资产名，也禁止从 prompt、图片像素、文件名或不透明 assetId 猜名称。
- BeatSheet v20 把章级对象身份、逐段状态与同源资产计划一次冻结：Agent 在根级 `objectRegistry` 注册稳定对象，在根级 `assetPlans` 提交需要参考图的结构化角色，每个 beat 在 `objectStates` 与 `storyEvents` 中提交当前段事实。Hono 与 agents-cli 必须精确接受同一 contract version；完整产物只在 JSON/必需可执行结构、引用身份、调用方冻结事实或供应商硬枚举无法被下游执行时退回。节奏、对白容量、来源分配、叙事锚、状态连续性及其它语义或参数合理性只进入 diagnostics，由 Agent 在整份生成前自检，不形成 Hono/Web 运行时质量门禁。Hono 验真 compact wire 后只编译由已存在结构唯一决定的宿主字段并展开下游 `assetObjectContracts`；`stagingPlan` 已从合同删除，互动轴、机位侧、轴线重建与逐人表演属于 `tapcanvas-video-prompt-writer` 的创作职责。
- 一键成片 v71 的完整章级 BeatSheet v20 首稿预算统一为 8192 output tokens，并要求使用最短完整事实表达，禁止同义复述、背景解释和把同一事实复制到多个字段。画布定义版本号与 SHA-256 执行指纹共同构成准入身份：任一不同都必须在工作流编辑器显示“升级到当前模板”，升级并重新添加前不得执行；禁止出现结构已变化但沿用旧版本号、导致能力舱只隐藏工具而页面仍宣称可运行的分裂状态。Agent 仍必须明确冻结人物 `physicalIdentityKey`、资产 `referenceAssetIds` 与 `referenceRole`，并为未复用的视觉角色提交中性身份锚和禁止漂移事实，因为这些是防止身体/角色漂移的语义身份事实；只有能从 `storyEvents/sourceCoveragePlan/objectStates/assetPlans` 逐字推导的 `sourceFidelityAudit/clipId/状态接力/characters/speakers/dialogueScript/assetId/clipIds` 等传输副本由宿主编译。这个边界压缩的是重复序列化和关键路径时延，不是故事、人物一致性或资产绑定责任；单 Clip writer 仍维持独立的 4096 output-token 合同。
- v71 把 `max clip` 提升为完整一键成片图中的一等结构参数。`beat-sheet-format` 节点硬切为 `max_clip -> video.beat-sheet.take/v1`，以冻结的 `workflowBeatSheetTakeCount=1..1000` 确定性保留 BeatSheet 前 N 个 Clip，并同步裁剪该集合之外的 speech ledger；默认模板显式保存 24，管理员可在“Clip 上限”节点修改，后续版本升级保留合法的已配置值。资产计划、逐 Clip writer、费用、生产交接、供应商提交、结果汇合、concat 与交付验收只消费该冻结前缀；所选 N 个 Clip 全部取得真实持久视频并完成合成后，工作流成功，不要求覆盖上限之外的章节余段。该边界只按有序结构数量截断，不读取正文、质量、风格或模型语义，不是运行中纠偏或语义完成闸门；非法或缺失上限在付费执行前结构性拒绝，运行中不得再把 `22/24` 一类上限外余量留作等待目标。
- BeatSheet 的 `durationSeconds` 是实时供应商目录冻结的物理 Clip 档位，agents-cli/Hono 编译器不得为了容纳对白把它扩成目录外秒数。`sourceCoveragePlan.speechLedger` 的 typed submit schema 在首次提交前即说明逐 Beat 人声容量：默认 4 字/秒、硬上限 6 字/秒，完整台词行必须一次归属到现有 Beat；容量不足时由同一章级 Agent 增加语义 Beat、选用更长的合法档位或重分配完整台词行，禁止删改台词、拆碎一行、伪造语速或由宿主偷偷延长时钟。结构 verifier 仍保留精确容量证据用于同链修订，但宿主投影不能先制造目录外时长、再让允许值校验与之振荡。
- BeatSheet 的 `speechLedger` 是来源人声唯一真源。Video Writer v14 必须在首次完整提交中为每条冻结 `lineId` 作者化一个合法 `speechEvents[]` 事件，并自行给出发声秒数、performance 与对应 Shot。宿主只从同一 `spokenScript` 编译可唯一推导的 Unicode 区间、冻结 speaker/delivery、`speakerBindings` 与 `speechEventIds` 机器索引；不创造缺失事件、不改变事件时窗、不重分配 Shot 时长。缺行、重复、未知 `lineId` 或非法时窗直接记录首次候选并结束该 Writer 节点，不再返回模型修订。静默 Clip 使用同一协议但不伪造人声数组；旧 shot 级对白字段继续硬切拒绝。
- Prompt Package v2 同时保存完整 authoring envelope 与统一 renderer 的紧凑 provider projection。供应商正文只有 `AUDIO / ENTRY+REFERENCES / SHOTS / EXIT` 四段；根 JSON、self QA、creative review、source audit、图片 prompt 与 negativePrompt 不进入视频模型。完整 `temporalFrameTrack` 仍逐窗保存在结构化审计事实中；renderer 只在供应商正文投影时，将时间相邻且 `startState / transition / carryState` 逐字相等的窗口确定性合并为一个连续区间，避免等价状态机械复读。该压缩不解释文案、不删改对白、不改变首尾状态，也不在供应商失败后触发重写或重试。逐 Clip 和汇总 `promptMetrics` 记录 writer 信封字符数、provider 字符数与比例，供 trace、8798 和离线评测比较，不形成语义质量闸门。
- v68 起（当前 v71）正式整章定义冻结为供应商原生对白音频：触发器直接驱动 `voice-materialize` 的纯控制执行器，确定性产生空 `tapcanvas.voice-manifest/v1`，不再调用音色目录、选声 Agent 或试听物化。台词、说话人和表演仍由 BeatSheet 与逐 Clip writer 的结构合同冻结并进入 Prompt Package；Hono 只核对空 manifest、`referenceAudioRequired:false`、模型能力与供应商拓扑。若未来切换为必需引用音色，必须发布另一版不可变 Workflow 定义并恢复精确目录合同，禁止在当前定义运行时按角色名、性别关键词、默认音色或硬编码池兜底，也禁止在同一图中保留原生音轨/引用音轨双轨分支。
- v68 起（当前 v71）的首视频与正式整章触发器都显式冻结 `workflowExecutionRecoveryPolicy: fresh_only`。它只禁止跨物理 execution 的恢复：手动 resume、自动同 family recovery、余额恢复、取消撤销和定义切换都会在读取冻结快照后、产生新 execution 或撤销旧副作用前以 `workflow_resume_fresh_only` 明确拒绝。恢复裁决同时检查来源执行的冻结快照与当前 Flow；因此当前 Flow 切到 `fresh_only` 后，早期未声明该字段的 v67 等历史快照也不能被续跑。下一次生产必须重新取得新的 `executionId`、`executionFamilyId` 与调用幂等身份，不能继承旧 DAG 游标、Agent checkpoint 或媒体提交身份。单个新 execution 内对已受理异步任务的 durable wait/resume 不受影响，以免重复扣费；历史执行和已生成资产保留为审计事实，但不得冒充新链进度。
- 可安全修复的 pre-submit 终态失败由 Queue 在同一 `executionFamilyId` 内自动创建 recovery execution，最多三个物理成员；成功 ancestor、成功 collection item、已受理 receipt 与已生成资产继续复用。`media_generation` 不在自动重提范围，已受理或终态媒体 effect 只做 reconcile/reuse。画布单例状态节点始终投影 family 的 root/latest/recoveryCount 和最新物理成员的真实 node summary，不再把失败 root 的 `queued 0/0` 留作可见状态。
- 工作流启动在创建 execution 之前先编译 scoped DAG，并以 executor registry 旁的端口合同核对每个内置执行器不可省略的输入。当前 `voice-materialize` 必须真实连接 `voice-catalog + voice-plan + estimate`，`production-handoff` 必须真实连接 `prompt-package + estimate + asset-bindings + voice-manifest`；缺边的旧画布直接返回 `workflow_flow_invalid`，不会先运行 BeatSheet、Clip writer、补图或其它昂贵上游节点再在视频提交前失败。节点运行结果是实际产出端口的权威事实；若持久 IR 省略可选 `atomicSpec.outputPorts`，底层执行器只发布唯一实际端口（例如 `result`、`image` 或 `video`），而声明端口与出边拓扑合并后也只有一个唯一正式端口，所有 `once / each / collect` 节点都在公共输出边界把该值确定性绑定到正式端口，`each` collection 同时保留正式端口 lineage。任一侧存在多个端口时不猜测，继续由下游显式报告端口缺失。`video.beat-sheet.take/v1` 现在在输出中冻结 `tapcanvas.beat-sheet-projection/v1` 前缀投影事实；首 Clip 展开只验证该前缀总时长不超过授权总时长，完整 BeatSheet 展开仍必须与授权总时长精确相等。这样 20 秒交付可以先提交合法的 15 秒首 Clip，再由整章 BeatSheet 以不可改写前缀补齐剩余 5 秒；没有显式前缀投影的 15 秒结果仍不能冒充完整 20 秒规划。配音卡物化严格核对目录声明的逐条音频最短/最长时长；只有目录另外显式给出 `maxReferenceAudioTotalDurationSeconds` 时才执行总时长上限，禁止把逐条上限臆造为整组总上限。已有整组配音卡满足该合同就原样复用；显式总预算不满足时保留原卡，以同一冻结 voiceId 和稳定的新节点身份追加 2 倍语速的工作流专用试听版本，避免覆盖或丢弃既有音频。若说话人数乘目录最短时长已经超过总预算，则在任何新音频生成前显式失败。每个 `video.estimate/v1` 节点的冻结快照还必须在受理前具有完整 `workflowVideoModelKey + workflowVideoResolution + workflowVideoAspectRatio`；equipped workflow 的动态调用合同会按实际未固定字段要求 `videoModelKey + videoResolution + videoAspectRatio`，图片节点独立要求 `imageModelKey + imageAspectRatio + imageSize`。这些是实时目录中的运行规格；`UserIntentContract.delivery.resolution/aspect` 只作为用户明确约束核对，禁止再复用同名 `resolution/aspectRatio` 把运行选择冒充成用户选择。当前执行变体只有一个可见 workflow 时，动态工具 schema 不再向 Agent 暴露 `attachmentId`，执行入口按持久能力舱事实唯一绑定精确附件；未显式选择变体时只暴露持久 `primaryForCapabilities` 的主路径和不带变体的普通工作流，非主路径 `first_video` 不与正式整章竞争。按次触发参数注入后仍缺字段时，start service 在创建 flow version/execution 之前返回缺失字段和节点 ID，禁止先消耗数分钟创作再在费用节点失败。该预检只验证图结构、目录键与媒体规格事实，不读取 prompt 或评价创作语义。
- `workflow.collection.take/v1` 是通用、无副作用的有序集合边界：节点用 `workflowCollectionTakeCount=1..1000` 从 `items` 端口确定性保留前 N 个 item，稳定继承 itemId 与 lineage，并发布源数量、请求数量和实际选择数量证据。它用于把批量工作流拆成可独立验收的局部执行（例如完整编译章节 Clip 后只提交第一条视频），不按章节、题材、模型或正文做语义筛选，也不能作为创作质量闸门。
- 创作方法只从 Workflow IR 冻结并由 agents-cli 预载的 required Skills 渐进加载；Web/Hono 只携带真实上下文、短执行目标、typed output contract、安全硬约束和确定性编译器。执行 trace 同时记录 `requiredSkills/loadedSkills`，两者不一致时不能伪称“已预载”。结构失败只记录精确 path、候选哈希与失败事实，不回灌模型；系统也不使用 prompt 关键词、正则、评分、最低字数或本地模板决定创作语义、完成态或是否生成。
- Hono 只做 schema 校验与事实透传，不根据用户文案判断媒体类型、选择知识源、决定检索数量或编排工具顺序；直接对话由 agents-cli 的 `delivery.promptMediaType` 声明图片/视频提示词任务，Workflow IR 则由 Agent 节点的结构化产物合同与 `workflowPromptExampleMediaType` 编译为 `promptExampleRetrievalScope@3 {mediaType, searchPolicy, model?}`。`tapcanvas.clip-prompts/v2` 使用 `required_non_blocking`：agents-cli 必须在首次创作推理前通过统一 Retrieval Sandbox 发起一次 `prompt_example_search` 候选检索尝试；其它提示词任务可显式使用 `agent_discretion`。Workflow Agent ingress 将同一个稳定 `publicTurnId` 同步为 `logicalTaskId`，让检索请求、candidate set 与后续精确读取都绑定当前持久逻辑任务；禁止只传 transport 身份而让 Retrieval Sandbox 拒绝请求。搜索只返回候选元数据，不自动注入正文，也不规定候选数量；writer 再按当前任务的相关性、信息增益、上下文成本与已有证据选择调用 `prompt_example_read` 零次、一次或多次。搜索与读取如实进入 trace，只有成功正文读取按真实 ID/SHA-256 写入 `executionProvenance.loadedKnowledgeSources`。零命中、未读取、工具未注册、索引/检索失败、Skill 缺失或来源版本变化都只能形成 `blocking=false` 诊断并继续原创，不能取得用户任务终止权。纯 `response + mediaType=null + promptMediaType=null` 仍可走闭卷结构快速路径。

- 持久 UserIntentContract 的语义身份按规范化事实计算：可空 `promptMediaType` 的缺省与显式 `null` 表示同一非提示词语义，不得因滚动升级把已独立复核的旧会话误判为合同漂移；真实哈希篡改仍按原规则显式失败。Workflow/画布投影形成的引用 ID 允许最多 512 字符，并在公开 schema 与运行时归一化层使用同一上限，避免“schema 已通过、内部冻结失败”阻塞当前用户任务。
- Skill 候选游标支持结构化弃选：候选召回不再强制加载其中一个 Skill。Agent 若判断全部候选不适用或会扩大用户范围，必须提交绑定原 `candidateSetId`、逐项覆盖全部候选且全部 `selected=false` 的成功弃选收据；runtime 随即关闭该候选游标并重新开放后续能力。同一个 provider 回复若重复提交多份覆盖完全相同认证候选的完整弃选收据，runtime 只保留第一份并按 `candidateSetId` 收敛其余协议重复项，避免等价只读声明挤占工具预算；部分候选、冲突选择和真实 Skill 加载不会被合并，仍按严格 schema 显式验真。若选择加载，则恰好一个候选必须 `selected=true` 且与 `skill` 相同，初次 section 读取只能使用运行时投影的精确 `sectionId` 枚举，`resource` 要等 Skill 骨架给出真实路径后才能读取。该协议只验证候选身份与收据完整性，不用本地规则决定哪项语义上适用。
- 市场案例来源是不可变数据：向量同步只读取 `prompt_library_entries` 与来源/模型关联，按内容指纹增量 upsert `agent_knowledge_vectors`，不删除向量、不更新提示词来源表。采集器再次遇到已有来源时只更新最近发现时间；若该来源的规范化原文哈希变化则显式拒绝覆盖。候选数量由 Retrieval Sandbox 的有界请求和真实相关性决定，正文数量由 Agent 的选择性读取决定；不存在业务层固定 Top K、最少读取数或自动正文预取。搜索、弃选、零命中、工具未注册、索引故障、检索失败或正文无效都进入 trace/diagnostics，无证据继续原创；知识覆盖不得评价提示词语义质量，也不得阻止创作、付费提交或交付。已受理媒体和已生成资产更不能因此被拦截、回滚或丢弃。
- 创作链的语义诊断统一没有终态裁决权：montage 是否适合叙事、Clip 是否欠拆、对白容量、跨时段、运动密度、字段互抄、来源覆盖、叙事验收、ffprobe 音轨/时长/清晰度和评分只写入 diagnostics 或供 agents 当前链修订；不存在可重新开启这些门禁的环境开关。纯 T2V 的冻结资产集合可以为空，Hono 不能以“至少要有一张锚图/设计板”为所有视频的起跑条件。只有当本轮合同显式声明了 `referenceAssetIds/referenceImageNodeIds/firstFrame/lastFrame` 等输入依赖时，对应真实 HTTP(S) URL、权限、供应商数量/尺寸/时长上限和付费幂等才是 pre-submit 硬边界。
- 视频状态的用户交付只以持久画布终态节点上的真实、耐久 HTTP(S) 最终视频 URL 判定：冻结 finishing 合同时要求真实 master URL，否则要求 canonical concat URL。URL 已存在即先满足交付；缺失 narrative/finishing verification、音轨或时长复核不通过都追加为 `deliveryVerification.diagnostics[]=postGeneration.*`，不能把已生成 master/concat 改判失败、触发自动回炉、覆盖或丢弃。真实最终 URL 缺失、不可持久访问或节点不属于当前 run 仍是结构化交付失败。
- 提示词案例的定时补充由管理员画布工作流调用 `tapcanvas_prompt_library_sync`，而非在 Hono 中按用户文案固定分流。上游 JavaScript 节点负责产出可编辑的 `tapcanvas.prompt-sync/v1`：每个来源声明 HTTPS origin、robots、最多四个发现入口、详情路径边界和详情解析器；当前 YouMind / OpenNana 使用内置结构适配器，新站点可在管理员可信的无环境变量子进程中提供 JavaScript 详情解析器，无需扩展工具枚举。协议硬限制每批 `1..50` 条、最多十个来源并采用 round-robin；当前执行身份与稳定幂等键共同构成批次幂等域。执行器逐项验证同源 URL、robots 与禁止路径，只读取允许的公开 landing/sitemap/detail HTML；已有 `source_url` 是增量游标。每条案例必须先将全部图片/视频归档到 TapCanvas R2，再按不可变原文与 canonical hash 导入；新条目完成后刷新相互隔离的 `market-validated:image` 与 `market-validated:video` 向量根。工具只返回后台受理或已最新的事实回执，不把异步采集伪装成当场完成。

- 导演台全景环境使用统一的无视差环境穹顶：2:1 等距图与普通背景图在 Web 编辑视口、截图和动画离屏渲染中共享 `skybox / skyboxYaw / skyboxPitch` 事实合同。穹顶球心跟随当前相机，避免导演视角或机位平移产生错误背景视差；`skyboxPitch` 只做 `-45..45°` 的确定性地平线俯仰校准，使背景地面与 `y=0` 导演网格对齐。Hono 仅验证 URL、类型和数值边界并原样持久化，不从图片内容推断地平线，也不覆盖已有导演台的人工校准。

- 回合恢复与新消息收口：Web 会先通过 `/public/agents/chat/status` 确认持久回合，并在公开状态快照前尝试精确续跑可恢复的孤儿回合。agents-cli 的 status 读取只投影持久 `rolloutState`、冻结合同与恢复所需历史，不再让 `userIntentContractReview/pendingTerminalDelivery` 终态证据承担生命周期控制权；终态证据完整性异常会按会话指纹写入一次结构化诊断，但状态接口仍返回权威回合事实，避免前端因不可读状态永久封闭输入。`promptMediaType=null` 与字段尚未出现表达同一“非媒体提示词”事实，合同哈希使用同一规范身份；`image|video` 仍进入哈希并保持类型差异。若续跑后服务端仍确认 `activeTurn=false`，旧 checkpoint 只作为诊断与追溯事实保留，不得锁死新消息；权威快照确认回合仍在 `running`/`suspended` 时，输入进入同一逻辑任务的续做路径，`needs_input` 则保持结构化回答入口。状态查询尚未落定时 Web 继续等待以避免身份竞态；查询已经显式失败时只展示诊断，不再把状态可观测性当作发送闸门。“开启新对话”仍通过 `resetSession=true` 完成服务端会话边界硬切换。
- 公开聊天的视频交付不再执行“五分钟未取得供应商回执即终止整条任务”的用户级硬截止。`taskId + providerAcceptedAt` 仍是“供应商已开始生产”的唯一事实，工作流受理、Agent 运行、图片完成、页面动画与排队都不能冒充该状态；但等待过久、单个 Agent 物理窗口结束或局部 verifier 失败只记录结构化证据并回灌同一 durable execution family 继续修复、重规划或等待外部回执，不能取消尚可推进的整章 Workflow、continuation 或根聊天回合。`tapcanvas-public-chat-video-production-deadline-v2` 与 `workflowExecutionControl@2` 只用于解释硬切换前已经持久化的历史 execution/事件；新公开回合不再创建 deadline job、不再向 Workflow 注入 production deadline，状态查询也不再执行 deadline worker。供应商已受理或已生成的媒体始终保留、对账和交付，不回滚、不覆盖。
- `record_user_intent.continuityOverrides` 以历史 requirement/fact 的精确 `itemId` 作为撤销身份。模型把一个全局唯一 itemId 搭配到另一份仍存在的历史 `contractHash` 时，agents-cli 会按全部冻结 continuity contracts 确定性重绑到唯一真实 owner；同 ID 出现在多份合同则返回 `continuity_override_ambiguous_item`，完全不存在则返回 `continuity_override_unknown_item`。该投影不读 statement 语义，只修复合同归属抄写错误，仍要求本轮用户提供明确 change reason，避免一条合法的当前变更因为哈希分组错误反复消耗物理窗口。
- agents-cli 的 `general` profile 同时承载普通问答与真实工具驱动交付；默认单次模型截止与统一 post-tool continuation 边界保持为 300 秒，避免章节正文、素材清单等大工具回执后被较短 profile clamp 每分钟重复切断。初始/大型 typed output 仍受 900 秒边界与根物理预算约束；单次超时只记录结构化诊断并结束当前推理动作，durable continuation 必须复用同一 logical task、检查点和已成功工具证据继续，不能重放已受理动作或把局部超时升级为用户级失败。
- `record_user_intent.delivery.durationSeconds` 只记录用户明确给出的可换算总秒数；未指定时必须省略，工具合同明确禁止用 `0`、`0.1`、极小正数或其它哨兵伪造未知时长。该约束避免无依据的时长事实触发独立审查修订；真实物理 clip 档位仍由 workflow 根据实时供应商目录冻结，不由 Hono 或 Web 猜测。
- BeatSheet 的无新增叙事人声只有一个规范空态：`narrativeAudioPlan={lines:[]}`。该对象由模型在首次完整提交中直接作者化；agents-cli 与 Hono 不再把 `[]` 改写为对象，也不为非空错误形态补字段。非法形态按一次性结构失败记录，fan-out 不猜测其语义。
- 首 Clip 快速启动产物 `tapcanvas.launch-beat-sheet/v1` 与完整 `tapcanvas.beat-sheet/v2` 共用同一组机器字段投影，但不共用章级语义验收范围：首 Clip 合同强制 `beats.length=1`，在 Agent 请求中明确 `assetObjectContracts[].referenceRole` 只能使用 `none/identity/wardrobe/prop/environment/palette/composition/vfx`，并在 Hono typed-output admission 处依据已显式冻结的对象 `kind` 确定性投影非法或缺失的 role（`character→identity`、`scene→environment`，其余对象使用同名职责）；精确空数组 `narrativeAudioPlan=[]` 同时投影为 `{lines:[]}`。该投影不读取名称、prompt 或剧情正文，不新增对象、资产或创作事实；未知 kind、非空错误旁白数组及其它结构错误仍原样失败。这样快速首片不会先被通用 JSON 外壳宣告成功、再在 fan-out 因同一机器枚举错位连续失败。
- 生成提案点击与回合恢复使用同一结构化事实链：`generation_task` 提案卡的“生成”按钮把 `proposalId/kind/title/prompt/model/parameters/nodeId` 放入 `chatContext.generationProposal`，Hono 只做 schema 与事实透传，agents-cli 以该提案作为本轮唯一执行对象；按钮显示文案不再承担规格或媒体类型推断。提案仍处于 `proposal` 时不伪称已提交，只有真实供应商受理后才投影 `queued/running/accepted_async`。终态验收候选在同一 `checkpoint revision` 上连续达到三次结构化失败（包括 reviewer 超时）后清除可逆候选并把失败事实回灌同一逻辑任务重规划，禁止再次重开同一物理 reviewer 窗口；已有副作用与资产证据保持不变。
- 对话发送准入分为两条确定性时序：用户点击发送时，Web 要求会话身份已经稳定且实时文本模型目录中已有明确选中模型；已取得的持久状态用于选择续做/回答入口，但状态传输失败时仍提交普通请求，由 agents-cli 的 session admission 原子决定“启动新回合”或返回精确 `chat_turn_inflight`。只有服务端确认存在在飞回合后，Web 才把原用户请求自动持久化为该逻辑任务的 `follow_up`，禁止因前置状态 5xx/超时让输入永久禁用，也禁止在客户端臆造 idle 或并行启动第二回合。点击瞬间先显示“正在校验并提交请求”，随后以 SSE `onOpen` 作为执行器真实受理事实；画布命令、首页挂起 prompt 等程序化派发仍可在面板初始化期间触发并保留有界等待。模型目录失败仍显式阻断，不使用旧模型或默认模型兜底。

- 物理执行窗口与用户对话严格分层：tokens/turns/tool calls/wall time 的预算值、physical run/request UUID、checkpoint revision、`durable evidence`、`resume_from_evidence` 和状态查询接口只存在于结构化 trace、ledger 与内部 completion rationale。`/public/v1/chat/completions` 是 Tanvas 等外部宿主的同步 OpenAI 兼容边界：若内部物理窗口进入持久续跑，门面必须丢弃该窗口缓存的模型/诊断正文、保持原 HTTP/SSE 请求与心跳，并按同一 `sessionKey + publicTurnId` 对账到 `succeeded/needs_input/failed` 用户终态；只有带 `final_response` 正文证据、`deliveryVerification@2/satisfied` 且两侧 `contractHash` 一致的成功终态才能作为 assistant 正文结束。禁止再返回 `202 chat.completion.pending`、把“任务仍在处理中”写成 assistant 内容、要求宿主重发原请求，或把内部 API 路径、任务编号和精确预算暴露给宿主。等待超过显式 15 分钟边界时原地返回 `xiaot_logical_turn_timeout`，持久任务本身仍由原 owner 继续，不重放业务副作用。agents-cli 消费 Responses SSE 时必须按 provider 的稳定 `item.id/call_id` 合并增量事件与 `response.completed.output`；网关省略 reasoning item、压缩终态数组下标并剥离终态 item id 时，只允许按同类型/角色的协议序位配对无 id 终态项，不得按正文或压缩后的 `output_index` 猜测，否则同一正文会被重复累计、触发无效终态修复和渠道限流。

- `UserIntentContract@2` 的 `delivery.kind/output` 是协议必填的规范描述，不要求逐字出现在用户原话中；`must` 至少包含一项忠实于当前用户请求的核心结果义务，问候或极短问答也不得提交空数组。审查器允许依据原始请求与正确的 `mode/mediaType` 生成不扩张的简短释义，但不得添加用户未要求的风格、质量、数量、规格或落点，也不得要求删除必填字段。`artifactCount/durationSeconds/clipCount/aspect/resolution` 等可选具体规格仍只接受当前请求或权威历史合同中的明确事实。主体、人物、动物或物体数量只描述资产内容，不等于独立终态资产数量，例如“生成一只猫”不能据此填写 `artifactCount=1`；协议为使必填 `kind/output` 通顺而使用“一张图片/一条视频”等单数描述，也不等于用户明确冻结了 `artifactCount`。这样简单请求不会因空合同或“审查要求删字段”与“schema 强制字段”的冲突而首轮失败，同时不放宽对臆造规格的拒绝。

- 依赖型异步续跑使用机器强制的副作用围栏，而不是只依赖提示词。图片、视频、音频或工作流一旦返回可寻址的 `accepted_async` 依赖，`artifactDependencies@2` 中的精确 `nodeId/taskId/runId` 就成为该交付的唯一 owner；sweep 只在该 owner 出现新状态证据后认领续跑。进入 dependency continuation 时，Hono 会同时从 hot tools 与 deferred catalog 移除原始图片/视频提交、配音、导演渲染和新 workflow begin 等会建立平行供应商任务的入口，即使原始回合的 allowlist 曾显式包含这些工具也无法重新放行。当前窗口仍可使用 `flow_get`、`image/video_reconcile` 与 workflow inspect/resume，完成对账、验收或推进同一 durable execution；不存在第二套编排工具。物理预算/replan 窗口不应用这条依赖围栏；它们继续服从各自权威 progress cursor。该边界只根据持久 continuation 类型和精确依赖元组收窄能力，不读取用户正文、prompt、节点标题或具体章节，因此不会形成 case-specific 路由；已生成资产始终保留。

- 公开对话等待 Workflow execution family 时，continuation 使用持久项目与规范画布身份核对依赖作用域：项目普通画布使用 `flowId`，章节画布使用 `chapter:<chapterId>`。章节回合中的空 `flowId` 不再与 Workflow 执行的规范章节 canvas ID 直接比较，避免已成功的章节成片被误标为 `dependency_terminal`、根回合长期留在 `waiting_async`。该匹配只校验项目与结构化作用域身份，不读取章节文本或工作流语义；依赖续跑仍受上述副作用围栏约束，不会重新提交已受理的媒体任务。

- 图片、视频与音频统一使用项目级媒体资产合同：真实对象存储 URL 产出后必须写入 `assets`，资产行保存 `type/url/sourceUrl/projectId/flowId/nodeId/chapterId` 等来源事实，画布节点同时保存 `assetId`（上传节点兼写 `serverAssetId`）及对应 `imageResults/videoResults/audioResults`。浏览器上传的 image/video/audio 共用 `/assets/upload` 或 `/assets/upload/presign -> PUT -> /assets/upload/commit`，音频不再保留 blob URL 作为成功兜底；生成音频由 `tapcanvas_generate_audio_to_canvas` 在落画布前登记资产。若媒体已经真实产出而资产登记失败，必须保留媒体 URL 和成功生成的画布节点，并写入 `assetRegistrationStatus=failed` 与明确错误，再返回部分成功错误；禁止丢弃、覆盖成品或宣称完整成功。生成视频继续由统一 task hosting 写入资产，reconcile 回填 `videoResults[].assetId` 与节点 `assetId`。

- Node API 在任何 workflow startup recovery 之前，必须先从共享 Redis 获取按数据库命名空间隔离的 generation lease。租约使用随机 generation token、定时 compare-and-renew，以及 drain 完成后的 compare-and-delete；第二个连接同一 Redis/数据库的 API 在监听端口前以 `workflow_runtime_owner_already_active` 显式失败，不能把健康 owner 的 `running` Agent 节点改写成 `workflow_runtime_restarted`。运行中一旦续租失败或 generation 被替换，当前 API 立即关闭 readiness、停止本地调度并 drain；旧进程未完成关闭前不释放所有权。这与 Agent turn generation fence 共同形成“全局 runtime owner → execution → node attempt → physical Agent generation”的单轨所有权链。

- 本地宿主机方式启动 API 与 agents bridge 时，Redis 使用 Compose 中同一持久卷实例，并只发布到 `127.0.0.1:${REDIS_HOST_PORT:-6379}`；宿主机进程必须显式设置 `REDIS_URL=redis://127.0.0.1:${REDIS_HOST_PORT:-6379}` 与同值 `AGENTS_REDIS_URL`，容器内服务继续使用 `redis://redis:6379`。禁止让宿主机进程继承容器 DNS 名后以 Redis 不可达状态运行，也禁止为“看起来可用”而另起一套空 Redis，避免 durable continuation、队列唤醒和实时广播形成双真源。

- agents bridge 在模型结果、工具回执或终态 checkpoint 已形成后写入 PostgreSQL 时，只允许由会话持久化层重试同一不可变 `meta/snapshot/completion` 语句。瞬时 transport code、连接类 SQLSTATE、序列化失败或死锁最多进行三次有界补写，并输出不含会话正文的 `agents_pg_session_persistence_retry={operation,attempt,maxAttempts,nextDelayMs,errorCodes}` 诊断；外层 workflow/Agent 节点不得因此重新调用模型或重放工具、图片、视频和计费动作。连接建立单次上限为 10 秒，并通过 keepalive 与有限连接寿命淘汰陈旧 socket。补写耗尽或确定性数据库错误继续返回真实失败，Redis 仍只是短 TTL 镜像，不能被当作 PostgreSQL 成功证据。

`llm_response_too_large` 被视为可恢复的物理窗口边界。宿主从不可变的 accepted-request snapshot 与精确 recovery checkpoint 重建同一逻辑任务，不要求用户重发，也不重新解释 prompt。由于响应超限发生在工具调用受理前，这条恢复路径允许没有 durable business-run frontier；普通预算续跑仍必须持有 task/run 或 durable-action 证据，以避免重复副作用。

本地 agents bridge 的 post-tool continuation 时限与执行内核默认值统一为 300 秒。完整结构化工具参数（例如整章动态 BeatSheet）不得被历史部署层 180 秒覆盖提前截断；超时仍是物理执行证据并进入同链修复，不是用户级失败。`general` 公共执行档的单次 provider 推理默认边界为 60 秒：它同时承载普通对话与真实工具驱动交付，不能再用 10 秒快速对话阈值反复取消健康但仍在推理的请求；部署仍可通过 `AGENTS_GENERAL_INFERENCE_TIMEOUT_MS` 显式调整，且始终受根物理窗口、外部取消与 900 秒 provider 上限约束。

公共对话中的 workflow family 恢复采用窄授权：普通 root 回合不暴露 `tapcanvas_workflow_resume`；只有管理员，或携带精确 `publicTurnId` 且根 execution trace 仍为 `waiting_async`、`logicalTaskId/rootTraceId` 均指向该 root 的 machine-owned continuation，才能在当前 project/canvas 作用域发现并调用它。恢复路由继续逐项核对 execution owner 与 flow，已终态 root、错 user、错 lineage 或跨画布 execution 均无权恢复；该授权只开放同 family resume，不开放管理员 `tapcanvas_workflow_run`，也不放宽 agents-cli 对第二次 `tapcanvas_equipped_workflow_run` 的防重复 fence。因而物理 workflow 的结构化输出失败可以回到同一逻辑任务创建 recovery execution，复用成功祖先和供应商回执，而不会形成平行任务或重复媒体扣费。

workflow family 的物理恢复使用 `recovery_snapshot`，不再只复用失败节点的严格祖先。Hono 会对整张不可变 DAG 快照逐节点比较执行签名：输入与合同未变的全部成功节点（包括并行 sibling 分支）直接复用；失败、取消或外部等待的 collection 节点把每个 `success/failed/waiting_external` item receipt、`taskId/canvasNodeId` 与 `externalCheck` 原样写入 replay checkpoint；发生真实节点配置变化或当前合同不再接受旧输出时，才机械失效该节点及其后代。新 recovery execution 只要加载了 checkpoint，就对所有 executor 设置 `resumeOnly`：已受理媒体先按原 taskId 对账，成功项不重跑；失败 item 是否允许再次执行由冻结 executor semantics 的 `retrySafety + resultLookup.outputField` 机械裁决。`unsafe` 动作以及已经持有声明结果收据（例如 `taskId`、`videoUrl`、`childExecutionId`）的失败付费/外部动作只保留并对账，不能被恢复解释成新提交；`safe` 无副作用动作、`agents.logical-task/v2`，以及声明了稳定幂等身份但在供应商提交前失败、因而完全没有结果收据的动作，才在同一 execution family、同一 runtime-node effect identity 下重新执行。这样 definition cutover 可以修复真正的 pre-submit 合同失败，同时不会把已有供应商任务变成第二笔扣费。该规则只依据冻结图、executor execution semantics 与持久回执，不读取章节名、prompt、模型或创作正文。

workflow family 恢复在创建新 execution 前会对发现的 Agent turn 执行本地传输、agents runtime 与 durable continuation 三平面中断。任一平面返回 `unknown/failed` 时仍拒绝恢复；诊断详情同时返回每个失败目标的 `sessionId/turnId/nodeId/runtimeNodeId`、三平面精简回执，以及失败平面的原始错误码与消息，便于依据真实中断证据修复，禁止以笼统计数绕过 fence 或重复创建付费任务。

agents bridge 的 inactive `/chat/interrupt` 是独立生命周期控制面：它只读取持久 `rolloutState` 与可选冻结合同，并以局部 JSONB 更新写回中断后的 rollout。其它终态交付证据即使因历史版本漂移而结构无效，也不得阻断精确 `sessionId + turnId` 的中断；异常证据原样保留供后续诊断，普通会话恢复仍继续执行完整合同校验，不能借中断路径清洗、覆盖或接受无效交付。

Workflow 结构化对白提交视频前，不再把配音卡的长试听正文直接交给视频模型。当前正式整章合同冻结为供应商原生对白音频：`voice-materialize` 使用 `video.voice-manifest.empty/v1` 从触发器确定性输出空 `tapcanvas.voice-manifest/v1`，不再把未被生产计划消费的 `voice-catalog -> voice-plan-agent -> voice-manifest.materialize` 放在供应商 POST 的关键路径。台词唯一真源仍是完整 `speechEvents`，shots 只引用 `speechEventIds`，供应商从 Prompt Package 的冻结对白与表演事实生成原生音频。未来只有显式切换为 `reference_manifest` 的另一版结构合同，才可重新引入精确音色目录、选声和短音色校准资产；禁止在当前 v71 定义里按运行时条件维护双轨。视频估价输出携带完整 `generationContract`，`production-handoff` 把它复制到每个 Clip；若它与估价合同或模型身份不一致则原地失败。逐 Clip 并发提交读取同一份冻结时长、参考图和空参考音频清单。同一物理 execution 内已经受理的媒体任务只做 receipt 对账，不会因 durable wake 再次提交；`fresh_only` 禁止把这些 receipt 继承到另一个 recovery execution。

- 本地 Node/Compose 的持久 workflow 恢复采用独立单一生命周期所有者：`api` 只接收 HTTP、冻结 execution，并把精确 `executionId + nodeId + nodeRunId + attempt + phase` dispatch 写入 Redis；唯一 `workflow-runtime-worker` 先取得数据库命名空间租约，同步执行 `restorePersistedWorkflowState`，完成中断 execution、queued node 与 waiting node 的恢复后才注册 BullMQ 消费者并标记 ready。API 重启、内存压力或长 HTTP 请求因此不再终止已经持久化的 Workflow 节点；Worker 重启则从 PostgreSQL/ExecutionDO 的真实游标恢复，不能以 Redis job 自身宣布业务完成。Redis pending-dedupe 只在 job 被领取前折叠相同 dispatch，领取后立即释放；节点活跃所有权仍由 ExecutionDO 的 `nodeRunId + attempt` CAS 与持久心跳裁决，所以 reconciler 重投不会产生第二个有效 attempt。`credit-finalizer-worker`、`agent-api-worker` 等进程虽然复用 `createNodeWorkerEnv` 获取数据库与工具绑定，但不得触发全局 workflow restart recovery 或消费 workflow node queue。启动期恢复因为 Worker 尚未注册消费者，可立即接管；ready 后的周期恢复则使用本地活跃 driver 与 append-only `node_started/node_recovery_started/node_external_check_started/node_heartbeat` 所有权事件组成的持续租约证据。物理节点协程必须用精确 `nodeRunId + attempt` 每 15 秒续租；Durable Object 只接受当前 `running` attempt，旧 attempt 的心跳和迟到结果统一被 fencing，协程收到 ownership lost 后立即取消。只有最近一次合法心跳超过有界宽限期且二次本地所有权检查仍为空时，才把 `running` 节点判为孤儿并递增 attempt。这样长 Agent turn、数据库扫描与外部轮询交错时都不会发生 TOCTOU 误接管；常态 queued/waiting reconciler 只重发持久 dispatch，不把新近活跃节点伪装成 runtime restart。
- Agent workflow 的 admission trace 与 durable turn 是两份独立事实。若 durable turn 尚未出现但 admission trace 仍是 `running`/`waiting_async`，只有在激活宽限期内才继续等待；超过宽限期即按 `workflow_agent_durable_turn_missing` 写入结构化证据并进入有界 physical retry。该恢复不重放已有业务回执或供应商动作，避免陈旧的 `running` 投影被外部检查无限轮询，也不会把传输故障伪装成用户级语义失败。
- Workflow Agent 的结构化失败只记录并结束当前逻辑节点，不创建局部修复生命周期，也不在同一 execution 内开启新的内容生成窗口。资产规划的运行时结构合同必须在首次调用前完整投影到 agents-cli：新建 `character://` 资产时，`referenceType/roleName/characterAssetRole/characterProfileVersion` 是按 role 冻结的精确事实，`identityAnchors/prohibitedDrift` 是 Agent 作者字段；下游不得要求模型未在 output contract/schema 中看见的字段。
- Node API 在取得 workflow 恢复所有权之前必须先通过双向 Agents 传输预检：`AGENTS_BRIDGE_BASE_URL` 证明 Hono 能调用 agents-cli，`TAPCANVAS_API_INTERNAL_BASE`（或显式 `TAPCANVAS_API_BASE_URL`）证明 agents-cli 的远程工具能回调同一 Hono。任一地址缺失、不是绝对 HTTP(S) URL时，进程在扫描或修改持久 execution 之前原地拒绝启动，避免错误配置消耗节点重试预算并把可恢复逻辑任务投影成终态。运行中若该回调配置事实异常，`agents_remote_tool_callback_base_missing` 仍投影为带持久证据的 `suspended` 传输中断，而不是用户级失败。Node 版 Durable Object 的调度图属于可重建的进程态；若已排队的 `waiting_external` 检查先于启动恢复到达，DO 只从不可变 flow version、当前 node runs 与最新事件序号重建同一 scheduler projection，再继续精确 `nodeRunId + attempt` 检查，不递增 attempt、不重新执行节点，也不把旧检查消息当成新媒体提交。本地 timer queue 对 `executionId + nodeId + attempt + phase` 执行单飞去重：节点自排的下一次外部检查与 15 秒全局 reconciler 投递折叠为同一个计时器；计时器进入处理器前释放身份，使当前处理器仍能安排唯一继任检查。新 attempt/新 phase 不被合并，失败处理器仍可由下一次 reconciler 重新发现。该边界只去重本地调度消息，不吞掉持久进度，也不会改变供应商 taskId。重启恢复读取 PostgreSQL 快照遇到 SQLSTATE `40P01/40001` 或 Prisma `P2034` 时，只对当前无副作用读操作做最多三次有界重试并记录结构化 operation/attempt/code。deadline worker、状态读取和用户中断可能并发结算同一 continuation；其 `Serializable` 结算把 continuation claim、repair owner 与 run 终态放在同一纯数据库事务内，遇到同一组结构化并发错误时允许重放整笔已回滚事务并记录精确 continuation identity。供应商调用、计费、媒体提交、画布写入和任意跨事务动作绝不进入该重试边界，因此数据库仲裁不会重放付费副作用。预算耗尽或非瞬时数据库错误继续原样使动作失败，不做静默回退。
- `waiting_external` 必须同时持久化版本化 `externalCheck@1` 调度回执，执行器只能二选一：`poll + notBeforeAt` 表示到绝对时间后检查同一 provider/task/turn，`signal_only` 表示不创建轮询任务、只由人工响应或其它显式外部事件唤醒。队列只执行这份机器回执，不从错误文案、prompt、模型名或工作流名称推断节奏。媒体与子工作流使用显式供应商状态检查周期；Agent 普通持久 turn 使用显式状态周期；结构修订使用短同链唤醒；`llm_http_429` 逐字采用持久 `retryNotBeforeAt`；`provider_balance_required` 使用一分钟低频检查且禁止模型/供应商重放；Human Approval 固定 `signal_only`，由响应路由写入事实后精确投递一次。collection 节点把每个 waiting item 的回执一并持久化，并以最早 timer 作为聚合唤醒点；若全部为 signal-only 则整个 collection 保持休眠。启动恢复和 15 秒 reconciler 会读取同一回执：未来 timer 按剩余时间排队，signal-only 跳过；旧持久等待若尚无该字段，只允许立即做一次无付费副作用的 receipt refresh，取得正式回执后不再使用统一 5 秒兜底。这样余额不足、限流、普通媒体处理中与人工审批不会共享一个硬轮询节奏，同时不改变 node attempt、供应商 taskId、幂等身份或任何已经生成的资产。
- Hono 与 agents-cli 当前共同签发并执行 `tapcanvas.beat-sheet-artifact@20`，`contractVersion` 与完整 required/exact/allowed 合同必须逐字一致，代际漂移原地失败。v20 的首次 provider schema 要求 `objectRegistry` 每项显式提交 `physicalIdentityKey/referenceImageNodeIds/referenceRole`，宿主不得用默认值掩盖缺失或非法枚举；同时从 Agent 提交面移除可以从单一事实机械编译的 `sourceFidelityAudit/clipId/exitState/characters/speakers/dialogueScript/dialoguePaceRate`。其中 `characters` 由角色 object state 投影，纯风景 Beat 得到确定性的 `[]`；来源账本仅在 Agent 未提交时由有序 `storyEvents` 编译，若输入已显式携带账本则保留并严格验证其语义缺口。Hono admission 与 agents-cli 首轮验收使用相同投影顺序和 verifier，既缩小长章节首轮输出，又不把错误输入静默改成成功。
- agents-cli 的精确字符串数组合同把空数组视为可冻结的结构事实，而不是非法合同。调用方声明 `arrayItemExactStringArrayFields` 时，`[]` 表示该逐项字段必须严格为空；运行时仍拒绝缺字段、非数组、空白元素、重复值以及任何额外成员。因而无对白、无说话人或无参与角色的 Clip 可以沿用同一通用身份合同进入 writer，不需要按题材、模型或 prompt 增加特例。
- BeatSheet 的 `sourceCoveragePlan.speechLedger` 是章节来源台词的唯一事实源；每行首次提交稳定 `lineId`、说话人、逐字正文、目标 `clipIndex` 与 `delivery`。宿主保留模型给出的合法 `clipIndex`，不再用累计最大值移动、排序或合并台词；越界或无法引用现有 Beat 的坐标属于确定性结构失败。`beats[].dialogueScript` 与 `speakers` 仍可从已验真的 ledger 确定性投影，`beats[].exitState` 与 `storyEvents[].entryState/exitState` 则完全由模型作者化并保持原值。
- 真实交付型 agents 评测不会在 owner-scoped 工作流成功后再消耗模型轮次，让 root Agent 用自然语言重新证明已经存在的终态。评测执行器只在权威 execution=`success`、成功节点显式发布 `delivery-evidence` port、同一节点声明地址化 artifact，且 URL 是无凭据、无查询、无 fragment 的稳定 HTTP(S) 地址时，将这组真实工作流事实投影为 `asset_url` evidence 与 `deliveryVerification=satisfied`；缺任一结构事实仍显式失败。该投影复用真实 expectedDelivery、root 模型身份和全部工具调用事实，不生成资产、不评价创作质量，也不把异步受理回执或临时签名 URL 冒充交付。
- 完整章节的一键成片 BeatSheet v20 冻结 `chapterArc={storyPromise,protagonistThroughline,primaryPayoff,endingHook}`、根级 `assetPlans`、每段 `dominantFunction/causalEntry/irreversibleResult/handoffToNext`、story events、首尾状态、时长边界与 compact object registry，不携带逐秒 `temporalFrameTrack`。BeatSheet Agent 是章级因果、可执行对象账本和同源资产意图的唯一语义作者；Hono 只编译确定性的身份、索引、对白、时钟与资产集合副本并展开非空 `assetObjectContracts`，不按正文判断质量。clip fan-out 根据物理相邻索引投影 `sequenceContext={chapterArc,previous,current,next}`。每个 clip 的 Video Writer v14 创作 continuity、独立 `speechEvents`、`shots`、speakerBindings、逐镜 `depictedStoryEventIndices` 与同链自检，不复制 `clipId/clipIndex/durationSeconds/characterRoleNames/exitState/assetObjectContracts/sourceEventCoverage/temporalFrameTrack/temporalFrameCoverage`，也不在 shot 上写对白正文或旧坐标。`shots[].durationSeconds` 是模型唯一首稿中的最终可执行秒数，必须精确加总到冻结 Clip 时钟；Hono 不缩放、不吸收余差，也不重映射事件索引。`speechEvents` 的 Unicode 半开区间和独立秒数由结构合同验真，`sourceEventCoverage` 与 `temporalFrameTrack` 由调用方在该最终时钟上编译。服务端不使用正则、关键词、正文匹配或单纯时间重叠推断剧情是否出现；实际画面是否演出了声明事件由 writer 的共享 authoring contract 在同链语义复盘中负责。缺少新的必需结构按 v20 硬切显式失败，不保留旧 BeatSheet 双轨。
- Equipped media workflow 的视频提交节点与每条 production-plan item 都必须携带 `videoReferencePolicy=forbidden`。生产交接只装配已经验真的图片 node/asset 引用；提交边界在任何 provider 调用前预检整份 production-plan，只要任一 item 存在 `referenceVideoUrl/sourceVideoUrl/upstreamVideoUrl/referenceVideoDurationSeconds` 等视频参考协议字段，整批原地失败且不产生部分提交。该约束是 provider 输入 schema 事实，不扫描提示词正文、不按题材分流，也不自动切换成 reference-video 模式。
- 视频参考身份在最终供应商 `content[]` 排序前以冻结对象合同键为唯一映射事实。画布 `referenceImageNodeIds` 与项目/素材 `referenceAssetIds`（含具体版本 ID）同为一等来源；ID Resolver 解析真实图片后，提交桥必须把每张物理图片关联到精确 `assetContractKeys`，再按最终媒体顺序渲染 `@图N（kind:canonicalName）`。不得因项目资产没有画布 nodeId 而退化成无名参考图，也不得从 URL、label、prompt 正文或图片顺序猜人物、场景和道具身份；同一图片承载多个冻结别名时保留全部合同键。
- 完整章节正文在一键成片的 delivery contract 中只保留一份 `authoritativeSources[].content`；若同一个权威来源同时出现在 `canvasFacts.nodes`，运行时只保留该 node 的身份、类型、标签和 revision 等结构事实，移除重复的 `content/chapterText/prompt` 副本。该投影按稳定 source id 做纯结构去重，不摘要、不截断、不改写正文。模型必须在第一次 terminal 提交前完成同一 Agent 内自检；若结构 verifier 仍发现硬缺口，只记录候选和诊断并结束该节点，不创建 durable 纠偏或 fresh replan。质量平台分别记录工作流受理、一次模型生成、物理传输等待和终态耗时，不把受理或等待冒充章节完成耗时。
- Workflow Agent 首轮 prompt 仍完整注入一次权威章节正文，但运行时来源提醒只携带 `sourceId/sourceFingerprint/revision`，禁止在同一次请求里再次复制整章。当前 v71 BeatSheet 的单次输出预算为 8192 tokens，并要求紧凑表达；这是分层产物合同的确定性容量边界，不是语义质量门禁，章节覆盖质量仅进入模型提交前的自检与运行诊断，不由 Hono/Web 用模板、关键词或返回纠偏接管。
- 质量平台轮询已受理 workflow 时，会把节点 `outputRefs.evidence.deliveryEvidence` 中的 `state/phase/recoveryCheckpoint/recoveryWindow/lastConfirmedAt` 原样投影为独立内部状态，并在批次运行中持续保存紧凑快照。外层 workflow 可以仍是 `running`，但内部 Agent 若已 `suspended`，控制台必须同时展示挂起原因和最后证据时间，不得继续把它描述为正常文本生成；该过程快照不构成交付完成证据，平均耗时仍只按真实终态计算。每个评测 suite 还可声明精确 `allowedToolNames` 能力授予，执行器通过受信环境合同只向 root Agent 暴露该用例必要的真实工具；真实交付评测创建隔离 workspace 时，同时按 suite 的结构化 `requestedWorkflowExecutionVariant` 从可访问的已保存工作流中装配对应的真实 attachment，并把附件身份与执行变体写入后续工具目录，避免出现“画布已建好但 equipped workflow 不存在”的假就绪状态。评测装配复用已有 attachment 时必须先经过与运行时目录相同的资格投影：routing 已确认、用户状态启用、冻结版本与源 Flow 存在且作者图仍等价；仅仅在数据库中存在同变体 descriptor 不构成可执行装配事实。若旧 attachment 已 stale，评测装配会继续从真实已保存工作流刷新/建立当前 attachment，禁止接口先宣称 equipped、随后目录又隐藏同一附件并让 Agent 在物理续跑中反复请求不存在的 schema。声明 `sideEffectPolicy=forbid_remote_business_actions` 的 direct suite 不创建隔离 TapCanvas workspace，也不加载远程工具目录；这类本地意图、Skill 与正文交付测试不会再因 8788 转发不可用而失败。需要真实远程交付的 `verificationMode=delivery` suite 仍保留认证目录和隔离 workspace，网络失败继续原样显式报告。root 的意图冻结、阶段记录、交付引用与大型结果读取等机器协议工具仍可用；`Skill/skill_search` 属于可选方法能力，只有 suite 的显式 allow-list 至少声明其中一个时才成对开放，禁止协议层偷偷扩张为完整 Skill 搜索循环。该收窄只按 suite 的显式能力合同工作，不读取 prompt 关键词，也不替小 T 决定工作流内部步骤。
- Workflow collection 的 `take/drop` 控制节点按节点声明的首个真实输入端口读取 collection，不假设端口名固定为 `items`。因此快速首 Clip 拆分后的 `clip-contexts`、`production-plan` 等领域端口仍保持 `tapcanvas.workflow-collection/v1` 的 item identity 与 lineage；`drop` 只移除已受理的前缀，不会把普通数组误判成 collection，也不会因首 Clip 已付费成功而跳过其余 Clip 与最终拼接。
- 8798 中断运行通过 `POST /public/agents/evals/executions/:executionId/cancel` 完成。该接口只接受含 `agents:chat` 的当前 agents-cli SSO grant，先按登录用户读取精确 execution，再核对请求中的 `projectId + flowId + optional chapterId` 与评测隔离工作区一致，且只允许取消 `queued/running` 执行。通过后以显式 `owner_eval` actor 复用统一 workflow cancellation service，取消 Durable Execution、本机节点作业与活跃 Agent turn，并返回 `localAbortedJobs / agentTurnCancellations / fullyInterrupted` 事实。ExecutionDO 的取消合同把 `owner_eval` 视为经过路由鉴权的用户作用域 actor，不再因 actor 枚举漂移返回 500。该能力不授予普通 SSO 用户通用管理员 workflow 权限，也不删除、覆盖或回滚取消前已经产出的节点结果和媒体资产。
- agents 评测工作区创建的 `eval-input` 文本节点会显式标记为唯一 `workflowCanonicalSource`。非章节工作流的 ProjectContext 先解析这一结构身份，并把精确节点 ID 固定为 `sourceNodeId`；重试产生的 BeatSheet、提示词或其它派生文本节点不再参与来源猜测。零个标记时保持既有结构解析，一个以上标记则显式失败，禁止按文本内容、创建时间或节点名称做语义兜底。每次平台运行仍创建新的项目与画布，输入可以只有文本，所需图片与视频在本次工作流内生成并注入。
- 章节作用域的 ProjectContext 始终以 `sourceNodeId` 指向该章节锁定的 canonical seed，并优先用它读取权威正文；`selectedNodeIds/selectedAssetIds` 只表达本轮显式选择与可复用资产，即使其中只有角色、场景或项目根来源节点，也不得抢占或否决章节正文。自由画布没有 canonical source 时仍要求显式选择中包含 ready 文本，禁止静默换成其它文本节点。该优先级只读取结构身份、画布作用域和资产状态，不按节点名称或正文语义分流。
- 根 Agent 的物理累计预算由 agents-cli 单一 `DEFAULT_PHYSICAL_TOKEN_BUDGET=393216` 合同提供。它依据真实章节交付样本中“233633 已观察 token + 46732 下一输入估算”覆盖上下文读取后的首次工作流 mutation；仍不改变单请求 context window、模型、工具权限或 workflow 自身预算。质量用例保持 `maxPhysicalRuns=1`，因此该容量用于避免付费动作前的人工物理切窗，不允许一次评测中自动续跑失败 workflow。
- 章节成片评测可在 suite 的结构化 `sourceWorkspace` 中声明当前账号可访问的 `projectId + bookId + chapterId`，并可声明至多 64 个精确 `requiredReadyAssetRoles={kind,canonicalName}`。评测工作区入口先逐字段核对章节归属，并在克隆前验证源项目每个声明身份都存在 `ready + productionEligible + image` 素材且能解析出稳定真实 URL；不满足时以 `agents_eval_asset_readiness_precondition_failed` 在 Agent 与付费媒体之前返回 409。项目克隆除根/章节画布、书籍目录与章节行外，还复制完整 material identity graph 与全部不可变版本，为资产 ID 生成目标作用域映射，递归重写版本 JSON 中的 project/asset 引用，同时保留稳定 URL、供应商 provenance 和无法映射的外部 style lock 身份；复用同一隔离项目时先精确刷新目标素材图谱，防止陈旧身份累积。克隆后再次按同一角色合同和真实 URL 解析器验真，任何缺失都在工作流启动前显式失败，禁止让名义上“资产已就绪”的 8-Clip 用例进入图片重生成。复制后的每本书 `index.json.projectId` 与本地 `rawPath/filePath` 必须原子重写为目标作用域，随后才从克隆书籍索引声明的 `contentFile` 或经边界校验的 `raw.md` offset 新鲜读取并验真精确章节正文。系统再通过章节叙事服务把已核验全文原子写入克隆章节的 locked canonical seed，并在独立项目根画布保留同一正文的审计来源节点及源项目、书籍、章序、文件名与 SHA-256 追溯事实。工作流只从 `chapter:<chapterId>` 的 canonical seed 读取权威正文，根 `flowId` 只供评测输入审计和项目级资产选择；二者禁止互换。agents-cli 子进程同时继承 project/flow/book/chapter scope；源项目不写入测试节点或生成资产，克隆后缺失选定书籍章节、权威正文或 canonical seed 写入失败会在工作流启动前显式失败，不回退到测试 prompt、项目根画布、章节摘要或手工章节。
- 隔离评测装配、工具目录、动态 schema 与真实执行入口使用同一 canvas-definition freshness 合同。`equipStandaloneEvalWorkflowCapability`、`tapcanvas_tool_catalog_get`、`tapcanvas_tool_schema_get` 与 `tapcanvas_equipped_workflow_run` 都不得因 suite 已显式声明 `full_video|first_video` 就放宽版本校验：已有 attachment 与新候选都必须携带当前 `workflowCanvasDefinitionVersion + workflowCanvasDefinitionFingerprint`，并且作者图、路由和冻结版本同时有效，才会进入 agents-cli 工具目录或执行目标解析。所请求变体只有旧定义时，工作区创建在启动 Agent 前以 `agents_eval_workflow_variant_unavailable` 显式失败；禁止先把旧能力宣称为 equipped、再由执行层返回 `workflow_definition_outdated`，更禁止让 Agent 通过更换模型、尺寸、空资产数组或 idempotency key 猜测重试一个参数无法修复的作者图问题。
- 已装配一键成片工具的公开 schema 完整暴露结构化 `triggerPayload`，包括用户明确总量事实 `targetDurationSeconds/requestedClipCount/requestedClipDurationsSeconds`，以及独立运行规格 `videoModelKey/videoResolution/videoAspectRatio` 与 `imageModelKey/imageAspectRatio/imageSize`。`requestedClipCount` 只承载用户已经明确指定的物理 clip 数量；即使没有 `targetDurationSeconds`，它也必须进入冻结 `generationContract` 并投影为 BeatSheet 的 `expectedArrayLengths.beats`，因此请求 8 段不能再由 Agent漂移成 9 段。没有逐段时长时，服务端只传实时模型的 `durationOptions`，不伪造每段秒数；用户同时明确逐段时长时，根 Agent 才把有序秒数原样传入 `requestedClipDurationsSeconds`。服务端验证数组长度等于数量、数组总和等于目标总时长且每项属于实时模型档位，再冻结精确 `providerSubmissionTopology`。用户未指定的总量字段必须省略；运行规格则只在 attachment 的 `requiredTriggerPayloadFields` 要求时从实时目录选择，并逐字段满足用户已冻结的交付约束。禁止 Hono/Web 通过题材、提示词关键词或静态默认值猜测；显式总时长、数量、逐段时长与供应商合法档位无法同时满足时在付费提交前原地失败。
- `imageSize` 的目录校验只允许把唯一的大小写等价值规范为实时目录中的精确 provider token，例如调用方 `2K` 对应目录唯一 `2k` 时冻结为 `2k`；它不会选择其它尺寸、其它模型或默认规格。没有精确或唯一大小写等价项时仍在工作流受理前以 `workflow_image_size_not_supported` 显式失败，禁止把展示大小写差异拖到供应商任务或计费边界。
- Workflow recovery 的上游 `success` 只表示源物理 execution 当时通过，不能跳过当前运行时合同。每次建立物理 execution 前都会先移除快照中仅属于上一代的 `workflowResolvedOutputReuse` 与 `workflowResolvedReplayCheckpoint`，再只从本次明确指定的 source execution 重新解析复用证据；旧祖先的部分失败 checkpoint 因而不能覆盖上一代已经完成的 BeatSheet、逐项结果或媒体资产。`prepareWorkflowOutputReuse` 随后按当前 Agent artifact 合同重新验证候选输出；仍满足才写入新的 `workflowResolvedOutputReuse`。不再满足的最上游候选会转换成带结构失败事实的新 replay checkpoint，由同一 Agent 节点在当前模型与执行族内修订；从该节点开始的所有后代停止复用并按 DAG 重放。逐项边界保留上一代 checkpoint 中已成功的 item 与可协调的供应商任务，只重跑失败/缺失项；已完成媒体节点仍凭稳定画布节点、taskId 与真实 URL 幂等 reconcile，不重复付费提交。这样硬切合同升级不会把旧 `success` 永久带入新链，也不会丢弃已经受理的媒体副作用。
- agents-cli 的 typed-output verifier 只返回“首次完整产物能否被下游执行”的结构事实。解析失败、根形态错误、必需可执行字段缺失、悬空引用、调用方冻结身份不一致或供应商硬枚举非法会结束当前节点；runtime 保存原始候选的位置、字符数与 SHA-256，记录 canonical JSON path，但不计算可写目标、不开放 correction 工具、不接受 delta，也不把证据送入下一模型轮次。语义一致性、节奏与参数合理性作为非阻塞 diagnostics 随 trace 返回；模型提交端只有完整产物终端 `format_final_json_response`。
- Workflow Agent 的 `json_object / json_array / json_artifact` 结构合同统一拒绝旧 `failurePolicy`、`collectionCorrectionFields` 与 `arrayItemMergeKeyFields`。合法策略只有 `single_submission_record_and_fail`；不存在结构化修订预算、失败历史回灌、`workflowStructuredRecoveryMode`、`workflowReplanCount` 或候选继续修复。
- Workflow Agent 的 durable admission 与 bridge 内存 owner 安装是两个因果有序但非原子的事实。`accepted/agent_running/completion_verifying` 刚持久化后的短窗口可能暂时投影为 inactive `unknown`；Hono 在统一状态机里对 `lastConfirmedAt` 新鲜的 checkpoint 保留 60 秒 activation observation window，只等待同一 turn 完成 owner 对账，不调用 resume，也不创建 `physical-retry:N`。观察窗结束后仍无 owner，才按已有 orphan continuation、generation fence 与有界 no-progress ledger 切换物理窗口。这个门只读取状态与时间证据，不判断业务语义；它防止同一个完整生成窗口在 admission 后数秒内被并发复制或重复消耗模型额度。
- Workflow Agent 的 `/chat/status` 是观察面，不拥有逻辑任务终态。API/bridge 代际切换期间返回的 `durable_turn_storage_unavailable` 与其它明确的 502/503/504 状态读取中断统一投影为 `workflow_agent_transport_recovery_pending`，保留同一 `sessionKey/publicTurnId` 与冻结输入继续 reconciliation；不得把观察面暂不可用写成节点失败、取消仍在运行的 Agent，或创建新的业务任务。迟到的同一 turn 自然完成结果仍可通过 durable turn/provider receipt 对账并优先收口；只有持久状态本身给出确定性失败终态时，才允许当前物理 Agent 动作结算失败。该规则按状态协议与作用域身份触发，不依赖工作流名称、prompt、模型或媒体类型。
- typed-output 每个逻辑 Workflow Agent 节点只拥有一个物理模型窗口并提交一份完整产物；不存在对象候选修订预算、局部上下文、字段级合并、“下一窗口整体重生”或候选形成前的物理恢复。供应商拒绝、断流、墙钟结束、suspension 或空结果都结束该 typed 节点，不开启新模型身份。
- 无进展保险丝不适用于 typed-output 的内容生成；typed 节点无论形成候选、未形成候选或验收失败，都在首个物理窗口结束时按已记录事实收口，不借保险丝、429 backpressure 或 continuation 延长预算。普通非结构化 Agent 与已被媒体供应商受理的异步资产对账仍按各自持久合同处理。
- structured-output checkpoint、correction scope 和局部纠偏工具均已退役。Workflow Agent 的 Skill/知识检索能力只在唯一作者窗口按冻结依赖与授权目录开放；结构化提交后不再切换工具面或创建另一种执行策略。指令、真实输入、输出合同、模型、交付作用域和 ProjectContext 仍进入不可变请求事实，供追溯与显式新执行使用，但失败候选永不跨窗口注入模型。
- 小T 的常驻 system prompt 只保留统一身份、`UserIntentContract`、真实能力发现、异步回执、幂等恢复和交付验收等通用 harness 合同；图片、视频、故事预览、分镜、写作、战斗编排、时长设计、VFX 与提示词编译等领域 route/SOP 不得常驻，也不得按用户文案在本地预选。每轮 AIGC 执行路径由 agents-cli 基于本轮 direct/catalog 工具说明、动态 schema、已加载 Skill、当前项目事实和冻结交付合同自主确定；catalog 中可发现但尚未展开的能力须先读取精确 schema，不能误报为能力缺失。领域方法只存在于对应 `skills/` 与工具合同并按需披露，Hono 仅提供权限、协议、事实和工具目录。工具返回 `accepted/queued/running/progressCursor` 只代表动作已受理；agents-cli 必须保留稳定任务身份并按工具声明的 `allowedNextActions`、恢复动作或结果查询继续同一逻辑任务，禁止重复越过付费边界，也禁止把局部动作失败直接投影为用户任务 `blocked`。
- dependency continuation 在精确 `taskId + userId` 的任务结果进入 `succeeded` 后，由 Hono 从权威 `task_results` 中结构性验真媒体类型、目标 `nodeId` 与真实 HTTP(S) 资产地址，并把 `trustedMaterializedArtifacts@1` 写回同一持久 continuation。Workflow execution family 进入无活动成员的终态后采用同一证据通道：Hono 先核对 owner、project 与规范 canvas identity，再只读取 family 内 `status=success` 物理 execution 的成功节点输出；只有 `agents.delivery.verify/v2` 已写出的结构化 `executorCompleted=true + verifiedItems>0 + expectedArtifactType` 与同类型持久 HTTP(S) artifact 才能投影为 `source=workflow_execution`，同时保留 family runId 与真实 sourceExecutionId。原始节点成功、任意输出 URL、失败 family 或错误媒体类型都不能闭环。该工作流资产会在 dependency 首次认领、手动恢复和后续 physical-budget 注册三个入口重新水合，避免跨物理窗口退化回 acceptance-only receipt 后反复读取旧 execution、误调用 resume 或永久显示等待。同一物理回合同时出现 provider `accepted_async` 与物理预算挂起时，精确 `artifactDependencies@2` 必须优先于普通 physical-budget rollover 接管续跑；只有没有新的或仍在运行的可寻址 provider 依赖时才登记普通物理续窗。dependency continuation 若仍需要另一个物理窗口，新的 continuation 必须原样继承精确 artifact tuple、dependency IDs 与已经验真的 `materializedArtifacts`，禁止退化为空依赖续跑而丢失图片或成片证据。该完整证据只允许在 `trustedPublicContinuation + physicalContinuationLeaseTakeover` 内部通道进入 agents-cli；主 Agent 与终态语义 reviewer 仅看到 `materializedHttpUrl=true`、媒体类型和任务/节点/资产/执行身份，不接触存储 URL，也无需再调用 `flow_get`、execution events、引用查询或 `present_media` 证明资产存在。agents-cli 只有在这些身份与本逻辑任务的 durable dependency 精确相关时，才把宿主证据纳入 `expectedDelivery -> deliveryEvidence -> deliveryVerification`；跨任务、跨节点、错误媒体、非 HTTP(S) 地址或单纯观察回执一律不能闭环。这样供应商或 Workflow 成功后的首个 continuation 即可生成简洁终态回复并完成生命周期，不重复生成媒体、不丢弃资产，也不把 URL 硬标准降级为节点占位。
- Workflow Agent 不再接受节点级知识卡挂载或停用名单作为第二套能力配置。唯一作者窗口按冻结 `workflowRequiredSkills` 与授权目录渐进读取 Skill/知识，由 agents-cli 依据冻结用户意图与真实上下文自主决定检索；Hono 不用正则、关键词或 prompt 文案替它选择来源，也不存在提交后的“局部结构纠偏窗口”。
- Skill 的精确 section/reference 在同一物理执行窗口内按 `skill + source + SHA-256` 去重，而不是只按工具参数去重。agents-cli 每次读取前都会刷新当前 SkillLoader：正文未变时避免重复注入，正文热更新后立即注入新版本并更新本窗口 provenance；旧回执没有来源哈希时不允许抑制正文。跨物理窗口仍重新注入所需正文并核对 semantic dependency pin；已冻结来源发生变化时写入 `semanticDependencyObservations(blocking=false)` 并明确版本差异，不得伪装成旧版本，但继续当前用户任务。该机制只管理模型当前可见的专业上下文，不选择 Skill、不做语义路由，也不参与媒体质量门禁或用户级终态裁决。
- agents-cli 的运行上下文已统一为带内容哈希的 `ContextFragment -> WorldStateSnapshot -> WorldStateDiff`，当前 snapshot 随 durable rollout state 持久化；从第二个物理 run 起，diff 的 `added/changed/removed` 与 revision 作为 `<world_state_update>` 进入 agents-cli 模型上下文，完整当前 fragment 事实仍随后无损提供。Hono 只保存和透传该结构化状态，不解析 fragment 正文做意图路由。provider working set 使用与业务无关的消息/工具协议投影，完整当前用户请求保持无损，工具调用和结果按 call ID 成对保留，超长 JSON 通常只生成 hash receipt；唯一额外保护是最近一笔工具结果以结构化 `details.retryableInCurrentAgentChain=true` 明确声明可同链修复时，该 call 的完整原始参数作为 repair baseline 无损保留并优先进入压力工作集，直到产生更新的 retryable failure 或成功动作。这样 BeatSheet、画布计划和其它大对象只修一个字段时不会因物理窗口切换丢失 sibling 字段、从摘要整包重写；保护完全基于工具协议位，不按章节、媒体类型、错误文案或 prompt 关键词触发，未声明可修复的旧参数仍按原规则压缩。旧的章节、视频和具体工具名特判压缩链已删除。后台子代理完成通知同样只走 agents-cli 的 SQLite durable mailbox，Hono 不维护第二套完成队列；agents-cli 以显式 `threadId` 或 spawn 已绑定的同一 `sessionId` 查询直属 child，在最终裁决前再次 drain 并复核状态。未收口或刚抵达但尚未综合的完成事件不能越过终态边界，查询也不能回落到 process-wide roster。
- 视频链路返回的 `assetRepair/v3` 是跨物理回合的权威修复 frontier。agents-cli 首次从供应商回执的 `progress.revision` 读取版本，持久化为规范化 `progressRevision`；规范化结果必须能够再次通过同一解析边界并恢复到下一回合，不能因字段投影形状变化丢失允许资产集合。恢复成功后，任何集合外的付费生图在远程提交前都会被结构性拒绝，避免 bridge 重启或 durable continuation 后重复扣费、错误补图或改写既定修复范围。
- 局部工具失败进入同链重规划时，agents-cli 生成并持久化版本化 `ReplanDeltaV1`，而不是只追加一段临时提示词。该增量以失败工具、规范化参数指纹、失败码、真实 evidence 指纹与当前 progress revision 构造确定性身份，明确记录仍冻结的用户意图、已保留的 durable evidence、副作用身份、活动 Todo 游标、已关闭的精确动作，以及本次必须重新选择的安全路径。JSON 落库/恢复后再次规范化必须幂等；同一 delta 重放只保留一份。它只描述结构化事实变化，不读取 prompt 或创作正文做语义路由。下一物理窗口因此能从“哪些事实没变、哪个动作已停、还缺哪条安全替代路径”继续，而不是重做规划、重复付费动作或把局部失败升级为用户级 blocked。
- 所有 provider 推理截止计时器都是当前在飞请求的权威收口路径，必须在调用方等待期间保持进程存活；禁止对该计时器 `unref()` 后留下未结算 Promise。初始推理默认 15 分钟，与 runtime 通用 root 物理窗口对齐；工具后续跑默认 5 分钟。二者仍取角色/根任务剩余预算的更小值，不能越过更窄的确定性边界。这样大型 typed output 不会在接近完整 terminal tool 时先被旧的 10 分钟 LLM 子截止取消，同时普通 continuation 仍保持有界。工具后续跑、初始推理与终态 reviewer 命中截止时，只结束当前物理动作/窗口并持久化已有工具结果、候选正文与证据 revision。终态 reviewer 对同一候选连续三次产生非法协议时，返回 `delivery_review_attempts_exhausted + replan_required`，由 durable continuation 复用同一候选继续验收；不得无限原地循环，也不得要求用户发送“继续”。
- continuation 注册是“权威 `agents_async_continuation` 行 + 幂等队列发布”组成的双效果结算。注册写入成功但队列暂时失败时，`agents_continuation_settlement` recovery capsule 会保留同一 `effectId/publicTurnId/logicalTaskId/continuation.id/progressFingerprint` 并由独立 worker 重放。恢复过程不能再把 `createTaskStatusIfAbsent=false` 直接理解为成功：它必须读取权威行，核对 user、root turn、session、stage、parent 与 progress fingerprint；匹配且仍为 waiting 才补发一个稳定 jobId，已经 claimed/terminal 则不重复发布。数据库、Redis、队列异常以及“发布计数为 0”属于 retryable，继续留在 waiting 并由同链恢复；合同非法、恢复 capsule 复用 claim token、注册被结构拒绝、权威身份漂移和不可能的多发布计数属于 deterministic terminal boundary，统一写入 `terminalBoundary={code,safePathsExhausted:true,failedAt}`。该边界与对应 `execution_traces` 在同一 PostgreSQL 事务中变为 failed，settlement 自身也变为 completed/failed，不再进入 reconciliation；`/public/agents/chat/status` 只按同一 user + publicTurnId 读取这个权威终态并覆盖 bridge 的旧 suspended checkpoint，已经 succeeded/cancelled 的逻辑终态保持不变。结构已损坏到无法还原身份的 failed marker 会让状态查询显式失败，禁止继续展示伪 suspended。这样“数据库写入成功、队列失败、settlement 写回又失败”的组合不会制造无人接管的伪成功，确定性损坏也不会永久后台空转，更不会重放媒体提交或计费副作用。`pnpm test:integration:continuation-chaos` 会自动拉起无持久卷、随机回环端口的临时 PostgreSQL/Redis，并跨独立 OS 进程验证三种事实：① continuation 行成功、队列发布为 0 后可恢复且稳定 BullMQ job 恰好一个；② 权威 continuation 身份漂移只终止一次、trace/settlement 同时 failed 且无队列 job；③ recovery capsule 缺失只终止一次、不再显示 suspended。该演练不调用模型、供应商或计费链，结束后只停止其精确命名的临时容器。
- 已 claim 的 continuation 从冻结合同验签、task capsule 解析、公开请求 schema 校验开始就进入同一个 pre-execution settlement 边界；这些准备步骤不能在结算 `try/catch` 之外抛出。旧合同版本、合同哈希损坏或请求事实结构非法会携带稳定机器错误码进入 `deferOrFailAsyncAgentContinuation`：只有明确的可恢复 bridge/stream 故障才释放 claim 并按预算重试，确定性准备失败则用原 claim token 把 continuation 原子终结为 failed。禁止把坏合同留在 `claimed` 后让队列无限重放，也禁止为旧合同建立兼容读取或从自然语言重新生成冻结合同；已有媒体任务仍按其真实受理状态保留，不回滚、不重复提交。
- 小T、Agent API 与公开媒体任务共用同一份 new-api 实时价格快照。快照只请求 `/api/pricing`；token/美元计价折算统一使用部署时显式配置的正数 `NEW_API_USD_EXCHANGE_RATE`，不再依赖已从 new-api `/api/status` 移除的 `usd_exchange_rate`。该配置缺失或非法时返回 `new_api_usd_exchange_rate_invalid` 并停止本回合，禁止以历史值或隐式 7.3 继续计费。
- 外部 OpenAI 兼容小T接口把“稳定会话作用域”和“单回合计费副作用”拆成两个身份：标准 `user` 只派生稳定 `sessionKey/billingConversationId`，用于记忆隔离、在飞互斥与 new-api 用量归集；每个 HTTP 请求使用唯一 `requestId` 派生 `effectId/reservationTaskId`，不同回合绝不复用积分冻结幂等键。对话冻结采用同一 PostgreSQL 事务内的批次锁与原子可用额计算：目标冻结额由 `TAP_CHAT_RESERVATION_CREDITS` 配置、默认 500，但最低可执行余额固定为 1，实际冻结 `min(目标额, 当前可用积分)`；因此任意正余额都可开始对话，只有真实可用余额为 0 才返回 `team_insufficient_credits`。原子冻结明确区分 `reserved / insufficient / idempotency_conflict`，普通重复回合标识仍返回 `team_credit_reservation_conflict`，不得伪报余额不足。唯一允许接管既有冻结的路径是已经 CAS claim、持有 durable continuation fencing 的物理恢复：若同一 `effectId` 的 reserve 仍未结算，且 `teamId + actorUserId + taskKind` 与当前恢复逐项一致，冻结事务返回 `existing_reservation` 及真实剩余额度，恢复窗口复用它继续 agents-cli；身份不一致、已结算或普通浏览器重放仍原地冲突。这样 worker 在“冻结已提交、handle 尚未返回”之间重启不会把用户任务终结，也不会新建第二笔冻结或重复越过付费边界。结算仍按本回合真实 new-api quota 尝试补冻并扣费，补冻不足时只扣已冻结余额，不产生负积分。
- 一键成片现在由已装配 Workflow IR 单轨承载：`tapcanvas_equipped_workflow_run` 只接受动态 schema 中当前用户真实 attachment，并把 ProjectContext、工作流版本、触发参数、资产快照与幂等键冻结进 execution。agents-cli 依据 `UserIntentContract@2.delivery={mode:"async_artifact",mediaType:"video",...}` 在工具执行边界拒绝裸视频工具、普通 `tapcanvas_workflow_run` 与旧视频编排入口；attachment 缺失或失效时显式失败，不存在默认生产回退。视频合同冻结、工作流尚未受理的正常准备阶段仍允许当前授权的权威只读事实工具，唯一保留的业务 mutation 是 `tapcanvas_equipped_workflow_run`。一旦终态 verifier 已返回 `needs_revision` 且仍无 `acceptedAsync=true` receipt，运行时进入确定性交付修复前沿：若工作流工具尚未进入当前 provider 投影，只暴露参数被收窄为 `name const=tapcanvas_equipped_workflow_run` 的 `tapcanvas_get_tool_schema`；这次成功查询会把已认证的 direct 或 catalog 定义都提升到下一轮，而不是继续保留泛目录查询；激活后只暴露 `tapcanvas_equipped_workflow_run`。两个阶段都要求工具调用，旧 execution 列表、其它目录 schema、Skill、画布诊断和 resume 此时都不可见，`tool_choice=required` 不能再被无关重复读取满足。若精确 schema 实际不存在则原地显式失败，禁止因此重新暴露其它路径。该收窄只读取已冻结的结构化交付类型、verifier 状态和 durable receipt，不解析用户正文；受理回执写入后即解除，后续持久 continuation 只跟踪同一 execution family。`paid_media_generation` 等底层媒体能力只由 Workflow 节点消费。已经受理的 execution、供应商任务和媒体资产保持原身份，禁止重复付费提交或因后续诊断回滚。
- 章节画布路由中的 `chapterId` 本身就是确定性的生产作用域；即使可选的 prose `chapterContext` 块为空，也不得把该请求误判为“空公共聊天”并延迟全部直接工具。只有既无章节作用域、也无节点/资产/生成合同/角色或显式工具策略的真正空聊天才允许延迟直接工具。延迟只改变首轮表示：所有已认证 direct definitions 必须连同确定性的 `requiredScope/capability` 元数据迁入同一个 deferred catalog，禁止把 `flow_get/flow_patch` 或动态 `tapcanvas_equipped_workflow_run` 清空后丢失。agents-cli 仍按精确名称加载同一工具 schema 并走同一执行入口，不恢复大型首轮 schema，也不形成第二条工具路径。
- `tapcanvas-public-chat-video-production-deadline-v2` worker 只结算硬切换前已经持久化的历史 deadline job：它按原合同保留 execution、资产与诊断，并终结历史根回合。新公开回合不再创建该 job；生命周期所有权由已验真的 durable continuation、Workflow execution 或供应商任务承担，缺少这些 owner 的 suspension 在发布边界以 `async_continuation_owner_missing` 当场失败，不能靠新增墙钟任务掩盖无人推进。
- 积分异步收口器把“预留已创建”和“供应商任务身份已绑定”视为两个确定性阶段。预留行尚无 `vendor_task_ref.pid` 且未达到孤儿释放年龄时，只写入 `provider_task_binding_pending` 并等待下一轮；禁止用临时 reservation task id 查询供应商，也禁止把 `task_not_exist` 误判成终态后用旧身份释放。只有真实 provider identity 可轮询，或达到孤儿年龄边界，才允许结算/释放。这避免供应商受理与预留 rebind 的并发窗口制造账本关联漂移。
- 预留从临时 effect identity 绑定到真实供应商 `taskId` 时，账务层在一条原子更新中迁移同一身份下的 `reserve / deduct / release` 完整生命周期；禁止只改 reserve 行。这样即使失败释放与 provider identity 回写并发，已有 settlement 也会随同迁移，`team_credit_batches.reserved_amount` 与 allocation 净额不会因为任务身份被拆成两组而失配。目标身份若发生唯一键冲突则整条更新原地失败并记录，不允许部分迁移或隐式重建账本。
- 正式用户的一键成片视频入口只展示最终版完整成片（`executionVariant=full_video`），必须包含全部 clip、独立 concat 与 delivery verification。`executionVariant=first_video` 仍保留在 Workflow IR、能力描述和本地回归测试中，用于只生成首个真实视频的验证路径，但不进入普通用户菜单，也不作为章节按钮可选交付；章节画布的“单章节一键成片”按钮固定派发 `media_delivery/full_video`。提示词编译图同样不作为一键成片视频入口展示。
- 章节按钮还会在 `chatContext.requestedWorkflowExecutionVariant` 中发送结构化 `full_video`，不再只把该事实写进自然语言 directive。Hono 在构建 agents-cli 工具面、延迟 schema 查询和最终 `tapcanvas_equipped_workflow_run` 执行边界三处使用同一枚举过滤并复核 attachment 的 `descriptor.invocation.executionVariant`；`full_video` 请求看不到也不能执行 `first_video` 或未声明变体的工作流。该事实通过 agents-cli 的 `remoteToolConfig` 以模型不可修改的传输字段传回工具执行入口；不匹配以 `workflow_execution_variant_mismatch` 显式失败，禁止默认工作流或文本关键词兜底。
- v60 继续把“开始生产视频”定义为供应商真实受理至少一个付费视频任务，而不是工作流已受理、Agent 已开始、图片已生成或前端定时器前进。正式 `full_video` 保持单一整章路径：完整 BeatSheet 一次创作，全部 Clip writer 按稳定 itemId 并发，生产计划再按 `itemConcurrency` 直接批量 fan-out 到供应商；显式 `first_video` 仍只在用户明确要求首片时使用。
- v62 的 `workflowExecutionControl@2`、`videoProductionStart@6` 截止事件和 v2 deadline queue 仅作为历史执行协议继续可读、可审计、可结算，不再注入新公开回合。当前运行时仍以可追溯 `taskId + providerAcceptedAt` 判定 started，并以真实 master/concat URL 与 delivery verification 判定最终交付；是否尚未进入媒体阶段只是进度事实，不能取得取消仍在健康首轮生成中的 Workflow Agent 的权力。已经被供应商受理或已经生成的资产始终保留。
- 章节一键成片的章级 `film_spec.adaptationMode` 是创作合同：`faithful` 只把原文事实、因果与逐字台词镜头化；`creative` 把原文作为创作底稿，在核心人物关系、世界规则、主线因果与关键结果不偏离的前提下，允许 BeatSheet Agent 同链扩写桥段、对白、冲突、反转、视觉包装和商业化表达。该模式由章节弹窗显式选择，经 `PUT /chapters/:id/film-spec` 持久化并合并到 `beatSheet.meta.adaptationMode`；工作流 Agent 依据它决定是否扩写，新增人声进入 `narrativeAudioPlan`，不伪装成原文台词。Hono 只校验枚举、权限与结构，不用关键词或质量评分裁决创意内容。
- 能力舱的工作流项目支持所有者直接删除：`DELETE /agents/capability-bay/projects/:projectId` 只接受 `ai_workflow` 项目所有者，并复用项目删除事务清理工作流、版本、执行记录、项目素材及失效的工作流能力装配；团队协作者和系统级工作流只能编辑/解除装配，不能越权删除。前端必须先展示不可恢复影响并要求二次确认，能力舱的“移除”仍只代表解除 Agent 装配，不等同于删除项目。
- 能力装配检查中的 LLM 语义冲突分析是可观测的辅助诊断，不拥有工作流发布或更新的终止权。结构、权限、版本与已知能力关系由确定性检查裁决；语义分析连接失败、上游 5xx 或返回合同无效时，检查结果必须写入 `semanticAnalysis.status=unavailable`、错误码与消息，并允许已通过确定性检查的版本继续更新。前端必须明确显示该部分检查未完成，禁止把它伪装成“无冲突”，也禁止把单次模型故障升级为整个能力更新 502。
- 装备入口的必填触发字段从 attachment 所钉住的真实 Workflow IR 图动态推导，而不是依据工作流名称、能力别名或 prompt。图中存在未固定 `workflowVideoModelKey/workflowVideoResolution/workflowVideoAspectRatio` 的视频合同或 estimate 节点时，运行时 schema 分别投影 `videoModelKey/videoResolution/videoAspectRatio`；存在未固定图片模型、画幅或尺寸的 `tapcanvas.image.generate/v1` 节点时，独立投影 `imageModelKey/imageAspectRatio/imageSize`。根代理只能从当前实时 enabled catalog 选择 canonical key 与支持规格，并必须满足 UserIntentContract 已冻结的用户约束。工具执行入口会在创建 execution 和任何付费节点之前再次核对，并把本次媒体选择冻结进对应媒体节点；禁止共享画幅字段、默认模型、展示名猜测或静默降级。历史 attachment 无需改写：服务端从其冻结版本图即时推导当前 invocation 合同。
- agents bridge 固定使用当前 `postgres@3.4.9`，并通过 pnpm patch 修复数据库连接关闭与 `setImmediate(nextWrite)` 交错时对空 socket 调用 `write` 的竞态；开发容器启动会校验补丁是否真实进入运行时，缺失时原地拒绝启动并重新安装锁定依赖，禁止带着易崩溃驱动继续运行。该保护只消除驱动进程崩溃，不吞掉数据库不可用事实：查询和动作仍按既有 503/结构化失败与 durable continuation 协议恢复。
- Storyboard Adventure 继续复用现有 `tapcanvas-storyboard-adventure -> tapcanvas_flow_patch -> choices -> 写作/编剧/视频工作流` 单链，不新增 Hono 意图路由、Forecast 服务或 SBA 专用成片流程。新写入且声明 `sbaContractVersion=1` 的 moment-board 节点使用共享结构合同：保存真实 `sbaParentNodeId`、正史/任务基线 `sbaStoryBasis`、带稳定 item ID 的候选 `sbaProjection` 和追加式 `sbaSelectionEvents`；Hono 只确定性校验字段、真实父节点/edge、选择事件身份，并对规范化 basis 生成 SHA-256 `basisFingerprint`，不评判剧情质量、不给投影打分，也不阻断已生成媒体。flow patch 的 `createdNodeSnapshots[]` 是分支 node ID 与 fingerprint 的持久化真源；agents-cli 只能据此输出带 `selectionEventId + branchNodeId + sbaPath + basisFingerprint` metadata 的 choices。Web 点击后发送单一 `[SBA_SELECTION]` JSON 执行动作、用户气泡仍显示自然语言 label，排队与即时发送共用同一正文，因此不会出现 label 路由和结构化选择两套真源。展开前 agents-cli fresh-read 并核对结构化身份，选择成功时 patch `selected` 且 append 收据；相同 selectionEventId 的完全一致重放幂等，不会重复追加，且一个 selectionEventId 在 flow 内只能归属一个分支，带选择回执的节点不能继续宣称为 candidate。回档按真实 edge 遍历后代，path 仅用于展示。画布节点内联显示“候选/已选择/已替代/非正史”与“正史已变化/来源未核验”；这些状态都是持久事实投影，不是语义质量门禁。下游只把真实选中节点、selectionEventId、basisFingerprint 和实际采用的 projection item 交给既有正文、scriptDoc、BeatSheet 与 SourceLineage，未采用投影仍保持非正史。
- 小 T 的持久工作流启动、诊断与恢复现已形成同一正式远程工具闭环：`tapcanvas_workflow_run` 与 `tapcanvas_equipped_workflow_run` 都返回版本化 `tapcanvas.workflow-execution-receipt/v1`，固定包含 `runId/executionId/executionFamilyId/status/acceptedAsync` 以及可直接调用的 `inspection` 参数；重复 idempotency key 命中同一 execution 时返回同一追踪身份，不会创建演示 run 或第二条任务。`tapcanvas_workflow_execution_inspect` 是只读 `execution_diagnostics` 能力，`view=family` 分页读取恢复执行链和聚合事实，`view=attempts` 分页读取单次物理执行的不可变 attempt、冻结执行语义与 provider receipt；服务端同时复核当前用户、项目和画布作用域，错误游标显式返回 400。若 inspection 证明最新物理 execution 已失败、原交付仍未满足且执行家族没有活跃 recovery，小 T 使用 `tapcanvas_workflow_resume {sourceExecutionId}`，由与 `POST /executions/:id/resume` 共用的唯一服务执行家族 guard、旧 Agent turn 三平面 fence、冻结快照重放、ProjectContext 身份水合和 output reuse；恢复执行继承原 `executionFamilyId`，已成功祖先、已受理媒体任务、真实资产和 provider receipt 不重做、不重复扣费。若唯一活跃 execution 的 Workflow Agent 已用版本化 `requestTerminal=suspended/provider_balance_required` 持久暂停，普通 resume 仍拒绝活跃家族。用户明确确认同一模型渠道余额已经恢复时，调用方可传唯一布尔事实 `providerBalanceRestored=true`：服务围栏旧 turn、取消旧物理 execution 的未完成调度，从余额暂停节点按原冻结模型、原 API style、原快照和原执行家族继续，身份以 `sourceExecutionId` 幂等派生；该入口对 execution owner 开放，但不接受 `false`、缺省推断或与 model cutover 同时出现。若用户明确选择新模型，则改用互斥的 `agentModelCutover={targetModelKey,apiStyle}`；Agent 工具入口强制目标逐字等于当前父 Agent 的真实模型与 API style，管理员 HTTP 入口要求显式 JSON body。model cutover 的新 flow version 只保留目标 `workflowInitiatingAgentExecution` 单轨，并追加 `tapcanvas.workflow-agent-model-cutover/v1` 审计账本；恢复 execution 的身份由 `sourceExecutionId + targetModelKey + apiStyle` 幂等派生。两种恢复都继承原 `executionFamilyId`，不另建逻辑任务、不重做成功祖先、不丢弃已受理媒体或真实资产；没有显式恢复事实时绝不试探余额或改模型，来源并非余额暂停、家族存在其它活跃成员或模型切换身份不匹配时均原地失败。该恢复工具属于已受理任务的协议基础设施，不随可替换的 workflow start capability 一起隐藏；它只能恢复当前授权画布中执行家族的最新失败成员或上述唯一余额暂停成员，不能从自然语言猜测执行或另建替代家族。agents-cli 把没有媒体声明的启动或恢复回执归为 `workflow` 异步受理证据，把带显式 `deliveryKind=image|video|audio` 的 equipped workflow 保留为对应媒体证据；这些回执在拿到稳定 run identity 后结束当前物理回合、写入未满足的 waiting evidence 与 durable task reference，等待持久 continuation 从新执行/资产事实恢复，禁止同回合轮询或重复提交。bridge 的内部 delivery evidence 必须保留尚未物化 URL 的 `accepted_async` 回执，并为工作流回执显式写入 `runProtocol=workflow_execution_family`；公开交付投影仍只认真实物化资产。依赖 sweep 按该协议读取整个 execution family，而不是把 `runId` 猜成旧 video run：家族仍有 queued/running 成员时保持 waiting；任一恢复成员成为最新终态后唤醒同一 root continuation，由 agents-cli 根据成功交付或结构化失败继续验收/修复。归属复核使用 owner、project 与 canvas，恢复执行 ID 变化不会丢失 root 对话，单次失败 execution 也不能提前终止执行家族。Workflow Agent 的模型输入只使用冻结上游端口与 typed delivery contract：直接 Workflow Agent 不再叠加面向交互聊天的章节画布快照；上游 Agent 结果只投影业务正文/资产事实，去除执行 provenance 与验收元数据的重复副本；资产规划读取 BeatSheet 的 cast、source assets、Clip 身份、场景、角色、连续性与资产对象合同，不重复注入与本节点无关的逐秒时间轨。完整 ProjectContext/assetSnapshot 继续由服务端保存并执行权限与输出校验，模型只看到项目身份、权限、当前选择和数量；可复用资产候选及 exact-string 合同只包含与当前 BeatSheet `kind://canonical-name` 精确相同的角色，不展开整个项目跨章节历史。资产计划只要声明 `existingAssetId`，结构校验就必须在任何媒体执行前证明该 ID 精确属于同项目、`ready`、可生产的冻结图片集合，并逐字匹配当前 `kind://canonical-name`；当前选择中的节点 ID、过期工作流输出或其它角色图片不能冒充复用资产。`json_array` 的 agents-cli 传输层允许且只允许 `items` 加可选的协议元数据 `minItems=1`；Hono 核对后只把 `items` 解包到业务端口，其他额外字段或错误值仍显式失败。这些都是字段级结构投影与协议校验，不判断创作质量，也不改写 Agent 产物。Workflow Agent 节点恢复按结构化持久事实分流：有可认领 continuation 时只用原 `owner + sessionKey + publicTurnId` 做 CAS resume；状态读取与 CAS resume 之间若另一恢复器已先接管同一回合，`chat_resume_turn_active` 是继续运行的竞争成功事实，当前节点保持 suspended/waiting，禁止把它终结为失败；身份、权限或其它状态错误仍显式失败。bridge 重启后留下 inactive `unknown|failed + accepted|agent_running|completion_verifying`，或 `suspended/provider_stream_interrupted` 但 continuation 已不存在时，ExecutionDO 将其视为当前物理窗口结束，持久递增 `physicalRetryOrdinal`，用新的 `:physical-retry:<N>` session/public-turn 重建同一不可变节点输入。agents-cli checkpoint 因此允许 `agent_running -> suspended`，确保角色时限或 provider 中断能先可靠落盘，再由工作流 owner 接管；这些状态不能直接变成用户级失败或永久空轮询。Hono 只投影这些机器事实，不依据工作流名字、prompt、节点数量或单次 execution 终态在本地裁决用户级完成。
- 上述 execution-family resume 只复用成功节点、已受理媒体 receipt 与非 typed 执行事实；它不能给失败或空悬的 typed `agents.logical-task/v2` 节点创建第二个模型窗口。恢复图若抵达这类节点，节点以 `structured_submission_window_closed` 终止；要重新创作只能由用户明确发起新的工作流执行，而不是运行时纠偏或自动续预算。
- 当执行族没有活跃执行时，普通 resume 默认仍只允许最近失败成员；管理员可通过 `trigger=manual` 明确选择更早的失败检查点，服务端会读取该检查点之后的全部家族成员与节点输出，并以冻结 executor semantics 和 output-reuse provenance 证明不存在新的外部副作用物理尝试。只有这份结构化副作用证明通过，历史检查点才可恢复；最新成员可以是已取消或已失败的错误恢复，但 Agent 工具入口不能自行跳过最近失败成员。后续存在任何未被 replay/pin 标记且已经开始的图片、视频、音频资产，或任何已经物化 `sideEffect` 的 executor 时继续返回 stale-source 冲突。`agents.logical-task/v2` 仍按外部写入能力保守处理，但失败/取消且没有成功工具回执、持久任务/进度回执、成功 item、媒体资产或已满足 delivery verification 的物理 Agent 调用被证明为“能力未物化”，可以随错误恢复路线一起放弃；这项判断只读取结构化状态与回执，不读取 prompt、工作流名或错误文案。该能力用于放弃没有供应商调用、Agent mutation、子工作流、拼接或其它外部写入的错误恢复路线，同时保留较早检查点中的成功产物；它不能绕过执行族 active fence、Agent turn fence 和供应商幂等身份。BeatSheet 的 `beats[].speakers` 是由 `dialogueScript+narrativeAudioPlan` 唯一确定的编译字段，Agent 首稿和历史复用输出都会在同一个结构校验入口确定性投影后再验收；旧成功产物不会仅因冗余 speakers 数组陈旧而被降级为重跑，也不会连带重做后续图片。
- 精确 `provider_balance_required` 检查点即使被后续失败或取消的物理成员盖过，也不应因“不是家族最新成员”永久失去恢复能力。用户明确确认余额恢复或显式模型迁移后，resume service 会复用上述逐成员副作用证明；只有后续成员全部是 replay/pin、`sideEffect=none`，或结构化证据证明外部能力从未物化时，才允许回到该检查点。任何未对账 Agent mutation、供应商提交、子工作流、拼接、媒体资产或未知执行都会保持 stale-source 冲突。该规则只开放精确检查点的可恢复性，不推断余额、不自动切模，也不在没有用户恢复事实时启动执行。
- 用户取消仍是权威终态，系统不得自动复活；但用户随后明确说明误取消或明确撤销取消并要求继续同一任务时，唯一 resume service 接受互斥事实 `cancellationRevoked=true`。它只允许精确最新、无活跃后代的 canceled execution，以 `workflow-cancellation-revoked:<sourceExecutionId>` 幂等创建同家族恢复成员，从第一个已开始的 canceled 节点继续，并复用该成员已经成功的 collection items、媒体 URL、供应商收据和 Agent 产物；历史 canceled 成员、非 canceled 来源、`false`、自然语言推断、与余额恢复/模型切换并用都原地拒绝。这样撤销取消不会另建任务或重复成功副作用，同时保留用户取消本身的控制权。
- 视频 writer 的 agents-cli 最终提交工具与 Hono verifier 使用同一个 v14 创作字段面：每个 clip 只提交 `continuity`、有序 `shots`、`speakerBindings`、完整 `speechEvents`、逐镜 `depictedStoryEventIndices` 与可选同链复盘证据；镜头/光线/材质/声场与运动学字段按 typed schema 暴露。`clipId/clipIndex/durationSeconds/characterRoleNames/exitState/assetObjectContracts/shots[].speechEventIds/sourceEventCoverage/temporalFrameTrack/temporalFrameCoverage` 不进入 Agent 提交面，由 Hono 从冻结上游事实投影或在最终时钟上编译，避免“prompt 要求模型复制、verifier 又拿调用方真源覆盖”的协议裂缝。direct Workflow Agent 的原生角色合同若声明 required Skills，agents-cli 必须在唯一物理窗口开始前从同一角色事实确定性派生只读 `Skill` 能力。Hono 依据冻结上游合同逐字段、逐顺序和精确 assetId 集合一次验收完整 Clip；其中空 `assetPlans` 是纯 T2V 在 `prompt_only` 与 `media_delivery` 下都合法的冻结集合，exact contract 必须把它解析为 `expected=[]`，不能把“明确无参考资产”误判成配置缺失。不从资产名、对白或 prompt 推断语义，也不把创作质量变成运行时门禁。
- Workflow Agent 新物理代际在受理前会 fence 同一不可变节点的上一代生成；bridge 返回的原始 `provider_stream_interrupted` 与封装后的 `agents_bridge_stream_interrupted` 同属可恢复传输事实。Hono 必须把两者都投影为 `requestTerminal.status=suspended`，并保留 `transportInterrupted/errorCode/sessionKey/logicalTaskId/retryableByDurableWorkflow` 证据，交给持久工作流从检查点继续；禁止把代际切换文案作为无 evidence 的 item 终态失败。若精确 public turn 的 execution trace 已终态但 agents-cli durable turn 尚未物化，Hono 将该双写缺口记录为 `execution_trace_terminal_without_durable_turn`，在同一节点冻结输入上递增 `physicalRetryOrdinal` 继续，同时把每次缺口计入通用 no-progress recovery window；达到统一窗口上限才显式失败，避免一次投影缺失终止任务或无界空转。对于 `unknown/accepted` 或 provider 中断发生在首个 recovery checkpoint 之前的物理代际，Hono 使用精确 `publicTurnId` 作为合成物理窗口身份：同一代际的重复轮询不重复计数，只有相同 progress revision 下出现新的物理代际才累计一次，任何新的持久进度都会重置窗口。身份、权限、schema 等非传输错误仍显式失败，不因该合同放宽。
- Bridge 重启或过载窗口返回的 `agents_bridge_failed`、`agents_bridge_queue_failed`，只有在 HTTP 状态明确属于 `408/425/429/500/502/503/504` 时，才与其它 Workflow Agent 传输中断一样投影为 `workflow_agent_transport_recovery_pending`，保留同一逻辑任务和冻结输入继续恢复；`400` 等协议拒绝仍原地失败。该分类只读取结构化错误码与状态，不匹配文案，也不把一次服务重建窗口升级为整条工作流失败。
- 媒体 execution 对已持久化 `taskId` 的 `queued/running/submitted/submitting` 统一视为 provider pending 结构事实；其中 `submitting` 覆盖“供应商已受理或已完成，但本地 canvas projection 尚未推进到 running”的崩溃与竞态窗口。图片/视频 runner 和后台 reconciler 都必须先以同一个 taskId 查询权威 task result：若双写中断只把 `nodeId + taskId` 保存进不可变 workflow item evidence、画布投影尚无 taskId，runner 会把这组精确身份作为单节点 reconcile target 补写回原节点；画布若已有不同 taskId 则拒绝认领，禁止串任务。迟到的 `succeeded + HTTP(S) OSS URL` 回写原节点并复用既有资产，不能把旧 `submitting` 直接判失败、创建第二个付费任务或丢弃 collection 中已成功 sibling；权威结果证明 failed 时原样保留该终态，同一 execution family 不再提交。该判定只读取枚举状态、稳定 task identity 与真实 URL，不解析 prompt 或媒体语义。
- Workflow 节点的普通 `maxAttempts` 只约束当前物理动作，不能覆盖 executor 已发布的逻辑续跑合同。若节点结果或 collection 中任一失败 item 的结构化 evidence 明确给出 `retryableByDurableWorkflow=true`、非空 `retryableFailure` 与单调递增的 `workflowRetryCount`，ExecutionDO 必须先保存该精确失败证据，再创建下一物理 attempt；collection 只重入带该 directive 的失败 item，已成功 sibling 保持不动。即使普通节点重试预算已耗尽，也不能把整个 workflow 提前置为 failed。是否继续以及总预算仍由 executor 的通用有界策略决定：策略耗尽时它停止发布 retry directive，runtime 随即如实失败。该机制不读取 prompt、工作流名称或错误文案，不做模型降级，也不重新提交已受理的媒体副作用。
- `provider_stream_interrupted` 发生在 agents-cli 写出首个 recovery checkpoint 之前时，状态解析仍保留该真实 `suspended + reasonCode + recoveryCheckpoint=null` 形状，不能把整个 bridge 状态误判为协议非法。Workflow Agent runner 将其视为 orphaned physical boundary：从冻结节点输入创建新的 `:physical-retry:<N>` 身份，并纳入统一 no-progress recovery window；连续五个不同物理代际没有任何新 progress revision 时才耗尽窗口，存在新进度时允许继续派生后续代际。已有 checkpoint 时仍优先 CAS 恢复原 continuation，两条路径不会并行。
- agents-cli 的交付证据额外携带因果来源：每个 settled 工具 trace 固结 `sideEffect`，root durable claim 固结 `origin=effect|observation`。`new_task`/未完成 continuation 的真实资产只能由本逻辑任务的 effect receipt，或与该 receipt 的 `taskId/runId/executionId/assetId/nodeId/URL` 精确关联的只读 reconciliation 结果物化；旧 ledger 没有 origin 时按 observation 处理。`tapcanvas_flow_get` 等画布读取和 `present_media` 只展示已经存在的 URL，不产生 effect receipt，也不能把历史成片升级成本轮交付。这样 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 不再把“看见一个真实 URL”误当成“本轮生成了这个资产”，同时仍允许已受理异步任务在后续物理窗口通过同一稳定身份补齐最终 URL。
- 对话输入区的排队 Dock 只是持久队列的浏览器投影：所有回合状态（包括 `running/suspended/needs_input/succeeded/failed/cancelled`）都读取 `chat/status.turn.pendingQueueCount`，不能在回合离开 active 后退回本地 `m_user_queued_*` 猜测仍在排队。服务端计数减少时按 FIFO 清除最旧的本地投影、只保留最新仍待消费条目；计数归零时 Dock 必须立即消失。状态暂不可得时可短暂保留本地已受理条目，但不得把它升级成服务端仍排队的事实。
- `needs_input` 是同一 public turn 的可操作等待态，不是运行中或新回合冲突态。只要 `chat/status` 已返回与 `turnId` 对齐的结构化 `pendingUserInput`，Web 可以在后台状态刷新尚未结束时提交 `requestUserInputResponse`；只有 `activeTurn/running` 或没有已确认快照时才禁用新回合。Web 查询 `/public/agents/chat/status` 设有 12 秒客户端超时，超时显式显示状态读取失败并提供刷新入口，禁止把无限等待伪装成仍在执行。
- 画布会话采用覆盖式唯一真源：项目、Flow、章节作用域统一使用确定性的 `project:<id>[:flow:<id>|:chapter:<id>]:lane:<lane>:skill:default`，不会再从客户端随机 `:conversation:<base>`、技能 lane 或“服务端最新一条历史”恢复运行时上下文。Web 在非活动回合以服务端快照替换本地消息投影；活动流期间才暂存尚未落库的临时卡片。用户显式开启新对话时，首个新回合携带 `resetSession=true`：Hono 清理该 canonical session 的公共消息投影并将 session memory 标记为 `superseded`，agents-cli 同时追加 `session.reset`/`session.state.cleared` 事件、清空 Redis 与 durable checkpoint，再让模型读取历史。旧物理 session 与旧事件继续保留并可从 Web 历史菜单以只读存档查看，但选择存档只调用 `memory/context` 读取消息，不旋转当前 session key、不恢复旧 memory、不能发送消息，也不参与当前模型上下文；continuation 不得重复执行 reset。这样既保留历史可追溯性，又保证“旧对话影响当前回合”和“刷新后前端看似清空、服务端又注入旧历史”不会复发。
- 无项目画布不再共用同一个浏览器级会话桶：当当前 Flow/画布有稳定 ID 时，Web 使用 `canvas:<canvasId>:lane:<lane>:skill:<skillId>` 作为会话身份；没有稳定画布 ID 的首页聊天才使用持久化的浏览器 conversation base。这样同一用户的不同无项目画布相互隔离，同一画布切换能力仍复用同一会话；项目/Flow/章节会话规则不受影响。
- 对话中断与异步任务取消是两种不同的生命周期权力。Web 的“中断当前对话”和“开启新对话”都只中断本地传输、当前 agents runtime 与 `resumeTrigger=physical_budget|replan` 的模型物理续窗；已经通过稳定 `taskId/runId` 受理、由 `resumeTrigger=dependency` 持有的 continuation 必须继续等待并收口真实异步证据，不能因清空聊天投影而变成无人接管的工作流。只有工作流自身的显式取消路径可使用 `scope=all` 终止依赖 continuation。该边界只依据持久 continuation 的结构化 origin，不读取 prompt、工作流名称或媒体类型；底层媒体 Run 继续但收口 owner 被静默删除的历史双轨已经退出。
- Agents CLI 的 `/chat/status` 在 live turn 上只读取内存中的 authoritative rollout state，不再为每次轮询重建完整 append-only transcript；inactive turn 才读取 PostgreSQL 中最新的状态事件与最近一段 history 事件，用于恢复收据。这样状态检查不会与当前回合的历史持久化争用同一条长查询，也不会因会话历史变大而把 Hono 的显式 status deadline 变成前端“卡死”。状态读取失败仍保持 unknown/保护态，必须等权威快照恢复后才允许开始新回合。
- live turn 的 `/chat/status` 先使用 agents bridge 进程内的 authoritative session，再检查 PostgreSQL durable schema；因此 bridge 重连或数据库 schema 探测短暂不可用时，仍能返回当前回合并接受同一 `turnId` 的精确中断。只有没有 live session、必须从 checkpoint 恢复时，才返回 `durable_turn_storage_unavailable`，禁止把一个仍可控的活动任务误报为 503。
- Web 的回合恢复会对两类结构化、非活动 checkpoint 自动执行一次精确 `sessionKey + turnId` 认领：正常 `root_physical_execution_budget_exhausted` 挂起；以及 `provider_stream_interrupted` 挂起，或停在 `accepted/agent_running/completion_verifying`（或携带同原因恢复 checkpoint）的 `unknown/failed` 回合。浏览器不提交 prompt、runId、工具参数或新的业务动作；Hono 只有在同一用户、同一 root turn 的持久 continuation/恢复 checkpoint 可被 CAS 认领时才续跑，否则原样返回拒绝并停止自动重试。这样 bridge/数据库短暂重启后小 T 能从最新认证工具 catalog 自行恢复，同时不会凭旧 UI 状态新建视频 run 或重复付费提交。
- 章节画布 Intent 入口现已硬切到公共对话的同一终态合同。Web 每次用户派发只创建一个稳定 `executionId`，并将其同时作为 `clientPendingId` 和 `chapter-intent:<projectId>:<chapterId>:<executionId>` 会话身份；请求必须携带真实 `canvasProjectId/chapterId/canvasNodeId`，完整保留选中源节点，其余画布仅投影可寻址结构索引。首次 POST 在尚未取得受理响应时若遇到断网、408/425/429 或 5xx，只能在五次有界窗口内逐字重发同一 `clientPendingId/sessionKey/body`；若重发得到 `agents_chat_turn_already_exists + publicTurnId`，客户端立即改用该权威 turn 的 status journal 对账，禁止创建第二个任务。余额、权限、schema 等确定性 4xx 不重试。流式客户端只消费规范 `tool/result/done`：`tool` 仅展示 agents-cli 已完成的真实动作，不在浏览器重放 `flow_patch` 或执行第二套本地生成流程；`result.trace.requestTerminal` 是 succeeded/failed/suspended/needs_input 的唯一完成裁决，缺失时显式报协议错误，不能以“收到文本”“流已关闭”或旧 `finalize` 事件冒充交付完成。若物理流返回 `suspended`，浏览器保持同一逻辑任务，按权威 `chat/status` 等待；checkpoint 失去活跃 owner 时只用精确 `sessionKey + turnId` 做一次 CAS resume，直到真实终态、需要不可推导的用户输入或有界等待耗尽。画布 Intent 的瞬时受理失败、连接中断和 accepted-duplicate 均由共享 durable transport 在同一任务身份内恢复；UI 不再提供会生成新 `executionId` 的手动重试，也不要求用户发送“继续”、刷新页面或重新派发同一 Intent。由 agents-cli 通过 TapCanvas 工具产生的节点与资产仍以服务端/画布持久事实为唯一真源，Web 不回滚、不覆盖、不丢弃已成功资产。
- 画布与组节点的“一键成片”只保留 `Canvas/runGroupToFilm -> chatCommandStore -> AiChatDialog -> agentsChatStream -> agents-cli` 单一路径。入口只传当前 project/flow/chapter/group、用户已确认的时长/比例/模型/配方/领域档案、组内文本与参考节点身份，显式加载 `tapcanvas-video-workflow`；Web 不再保存八阶段 SOP、固定工具顺序、模型操作方法或另一条 raw `/public/agents/chat` 流。历史 `streamStoryboardAutoRun`、独立 auto-run store 和悬浮进度面板已删除，防止未来误接回无持久身份、无事件 journal、以 `done` 冒充完成的平行实现。任务受理、断线恢复、异步资产对账与 `requestTerminal` 验收统一复用公共对话 harness；工具和资产进度在主对话与服务端画布事件中展示，真实成片 URL 与 delivery verifier 才构成交付证据。
- 公共小 T 响应的成功终态采用硬切后的结构闭包：`requestTerminal.status=succeeded` 只有在同一响应同时携带 `expectedDelivery.active=true`、合法 `deliveryEvidence@2`、`deliveryVerification@2.status=satisfied`，且 `expectedDelivery.contractHash === deliveryVerification.contractHash` 时才可向 Web 投影为成功。agents-cli 在实时 `/chat` 响应的 `trace.runtime.terminalDelivery@1` 中直接携带刚从 Logical TaskStore 构造的同一份权威闭包；Hono 只做结构校验和公开字段投影，纯文本回合必须保留 runtime 绑定的 `final_response` evidence，禁止再从 `semanticTaskSummary`、正文、assets 数量、旧 `turnVerdict` 或工具成功数重建另一套终态。agents-cli 声明成功但没有这份闭包时，公开终态改写为 `requestTerminal.status=failed/reason=terminal_delivery_chain_invalid`；若字段已经出现却版本、结构或 hash 非法，或它与物理执行出口矛盾，则 bridge 以独立协议错误显式失败，不能把不同根因压成同一个错误码。Web 的最终气泡与持久 live-run 状态仓库复用同一个纯结构终态投影，并把投影后的终态写入本地消息，防止协议失败气泡因缺少 settle 标识在状态轮询中复活为 spinner，也防止气泡与后台运行条对同一回合显示互相矛盾的完成状态。已经返回的真实资产仍完整保留，结构失败只否决不可信的完成声明，不删除、覆盖或重提媒体任务。
- `/chat/status` 的刷新/断线恢复与上述实时响应共用同一成功闭包，不再把裸 `state=succeeded` 或 `finalResponse` 当作完成证据。每个 turn 还必须持久化结构化 `terminalAuthority`：公开根任务为 `user_delivery`，Workflow 直接调用的内部 Agent 为 `workflow_action`；缺失的历史字段按 `user_delivery` 处理。agents-cli 在 TaskStore 根任务真正进入 `satisfied` 后、公开 turn checkpoint 进入 `succeeded` 之前，将精确的 `requestTerminal + UserIntentContract + DeliveryEvidenceV2[] + DeliveryVerificationV2` 写入 `latestTurnContext.terminalDelivery@1`，并随 rollout state 持久化；verification 必须为 `satisfied`、evidence 非空且双方 `contractHash` 完全一致。只有 `user_delivery` 成功终态要求并允许向用户投影这份交付闭包；`workflow_action` 的成功只供 Hono 内部 Workflow runner 按自己的结构化输出合同观察，不得被 Web 冒充为用户交付成功。若刷新时 transport 快照缺失或损坏，agents-cli 会先按同一 `publicTurnId/logicalTaskId` 只读查询权威 Logical TaskStore 根节点；仅当该根节点仍为 `satisfied` 且能重新构造完全相同的版本化交付链时才恢复成功投影，禁止从正文、工具名、资产数量或旧 trace 猜测。TaskStore 也没有合法闭包时才投影为 `failed/terminal_delivery_chain_invalid`；Web 若收到内部动作成功则投影为 `failed/workflow_action_not_user_delivery`，气泡与 live-run 仓库再次执行同一结构检查。候选正文和已经生成/受理的媒体事实继续保留，只撤销虚假的成功声明，不创建新任务、不重复提交付费媒体。该设计沿用参考 harness 的“每次传输只有一个权威 terminal handler、恢复只读持久 checkpoint”原则，但交付裁决仍由 TapCanvas 自身的 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 合同承担。
- 章节剧情现已采用单一真源写入：小T先用 `tapcanvas_project_chapter_get` 读取章节元数据、独立画布与 `canvasRevision`，确认剧情后只能通过 `tapcanvas_project_chapter_update` 进行 CAS 更新。该动作在同一个 revision-guarded 数据库写入中同时更新 `chapters.title/summary` 与锁定的 `chapter-seed-<chapterId>` 节点（`chapterText/content/prompt/sourceChapterRevision/sourceHash`），并向章节 SSE 广播新种子；Web 载入章节时优先采用服务端持久种子，不再用旧页面 props 覆盖新剧情。普通章节 PATCH 也硬切到同一写入函数，因此页面编辑与小T编辑不会再形成两套正文。工作流 `project_context` source 会把原始节点投影成顶层 `kind/content/sourceRevision/sourceHash` 事实，BeatSheet Agent 不再收到只有嵌套 `data.chapterText`、却按 `nodes[].content` 读取的错位合同。
- 章节剧情确认后的自动交接，以及用户在对话中要求“用九宫格图预览剧情”，统一由 agents-cli 加载 `tapcanvas-storyboard-expert` 后调用专用 `tapcanvas_story_preview_orchestrate`。通用 `tapcanvas_image_generate_to_canvas` 已从公开 schema 硬删除 `previewBoard/mode`，运行时也只允许专用编排路由携带内部 `storyPreviewOperation` 提交逐板内容，不保留旧复用查询或通用生图双轨。agents-cli 先通过 `tapcanvas_project_chapter_update` 冻结版本化 `storyPreviewContract`；合同记录 `storyDurationSeconds`、`previewScope`、归一化 `previewWindow`、显式 `frameIntervalSeconds` 与完整 `requiredReferences`。Hono 按这些数值事实确定性推导总格数、最多九格的分页、本板精确格数和每格起止时间，并用持久 `progressCursor` 只开放第一个缺失的 `put_board_N`；running/success checkpoint 依据章节 revision/hash 与真实节点/任务状态幂等复用，不重复越过付费边界。
- 每个动态 `put_board_N` schema 都给出本时间窗完整重叠原文 `sourceExcerpt`、冻结 `referenceOptions`、精确格数和可选引用 ID 枚举。Agent 必须在当前链完成来源覆盖、视觉实体盘点与逐格 authoring，并为每格显式提交 `frame/mid/end/camera/feedback/environment/subjectRefIds`；`subjectRefIds` 的精确并集是本板实际引用集合。Hono 只校验非空结构、格数/时间网格、引用 ID 是否属于冻结合同、revision/hash 与幂等事实，不再使用关键词、别名、bigram、字数阈值或正文 `includes` 猜人物、猜场景、补默认主角、判定剧情质量或把全部引用覆盖到每格。跨世界、屏幕、照片、回忆与画外主体的语义归属由 Agent 的 Visual Entity Inventory 和 `tapcanvas-storyboard-expert` 同链自检负责；发现遗漏时只重写当前未受理板，不能改章节真源，也不能把纠偏下沉成 Hono/Web 文案门禁。
- 服务端仍从紧凑格展开权威 `storyPreviewCells`、跨格/跨板状态承接、完整 `referenceManifest`、active reference IDs 与最终九宫格 prompt；prompt 中的引用只来自逐格精确声明，不从文案二次路由。每板持久化为 `storyboardImage`，携带 `assetUsage=preview_only`、`assetPurpose=story_preview`、`productionEligible=false`、`productionLayer=preview`、`creationStage=story_preview`、系列索引和来源身份。真实图片同时回到聊天和画布；preview 继续被图片/视频生产引用链明确拒绝，正式出片必须从同一权威章节文本重新编译 production design board，不能改标签复用。
- 章级改编在切 beat 前由 `tapcanvas-dramatic-adapter` 做 ephemeral Visual Entity Inventory：语义归并稳定实体并区分 `visible/audible_only/mentioned_only/flashback_visible/unresolved`，再把结论写回既有 `essentialCausality/stateTransitions/visualStateTimeline/assetObjectContracts` 与逐拍主体绑定，不新增平行持久 schema。世界书四件套也改用结构身份：非空 text 节点必须显式携带 `data.bookBibleType=world|roster|redlines|ip_safe`；定稿检查和 stale autosave 保护只读取该字段，不再用 label 正则或 SQL LIKE 识别语义。损坏画布显式失败，不能静默当成“全部缺失”。
- 画布图片生成能力由 `tapcanvas_image_generate_to_canvas` 统一提供：它仍使用当前用户可执行的图片模型目录、真实异步任务、节点回写和资产权限边界。公共对话的冷工具目录先返回 `generate|generate_advanced` 操作索引；普通单图的 `generate` 投影只暴露基础节点、模型、画幅、尺寸、引用与等待字段，完整生产元数据只在显式选择 `generate_advanced` 后披露，避免一句话生图为无关 schema 重复支付上下文成本。两种操作共享同一组 `imageModel/aspect/imageSize` 执行字段；`executionCatalog.selectionContract` 必须指向真实字段 `node.data.imageModel`，并要求从实时目录复制精确 modelKey 与受支持规格，禁止 schema 一边要求高级身份元数据、一边迫使运行时退回账号默认模型。agents-cli 的 runtime 初始 capability grant 与 resolver 共同使用 `262144` 的单一物理累计 token 预算，不能再由 Web/质量入口保留 `120000` 的平行旧值，使普通生图在首次异步提交前被人工切窗。若浏览器只带 `canvasProjectId` 而未及时带上 `canvasFlowId`，Hono 仅在认证项目下恰有一个可见 flow 时确定性补齐该 flow；多个 flow 不猜选，继续显式要求当前画布作用域。这样不会把“作用域暂缺”误报为“没有生图工具”。
- 画布媒体生成使用统一的 `generationContext` 事实合同保存资产归属：浏览器节点、`tapcanvas_image_generate_to_canvas`、视频画布工具与工作流执行在提交媒体任务时携带真实 `projectId`，并按实际作用域附加 `flowId/chapterId/nodeId/workflowExecutionId`。Hono 在任何供应商提交或异步图片受理前验证项目访问权及 flow/chapter/execution 的项目归属；该上下文随 queued/running/succeeded/failed 任务结果和视频轮询持久保留，最终 OSS 资产统一写为 `assets.project_id + data.kind=generation + data.type/url`。素材库仍可按项目归属过滤；底部“生成历史”则是当前用户全局时间流，只按 `kind=generation` 查询、按创建时间倒序、每页 20 条，不附加项目过滤。生成历史、发布素材选择器和 Neo TV 只读取 canonical generation 合同，不再依赖从未由媒体链写入的 `taskNodeOutput` 形状；无项目上下文的公开 API 生成仍明确保持 projectless，禁止猜测挂到当前项目或跨项目复用旧资产记录。

- Workflow Agent 的结构化同链修复会在持久 evidence 中维护有界、去重的 `structuredFailureHistory`（上限与通用总重试预算一致），并在每个新的 correction 物理窗口把该逻辑任务此前出现过的全部不同 verifier 失败一起交给同一模型。模型必须对完整 JSON 同时复核所有历史失败，不能只修最新一项后重新破坏已通过的旧约束。history 会随 durable waiting/transport recovery 证据跨 API 或 bridge 重启继续传递；本地只收集确定性的合同错误文本、去重和限长，不解释 prompt、章节正文或错误语义，也不针对某一 Clip/对白添加分支。相同失败仍计入独立的 no-progress fuse，不同失败继续消耗总重试预算，因此该机制阻止 A/B 约束振荡，但不会放宽结构合同、隐藏失败或形成无限重试。
- BeatSheet 的跨 item / 跨 Clip 连续性、来源分配与 `storyEvents.sourceBeatId` 语义映射由模型在完整产物中处理；Hono/前端不提供局部邻接上下文、不补写语义，也不因顺序或连续性诊断阻塞工作流。只有来源 ID 不存在等下游无法解析的引用错误可以退回完整产物。
- 一键成片的内容密度由同一条创作/编译链负责：BeatSheet v12 只提交剧情语义真源，包括 `sourceCoveragePlan.speechLedger`、`sourceFidelityAudit.sourceBeatLedger` 的语义摘要、章级 `chapterArc`、连续的 `beats[].storyEvents`、因果交接和对象合同；`protocolVersion/sourceId/sourceFingerprint`、来源顺序与事件时长、`clipIndex/dialogueScript/speakers/exitState` 由 Hono 与 agents-cli 使用同一确定性投影补齐，模型不得重复抄写。Video Writer v14 只创作有序 `speechEvents`、`shots`、`depictedStoryEventIndices`、画面任务、可选动作、摄影、声音与同链自检；shot 不携带对白正文或 `speechEventIds`。Writer 在唯一提交前把逐镜最终秒数精确闭合到冻结 Clip 时钟，并以累计半开镜头区间验证每个事件索引；Hono 不改变这些参数，只编译 Shot 与 SpeechEvent 的精确区间引用。随后以 story event 边界、整数秒边界和 shot 边界为唯一时间分区，从冻结事件与 writer shots 确定性编译 `sourceEventCoverage/temporalFrameTrack/temporalFrameCoverage`：窗口最长 1 秒，事件/镜号只按结构化下标和时间区间求交。机器字段在 Agent 首稿合同中省略，编译完成后仍进入原完整执行 verifier；编译器不解释正文、不生成剧情，也不使用字数、镜头数量、审查分数或关键词命中作为语义质量闸门。
- BeatSheet、资产规划与 Clip writer 共享唯一的逐对象连续性合同，但不再复制整章上下文。每个 writer item 只接收冻结 `sourceReceipt + current beat + sequenceContext(previous/current/next 与 chapterArc) + assetObjectContracts`；完整 `sourceCoveragePlan/sourceFidelityAudit` 不进入并行 writer payload，writer 也不得重建章级账本。每个 beat 用稳定 `clipId + storyEvents + assetObjectContracts + causalEntry/irreversibleResult/handoffToNext` 冻结当前片段的事实与相邻交接；逐秒/亚秒轨由服务端根据结构化事件下标与有序 shots 编译。同一 canonical 对象跨 clip 的 `identityInvariant` 必须一致；它下一次声明出场时，`startState` 必须逐字继承上一次声明的 `endState`。
- 图片资产复用是执行宿主的确定性事实，不再交给 Asset Agent 复述。Hono 只依据冻结 ProjectContext 中精确 canonical identity、`state=ready`、`productionEligible=true`、项目归属与真实稳定资产身份划分 reused/unresolved：reused 角色由宿主直接物化 `existingAssetId/existingProjectId/existingNodeId` 计划，不要求 prompt，也不调用 Agent；Asset Agent 只接收 unresolved role allowlist 并为缺口输出新图片 prompt。全部角色已就绪时资产规划以 `all_frozen_asset_references_reused` 成功收口，图片执行器在复用分支前不读取 prompt、也不要求图片供应商。project-node 的整画布 revision、`status/approval/transcode/URL expiry` 生命周期字段，以及可能在异步结果物化时被压缩的 `creationStage/productionLayer` 生产过程元数据，均不参与媒体内容指纹，避免其它节点保存、同资产状态推进或结果回填整理元数据时把未换字节的图片误报成 `workflow_asset_version_drift`；消费时仍 fresh-read 当前状态、权限、生产资格、真实 URL 与媒体/身份内容指纹，真实换图、拒绝、删除、转码中或资源过期继续明确失败。资产 fan-out 另外记录 `reusedItemCount/generatedPlanItemCount`，质量平台从 managed workflow 的真实 `startedAt/finishedAt/durationMs/itemRuns/evidence` 展示节点时钟、逐 item 耗时和复用/补图数量；恢复成员只可按 `executionFamilyId` 与原评测执行族协调，不能把新的物理 execution id 错判为另一任务。已经受理或生成的媒体资产仍不受后置诊断影响。

- Web 的“创作动态”是现有执行主链的只读事实投影，不是第二套 AI 编排器。`GET /tasks/inbox` 统一返回 `task_results` 中的 `queued/claimed/running/succeeded/failed`，覆盖 chat、prompt refine 与全部媒体任务；`claimed` 只投影为 `running`，非终态任务不产生完成通知，也不能因尚无资产被伪装成失败。当前小T回合继续由既有 `liveChatRunStore` 消费 agents bridge 的真实 stream/terminal/trace；若同一 `requestId/runId` 已出现在持久任务收件箱，Web 只保留持久记录，禁止双份展示。动态详情继续使用真实 taskId、nodeId、状态、失败原因与资产，前端不根据 prompt/工具名推断进度或结果。
- “创作动态 → 记忆”读取的仍是现有 `/memory/context` 分层装配结果，按当前 project/book/chapter scope 展示 user preference、project/book/chapter facts、artifact refs 与 rollup。该页明确标记这些条目只是当前可提供给小T的候选记忆；是否在某一回合实际读取、采用或影响动作，仍只能由该回合的 execution provenance、tool trace 与交付证据证明。Web 不另建记忆库、不把候选记忆升级为事实，也不从记忆正文做本地语义路由。
- `record_user_intent` 的候选合同先接受独立语义复核，不能由提出合同的主代理自行宣布正确。agents-cli 使用 root 本轮实际生效的同一模型与 provider 做无工具、严格 JSON 推理，逐项对照精确原始用户请求、候选 `UserIntentContract@2` 和可继承的历史合同；物理 continuation 必须优先使用 task capsule 恢复的不可变原始目标作为审查源，当前 continuation prompt 中的 progress frontier、allowed actions、receipt 与 schema 读取限制属于机器执行控制，禁止投影成用户 `must/forbid/prefer`。`UserIntentContractReview@2` 必须绑定 `requestFingerprint + contractHash + continuityFingerprint`，并按候选合同顺序恰好一次确认全部 `must/forbid/prefer`；reviewer 输出不再复制容易在长合同时重复或错位的 `requirementId`，runtime 按严格定长数组位置确定性绑定稳定 ID，语义状态、证据来源与理由仍由独立模型逐项给出。审查同时分别检查 `delivery.mode`、`delivery.mediaType` 以及由 `kind/output/artifactCount/durationSeconds/clipCount/aspect/resolution` 组成的完整终态规格；任一规格值缺失、误分类或并非来自本轮明确请求/精确继承的权威合同，都必须返回 `needs_revision`，用户未指定的值则必须省略而非补造默认值。`clipCount` 只表达用户明确要求独立交付的片段数量：供应商按时长上限拆出的内部窗口、BeatSheet 规划和拼接拓扑都属于 generation contract，不能进入意图合同；用户要“一条最终成片”且只给总时长时，`artifactCount=1`，`clipCount` 省略。模型目录、供应商限制、超时、图片预制和重试步骤同样只属于 `confirmedFacts` 或下游执行合同，不得被 reviewer 反向提升成缺失的用户 must。`confirmedFacts` 只属于规划事实，不参加用户要求审查。`delivery.mediaType` 的完整合法域只有 `image|video|audio|null`：正文、JSON、回答或计划等非媒体 response 必须使用 `null`，不得要求 `text/plain`、`application/json` 或其它 MIME/产品标签。审查输出若仅在 JSON、身份字段、枚举或 requirement exact-set 上结构失效，agents-cli 在同一个原子 reviewer 内最多再完整生成一次并累计到本物理窗口预算，不把这种内部协议修复抛回 root 消耗新的 `record_user_intent` 回合；两次仍无效才显式上报结构失败。语义 `needs_revision` 会把完整候选和精确缺陷持久化为 `PendingUserIntentRepair@1`，后续同一物理链或 durable continuation 必须用 `record_user_intent.repair={baseContractHash,patch}` 只替换被指出的顶层字段，runtime 从候选原样保留未提交字段（尤其 `referenceResolution`），重新执行完整结构校验与独立语义复核；禁止每次从零生成整份合同。候选通过后该 repair checkpoint 原子清除。文本交付中失败或被关闭的只读动作必须作为事实进入统一 delivery verifier，不能在候选验收前被本地 `tool_action_terminal_failure` 提升成任务级终态；若该读取确属合同必要条件，verifier 仍会据实判定证据不足。交付模式按终态主事实唯一分类：新物化的图片/视频/音频即使还要求回填画布或项目，仍为 `async_artifact`，持久落点写入 `delivery.output` 与用户要求；只有不产生新外部资产、终态本身就是持久 mutation 时才使用 `state_change`。只有 `faithful` attestation 才作为最终合同审查持久化；Hono 不生成、重写或用本地 route 复核这份语义结论，只恢复同一个 agents-cli durable session。
- continuation 的 action recovery frontier 只保留尚未被后续确定性成功事实解决的动作失败。特别是 session 已持久化有效冻结 `UserIntentContract` 时，旧窗口中失败的 `record_user_intent` 诊断必须从下一 continuation 的 recovery facts 删除；冻结合同本身就是该协议动作随后成功的更强证据。否则无 `retryInput` 的旧失败会与 `authoritativeProgressFrontier=null` 组合成伪阻塞，并诱发“没有合法动作”的空转重试。该裁剪只依据工具身份和冻结合同事实，不读取或改写用户文案，也不删除真实业务失败、媒体回执或已生成资产。
- 语义依赖冻结允许逻辑任务先经历一个或多个 `userIntentContractHash=null` 的前置物理窗口，再在独立复核成功后首次冻结合同哈希；第一份非空哈希出现后才进入不可变阶段，后续改变或消失均以 `semantic_dependency_changed` 显式拒绝。这样合同建立本身可以跨预算窗口完成，不会把合法的 `null -> verified hash` 误判为语义漂移，同时仍禁止真正的跨窗口换合同。
- DeepSeek Harness 硬切后的终态协议（2026-08-31）：公开小T/root 的语义完成判断由 Harness 主代理承担。每轮结构化用户消息最前方注入通用 `required_pre_final_action`，要求主代理按“用户最终收到什么”自主判定本轮是纯文本响应还是状态/资产交付；中途调用过 mutation/Workflow 工具不自动把最终文本交付改成 state change。普通纯文本 `response` 必须在开始输出任何最终正文前调用 request-scoped 私有 `report_delivery` 并取得成功回执，不能因任务简单或无需其它工具而略过。该调用提交结构化任务目标、响应交付规格与逐项 must 自检，只在 Bridge 内冻结 `UserIntentContract@2/expectedDelivery`，不转发 Hono，也不允许模型直接填写最终 `deliveryEvidence` 或 `deliveryVerification`。对于成功 Workflow 回执中恰有一个 `workflow.output/v1` 标准文本且 Harness 最终正文与其逐字相等的响应，Bridge 的通用事实 verifier 可直接冻结 `workflow_authored_response` 合同，并同时绑定终态 Workflow 回执与最终正文 SHA-256 两类 evidence；多输出、缺输出、非终态、执行失败或正文不完全相等均不满足此路径。Harness 正常结束后，Bridge 才生成 `deliveryVerification@2.status=satisfied`、`terminalDelivery@1` 与 `PhysicalRunExitV1(logical_terminal/satisfied)`。缺少合法报告或上述精确 Workflow 证据、正文为空、合同非法、模型未完成或 hash/引用不一致均显式失败。`state_change` 与 `async_artifact` 禁止使用文本报告或 Workflow 文本冒充成功；它们必须来自业务工具真实回执、持久状态或已物化且媒体类型一致的 HTTP(S) 资产 URL，queued/running 受理、nodeId/taskId、普通正文、子代理 completed 和工具调用结束均不是充分交付证据。已经产出的资产即使验收未满足也必须保留，后续只允许追加事实与同链修复，不能删除、覆盖、回滚或重复提交付费任务。
- Hono 本地自动发现 bridge 时不会把任意 `200 /health` 当作 Harness。健康响应必须逐字段匹配当前锁定的 `{ok:true,runtime:"deepseek-harness",profile:"sdk",upstreamVersion:"0.1.2-alpha.2"}`；旧 agents 进程、SSH 转发到旧服务或版本漂移都会显式判为不健康，禁止以泛化 `{"ok":true}` 混入当前单轨运行时。显式配置的远程 bridge 身份不匹配时启动失败；本地开发若默认 `8799` 被非 Harness 进程占用，应明确配置当前 Harness 地址后重启 API，不允许继续沿用旧运行时。
- 执行阶段协议 `StageExecutionPacket@1 -> StageExecutionReceipt@1` 只承担可选的跨物理窗口续跑证据，不再充当第一次业务 mutation 的前置闸门。`UserIntentContract@2`、能力授权与真实工具 schema 已经构成业务动作边界；当前窗口事实就绪时 agents-cli 必须直接执行，缺少阶段包不得拒绝、挂起或终止动作。只有已经确定的唯一 frontier 确需跨窗口保留时，root 才调用 `record_stage_execution`，把合同哈希、输入引用、真实 Skill source hash、预期输出、证据类型和唯一下一工具动作追加到 LogicalTaskGraphV2。active packet 一旦存在仍严格复用 `DurableProgressCursorV1`，continuation 只恢复并推进该 frontier；Hono 只透传 checkpoint/`durableTaskReferences`，不解释 `stageId`、不选工具、不拼 SOP。成功/失败/blocked trace 由 agents-cli 追加 receipt，最终完成仍须经过 `expectedDelivery -> deliveryEvidence -> deliveryVerification@2`。
- 质量平台新增只读 `progressFunnel`：从 agents-cli 真实 tool trace 统计首次 intent freeze、首次 stage packet、首次成功业务 mutation、其前控制面调用数与生产 mutation 数。Skill/knowledge/schema/task 查询和两个协议工具不算生产进展；执行型评测若没有成功的真实业务 mutation，明确归类 `control_plane_stall`。该分类只进入 eval 报告和失败中心，不是 Hono/Web 创作质量闸门，不会拦截、回滚或丢弃已经受理/生成的媒体。
- agents-cli 的 action-only 投影把“已由认证 schema 激活、但尚未获得成功事实回执”的只读 catalog 工具视为结构性前置事实游标：读取继续可见，普通 mutation 暂时不可见，直到全部已激活读取成功消费；显式 delivery-repair 目标仍可按恢复合同执行。该通用结构规则避免章节正文、素材清单等必要事实在 schema 激活后一回合被误删、被付费动作越过或造成重复 schema 查询，不依赖工具名、章节、工作流或 prompt 关键词。
- “一句话是否真的交付”使用 `node apps/hono-api/scripts/ai-delivery-acceptance.mjs --case text|image|video|all` 做公共入口黑盒验收（同名 package scripts 也保留给 pnpm workspace 调用）。图片 case 的默认用户原话固定为“生成一张小猫图片”，明确冻结图片媒介，用来覆盖普通原创单图的最小真实链路，避免把模糊的“生成一只小猫”错误当成图片意图。执行器只调用正式 `/public/agents/chat`、`/public/agents/chat/status` 与同一 public turn 的 `/public/agents/chat/resume`，请求字段保持网页主对话的 `vendor=agents + mode=auto + forceAssetGeneration=false`；文本、图片、视频的差异只存在于用户的一句话，不用本地 route、关键词、专用工具白名单或强制生成开关替 agents 做语义决策。每个 case 使用新的稳定 `sessionKey + clientPendingId`，消费首条 SSE 后始终以该 turn 的 durable status 对账；物理预算或 provider stream checkpoint 可通过原 turn CAS 续跑，绝不重发原 prompt、创建第二个逻辑任务或切换模型。对图片 case，status 观察器还会以真实 `tool_completed(tapcanvas_image_generate_to_canvas, succeeded)` 为首次已提交生图证据；若在该证据之前出现 `root_physical_execution_budget_exhausted`，即使后续窗口侥幸交付也必须判定本次集成验收失败，以防控制面空转被最终终态掩盖。媒体 `task_results` 一旦终态，后台 worker 由独立的 `tapcanvas-inprocess-async-continuation-sweep` 轻量 lane 每 5 秒核对一次精确 dependency frontier 并投递原 continuation；它不再等待 60 秒一次的视频/authoring drive，因此“资产成功”和“用户逻辑任务终态”之间只允许留下一个短扫描窗口。其余通过条件不是 HTTP 200、`done`、非空正文、taskId 或 queued/running，而是 status 明确 `state/phase=succeeded`、`terminalAuthority=user_delivery`，并持久提供同一合同哈希绑定的 `requestTerminal=succeeded + UserIntentContract@2(expectedDelivery) + deliveryEvidence + deliveryVerification@2/satisfied`。正文还必须有最终正文和 `final_response` 证据；图片/视频必须由合同中的精确 `delivery.mediaType` 绑定 `artifact.attributes.url` 的真实 HTTP(S) 资产，且满足 `artifactCount`。运行需要显式 `AI_DELIVERY_ACCEPTANCE_API_BASE`、`AI_DELIVERY_ACCEPTANCE_MODEL_KEY` 和且仅一个 API key/Bearer 凭据；质量平台还显式传入其隔离创建的 `AI_DELIVERY_ACCEPTANCE_PROJECT_ID/FLOW_ID`，禁止写入用户现有项目。图片/视频会产生真实付费资产，必须再传 `--allow-billable`。离线合同测试为 `node --test apps/hono-api/scripts/ai-delivery-acceptance-contract.test.mjs`，不连接服务、不生成资产。
- `PendingTerminalDelivery` 的恢复把传输型重试与无进展前提失效明确分开：review timeout/provider 中断仍复用同一候选与 evidence revision；但同一物理窗口已经三次耗尽 `delivery_review_invalid` 的原子结构修复后，只允许再跨一次 durable 边界保存诊断。下一物理窗口必须撤销这个仅用于展示/验收、没有业务副作用的旧正文候选，把 `delivery_review_invalid_requires_replan` 与缺失标准回灌 root planner，并恢复真实模型/工具执行；禁止无限重开 0-turn reviewer continuation。撤销候选不撤销、不覆盖 durable claims、工具 receipt、供应商任务或媒体资产，后续仍按当前逻辑任务的因果 effect 身份继续。该状态转移只依据持久 reviewer 协议失败与有界计数，不按 prompt、媒体类型或具体 workflow 写 case 分支。
- `/public/agents/chat` 的画布节点身份合同统一允许最多 512 字符，并同时约束顶层 `canvasNodeId` 与 `chatContext.selectedReference.nodeId`。工作流投影节点使用 `workflow/node/item/execution/output` 组合身份，合法真实 ID 可能超过旧的 120 字符 UUID 假设；两处字段必须接受同一个真实节点或一起显式拒绝，禁止前端清空选中态、截断 ID 或省略上下文来绕过协议错误。
- 主 Agent 不执行本地关键词、正则或创作质量 admission gate。唯一的模型级语义前检是用户明确要求的 GPT 内容安全合同：公开小T `/chat` 在新的用户回合读取本轮 AI 对话实际生效模型；只有该模型属于 GPT 时，才先用同一 new-api provider 以 Chat Completions 非流式调用一次 `deepseek-v4-flash`，只审查原始用户请求是否违反政治合规要求或包含敏感话题。这里不固定任何 GPT 型号，放行后的 root、内部轮次、子代理和 Workflow 节点全部继承用户本轮实际模型。严格 `ContentSafetyVerdict@1` 只有 `politicalViolation=false && sensitiveTopic=false` 时允许继续。拒绝返回 `content_safety_rejected`，空响应、协议错误、非终态、非法/矛盾 JSON 或审核渠道不可用返回 `content_safety_unverifiable`，两类结果都不得调用 GPT，也不得切换审核模型或目标模型。实际目标模型为 DeepSeek 时不递归审核；同一 root 请求通过后，继承同一模型与原始用户合同的内部轮次/子代理仍属于该已审核执行链。服务端认证的 `executeForcedAgentDirectly` Workflow 原子节点和带 `physicalContinuationLeaseTakeover` 的持久物理续跑都只消费已经受理的用户任务，不构成新的用户请求，因此不得再次调用内容安全模型；它们仍受原公开 root 合同、工作流权限和确定性执行边界约束。除这项显式安全边界外，政治、战争、军事等题材不能由 Hono/Web 本地语义规则预判，创作任务仍须在既有权限、余额、供应商硬边界与工具合同内完成。工具重试预算、closed action、单次动作的 `terminal:true` 以及终态 reviewer 失败只关闭当前动作或当前物理窗口，统一投影为可恢复的 repair/replan 证据。`AgentTaskCompletionSignalV1.disposition=failed` 还必须同时携带确定性的 `terminalBoundary` 和 `safePathsExhausted=true`；缺少这两项的本地失败信号一律无效，不能终止逻辑任务。真正的余额不足、权限拒绝、用户明确取消、不可推导的必要输入或所有安全路径耗尽后的外部能力失败仍由各自确定性边界如实返回，禁止伪装成功或静默降级。
- root persona 的现实政治/战争/军事拒答边界只覆盖现实对象及其伪装、影射或映射请求；纯虚构小说、影视、游戏和广告里的非现实冲突、武侠仙侠战斗、角色资产、场景与分镜属于正常创作范围，继续通过本轮 `skill_search -> Skill` 与真实工具合同执行。Skill 候选召回统一保留中文句子中的独立 `PPT/PPTX/Excel/XLSX` 等拉丁词元、去重相同检索视图并归一 RRF 分数，避免正常 Office 交付因候选批量满分或混合文字粘连而误报“没有生成器”；Hono 不新增关键词 route，也不提供固定模板兜底。
- 物理退出与恢复只认 durable owner 投影的 `PhysicalRunExitV1`。该合同及其 `ContinuationTicketV1` 由 `packages/schemas/agent-observability` 唯一定义，agents-cli 与 Hono 只保留类型别名和各自的运行时构造/解析，禁止跨层复制状态枚举。公开根任务的 owner 是 TaskStore；直接 Workflow Agent 的 owner 是 durable Workflow，并使用真实 `publicTurnId + role/workflow node + physical progress revision` 签发同一版本回执。runner 的乐观 completion、非空正文、HTTP 200、子代理 completed 或单次 verifier 结果都不能覆盖回执。`user_delivery` 的 `logical_terminal/satisfied` 仍要求已验证最终交付；`workflow_action` 的同形终态只表示本节点一次提交结束。直接 Workflow 原子节点若报告 `repair_required/replan_required`，当前物理 run 立即以 `logical_terminal/failed` 显式结束，修复建议只留在 completion/attention diagnostics，不签发 continuation ticket、不创建第二个模型窗口；只有真实异步受理或外部证据等待可以保持非终态。Hono 在同时收到 `PhysicalRunExitV1` 与较弱的 `runOutcome@1` 时以前者重新投影，两者漂移只记高优先级协议诊断，弱信号不能覆盖权威退出。
- 视频 `status` 把“run 生命周期已终止”和“当前工具动作是否仍可自修复”拆成两个事实：`runTerminal:true` 表示被查询的物理 run 已失败/取消；wire `terminal` 只表示当前 status 动作是否关闭。只要响应携带合法 `recovery`，必须返回 `ok:false + terminal:false + runTerminal:true`，使 agents-cli 的通用 tool self-repair 真正执行 `recover_authoring`、`resume_pre_submit` 或 `replan_beats`；不能一边声明精确恢复动作、一边用 `terminal:true` 令运行时忽略它。没有安全恢复声明的失败仍返回 `ok:false + terminal:true`，只关闭该 status 参数动作并进入通用重规划，不直接终止用户 goal。`lifecycleOutcome/goalOutcome` 继续分别表达 run 与交付事实，查询 HTTP 成功不能把失败生命周期伪装成 `ok:true`。
- Skill 候选收据也属于 durable 逻辑任务状态，但不是 capability frontier。`skill_search` 产生的 hash-addressed candidate receipt 会由 agents-cli runtime trace 交给 Hono，并随同一 public turn 的 physical continuation 原样保存、合并和回传；continuation 以 task capsule 的不可变原始 goal 作为 `retrievalUserRequest`，不能用机器生成的 continuation prompt 改写候选请求身份。agents-cli 在每个新物理窗口重新校验 `logicalTaskId + rawUserRequestHash + candidateSetId`；尚未消费的正向候选继续作为可选证据展示，`Skill` 也保持可用，但不得把模型工具面收窄为仅可选择 Skill，不得阻塞画布、媒体或其它已授权动作。Hono 不选择候选、不按 Skill 名路由，也不把旧任务收据迁移到新任务。若实际调用 Skill，候选身份、选择/弃选收据与 section/reference 仍严格验真；历史 receipt 只证明曾经读取，跨物理窗口按需读取时重新注入精确正文，同一窗口内才去重。
- action-only 只读保险丝可以保留已认证的 `Skill` 消费能力与已选 Skill 声明的 runtime child tools，但它们只是可继续使用的证据能力，不是必须先完成的独占前置动作。最终 provider 投影统一执行 `visibleTools > 0` 才允许发送 `tool_choice=required` 的 wire invariant；候选存在本身不能触发 required tool choice、不能关闭 mutation，也不能增加强制模型往返。该恢复只使用候选收据、当前运行加载事实、Skill runtime 声明与授权工具定义，不解析用户文案、工作流名称或创作内容做本地路由。
- delegated child 返回的 response 只会写成带正文 SHA 的 candidate source evidence，并保持 `waiting_for_evidence/unsatisfied`；它不能因 child `completed` 或非空文本直接满足父任务，state change 与 async artifact 仍须真实持久证据。正常 child settlement 会释放 fencing lease；如果父级 abort 已发出而 child runner Promise 仍未确认结束，agents-cli 保留原 lease 并追加 `collab_child_run_uncertain_in_flight`，Hono/continuation 不得再认领并重放该潜在副作用，只有迟到 runner 在原 token 下完成结算后才释放或进入下一恢复态。
- 跨窗口 `progressCursor` 的 canonical 投影固定包含 `graph/scopeId/phase/revision/executionGeneration/completedUnitIds/pendingUnitIds/allowedNextActions/requiredReadActions/allowedSupportingTools`。其中 `revision` 是业务进度，`executionGeneration` 是独立的物理执行租约代际；Hono 必须保留该字段并让需要 fencing 的 repair action 逐字回传，不能把旧 generation 与相同 revision 拼接成合法写回。字段只表达结构化 DAG 与授权事实，不参与语义路由。
- continuation 的 `authoritativeProgressFrontier=null` 按事实分两类：已有 durable receipt/claim/dependency 时表示当前缺少可安全认领的执行前沿，禁止猜动作；而在 `progressRevision=0` 且没有任何 durable business receipt、claim、action recovery 或依赖 run/task 时，它只表示业务动作尚未开始。后一类必须从不可变 task capsule 原始目标恢复正常的上下文读取、agents 自主规划与第一个合法业务动作，禁止把空前沿解释为“所有工具永远越权”并制造无进展续跑循环。
- 公开对话的浏览器连接与 durable turn 已彻底解耦。所有可见 SSE 帧先以 Hono 专用 marker 写入既有 `execution_trace_events`，并等待数据库返回真实 `seq` 后才发送 `id=<publicTurnId>#<seq>`；持久化失败时不暴露游标，禁止客户端确认一个数据库中不存在的事件。浏览器断线后只向 `/public/agents/chat/status` 提交同一 `turnId + afterEventId`，并同步发送标准 `Last-Event-ID`，从该 append-only journal 补发遗漏帧；原 prompt 不会重发，也不会创建新逻辑任务或重复付费副作用。重复/旧序号幂等忽略，跨 turn 或非法游标显式失败；恢复前必须用 `seq=1 request.accepted` 核对同一 session identity，缺失或不匹配均以 409 拒绝。retention gap、游标超前、payload 截断或终态 trace 缺公共终态投影时发送结构化 `resync{recovery.kind=status_reconcile}`，不得静默跳过。只有 `result`、`done` 与 `error.terminal=true` 结束消费；`error.terminal=false` 只追加诊断并继续当前回合。Web 在 turn 已受理后不再把 3 分钟没有业务事件判成任务失败；raw SSE heartbeat 和任意收到的字节都会通过 `onTransportActivity` 续本地观察窗口，3 分钟仅刷新“继续同步”的事实状态。单条 transport 连续 45 秒没有任何字节时只取消该连接，再以上述 `Last-Event-ID` 打开 status replay；durable turn 不取消，原 prompt 也绝不重发。页面刷新没有可信浏览器游标时仍走 durable status 对账；response 候选是否续跑只看结构化物理恢复票据，不看 `delivery.kind`。
- 上述 DeepSeek Harness 终态协议是本节的唯一现行权威。下文出现的旧自研 TaskStore reviewer、`PendingTerminalDelivery@2`、`followUp` 或多轮 completion repair 描述仅属于历史持久数据与迁移背景，不代表当前 Harness 执行路径。当前 `report_delivery` 仅是 Bridge 私有的 response-mode 语义自检工具，不属于 Hono 公共画布工具面，也不能替代执行证据。现行验收链统一为 `expectedDelivery -> runtime deliveryEvidence -> deliveryVerification@2 -> PhysicalRunExitV1`：普通响应的 expectedDelivery 来自 Harness semantic report/UserIntentContract@2；唯一标准 Workflow 文本响应可由 Bridge 根据成功终态回执和最终正文精确相等这一结构事实冻结同形合同。Hono 只校验、持久化和投影结构事实，不另做语义路由、创作评分、正文关键词补丁或工作流个案判断。
- 一次 `request_user_input` 是不可拆分的单阶段输入合同，并且现在必须携带可机器验真的 `blockingBasis`：`contract_unresolved` 逐字引用当前已冻结 `UserIntentContract.unresolved` 中的一个或多个未决事实/授权，`delivery_reference_choice` 则逐个引用该合同 `referenceResolution=needs_user_choice` 的完整候选 ID 集合；两者都必须附事实证据引用。runtime 只比较这些结构化合同字段，不读取问题文案做语义判断。合同不存在、未决数组为空、引用集合不一致，或 Agent 只是因为 checkpoint/runId 缺失、担心重复生成、需要安全重启、需要自行规划创作/DAG 而询问时，当前工具动作会显式失败并把证据回灌同一链继续执行，不能把任务投影为 `needs_input`。Web 对话面板与章节意图入口共用同一组选项组件：每个 question 独立单选，但单项选择只更新本地草稿；只有当前 request 中全部 question 都有答案后，“确认并继续”才可用，并一次提交按 question 顺序排列的完整 `requestUserInputResponse`。前端不得把某一组选项的点击直接投影为 continuation，也不得为同一阶段发起多次续跑；这样一个阶段包含题材、结尾等多组决策时，agents-cli 只会在完整事实到齐后重新 claim 同一逻辑任务。
- 小T 能力舱的替代关系按工作流版本原子维护：能力描述只从冻结图中的显式 Skill 原子节点（`workflowSkillId/skillId/atomicSpec.skillId`）读取真实依赖，不再把 Workflow Agent 的旧 `workflowRequiredSkills` 配置当成依赖。语义冲突分析若把这类显式依赖误报成竞争主路径，服务端依据机器依赖确定性收敛为委托关系。Workflow Agent 自主检索并读取的 Skill 只进入 execution provenance，不改写能力舱的静态替代关系；因此全目录访问不会让一个工作流在装载时声明依赖全部 Skill，也不会批量停用内置能力。
- 浏览器 AI 对话与画布工具回调统一使用 HttpOnly 会话：浏览器不再从 Cookie、localStorage 或 URL 读取/转发 JWT。`/public/agents/chat` 在完成真实会话鉴权后，只用 `INTERNAL_WORKER_TOKEN` 签发当前用户、当前请求生命周期内的受信内部委托凭据给 remote tool 与用户 Skill 读取边界；委托仍逐次恢复用户、团队和权限事实，不能提升角色。缺少内部委托配置时显式失败，不回退到 URL token、前端 Bearer、默认身份、正则/关键词意图路由或另一条本地 AI 流程。
- `/public/tasks` 与 `/public/draw` 的 `text_to_image/image_edit` 已硬切到同一持久媒体执行边界，不再接受同步/异步双轨开关，也不再按模型别名选择执行方式：HTTP API 只完成精确模型可执行性校验与 worker 存活预检，随后在一个 PostgreSQL 事务中同时创建真实 `task_results=queued` 和现有 `task_statuses(provider=async_image_dispatch,status=waiting)` 分发合同；任一写入失败都会整体回滚，不能留下只有 taskId、没有执行身份的半受理任务。Redis/BullMQ 只承担传输，不是受理真源；API 在事务提交后、首次入队前退出，或入队后、回执写回前退出时，常驻 `agent-api-worker` 会用现有 task-status sweep 回收超时 claim，并按相同 `userId + taskId` 确定性 job ID 重新分发，禁止创建第二个图片任务。分发失败保留在同一 outbox 内有界重试，达到预算才把同一 task 原子收口为带失败证据的 `failed`。禁止再用请求进程内的 detached Promise、`executionCtx.waitUntil` 或另一套 scheduler 执行图片供应商调用。常驻 `agent-api-worker` 同时是 `tapcanvas-agent-api-video` 与 `tapcanvas-async-image` 两条队列的唯一消费者；它在注册 BullMQ 消费者前强制关闭 PostgreSQL index/index-only/bitmap scan，对 `task_results(user_id,task_id)` 与 `task_statuses(task_id,provider)` 做堆表身份唯一性检查，并核对两条关键唯一索引均为 unique/valid/ready/live；发现重复物理行、缺索引或失效索引时以 `task_persistence_identity_corrupt` 显式退出，不能在数据库身份事实不可信时继续显示健康或消费任务。图片 worker 原子把 `queued` claim 为 `claimed/running` 后才允许预留积分或请求供应商，成功后写回同一个稳定 task id、本站 OSS 资产和 `succeeded`。BullMQ 图片 job 固定 `attempts=1/maxStalledCount=0`：SIGTERM 时 worker drain 当前请求；若进程硬退出、job stalled 或执行抛错，只把非终态 task 原子收口为带 `failureReason` 的 `failed`，不得自动重放一个可能已被供应商受理、可能已经扣费的图片请求。worker/Redis 在受理前不可用、数据库事务失败或 durable dispatch 合同损坏都会显式失败，不伪造 running，也不切换模型、规格或渠道。
- `Agent API 接入` 是画布内小T对话的异步远程 facade，不是第二套语义路由或视频快捷接口。它复用同一个 `runPersistedAgentsChatTask -> agents_bridge:public_chat -> agents-cli` 主 Agent、session、Skill/Knowledge 工具、业务工具目录、LogicalTaskGraph、continuation、trace 与交付验收；唯一额外事实是该 endpoint 把本轮终态产物冻结为一条真实最终视频。`direct_assets` 只是在执行完成后依据真实 asset/canvas receipt 计算的输出投影标签，不能参与入口路由、Skill 选择或编排决策。`POST /public/agent-api/video-jobs` 接受明确的 `prompt + modelKey + media[{type, assetId|sourceUrl, role}]`，并要求本次身份确实来自一个已启用的用户 API Key；JWT 单独调用会在创建项目或 job 前以 `agent_api_key_required` 显式拒绝。服务端先以有界等待验证 BullMQ 连接、至少一个已注册的 `agent-api-worker` 与自有对象存储都可用，再创建一条 `agent_pipeline_runs` 持久 job；Redis 可达但没有消费者时在创建项目或 job 前返回 `503 agent_api_worker_unavailable`，队列不可达则返回 `503 agent_api_queue_unavailable`，不再受理无人执行的任务。未传 `projectId` 时按当前 API key owner 与 active billing team 的正常项目作用域创建项目，未传 `flowId` 时通过统一 `upsertUserFlow` 合同创建专属空画布，并从首次写入起持久化 `ownerType=project + ownerId=projectId`，保证 Web、CLI 与 agents 的 scoped loading 使用同一投影作用域，不依赖事后修复。开发与生产 compose 都常驻同一 API 镜像、单一职责的 `agent-api-worker`，它是 `tapcanvas-agent-api-video` 的唯一消费者；API 容器只提供 HTTP，worker 容器只运行 `dist/agent-api-worker.js`，综合后台驱动进程（部署服务名 `credit-finalizer-worker`）不消费该队列。worker 必须先验真数据库连通性和 `INTERNAL_WORKER_TOKEN` 才注册为队列消费者；部署脚本与 GitHub Actions 再等待 worker 健康并执行 `agent-api:worker:health`，该健康检查同时验证 Redis 与真实 worker 注册数，因此部署、profile 切换和进程重启都不能在无人消费或内部委托凭证缺失时宣称成功。队列只保存 `userId + apiKeyId + billing scope` 等身份事实，绝不保存、复制或尝试恢复长期 API Key 明文。worker 领取具体 job 时重新检查该 `apiKeyId` 仍存在、启用且属于 job owner；随后使用版本化 `tc_internal:v2:*` 内部委托凭证把 `userId + apiKeyId` 送入统一 agents bridge。v2 凭据由 `INTERNAL_WORKER_TOKEN` 做 HMAC-SHA256 签名、固定一小时失效，载荷不包含长期 token；每次 `/public/agents/tools/execute` 回调都会验证签名与有效期，再校验用户状态和原 key 启用/撤销/过期状态，恢复真实角色、计费团队与 `apiKeyId` 日志归属。因此异步调用与 CLI 直连使用同一用户权限面，同时允许 key 在排队后被禁用、撤销或自然过期。缺少内部凭证会使 worker 健康检查失败而不受理任务；队列中历史 job 仍会在执行边界以 `agent_api_internal_auth_unavailable` 显式失败，不会先匿名运行再落成 `auth_missing`。外部 `sourceUrl` 只接受公网 HTTP(S) 形态并拒绝环回、私网、链路本地与元数据地址；队列 worker 会把远程图片/视频先托管到 TapCanvas OSS，并以稳定 assetId 和显式媒体类型交给 agents bridge。持久 Agent API job 的原始 prompt 是 standalone BeatSheet 的冻结 source authority，工具回调会逐次验证 job owner、product 与 project；不再从画布文本节点读取需求。`kind=text|image|video` 输入节点仅作 best-effort 回显，投影失败会写入 job progress 与结构化日志，但不阻断后端生成、拼接和交付。Agent API job id 同时作为根 `execution_traces.id`，每次远程工具调用的名称、状态、耗时、脱敏入参与返回摘要均写入现有持久 trace；管理员可在“后台管理 → Agent → Agent API / 远程调用日志”按 Job / Trace ID 精确查询，不依赖容器 stdout。Hono 只注入“最终交付必须是视频资产”这一调用方明确的协议事实；具体创作、分镜、工具与工作流选择仍由 agents-cli 决定，不使用关键词、正则、固定 route 或固定 Skill 套餐。agent 已执行后若仅对话记录持久化失败，任务会追加可检索诊断而不会丢弃或回滚已生成成片。
- 编排器写入最终 `composeVideo` 成片节点时必须同时写入 `productionLayer=results`、`creationStage=result_persistence` 与 `approvalStatus=needs_confirmation`。这些字段是结果读取合同的一部分：Agent API 与画布小T可在工作流成功后通过结果层查询取得同一真实成片节点；禁止出现“成片已在画布、结果过滤却返回 0 节点”的双重事实。
- agents-cli 以 Responses 协议重放已完成的 assistant 消息、`function_call` 与 `function_call_output` 时，统一显式携带 `status=completed`。该状态是 provider 输入项合同的一部分；缺失时部分 Responses 兼容渠道会在工作流已成功、根代理只做终态收口时返回 `MissingParameter(input.status)`，错误地把已满足交付投影成 Agent API 失败。状态补全只描述已有历史项已经完成，不修改工具结果、用户语义或工作流终态。
- `POST /public/agent-api/video-jobs` 还接受可选的 `videoResolution`、`aspectRatio` 与 `targetDurationSeconds`。目标时长是最终成片总时长，必须为 1–180 秒；超过 180 秒在协议校验阶段显式拒绝，禁止自动截短。长片由统一视频工作流依据所选模型的实时单 clip 合法档位拆段并经后端合成，不能把 180 秒冒充成单次供应商请求时长。显式值在受理时冻结并优先于账号偏好；省略分辨率或画幅时冻结账号最近选择，新账号初始值为 `gpt-image-2 / 1K` 与 `minimax-h3 / 768p / 16:9`。同一份冻结事实与固定 `maxVideoDurationSeconds=180` 进入 BullMQ job、Agent API 需求节点与主 Agent 请求，必须逐字写入生成合同并以本轮实时模型目录验证；不支持时显式失败，禁止按目录顺序、模型家族或供应商错误自动改规格、换模型。队列只保存这些非密钥事实，不保存 API Key 明文。
- DeepSeek V4 按供应商公开协议能力选择 Chat Completions；其正式声明的对象输出使用 `response_format={type:"json_object"}`，不再把 Chat 格式错误翻译成未公开支持的 Responses `text.format=json_object`。当前部署的 V4 网关实测仍是 thinking route：它会忽略 `thinking.type=disabled` 并继续返回 reasoning，同时确定性拒绝 `tool_choice=required` 与 named tool choice；因此冻结协议画像不发送无效的 thinking override，也不虚报 required 支持。typed `outputContract` 会在请求发出前依据同一冻结画像选择唯一结构化终态通道：正向声明 required tool choice 的供应商使用动态终态工具；未声明 required 支持的供应商只使用原生 JSON response format，绝不同时暴露可选终态工具形成双通道。这是同一模型启动前的 wire capability 选择，不是失败后删字段、换模型或降级。Hono 不因模型名或 Agent API 入口自动声明 `webSearch=true`；供应商搜索只有调用方显式授权时才可暴露。GPT 系列仍按其协议画像使用 Responses 与 required tool choice。模型与协议在本轮冻结，continuation 不允许切换。
- new-api 的供应商请求审计覆盖原生 Chat Completions、原生 Responses，以及 RightCode 等必须执行 `Chat Completions -> Responses` 协议转换的桥接路径。桥接路径在供应商请求前即按同一 `requestId + retryIndex` 持久化 channel、请求模型、上游模型、转换链、上游 URL 与转换后的请求 Body；非流式响应继续记录原始上游响应，转换、传输、HTTP 与响应解析错误写入同一 attempt。流式响应至少保留请求与失败事实，不把无法完整缓存的 SSE 正文伪装成已记录。后台“当前没有记录上游链路”只能表示 attempt 事实缺失，不能用来推断供应商健康、请求未发送或请求格式错误。
- 工作流原子 Agent 的结构化输出合同必须同时进入提示词约束与供应商协议字段，不能只靠自然语言要求模型“输出 JSON”。为避免把某个供应商的 `json_schema` 方言误当成跨模型标准，工作流原子节点统一使用对象型 JSON 信封：对象与 artifact 直接传输，顶层数组先传为唯一字段 `{"items":[...]}`，agents-cli 按 `requiredArrayField:"items"` 完成同链结构校验，Hono 再确定性解包为 typed port 的顶层数组。对象型合同会把顶层 `string / number / object / array` 字段类型原样冻结到首次执行和 continuation；嵌套对象与数组必须以原生 JSON 值提交，禁止字符串化。该事实经 `/public/chat` 原样传入 agents-cli，并在主执行与同一逻辑任务的 continuation 中持续冻结。agents-cli 必须在模型调用前按冻结的 wire capability 选择且只选择一个终态协议：声明支持 required tool choice 时动态暴露无副作用终态工具 `format_final_json_response` 并发送 `tool_choice=required`；未声明 required 支持时不暴露该终态工具，只发送调用方声明的 `response_format={type:"json_object"}` 并直接验收最终 JSON 正文。两条通道不得同时出现，也不得在失败后互相切换。无论使用哪条通道，runtime 都按同一 `outputContract` 做完整性与字段类型校验；非法结果携带确定性结构失败证据在同一 Agent 链内限次修正，绝不进入未知工具或副作用分支。这套选择只依据供应商协议能力，不按模型名或工作流名称分支。普通、不带 `outputContract` 的调用方自有 `responseFormat` 仍按原协议透传。该合同只允许由调用方显式配置的 typed Workflow Agent 原子节点开启；公开小T与一键成片不得为了修复模型格式而自动推导或注入 `outputContract`。若编排图改为“Agent 原始输出 → 专用 Parse 节点”，格式提取只属于 Parse 节点；Parse 节点成功发布的 typed artifact 就是格式权威，后续节点直接消费，不得再对正文或 payload 做第二轮语义解析、格式校验、猜测或自动改写。此时 delivery verifier 只核对该 artifact 的真实存在、来源与交付落点，不重新裁决它的内部格式。其它节点输出仍由既有 typed port、artifact contract 与 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 做确定性验收，终态协议不替代交付验证，也不形成 Hono 的第二套语义闸门。
- 一键成片的 BeatSheet 只有一个语义作者：冻结工作流内稳定 ID 为 `beat-sheet-agent` 的 `agents.logical-task/v2` 原子 Agent。根对话 Agent 只选择已确认的 attachment，并提交 `idempotencyKey`、用户明确总量事实，以及 attachment 要求的独立视频/图片运行规格；唯一绑定时不得提交 `attachmentId`。禁止生成、传输或验收平行 BeatSheet。工作流 Agent 从 `delivery-contract.canvasFacts` 读取服务端冻结的 authoritative source，在自己的结构化输出通道生成并同链修复完整 `tapcanvas.beat-sheet/v2`。其中 `storyEvents` 的来源身份、事件文本、时间、入口态与出口态仍全部由 Agent 创作并接受严格验证；章级输出不携带逐秒/亚秒 `temporalFrameTrack`，该轨由后续单 Clip writer 根据已经冻结的事件事实编译。缺少任何 story event 语义字段时编译器拒绝补造并继续显式失败。后续 `beat-sheet-format` 是无模型的 `workflow.control.join/v1` 确定性传递节点，不重新解释剧情。
- BeatSheet 版本化合同中的稳定 Clip 身份与数组序号属于机器拥有字段：`beats[*].clipId` 由冻结来源指纹（无指纹时由 artifact 协议身份）和数组位置确定性生成，`sourceFidelityAudit.sourceBeatLedger[*].sourceOrder` 必须按数组位置从 0 连续生成，`beats[*].clipIndex` 必须逐项等于物理 Clip 顺序。agents-cli 与 Hono 在各自首次 versioned verifier 之前使用同一投影规则机械补齐/覆盖这些字段；该步骤不属于模型纠偏，即使节点采用 `failurePolicy=fail_fast` 也必须执行，并且不会增加模型调用。对白的 `sourceCoveragePlan.speechLedger` 已经是本份 artifact 内的冻结事实：当 `dialogueScript` 只漏了 `lineId` 时，只有 `speakerName + text` 在 ledger 中唯一精确命中才可复制 lineId；当 lineId 唯一命中时，也只可补齐缺失的 speakerName/text。冲突、歧义、归属 Beat、时间与 delivery 枚举仍交给 Agent 修正，harness 不猜、不改写台词。上述机械编译不得生成或改写 `sourceBeatId`、summary、storyEvents、时长、对白原文或任何剧情事实；机器身份与纯索引漂移不再触发结构失败或额外模型调用，语义缺失在 `fail_fast` 下仍按首稿直接失败。
- `tapcanvas.beat-sheet/v2` 的顶层 `protocolVersion` 是由 artifact type 冻结的调用方协议事实，不再只是要求模型自行记忆的普通字符串。Hono 把精确值写入 typed contract；agents-cli 的通用结构修复只在字段缺失、`null` 或空字符串时机械补回，非空冲突值仍由严格 verifier 显式拒绝。BeatSheet 合同版本在 Hono 与 agents-cli 必须同步推进，版本不一致不得启动工作流。
- `tapcanvas_equipped_workflow_run` 的主路由 admission 会把已复核 `UserIntentContract@2.delivery` 中存在的 `durationSeconds/resolution/aspect` 与 `triggerPayload.targetDurationSeconds/videoResolution/videoAspectRatio` 逐字段精确比对。用户未冻结分辨率或画幅时，运行时字段仍可从实时目录选择，且不会被误记为用户事实；用户已冻结时，遗漏或不匹配会在工作流受理和任何付费节点之前以 `video_delivery_contract_facts_required` 拒绝，并把精确期望值回灌同一 agents-cli 链修正。Hono/Web 不从用户正文解析这些语义规格，也不维护第二套补丁。
- Equipped workflow 的 durable execution 行创建后、调度器派发前，admission 必须在调用者真实 project/chapter canvas 上幂等写入唯一的服务端托管 `workflowExecutionNode`（固定节点身份，data 冻结精确 `workflowExecutionId + createdAt + queued/running/terminal` 事实）。画布为空不能跳过该投影；写入失败时执行保持 queued 并以 `workflow_execution_projection_failed` 显式失败，同一 idempotency key 重试先补写节点再认领调度，禁止出现“后台已 running、画布仍 0 节点”的受理态。该节点只证明持久工作流已受理，不构成图片、视频或最终交付完成证据；前端重载仍从 execution/node-run 真源刷新它，历史执行缺少持久节点时才创建不入库的 runtime recovery projection。
- 一键成片画布定义 v22 删除了模板层的 `workflowTargetDurationSeconds=15`。只有调用方显式提交总时长时，delivery contract 才冻结 `targetDurationSeconds + providerSubmissionTopology` 并要求精确守恒；完整章节未指定总时长时只冻结实时 `durationOptions/maxDurationSeconds`，BeatSheet Agent 依据完整来源动态决定 Clip 数量，各段采用供应商合法时长，总时长由实际 beats 求和，禁止把单 Clip 上限或模板值冒充整章时长。工作流内部 Agent 只接收类型化上游端口、权威来源和当前节点所需的紧凑资产身份清单，不再把可能达到 MB 级的完整 `ProjectContext.assetSnapshot` 重复序列化进每个 Agent prompt；完整快照仍只在服务端用于权限、资产解析和确定性复用验真。
- `tapcanvas_equipped_workflow_run` 不再公开或接受 `preparedBeatSheet`，能力舱也不再从冻结版本投影外置准备合同。显式时长与视频模型在 admission 依据实时模型目录冻结总时长、合法时长档位和供应商提交拓扑；20 秒目标在模型合法档位 `[5,10,15]` 下形成 `[15,5]` 物理容器。该拓扑只约束可执行事实，并通过 `delivery-contract.generationContract` 进入工作流内 Agent 的结构化合同；叙事节拍、事件密度、对白与连续性仍由 Agent 在同一工作流节点内完成。Hono 不按正文、关键词或模板推断语义时长，也不在外层对话工具参数中承载大体积创作产物。
- 视频工作流的 fresh estimate 现在同时冻结完整 `generationContract`（时长档位、参考图上限、参考音频边界），production handoff 把同一合同逐项复制到每个付费 Clip，视频节点再把它写入画布提交节点。结构化工作流 Clip 在供应商提交前优先使用这份冻结合同校验引用预算，不再在估价之后重新依赖可变模型目录；独立视频节点或旧执行快照没有冻结合同时仍 fresh-read 当前目录并显式暴露精确目录错误。这样模型目录重启、缓存刷新或配置漂移不会让已估价的整章任务在中途丢失 `maxReferenceImages`，也不会借本地供应商常量绕过真实合同。
- 同一次 equipped workflow admission 还必须用所选视频模型的实时 `resolutionOptions/aspectRatioOptions` 校验本轮 `videoResolution/videoAspectRatio`。目录外规格在创建 workflow execution 之前原地返回精确合法值，禁止先启动整条工作流、运行到 `delivery-contract` 后才发现供应商不支持；该校验只处理目录中的确定性执行事实，不从文本推断规格，也不自动改成另一个值。图片则以所选图片模型目录独立校验 `imageAspectRatio/imageSize`，两类画幅不再共享字段。
- 用户没有明确总时长时，工作流禁止把节点模板的 `workflowTargetDurationSeconds` 或模型 `maxDurationSeconds` 当作用户的整体交付时长。此时 `delivery-contract` 只冻结实时 `durationOptions/maxDurationSeconds`，不冻结 `targetDurationSeconds/providerSubmissionTopology`；BeatSheet Agent 依据完整来源语义自主决定 Clip 数，每个 Clip 仍必须使用供应商合法时长档位，总时长由全部已验收 Beat 确定性求和。只有用户明确给出总秒数时，才保留精确总和校验与物理提交拓扑。
- 一键成片只保留已装载 Workflow IR：根代理调用 `tapcanvas_equipped_workflow_run`，随后只读取同一个 execution family 的真实状态。旧视频 preflight wire contract 与 `video.beat-sheet.prepared/v1` 入口不再属于代理运行时工具面，也不提供兼容回退。Workflow Agent 的 JSON 候选只有一次完整提交窗口；结构合同失败记录候选哈希、精确路径和模型建议后立即显式失败，不回灌 prompt、不做字段级纠偏、不打开 durable retry，也不能退回根对话 Agent 重拼参数。用户明确再次发起时必须创建新的 `fresh_only` execution family。
- 正式 Video Writer v14 额外把 `executionPolicy=single_inference_no_tools_record_and_fail` 作为一等公民写入输出合同。Hono 在进入 agents-cli 前不再给该原子任务装配 `Skill`、知识库、案例搜索/读取或其它运行时工具，也不再注入 `promptExampleRetrievalScope`；所需 Skill 骨架和 autoload resources 必须在推理前一次装配完成。agents-cli 最终可见工具面只能是供应商支持时的结构化最终提交通道，否则使用纯 JSON response format。供应商断流、输出截断、余额拒绝、推理超时、物理预算结束、空提交或结构失败均只记录一次失败证据并写入 terminal failed，不生成 continuation prompt、不登记 durable suspension、不打开第二次模型窗口。该策略由版本化合同显式选择，不按章节、项目或模型分支；普通用户对话与非原子长任务仍保留原有恢复语义。
- Video Writer 的冻结 `itemTimelineDurationSeconds` 同时进入 agents-cli 最终提交工具的 `shots` / `durationSeconds` 字段说明和紧邻工具调用的提交指令，明确显示本条 Clip 的精确秒数。`shots[].durationSeconds` 只表示最终绝对秒数；模型在唯一提交前自行逐项加总并闭合，runtime 不归一化、不缩放、不取整、不吸收余差，也不返回纠偏。这样确定性时钟仍可在边界显式失败，但不会再由相互矛盾的“相对权重/宿主归一化”合同诱发失败。
- 一键成片的视觉资产与 Clip 采用“BeatSheet 一次冻结对象、跨章资产身份与中性资产 Brief，宿主机械投影，图片与逐 Clip 创作并行，汇总时绑定，生产前验真”的单一路径。BeatSheet v20 首次提交前会收到冻结 ProjectContext 中全部 `ready + productionEligible` 项目图片的紧凑身份注册表（精确 `assetId`、名称、类型、来源画布与 `sourceFacts`，不含 URL）；Agent 按角色肉身、场景空间和来源事实判断同一身份，名称、章节称谓或 canonicalName 不要求逐字相等。同一身份把精确 ID 写入根级 `objectRegistry[].referenceAssetIds`，角色同时沿用已有 `physicalIdentityKey`；确认是新身份或不同可见状态时才保持引用为空。这个语义决策只发生在 BeatSheet 唯一首稿内，不启动第二个 Agent，也不在后续物理 run 中返回纠偏。Hono 只验证 ID 属于冻结项目、图片已就绪且同一 ID 没有绑定到冲突对象；不得用字符串相等否定 Agent 的身份结论。BeatSheet 的 `assetPlans` 对每个 `referenceRole!=none` 的稳定 `kind://canonical-name` 只提交一次 `prompt + negativePrompt + identityAnchors + prohibitedDrift`；`asset-coverage` 使用 `video.asset-plans.project/v1` 添加机器 `assetId`，`asset-fan-out` 再机械计算精确 `consumerClipIds` 并叠加已验真的精确复用事实。`asset-fan-out` 在任何图片付费动作前仍拒绝未知 Clip、重复身份、孤儿资产和越权/不可用 ID。BeatSheet 完成后，`clip-fan-out -> clip-writer-agent` 与 `asset-fan-out -> asset-image-generate` 同时启动；writer 不等待、不猜测也不复制 `assetId`。`prompt-package` 同时等待 writer 与 `asset-items`，再按稳定 role 确定性绑定 ID、核对每个 Clip 的精确消费集合，并以绑定后的对象合同重新编译供应商提示词。`production-handoff` 仍等待全部图片取得持久 HTTP(S) URL；付费边界 fresh-read 权限、版本和 URL，并要求生成集合与消费集合完全相等。图片、writer 与视频的 `itemConcurrency` 均为 16；并发上限是结构合同，不改变 provider receipt、幂等身份、资产验真和已受理任务的协调边界。
- Workflow 图片/视频副作用节点按 `runtimeNodeId + executionFamilyId` 生成唯一画布节点身份；同一执行族的恢复只允许复用成功结果或对账已受理 receipt。任何终态失败（包括明确的 pre-upstream 拒绝、供应商审核拒绝和已有 task 的失败）都不会创建 `terminal-retry` 节点，也不会原样再次提交；新的供应商请求必须来自用户明确发起的新执行族，历史节点、任务和已产出资产保持不变。供应商返回 `ark_moderation_rejected.data.rejected_urls` 时，失败节点持久化 `providerRejectedUrls`；下一次 ProjectContext 仅按 URL 的稳定资源身份把对应资产投影为 `approvalStatus=rejected/state=unavailable/productionEligible=false`，让资产规划 Agent 重新规划，不用本地语义规则猜测内容。
- `structured_output_invalid` 是当前 Workflow Agent 节点的确定性失败终态：只要模型已形成非空候选，节点执行器就保存原始候选、哈希、冻结合同与精确拒因，写入 canonical failed terminal，并清除 waiting、continuation 与 retry directive。该候选不回传模型、不合并、不修订、不重新生成；collection resume、execution-family recovery 与旧 `repairable` 标记也不能再次调用模型。版本化 verifier 只硬拒绝 JSON/必需可执行结构、悬空引用、调用方冻结身份、权限/计费幂等、真实资产 URL 与供应商硬限制；BeatSheet 的节奏、容量、来源顺序、状态接力等创作语义只进入 diagnostics。该机制对全部 typed Agent 节点通用，不按模型、章节或具体工作流添加分支。
- typed Workflow Agent 遇到 `llm_http_429`、供应商断流、墙钟结束、进程中断或其它首个物理窗口未提交产物的终止事实时，记录 `agentExecutionFailure.phase=before_structured_submission` 与 canonical failed terminal，并立即失败；不创建 `workflow_agent_rate_limit_backpressure`、`physicalRetryOrdinal`、`retryNotBeforeAt` 或下一模型身份。历史 typed checkpoint 在恢复入口以 `structured_submission_window_closed` 失败，不能重新调用模型。plain-text Agent 仍可使用 provider backpressure；图片/视频供应商已经受理且有稳定 task/receipt 的异步对账也继续等待真实结果，因为它们不是 typed 内容重生成。
- Workflow Agent 的 durable public turn identity 仍受 160 字符协议边界约束，但不得通过直接裁掉右侧 node/runtime-item 身份来满足长度。短身份保持原文；长身份统一编码为“可读前缀 + 完整未截断 base 的 128-bit SHA-256 摘要 + structured/physical retry 后缀”。同一执行中共享长前缀、只在 `::item::<itemId>` 尾部不同的 collection 项因此始终得到不同的 logical task/public turn，且每个重试序号保持可追踪；禁止因为 nodeId 过长让不同 Clip 共用 session、互相覆盖 checkpoint 或错误 fencing。
- 显式 `executionResume` 创建的是同一 execution family 中的新物理执行，不是旧 node attempt 的原地轮询。collection 恢复保留并复用所有 `success` item；`waiting_external` 只按真实持久 receipt 对账；终态失败 item 原样保持失败且不再进入图片/视频付费执行器。若运行时、协议或资产上下文修复后需要重新生产，调用方必须发起新的显式执行族；旧 execution、节点、taskId 与成功 sibling 继续留作审计和资产证据，不通过 resume 偷偷重做。
- 直接 typed Workflow Agent 的单次物理 token 预算在首次调用前由显式 `maxOutputTokens` 冻结，模型必须在这一提交内完成自检与最终结构化输出。无论候选是否形成，都不得因为 verifier、429、断流、墙钟或 suspension 提升 capability grant、创建下一模型回合或派生新的物理输出预算；普通聊天、非结构化 Agent、子代理和未声明输出上限的调用也不隐式扩容。
- Clip writer 的 `clipId/clipIndex/durationSeconds/characterRoleNames/exitState/assetObjectContracts` 来自已验证的 `clip-contexts`；`sourceEventCoverage/temporalFrameTrack/temporalFrameCoverage` 来自冻结 `storyEvents + shots` 的确定性编译。这些都属于调用方机器事实，不属于 Agent 创作字段。节点执行器在严格验收前投影或编译这些字段，同时保留 Agent 编写的 shots、动作、镜头、表演与复盘证据；标准一键成片 v35 的并行 writer 合同不再配置 `itemExactAssetIds`，因为此时 `clip-contexts.assetPlans` 按设计仍为空，若用它校验已投影的冻结对象身份，会把全部合法对象误报为 unexpected。Hono 随后仍以 `assertExactWorkflowClipAssetObjectContracts` 对冻结对象逐字段验真，并在 Prompt Package 汇总时按 `kind://canonical-name` 把并行完成的生产资产 ID 确定性绑定回对象合同；缺失、重复、错绑或非法上游上下文继续显式失败。
- Clip writer 的冻结 `spokenScript=[]` 是确定性的“本 Clip 无人声”事实。v14 已硬切移除所有 Agent-owned shot 级人声字段；只要任一 shot 提交 `dialogueLineId/dialogueStartOffset/dialogueEndOffset/speakerName/dialogueDelivery/dialoguePerformance/dialogue/dialogueText`，合同就记录精确路径并立即结束该 Writer 节点，不机械删除、不回传 Agent 修订，也不保留兼容双轨。非空 `spokenScript` 中每条 lineId 必须且只能物化为一个完整 `speechEvents[]` 事件，Unicode 区间固定为 `[0, codePointLength)`；writer 不提交 `speechEventIds`，宿主在首次验收时确定性编译。
- 独立质量用例的工具作用域信封完整保留 `projectId/flowId/bookId/chapterId`：catalog 查询、deferred schema 与真实工具执行使用同一组字段。存在 `chapterId` 时，权威交付画布恒为 `chapter:<chapterId>`；执行观察、恢复和最终验收也绑定该 chapter canvas，根 flow 只保存隔离项目输入，不再作为章节成片的静默回退落点。章节参数在任一边界缺失都会表现为作用域不匹配，而不会把成功资产写进根项目后仍判测试通过。
- `requiredSkills` 是 Workflow Agent 的显式能力依赖，不是提示性标签。直接初稿执行只要 required Skill 非空，Hono 必须在调用 agents-cli 前把结构工具 `Skill` 纳入受限 `executionToolPolicy.allowedTools`，即使冻结节点没有重复列出它；否则 agents-cli 无法按 progressive loading 读取已声明 Skill，并会在模型调用前显式拒绝。CLI/8798 所使用的 AssistantRuntime 包装层也必须把 `requiredSkills` 原样传给 AgentRunner，禁止出现 transport 已接收、核心执行却丢字段的半连接状态。agents-cli 的 capability grant 在该 selected-only 模式下只保留 `Skill` 精确 section/resource 读取，禁止再从 `Skill` 自动派生并暴露 `skill_search`；Skill discovery 只属于未冻结 requiredSkills 的根请求。这样原子节点不会重新发现、改选或另行编排调用方已经冻结的能力。渐进骨架里的 `Available sections` 只负责导航，不是逐项执行清单；Agent 必须先使用 description、结构化能力元数据与自动装载资源，只在存在明确方法缺口时读取能解决该缺口的最少 section/resource，不得为“完整性”批量展开标题。typed 创作节点的用户指令必须与该能力面一致：只允许读取 requiredSkills 已授权的精确 section/resource，禁止 skill_search、知识工具与业务工具；不得再用“typed 输出禁止全部工具”的矛盾指令让 writer 只拿到骨架却无法读取领域 reference。该依赖闭包只补 `Skill` 这一协议工具，不开放其它业务工具；未声明 required Skill 的 typed 节点保持零工具面。
- collection 恢复调度把“已受理外部等待项”和“尚未开始的新项”分成两个事实边界。每次 reconciliation 先按原 item identity 公平轮询全部既有 `waiting_external` checkpoint；即使前一个仍在等待，也不能让排在后面的已受理 Agent/媒体任务饥饿。既有等待项构成完整的 accepted-frontier barrier：无论节点 `itemConcurrency` 多大，并发 worker 都不能在该 barrier 全部结算前抢占尚未开始的新项；只要任一等待项仍未结算，本轮就不扩大副作用面。barrier 全部成功/失败结算且没有等待项后，同一 reconciliation 才可继续下一批；已成功、普通终态失败与尚未触碰的项继续复用原 checkpoint。该策略只读取 item status/runtimeNodeId，不按节点业务、prompt 或媒体类型分流。
- 节点级 structured-output 不维护修订窗口、无进展预算或 verifier 回灌。BeatSheet 的时间轴、状态链和资产对象合同都在首次调用前作为完整机械后置条件提供：每段事件从 0 开始、相邻首尾精确相接、末事件等于片段时长；状态逐事件与逐段接力；资产 kind 只能使用冻结枚举、每段至少一个 scene、每个出场角色都有同名 character 合同。模型在唯一提交前自行满足这些条件；提交后失败字段只进入 diagnostics，不再表示“候选仍在收敛”。协作 mailbox 只在当前显式 `threadId` 或 spawn 绑定的 `sessionId` 作用域存在直属委派记录时读取：从未派发子代理的 typed workflow run 不触碰进程级共享 `root` mailbox，防止其它会话旧格式记录遮蔽当前结构化失败；真正拥有委派记录的会话仍严格解析并显式报告损坏消息，禁止静默丢弃。
- Video Writer 的 `shots[].shotNo` 同样是数组游标而非创作语义；agents-cli 在完整候选进入 v7 verifier 前按数组顺序一次性重建为 `1..N`，保留每镜的 visualTask、action、时长、运动和对白区间。这样错误编号不会逐镜消耗供应商纠偏回合，完整 artifact 仍需通过原 v7 verifier。
- BeatSheet 的 `dialoguePaceRate` 是 Agent 的创作与离线诊断事实，不是运行时完成闸门。agents-cli/Hono 仍严格验证 speechLedger 的逐字重建、顺序、说话人、delivery 枚举、Clip 时长正数与时间轴连续性，但不再以 `Unicode 码点数 > floor(durationSeconds * dialoguePaceRate)` 拒绝 BeatSheet 或要求结构化重写。容量建议继续进入同链 prompt、自检与质量报告；无论建议是否满足，已形成的合法结构都会继续进入 Clip Writer，禁止因模型自报语速丢弃整章创作结果。
- `tapcanvas.asset-plans/v1` 的 `consumerClipIds` 是冻结 BeatSheet 对象合同的确定性投影，不是创作语义：服务端以 `kind://canonical-name + referenceRole` 机械重建每个计划的真实消费者集合，自动移除 text-only occurrence、补齐需要 authoring visual reference 的 occurrence。Agent 仍必须为每个冻结 visual role 交付且只交付一个真实计划；未知 role、重复 role 或缺失 role 会一次性汇总为明确合同错误。这样同一个全局角色/场景在不同 Clip 的 referenceRole 不同时，不会再逐 Clip 消耗结构修订窗口，也不改变 prompt、剧情或视觉创作内容。
- 系统级共享工作流的媒体交付目标与调用者上下文随执行快照冻结：`tapcanvas_equipped_workflow_run` 每次运行都从当前 `canvasProjectId + (canvasFlowId | chapterId)` 动态构造统一 `ProjectContext`，包含 project/canvas、选择资产与节点、时间线 clips、权限，以及当时可见资产的 `assetId + assetVersion + assetVersionId + canonicalName + referenceType + approvalStatus + state` 快照；章节会话以 `chapterId` 显式选择 `chapters.canvas_flow`，其资产快照使用 `chapter:<id>` 规范身份，而执行期读写与媒体轮询均携带同一冻结 chapter delivery scope，禁止误写项目根 flow。缺少当前画布上下文会显式失败，不能回落到模板项目。标准一键成片来源使用 `workflowSourceMode=project_context`：公开画布聊天由 Hono 依据可信 `publicTurnId` 精确读取同一用户、同一回合的不可变 `request.accepted.prompt`，生成带 owner、逐字文本与 SHA-256 指纹的服务端 `workflowAcceptedTurnSource` 并冻结到执行快照；该保留字段不在模型工具参数中公开，模型提交会被拒绝。standalone 聊天没有独立故事真源时，执行器校验 owner 与指纹后将其投影为唯一 `public_chat_turn` 权威来源，不读取或猜测空白画布中的文本节点；章节聊天继续以冻结章节正文作为唯一 `authoritativeSources`，同时把同一 accepted turn 逐字投影为独立 `canvasFacts.userRequest`，供全部 Workflow Agent 落实本轮执行与创作要求，禁止把操作说明、模型名或规格混进剧情。章节与非聊天调用没有 accepted turn 时继续优先读取冻结选择中的就绪文本节点，没有明确选择时调用者画布必须恰有一个权限可见、状态 ready 的文本资产，零个或多个都显式失败。Agent 只消费权限过滤后的 ProjectContext/Asset Resolver 事实；BeatSheet 在唯一首稿中依据角色肉身、场景空间与 `sourceFacts` 判断复用，并提交冻结精确 `assetId`，`canonicalName` 是候选事实而非字符串相等闸门。`approvalStatus=rejected`、`state!=ready` 或版本漂移仍在付费消费前显式失败。资产计划只用 `existingAssetId + existingProjectId` 声明复用，不传 URL；执行节点在消费边界重新校验权限与版本，只有同一版本的签名 URL 过期时才可按稳定 ID 刷新。运行过程中修改角色卡不会被悄悄吸收成另一张脸，必须形成新的运行快照。
- 一键成片的 BeatSheet Agent 以 `delivery-contract.canvasFacts.nodes[].data.content` 中的真实文本节点为唯一剧情权威；先在同一执行链建立来源事实账本，再加载方法型 Skill，并通过 `sourceFidelityAudit` 自检。供应商合法时长窗口变化只允许按原因果顺序重装叙事节拍，不能改写人物、持物、伤势、冲突或结尾钩子；该语义纠偏属于 Agent 同链职责，不下沉为 Hono/Web 关键词闸门。
- 工作流执行历史持久化 run 级 ProjectContext、asset snapshot、输入、版本、耗时、重试、标准 `error_code/failure_stage`，以及 node 级输入/输出、工具、模型、耗时与重试。重上下文只保留在服务端：小T 的 workflow run/get 回执和终端 CLI 的 `executions / executionRun / executionGet / executionCancel / executionResume` 均只返回紧凑状态，固定移除 `projectContext / assetSnapshot / userInput`；确需核验时显式读取 `executionContext`，节点与恢复证据通过有界、分页 inspect 接口读取，避免数 MB 历史资产污染主模型上下文。`usesProjectAssets` 由纯结构事实产生：ProjectContext 当前选择含资产、冻结 trigger payload 显式携带非空 `selectedAssetIds`，或执行期 Asset Resolver 已成功解析任一当前项目资产，任一成立即记为项目资产参与；不再只看 UI 当前选择而把小T或工作流实际复用的调用者资产误记成“未使用”。确定性 replay-safe 节点最多自动执行 3 次；高成本媒体节点沿用逐 item checkpoint。`POST /executions/:id/resume` 默认恢复执行族中最新的失败成员，且执行族已有 `queued/running` recovery 时以 `workflow_resume_family_active` 拒绝再建第二条，防止并发恢复在进入付费媒体节点后形成重复扣费。管理员/CLI 的显式 manual resume 可以选择更早的失败 checkpoint，但服务端必须审计其后的每个物理成员：未启动节点、纯计算节点、无成功工具/持久任务/交付回执的失败 Agent，以及全部 item taskId 都属于源 checkpoint 已持久 provider receipt 集合且没有新成功工具写操作的 Agent/媒体 collection reconcile 才允许越过；任何新 provider taskId、成功外部 mutation、未知 executor 或 unresolved side effect 都保持 `workflow_resume_source_stale`。该比较读取源 execution 的分页 node-attempt receipt 真源，不依赖错误文案、时长或 prompt。恢复准入不能只相信源 execution 的终态，必须先按持久 trace 与 node receipt 找出整个 execution family（含根执行、直接父执行与更早祖先）残留的全部 Agent turn，以 `provider_stream_interrupted` 同时封停本地传输、Agent runtime 与持久 continuation，任一取消平面未确认即以 `workflow_resume_agent_fence_failed` 拒绝创建 recovery，避免任一旧会话在服务重启后苏醒并与新恢复任务争写同一 checkpoint。合法恢复随后从失败节点建立 recovery execution，并通过既有 output reuse/checkpoint 合同复用未变化的成功祖先与已完成 item。`GET /executions/:id/context` 暴露当时资产快照，`GET /executions/metrics` 提供 workflow success、node failure、recovery success 及版本/节点/工具/模型/项目资产使用维度拆分。
- 工作流装配给小T支持作用范围：管理员装配时可选择 `current_user`（仅自己可见/可用，默认）或 `all_users`（发布为系统级工作流，全体用户可见/可用）；普通用户不传 scope、一律按 `current_user`，非管理员提交 `all_users` 以 `capability_equip_scope_forbidden` 拒绝。`agent_capability_attachments.scope` 持久化该选择（老数据按 current_user 处理）。`listEquippedWorkflowCapabilities` / `getCapabilityBay` / `resolveEquippedWorkflowExecutionTarget` 对全体用户同时返回系统级工作流：工具面动态暴露其 attachmentId，任意用户可触发执行；系统级工作流跳过调用者对管理员工作流项目的访问闸门（执行身份、媒体落点与计费都挂在调用者自己身上），但仍校验装配版本未过期（stale）与路由已确认。系统级调用（delivery scope 生效）时 `canvas-source` 的 `inline_text` 强制要求 `triggerPayload.source`；`canvas_group` 强制要求真实 `triggerPayload.sourceGroupId`；`project_context` 不要求小T提供来源字段，由服务端从冻结选择或唯一就绪文本资产确定来源。三种模式都不读取工作流项目内的模板画布来源，避免把管理员模板内容静默暴露给其他调用者；每次触发的时长、模型、分辨率、画幅以及实时 `durationOptions/maxDurationSeconds` 会随 `canvasFacts.callConfig` 原样进入交付合同，这些字段只定义供应商可执行窗口，不预先冻结 Clip 数量或边界，也不能被静态模板配置覆盖。
- 已保存的一键成片工作流项目采用 Web 侧版本化结构硬切：同步时覆盖原子节点的可执行合同和内部 DAG，显式清空模板上残留的 `workflowTriggerPayload`、旧 Agent JSON 合同、旧 Skill/知识检索配置与其它阶段专属运行字段，同时保留运行遥测和用户明确选择的模型。所有 `agents.logical-task/v2` 节点的 Agent 身份、指令、输出编码、专属 `workflowAgentOutputArtifactType` 与交付要求作为同一原子运行合同投影；普通 `workflowOutputArtifactType` 不再冒充 Agent 产物身份。BeatSheet 只加载 `tapcanvas-dramatic-adapter`，要求模型在唯一 `speechLedger` 行上一次提交 `lineId/speakerName/text/clipIndex/delivery`，并在同一首轮为每个 Beat 提交非空可执行对象账本；宿主只确定性投影 `dialogueScript`、最终 `speakers`、相邻 `storyEvents[].entryState`、Beat `exitState` 与 `clipIndex`，不会替 Agent 补造缺失语义，也不触发创作纠偏轮次。视觉资产规划只加载预装的 `tapcanvas-video-workflow` 并消费启动前冻结的 ProjectContext/assetSnapshot，不再开放式搜索 Skill 或知识；单 Clip writer 只加载自带合同和 embedded self-review 的 `tapcanvas-video-prompt-writer`，模型只需创作非空 `clips[].shots[]`，机器身份、覆盖与逐秒轨由服务端投影。每镜正时长仅表达相对节奏，服务端保持比例并确定性归一到冻结 Clip 总时长，不再因小数加总偏差把有效创作拦截成失败。可选 QA/audit 文本不构成阻断。所有逐项执行节点的 `itemConcurrency` 必须是统一运行时合同允许的 `1..8` 整数；它只表达节点希望占用的并行窗口，实际准入统一经过进程级与账户级容量池，不能再由单节点自行越过或把容量暂满投影为业务失败。旧项目里缺少 Agent 专属产物身份、要求模型重复抄写 `dialogueScript`、允许 Beat 提交空对象账本、要求 filmBible、长篇报告、开放检索、超出并发边界或依赖镜头小数时长精确手算的定义必须升级后才可执行。旧项目/章节 ID、测试调用载荷、旧角色名、固定 `clipDurations` 和错误内部边不能继续成为 authoring truth；修改后必须重新经过 capability inspection 并原位更新 attachment，只有 `attachedVersionId` 与当前 `sourceVersionId` 一致且 `stale=false` 的版本才允许小 T 路由。
- `prompt-package -> production-handoff -> concat` 的付费生产边界只验证确定性结构事实：包协议与 artifact 身份、非空 Clip、Clip 数量与总时长守恒、对白计数守恒、资产绑定计数、结构化诊断字段版本，以及后续真实资产 URL/权限/供应商参数。`deliveryVerification.status` 与 `embeddedAuthoringReviewCount` 继续完整保存为可观测诊断，但不再要求 `satisfied` 或逐 Clip 覆盖，也不得阻断视频提交与拼接。创作审查不足只能进入质量平台、离线评测和后续修订版本；不能把已经成功编译的提示词、已经生成的图片资产或后续媒体生产改写成 `failed/skipped`。
- 工作流视频片段节点与最终拼接节点使用 `runtimeNodeId + executionId` 组成执行级唯一画布身份；同一执行的恢复继续命中原节点和原供应商回执，不同执行则写入独立节点。这样新版本成片不会与历史 `workflowEffectId` 冲突，也不会覆盖、删除或把旧成片误认成本次交付证据。
- 系统级工作流支持按用户手动关闭：普通用户可 `PUT /agents/capability-bay/workflows/:flowId/state {enabled}` 针对自己关闭/重新启用（只允许操作 all_users 装配；自己的装配用 unequip 管理）。状态存 `agent_capability_preferences(capability_kind="workflow", capability_id=flowId, enabled)`，仅作用于该用户：关闭后从该用户的小T工具面（`listEquippedWorkflowCapabilities`）剔除、执行被 `capability_workflow_disabled_by_user` 拒绝，但在 Agent 配置里仍显示为“已关闭”以便重新启用（`getCapabilityBay` 返回 `userEnabled=false`）；不影响其他用户。管理员发布者同样可以对自己关闭/恢复。
- 小T 的持久工作流扩展统一通过“能力舱”装配合同进入运行时，不再把“已购买/已拥有 Skill”“本轮手动选择 Skill”和“已授权执行的工作流”混成一个状态。能力舱只接受恰有一个触发器且至少有一个原子节点的已保存工作流版本，持久保存 `sourceVersionId + descriptorSha256 + conflictReport`；画布数据变化后，旧装配在真实执行边界以 `capability_attachment_stale` 明确拒绝，禁止继续复用、偷偷更新或回落到小T内置成片链。候选列表直接从 `flows` 当前作者图构造 descriptor，并对“工作流身份 + 名称 + 项目 + 规范化作者图”计算内容寻址的 `capability-version-<sha256>`；普通列表读取不再查询、排序或解析 `flow_versions` 历史。只有用户执行 inspect 时才以该稳定 ID 幂等冻结一份不可变版本，equip 在事务内重新计算当前作者图 ID 做 CAS，真实执行继续只消费这份通过检查的冻结版本。React Flow 展示字段、执行遥测与 fan-out/成片运行产物不进入内容身份；模板节点、连线、指令、模型与工具合同的真实编辑会产生新的版本 ID。项目目录也走只含身份、分类与访问权的轻量查询，不再为了能力列表读取所有项目画布并推导封面。这样已有数万条历史版本不会再影响 Agent 配置开窗，执行快照也不可能被误选为新的 attachment 源；Web 侧仍保留 15 秒硬超时作为故障保护，且同一项目的 StrictMode effect 重放会复用同一个在途 Promise。画布工作流组的“装配给小T”入口先按同一触发器/阶段结构合同检查该组是否完整代表当前 Flow；仅在画布存在未保存数据或尚无 Flow 身份时执行保存，再把精确 `flowId` 交给能力舱自动定位，避免无变化点击也制造新版本并把现有装配错误标成过期。装配检查的结构冲突由 Hono 依据能力 ID、工具、artifact、权限和副作用做确定性比较；职责重叠、目标矛盾与输入输出歧义由 agents-cli 的 `/capabilities/conflicts/analyze` 使用统一结构化输出合同判断，Hono 不用关键词、正则或工作流名称代替语义分析。冲突输入同时包含当前用户已装配工作流、可见内置 Skill，以及由 `REMOTE_TOOL_CONTRACTS` 这一运行时真源派生的小T内置能力与真实工具集合；因此检测不再把“后台 Skill 列表”冒充全部内置能力，也不维护一份会漂移的平行能力表。通用读取、诊断和已装备工作流调用入口本身不构成功能冲突。语义 warning 需要用户显式确认但不成为创作质量闸门，blocking 仅允许表达无法安全共存的事实性矛盾。冲突分析使用 agents bridge 的独立显式 `AGENTS_CAPABILITY_ANALYSIS_MODEL`；它不继承普通小T对话可能被环境覆盖的 `AGENTS_MODEL`，指定模型不可用时原地失败且不自动切换。该端点是无工具、严格 JSON 的控制面调用，显式以 run-scoped provider override 使用非流式 Chat Completions；报告按同一对象和原因去重、最多 12 条且字段限长，模型输出预算固定为 8192 tokens，防止大型内置能力目录把控制面检查拖成长篇枚举。若首轮 JSON 未通过确定性合同校验，agents-cli 会在同一请求链内把原始事实、无效输出和精确校验错误回灌给同一分析模型做一次结构修复；修复结果仍不合格时原地失败，禁止把坏输出静默当作“无冲突”。`length` 等推理请求自身的非完整终态仍原地失败，半段 reasoning 不会被当作冲突结论。普通小T、子代理或工作流节点的全局流式配置不受影响。一次成功检查会把工作流版本/hash、当前 attachment 集合、可见 Skill、内置能力目录和完整冲突报告封入 10 分钟有效的服务端签名 inspection token；装配提交只验签并在同一个串行化事务内重新核对这些确定性数据库快照，不再第二次调用模型，避免同一操作被两次语义采样的不确定性反噬，也避免检查与写入之间的并发变更穿透。任何版本或能力目录变化、token 篡改、用户/工作流不匹配都会要求重新检查。成功装配后，真实聊天工具面以及公开 `tapcanvas_tool_catalog_get` / `tapcanvas_tool_schema_get` 查询面都按当前用户的同一 attachment 数据源动态暴露 `tapcanvas_equipped_workflow_run`，attachment ID 由 schema 枚举约束；该入口属于 attachment 授权协议而非可替换的 `builtin:workflow_execution`，所以停用或替换内置工作流执行能力不会把替代工作流自身的唯一调用入口一并移除。该入口不依赖当前打开的项目或画布：没有画布作用域时仍按已装配 attachment 暴露，实际执行再校验源工作流的用户归属、冻结版本、项目访问和幂等键。旧会话的 capability grant 每轮以当前动态工具面刷新，新增装配入口必须进入同一 grant，不能继续沿用装配前的旧白名单。回调用装配描述中冻结的触发器启动同一个 ExecutionDO 工作流；卸下只删除小T授权关系，不删除 Flow、版本或历史执行。
- 能力职责采用严格单轨合同。冲突分析必须对每条关系返回 `resolutionMode=acknowledge|choose_primary`；真正的主路径重叠必须逐项选择候选工作流替换哪一个现有工作流、Skill 或可替换的小T内置能力，后端只接受与签名检查报告逐条匹配的 `routeDecisions`。`invocation.executionVariant` 是服务端在工具目录、动态 schema 与真实调用入口之前执行的结构化互斥路由选择器：两个工作流若都显式声明该字段且值不同，就不可能竞争同一次调用，因此即使共享输出 artifact、底层工具或成片语义，也不得产生结构或语义主路径冲突，允许同时装配；同一变体或任一方未声明变体时仍按普通冲突合同处理，禁止猜测默认变体。冻结工作流中的 `workflowAllowedTools / workflowToolId / workflowInputPorts / workflowOutputPorts / workflowOutputArtifactType` 会进入能力 descriptor；工作流原子工具与公开工具的同族协议 ID 会做确定性工具族比较，不依赖工作流名称、description 关键词或模型是否偶然识别出重叠。选择保留旧能力或返回编辑，不会发生装配；选择替换旧工作流只卸下 attachment，不删除 Flow、版本或执行历史；选择替换 Skill 或可替换内置能力会持久写入用户级 `agent_capability_preferences(enabled=0, disabled_reason=replaced, replaced_by_capability_id=...)`。工作流声明在 `requiredSkills` 中的依赖不能被它自己替换。`builtin:one_click_video` 是可替换的终态视频生产能力，`paid_media_generation` 是不可替换的真实媒体原语；工作流可以接管前者，但只能在自身冻结图中使用后者。替代关系必须投影为当前请求的 `primaryCapabilityRoutes`，历史偏好只有在 attachment 仍存在且 routingReady 时才生效；用户/系统对能力做出的显式手动停用仍按原状态生效。旧 attachment 若没有其它可替换能力的单轨决策会被标为 `routingReady=false`，不进入工具目录，也不能执行，必须重新检查确认。
- 已确认的主路径替换关系必须进入每轮真实 Agent 工具合同，不能只停留在能力舱 UI 或禁用偏好中。`listEquippedWorkflowCapabilities` 会把当前用户 `agent_capability_preferences(disabled_reason=replaced, replaced_by_capability_id=workflow:...)` 还原为 attachment 的 `primaryForCapabilities`；`tapcanvas_equipped_workflow_run` 的直接工具描述逐项声明“哪个已装载工作流替代哪个产品能力”。agents-cli 仍依据结构化 `expectedDelivery` 自主判断本轮是否命中被替代能力，但一旦命中，必须把该工作流作为端到端主动作；图片、单视频、配音、合成等底层工具只服务明确局部动作或其它目标，不得绕过已确认主路径去冒充同一端到端交付。工作流版本更新即使只产生 `version_change` 提示，也从持久偏好重新恢复这条主路径事实，避免更新时覆盖 `route_decisions_json` 后路由语义丢失。
- 工作流 description 是装载路由合同的一部分，与创作模板备注完全分离。选中工作流组时，“装载到小T”是一级操作，“创建模板”降到更多菜单；用户点击装载后，必须先在专用的“装载工作流”步骤生成或确认能力说明，再保存版本并进入能力舱 inspect/equip。agents-cli 根据该组真实节点、边、原子 operation、executor、输入模式与输出 artifact 生成结构化中文说明。该控制面能力必须走 `/agents/capability-bay/descriptions/generate -> agents-cli /capabilities/descriptions/generate -> runAtomicStructuredInference` 的一次性、无会话、无工具调用链，并使用调用方当前明确选择的模型与 `json_object` 输出合同；它不得进入 `/public/chat`、会话持久化、Skill 装配、任务 completion gate、delivery verifier 或 continuation，因此不会把元数据生成误当成创作任务，也不会与正在执行的小T工作流争抢会话。服务端严格验收唯一非空 `description` 与协议长度，解析失败会原样提示且不会写入默认文案；模型或供应商不支持时显式失败，禁止自动换模型。确认结果写入唯一工作流触发器的 `workflowCapabilityDescription`；Web 先保存当前作者图，再调用显式版本端点冻结不可变 Flow 版本，普通自动保存、Agent patch、媒体结果回填和执行后清理都只更新当前作者图，不得制造“保存版本”。descriptor 优先读取该触发器字段，并只为历史版本兼容读取版本根字段，因此装载后小T使用的是用户在装载前确认的说明，后续普通保存也不会丢失。输入契约不交给模型猜测：descriptor 依据冻结 DAG 中 `tapcanvas.canvas.group.read/v1` 的 `workflowSourceMode` 确定 `invocation.sourceMode + requiredTriggerPayloadFields`；聊天工具面仅对 `inline_text` 声明 `source` 必填、仅对 `canvas_group` 声明 `sourceGroupId` 必填，`project_context` 不要求来源字段并由执行器读取冻结 ProjectContext。只有当前全部已装载工作流共享同一必填集合时才把字段提升为 JSON schema 必填项，避免多工作流契约互相污染。
- 装载工作流的执行可见性按调用者交付作用域投影。ExecutionDO 广播项目直接读取本次 `workflow_executions.project_id`，不得从模板 `flow_id` 反查工作流项目；执行历史、指标和小T执行查询同时接受 `flow_id=current flow` 或 `canvas_id=current flow`，并继续校验 owner 与调用者 project。这样跨项目装载运行会在当前画布实时显示并可 fresh-read 终态/error_code/failure_stage，模板项目仍保留 source flow 与不可变版本归属，但不会夺走调用者的历史记录或让小T基于查不到执行而误报 running。
- 内置能力采用系统与用户两层持久运行事实，优先级固定为 `系统停用 > 用户停用/工作流替换 > 用户启用`；其中不可替换的底层媒体原语不接受 `replaced` 路由状态。管理员通过 `/admin/agents/built-ins` 管理 `agent_builtin_capability_settings`；系统停用对所有用户、现有会话和新会话立即生效，系统重新启用只解除全局限制，不删除或改写各用户原有偏好。用户在 Agent 配置中对 Skill 与内置能力的启停也不是只影响界面的筛选。Hono 在每次 agents bridge 调度时读取当前用户的禁用 Skill 集合并传给 agents-cli，同时合并系统级与用户级内置能力禁用集合，在同一份 `REMOTE_TOOL_CONTRACTS` 真源上同时过滤 `capabilityGated=true` 的 direct surface、deferred catalog 和 schema 查询；目录与 schema 包装器自身虽然不可被产品能力开关关闭，但在构造返回工具面时也必须 fresh-read 这份禁用集合，并把 attachment 的 `primaryForCapabilities` 原样投影到已装备工作流描述，禁止 CLI/模型目录重新暴露已被替代的主能力。`capabilityGated=false` 的认证、目录发现与已装备能力调用协议不随产品能力开关消失。工具回调执行入口还会 fresh-read 两层状态，只对受门控工具分别以 `built_in_capability_disabled_by_system` / `built_in_capability_disabled_by_user` 拒绝旧会话或陈旧目录的调用；非门控入口仍执行自身的 attachment、权限、版本和幂等校验。系统停用的能力不会参加候选工作流的职责冲突比较，系统状态在检查后变化会令 inspection token 失效并要求重新检查。agents-cli 同时从稳定目录展示、语义召回、直接 `Skill` 加载和 required Skill 依赖闭包中排除禁用 Skill。模型直接调用已禁用 Skill 时该动作返回 `skill_disabled_by_user`，不会换用同义 Skill、默认 Skill 或另一模型兜底；required Skill 在预载阶段被停用则记录非阻塞诊断并从真实 loadedSkills/provenance 排除，用户总体任务继续走其它合法路径。被工作流替换的 Skill 或可替换内置能力必须先卸下替代工作流才能重新启用；底层媒体原语不因为工作流装配而被隐藏，用户手动停用则可随时重新启用，系统停用期间用户不能把该能力重新打开。
- 能力舱是 AI 编排工作流的统一管理入口：`project_kind=ai_workflow` 与普通创作项目明确区分，能力舱可以原子创建一个 AI 编排项目及其首个空 Flow，并能跳转精确项目/Flow 编辑；项目中心只依据该结构字段显示“AI 编排”标识，不根据名称或画布内容猜测。能力舱会跨当前用户可访问的 AI 编排项目列出候选工作流，同时保留从当前普通项目装配其真实 Flow 的入口。
- `tapcanvas_equipped_workflow_run` 每次成功取得真实 `workflow_execution_id` 后，必须幂等写入 `agent_capability_invocations`，冻结 attachment、能力 ID/名称、source version/hash、代理 execution/session/tool-call 身份与有界结构化调用范围；原始幂等键不进入审计记录。调用记录通过真实 execution 关系展示状态，并复用 `/executions/:id/snapshot`、`/node-runs` 与 `/events` 查看执行时不可变 Flow 快照、每个节点状态/起止时间/错误/输出证据。即使首次 HTTP 回包在审计写入处失败，重试同一幂等请求也只补记同一个 execution，不创建第二次付费执行。
- Equipped workflow 的 attachment 新鲜度只比较可执行作者事实，并把冻结 `flow_versions.data` 内的 canvas-definition version/fingerprint 作为同一资格合同的一部分。`getCapabilityBay` 的 `candidate.stale`、公开对话工具面、动态 catalog/schema 与真实执行入口都读取同一个冻结版本事实；不能只因 `sourceVersionId/descriptorSha256` 仍相同就把旧模板显示为可执行。边身份规范化为 `id/source/target` 与非空 `sourceHandle/targetHandle`；React Flow 在读取时补出的 `type=typed`、`animated=false`、空 `data` 等展示字段不参与版本哈希和 stale diff。端口句柄、端点或真实作者数据变化仍然原地报 stale，禁止为了兼容展示默认值而放宽可执行图契约。
- 已装载一键成片采用严格单轨的“总时长授权 + Agent 语义切片 + 供应商档位校验”：`tapcanvas_equipped_workflow_run` 在受理事务开始前 fresh-read 实时模型 `durationOptions/maxDurationSeconds`，只冻结目标总时长、模型 key 与合法单次档位，`workflowVideoDurationPlan` 使用 `agent_semantic_duration_budget`，不冻结 clip 数量，也不把供应商最大窗口当作叙事结构。BeatSheet Agent 依据权威来源与方法型 Skill 动态决定 beats；Hono 只验证时长、索引、集合、逐字来源和资产身份等确定性事实。根级 `sourceCoveragePlan.speechLedger` 冻结全部原文人声，各 beat 的 `dialogueScript/speakers` 由宿主确定性投影，新增旁白、系统音和内心声只进入 `narrativeAudioPlan`。逐 Clip writer 为每条冻结 lineId 提交一个完整 `speechEvents[]` 事件，包含 `[0,codePointLength)`、独立秒数、speakerName、delivery 与 performance；shots 提交正数最终可执行秒数并省略 `speechEventIds`，禁止复制正文、按切镜拆词、重启或重复发声。Writer 首稿必须使镜头秒数精确加总到冻结 Clip 时长；Hono 不归一时钟，只按区间相交关系编译精确 `speechEventIds`。Prompt Package 编译器从冻结脚本物化 `spokenText`，用统一 renderer 只输出 `AUDIO / ENTRY+REFERENCES / SHOTS / EXIT` 四段供应商正文；writer 的根 JSON、self QA、creative review、source audit、图片 prompt 和 negativePrompt 全部留在 authoring artifact，不进入视频模型正文。包内逐 Clip 及汇总 `promptMetrics` 同时记录 writer 信封字符数、provider 正文字符数和投影比例，只用于 8798/trace 的效率比较，不作为生产门禁。
- 公开聊天中已装载工作流的幂等身份由宿主拥有，而不是模型拥有。Hono 将不可变 `publicTurnId` 规范化为 equipped workflow 的 execution idempotency key；同一逻辑 turn 的所有物理 continuation 即使提交不同的描述性 `idempotencyKey`，也只能命中同一个 workflow execution。agents-cli 同时消费继承的 `durableTaskReferences`：同名 start-only 工具已有 `acceptedAsync=true + runId` 时只开放读取原 execution/family/attempt/交付证据的路径，禁止再次启动。非公开聊天且没有 `publicTurnId` 的调用继续使用调用方显式 key，并服从原有 attachment、owner、版本与幂等校验。
- 公开聊天请求里的画布节点身份统一服从 `PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH`：顶层 `canvasNodeId`、`chatContext.selectedReference.nodeId` 与 `chapterCanvasReference.selectedNodeId` 使用同一上限。工作流物化节点可组合 workflow、item 与 execution 身份；引用层必须无损携带这个显式选中身份，其它节点事实不内联、由 Agent 按需调用 `flow_get/flow_search` 读取。
- catalog operation 的结构性参数失败由 agents-cli 持久化精确 repair cursor，并在下一物理执行窗口从当前已认证工具目录重新加载同一 operation schema；修复回合只向模型暴露这一项动作，不能改选其它业务工具。`tool_choice=required` 不是跨供应商通用能力：只有 agents-cli 的冻结模型协议画像或调用方依据实时供应商协议作出正向 `requiredToolChoiceSupported=true` 声明时才发送；能力未知或未声明时省略该字段，同时保留单工具投影、精确 schema、执行端校验和诊断日志。该字段还必须在全部 Skill、frontier、action-only 与结构化修复投影完成后的 provider 边界再次核对：最终模型可见工具数为零时一律省略 `tool_choice`，即使较早的 delivery-repair checkpoint 要求新工具证据，也只能保留未满足事实并进入后续合法恢复，禁止构造“`required` 但没有 `tools`”的非法请求把内部纠偏失败投影成用户任务失败。诊断日志记录最终 `visibleTools` 与实际发送状态。Skill 候选消费也按同一持久事实投影：当候选集中某个精确 `candidateId` 已存在于当前物理执行链的成功 loaded-Skill 集合时，该候选集视为已消费；即使历史 tool receipt 因进程恢复发生配对降级，也不得再次进入 pending-selection 并与 durable frontier 求交成空工具面。新逻辑任务不能只因同一会话历史上加载过某 Skill 就跳过本轮选择；一旦本轮存在真实正向候选 receipt，provider-facing `Skill` schema 会把 `skill` 收窄为该 receipt 的精确 candidate ID 枚举、把 `selection.candidateSetId` 固定为 receipt ID，并要求两者同时提交。这样上下文压缩后的模型不能再把“一键成片”显示名臆造为 `one_click_film/one-click-film`，也不会在只剩 `Skill` 的窄工具面中失去自修复路径。这里仅比较结构化 Skill/candidate ID，不根据用户正文、描述或关键词补选 Skill。Hono 不按模型名猜测该能力，也不因字段不兼容重试、换模型或放松参数合同。
- CLI 与 agents-cli 的工具发现统一经过 `tapcanvas_tool_catalog_get → tapcanvas_tool_schema_get → 精确工具调用`。这两个目录包装器本身也注册在确定性的 remote-tool surface 合同中，归属只读的 `project_discovery` 协议面且不要求预先具备项目/画布 scope；它们是发现当前能力开关结果所必需的基础协议，因此不进入用户可停用能力的 `requiredTools`，实际业务工具仍在 handler 前按同一合同执行能力开关、权限与 schema 校验。独立回归平台使用 TapCanvas Web 当前登录账号批准的 agents-cli SSO grant 调用同一个 `/public/agents/tools/execute`，中间件必须重新验签 grant、用户状态与 `agents:chat` scope，不能把 grant 转换成长期 API Key，也不能匿名回退；目录同时返回由能力舱持久配置投影的 `primaryCapabilityRoutes`，使独立运行时与 Web 对话使用同一条 equipped workflow 主路由。真实交付型回归只要求用户提供文本输入；每次 attempt 开始前，平台通过 `/public/agents/evals/workspaces` 以同一 SSO身份创建一个全新的隔离项目和画布，并将本 case 的原始文本写入且只写入一个 `ready` 文本节点，再把返回的 `projectId/flowId` 贯穿该 attempt 的全部物理续跑窗口。测试中产生的图片、视频、日志和最终资产都落在这个运行空间，不读取或复用用户已有项目；非交付型测试不创建项目。平台调用 `/public/agents/evals/executions/:executionId` 查询，或调用其 `/resume` 恢复时，除了 owner scope 还必须逐次提交本 attempt 的精确 `projectId/flowId`；服务端必须把它们与 execution 的持久 `project_id + canvas_id` 逐字核对，任一不一致均以 `agents_eval_execution_workspace_mismatch` 拒绝。`flow_id` 是共享 equipped workflow 的不可变模板身份，只作为审计事实返回，不能与交付画布 `canvas_id` 混用；否则正常的系统工作流执行会被误判为越界。历史报告如果没有保存这组工作区身份，也不得自动重新协调旧 execution。平台不能把“已受理”提前投影成通过或失败；若绑定工作区内的 execution 失败，平台而非 root Agent 恢复同一 owner、同一项目、同一画布、同一执行家族的最新失败成员，并等待恢复 execution 的权威终态，root Agent 禁止另建并行工作流。构建窗口中 CLI 入口短暂缺失时，平台在启动物理 run 前做有界就绪等待，超时仍显式失败。每个 catalog 工具的首次 schema lookup 必须省略 selector；若供应商工具序列化器提前填入可选 selector，agents-cli 会明确回显 `ignoredPrematureSelector`，只把该次无副作用读取归一为首次 index 请求，绝不据此选择或执行业务操作。多 operation 工具先返回真实 `operationIndex`，第二次 lookup 才允许原样复制其中一个 field/value。取得 index 后若仍提交不存在的 selector，调用保持显式失败，并在错误中返回真实 `operationIndex` 与全部合法结构化值，让同链 Agent 精确修参，不把错误 selector 静默改成另一操作。禁止把目录工具当成合同外特例，或在发现失败时绕过 `/public/agents/tools/execute` 直调画布接口。
- 每个新的公开小T逻辑任务（普通画布对话与 Agent API job）都装配 `enabledModelCatalogSummary`，并 fresh-read new-api 的模型目录、实时价格与可执行 endpoint 快照；不能复用 Agent Bridge、API 或 worker 进程内的五分钟被动列表缓存来冻结生成合同。new-api 是公开媒体任务的唯一执行路由，因此图片、视频与音频的“可执行”事实都只由同一份 selectable runtime 快照决定，精确 `requestModelKey` 原样成为生成合同里的 `modelKey`；产品模型目录仅可补充中文标签、用途等展示元数据，缺少本地匹配行、厂商映射或本地厂商密钥行都不得把真实可执行 runtime 模型过滤掉。音频仍只暴露带 `tapcanvas:audio-type=speech|music` 和正数实时价格的模型，并透出声明过的 audio engine。目录层不按列表顺序选择默认模型，也不替换账号在任务受理时冻结的显式偏好；管理员刚启用/禁用的模型会在下一条新任务生效，无需重启服务或等待缓存自然过期。fresh-read 失败时整个摘要显式 `unavailable`，不回退旧目录，也不得把“未加载/读取失败”解释成零模型；runtime 可执行集合为空时记录目录数量诊断，只有真实 fresh-read 成功且投影确实为空时才可报告零模型，禁止凭模型家族、别名猜测或自动降级补位。
- 图片规格计费也以 new-api 实时快照为唯一价格真源。`gpt-image-2` 使用与 Tanva 尊享线路一致的 `image:{1k|2k|4k}:{low|medium|high}` 九档合同，Hono 按 100 积分/CNY 原样投影；比例不参与价格键，分辨率与质量分别进入供应商请求，不能把 4K 隐式提升成 high。`params_def.quality` 决定 Web 可选项与默认 low，用户选择的同一质量值同时进入预估规格键、new-api 请求和最终结算；每张参考图再按快照中的 `reference_image_price_cny` 追加 10 积分。实时价表缺少所选规格时必须显式失败，禁止回退模型基础价或其它质量档。
- 视频供应商提交拓扑与创意节拍是两层合同。内置视频编排运行时使用实时模型 `durationOptions` 和冻结的 `userIntentContract.delivery` 计算最少合法提交次数；已装载工作流则完全使用该工作流受理时冻结的 `workflowVideoDurationPlan`，不再读取小T推导的 clip 数。用户未通过对应执行合同显式要求物理 clip 数时，优先填满模型最长合法时长。例如 Seedance 2.5 对合法 20 秒目标只建立一个 provider clip，钩子、制作、成品、用餐与 CTA 等多个叙事阶段必须在该 clip 的内部镜头表表达。Agent 提议的 beat 数不能隐式扩大供应商调用次数；旧 draft 若与冻结拓扑冲突，只能保留审计证据并在同一逻辑任务内重新编译，不能重提任务，也不得先产生媒体副作用。
- durable frontier 以 `graph + runId` 隔离实例；同一实例才执行 completed unit 的单调比较，新 run 的空白起点不得被旧 run 的完成集合误判为进度回退。`loop` 若进入 `asset_repair_required`，响应必须切换到独立 `asset_repair:<runId>:<revision>` 游标，唯一变更动作是 `repair_assets`，并显式开放图片生成/对账 supporting tools；不得继续暴露已经成功的 `loop` 作为下一动作。
- durable frontier 只收窄可写业务动作，不得让 continuation 回合丢失根协议与事实读取能力。工具是否为只读必须统一经 agents-cli 的 canonical execution semantics 解析；不能只检查某个 provider-facing definition 是否内联 `execution.sideEffect`，否则像 `Skill`、`skill_search` 这类由统一语义表声明为 `sideEffect=none` 的根协议工具会在精确 frontier 投影后被误删。进入 frontier 后只保留唯一可写动作、服务端声明的 supporting writes 与 canonical 只读工具；因此专业方法加载、事实补证和交付协议可以跨物理回合单调继承，而无关副作用仍保持关闭。

- `GET /public/agent-api/video-jobs/:jobId` 是 Agent API 的唯一轮询真源，并按 API key owner 隔离。轮询是事实读取：只有 worker 已持久化的非 `queued` 阶段或真实 agent turn 才能把 job 投影为 `running`；没有 runtime turn 且持久阶段仍为 `queued` 时必须保持 `queued`，清除历史误写的 `startedAt`，相同事实的重复 GET 不改写 `updatedAt`。runtime 查询失败只记录可检索诊断并返回最后一份持久事实，禁止用 GET 制造“正在执行”的假进度。`queued/running/needs_input/failed` 都不会携带成功结果；`needs_input` 只投影 agents-cli 的结构化问题。Agent API 的交付真相来自同一 job 的 `execution_traces` 家族、持久 `video_runs` 与 `authoring_artifacts.delivery:verify`：后端 run 负责收取各段、服务端拼接、托管最终资产并持久化 `deliveryEvidence.videoUrl`；画布节点只是可选回显与审计投影，轮询、恢复、拼接和完成判定都不得读取画布作为依赖。`succeeded` 必须取得上述后端事实中的唯一自有 OSS HTTP(S) 最终视频；异步 receipt、文字回复、中间 clip、第三方 URL、输入视频或“agent 已结束”都不是成片证据。若最终 trace 比一次过早的 `agent_api_delivery_unsatisfied` 终态更晚落库，轮询会依据同一 job 的新事实把该记录纠正为 succeeded，而不会提交任何新媒体任务。CLI 的 `tapcanvas agent-api submit/status/wait` 只操作这组稳定 job 接口；wait 超时不改任务状态、不轮询供应商、不重复提交。
- Agent API 聚合多个关联后端 run 时，终态优先级固定为“唯一真实交付 > 任一 canonical status 仍为 active 的 run > 所有关联 run 均为确定性失败 > 没有真实持久 run 时的逻辑任务结构化终态”。已经持久受理且仍为 `pending/running` 的同一 canonical run 可以继续等待真实证据；writer 一旦形成非空结构化候选并违反冻结合同，该次 run 就按 `single_submission_record_and_fail` 立即失败，历史 `repairable/repairAttempt/repairProblems` 只作审计，不能使失败工件重新成为 active、周期恢复或新增模型预算。不能只凭底层 production `state` 非终态伪造运行中；若收集到的 run identity 全都没有对应持久 `video_runs`（包括 preflight 只创建 draft、尚未 commit 的情况），聚合结果必须是 `absent` 而不是 `pending`，随后吸收最新 continuation trace 的 `requestTerminal.terminal=true/status=failed`，不能继续用 agents-cli 旧的 suspended checkpoint 假报 `running`。该聚合只读取共享视频状态协议与结构化终态，不解析 prompt、模型名或错误文案，也不触发重提、模型降级或结构化失败恢复。
- 后端 concat 取得真实 OSS URL 后立即以 durable run 与 `concat:auto / delivery:verify` 工件进入交付事实链；`film-*`、run-status 节点及连边随后只作 best-effort 画布投影。投影失败会进入 `projectionDiagnostics` 与结构化日志，不得抛弃已生成 URL、阻断 job、回退浏览器合成或重新提交 concat。媒体探测、叙事核验和商业母版技术核验同样只追加 diagnostics；一旦持久最终 URL 与全部 clip URL 齐备，它们不得作为生成后交付闸门。
- agents-cli 在整条执行链的副作用边界读取已冻结的 `UserIntentContract.delivery.mediaType`：`kind` 是开放产物标签，不能决定媒体类型；只要权威 `mediaType=video`，裸 `tapcanvas_video_generate_to_canvas`、通用 `tapcanvas_workflow_run` 与旧视频编排入口都会显式拒绝，不能另建平行视频链。唯一入口是动态 schema 中真实存在的 `tapcanvas_equipped_workflow_run attachmentId`；Hono 在远程工具目录中不再暴露旧编排工具。`tapcanvas-video-workflow` 定义根代理的事实读取、attachment 选择、一次启动、execution 恢复和交付验收责任；BeatSheet、逐 Clip writer、资产处理、配音、视频生成与合成方法属于 Workflow Agent 节点及其按需 Skill。Skill/知识 receipt 写入 execution provenance 和诊断，但不能阻断已授权生产、回滚媒体或迫使用户重提任务。Hono/Web 不按关键词路由，不建立第二套本地视频流程。
- 视频合同冻结后、工作流尚未受理前，agents-cli 的 pending-start 工具面只移除与当前交付无关的有副作用动作：当前已授权的只读事实工具和完整 `tapcanvas_get_tool_schema` 目录仍然可见，唯一保留的业务 mutation 是 `tapcanvas_equipped_workflow_run`。root 必须逐项核对 `UserIntentContract.must`；若用户明确要求先读取或依据权威项目事实，就先取得对应只读成功回执，相互独立的读取可并行，再启动不可逆、付费或持久交付。Workflow 内部自行读取上下文不能替代用户明确要求的前置事实读取；这一责任由通用合同与工具副作用语义表达，不按章节、素材或测试名称写专用分支。若 root 随后提交终态候选却被通用 delivery verifier 判定为 `needs_revision`，事实准备阶段结束：下一轮只允许精确 equipped workflow schema、再只允许该 workflow mutation，防止 required tool choice 被重复材料读取消耗。
- Workflow Agent 只有完整产物通过确定性可执行合同后才构成交付进展。未通过的完整提交只记录当前物理动作失败及 verifier 证据，不刷新业务 progress revision，也不保留为后续可编辑候选。BeatSheet 的 `storyEvents`、`dialogueScript`、`assetObjectContracts` 与来源 ledger 始终由 Agent 一次性协调输出；本地不选择最小修订目标。
- finalizer 的项目级/章节级视频孤儿回收只负责修复历史裸视频节点与画布回显：它扫描静置的 `flows` / `canvas_flow`，只对已有真实 `taskId` 且状态为 `queued/running/submitted` 的节点执行幂等 reconcile，不重新提交、不改变模型、不重复计费。这个 sweep 不是 Agent API 的任务驱动器或交付真相源；新 Agent API 视频任务只能由已装配 `tapcanvas_equipped_workflow_run` 按冻结 Workflow IR 建立持久 execution 事实。每个画布 reconcile 错误仍进入结构化 `errors` 与服务日志，禁止吞错。
- `video-run-status` 是后端 run 到画布的幂等可见性投影，不是驱动心跳。投影器在 fresh-read 后只比较自己管理的字段；当状态、文案、资产修复声明与交付事实均未变化时必须返回 `unchanged`，不得重复 patch、递增 `canvas_revision` 或刷新 `flows.updated_at`。这保证已被供应商受理的 `running + taskId` 图片节点能够满足图片 reconcile 的静置窗口，并在真实 `task_results` 成功后回填同一节点 URL、唤醒同一 dependency continuation；状态展示不得通过等值写入造成 reconcile 饥饿，也不得因此重提任何付费媒体任务。

- OpenAI-compatible 宿主模式把 `flow_patch` 与 manifest 声明的高层 `hostTools` 视为两类独立命令通道，不再复用默认脱敏后的观测输入。低层节点变更使用 `flow_patch`；宿主自己的业务动作（例如创建/编辑演示文稿）统一由 agents-cli 调用 `host_tool{name,arguments}`，工具名枚举、说明和参数结构完全由当轮 manifest 驱动，不允许 facade 过滤或编造。Hono 仅在 manifest 实际暴露对应 direct 工具时请求 agents-cli 返回原始参数，随后必须同时满足工具事件 `status="succeeded"` 与 `HostFlowPatchSchema` / `HostToolCallSchema` 才能投影为 `delta.tool_calls`；`phase="completed"` 只表示工具生命周期结束，`denied/blocked/failed` 或缺失 status 的事件绝不能下发给宿主执行。已成功的命令若缺参、被脱敏或 schema 漂移，整轮显式失败，禁止静默丢弃后返回空 `finish_reason=stop`。agents-cli 的 capability grant 解析与构建统一保留 128 项，并把当前请求的 direct 动态工具放在持久旧 grant 与本地工具之前，禁止因工具列表裁剪而出现“manifest 已暴露工具、runtime grant 却无权限”的分裂工具面。facade 会暂存 assistant 正文直到 agents-cli 的结构化 `requestTerminal` 到达；`failed` 仍显式报错，只有 `succeeded/needs_input` 才允许发布普通成功终帧。`suspended` 不再被 facade 投影成用户级错误：OpenAI 请求也先进入与 `/public/agents/chat` 相同的持久执行包装器并登记 continuation；非流式返回 HTTP 202 `chat.completion.pending`，携带稳定 `turnId/sessionKey/statusPath`，流式只发布“持久任务仍在续跑”的事实状态后结束当前传输。物理窗口结束不能伪装成普通 `stop`，也不能终止同一逻辑任务。普通 agents 工具流继续保持脱敏。`host-execute` 只校验命令、不写 TapCanvas 数据库；接入宿主必须执行命令，并以自己的节点持久化、任务受理和真实资产证据决定用户级完成。

- 上传素材与图片参考统一采用“稳定 ID 在 agent 面流转、真实 URL 只在服务端边界解析”的单路径合同。`tapcanvas_asset_add_to_canvas` 将已上传/已登记的图片 assetId 解析为真实 `kind=image` 预览节点，并持久化 `sourceAssetId/referenceRole/referenceStrength`；主模型的参数和回执均不含存储 URL。图片生成可用 `referenceAssetBindings` 显式声明 `layout/style/identity/content`：layout/content/identity 进入构图参考，style 进入独立 `assetInputs(role=style, weight?)`，角色职责与强度只来自结构化合同，不从标题或 prompt 猜测。可选整数 `seed` 原样传给供应商；省略 seed 与 `nodes[]` 批量入口共同提供独立随机变体。任何引用无法验真、职责非法或同一 assetId 重复绑定都会在付费提交前显式失败，不会丢引用、换模型或使用默认工作流。
- `tapcanvas_asset_add_to_canvas` 的画布投影以真实 `(assetId, referenceRole)` 作为天然幂等身份，而不是信任模型每个物理窗口重新提议的 `nodeId`、标题或坐标。执行前必须 fresh-read 当前作用域画布；若相同资产和职责已经存在，就返回既有节点并标记 `alreadyPresent=true`，不得再次写入、复制节点或把同一已物化图片伪装成多个交付。不同职责仍是明确不同的引用投影；这项去重只约束展示同一真实资产，不删除、覆盖或回滚任何已生成媒体，也不阻止用户显式要求并实际生成多个不同资产。

- 画布节点历史字段 `showSystemPrompt/systemPrompt` 已退出图片生成与结构化提示词链路：Web 不再提供对应配置面板、节点 schema 不再声明该 feature，`remoteRunner` 与 `tapcanvas_image_generate_to_canvas` 都不会读取或转发旧字段。图片提示词的方法论只来自 agents-cli specialist / Skill 的当前执行结果；旧画布即使仍保存这些字段也只作为未消费历史数据存在，不会暗中改变新的供应商请求。
- 旧 `mosaic` 画布节点已硬切退役：Web 不再提供节点 schema、编辑器或执行器，`/public` flow schema、AI tool schema 与 agents bridge 也不再接受或生成该节点类型。参考图合版仍是图片生成链路内部的 `referenceSheet` 处理能力，不再借用旧拼图节点语义。

- 异步视频节点采用“输入关键帧临时封面 → 成片真实首帧永久封面”的单节点投影合同：`tapcanvas_video_generate_to_canvas` 在供应商受理后立即持久化 `running + taskId`，并把实际提交的首个图片输入记录为 `videoInputPosterUrl`，让画布无需等待成片即可显示真实输入关键帧；任务完成后，回收器优先使用供应商返回的 poster，若本站 OSS 视频只有 `videoUrl`，则通过 media-worker 按对象 key 补抽首帧并写入 `videoThumbnailUrl/videoResults[].thumbnailUrl`。Agent 可见的 `tapcanvas_video_reconcile` 必须同时携带同一次提交返回的 `nodeId + taskId`，服务端只允许查询、结算并回写这一条精确匹配的节点；它不得再无参数扫描整张画布，也不得借对账修改无关并发任务。历史孤儿与缺 poster 的批量修复只由受控后台 recovery worker 承担。抽帧失败只追加 `videoPosterBackfillStatus/videoPosterBackfillError`，不得覆盖、回滚或丢弃已成功视频，前端继续明确使用输入关键帧作为可见 fallback，且禁止为封面缺失重提付费任务。
- FunAI 视频入口在产品目录中只公开带渠道后缀的 `seedance-2.0-funai`、`kling-v3-funai`、`kling-o3-funai`，与无后缀官方模型保持独立身份。Hono 的供应商边界只保留调用方已经给出的结构事实：普通参考图继续进入带 role 的 `content[]`，`styleReferences/style_references` 与 `elementReferences/element_references` 分别进入独立 metadata 字段，输入视频保留为 `video_url`，显式 `audio=false` 也不得丢失。具体 FunAI provider model key 由 new-api 的 `task.funai` 适配器按这些结构化输入选择：Kling V3 常规请求走 `kling-v3`，视频/风格/元素请求走 `kling-v3-omni-v2v-create`；Kling O3 常规请求走 `kling-o3`，基础视频参考走 Standard V2V，风格或元素参考走 Pro V2V。new-api 的 `model_mapping` 只处理供应商 key，`channels.setting.pricing_model_mapping` 独立引用无后缀同名模型的实时计价真源；FunAI 规格售价统一取 `max(官方规格价 × price_ratio=0.5, 时长 × min_video_price_cny_per_second=¥0.30)`，不保存平行绝对价表，后续修改官方模型价格时自动同步，同时不低于已知每秒成本。Hono、Web 与 agents 不按 prompt、关键词或本地 route 猜供应商 key；输入角色不充分时适配器显式失败，也不自动换模型或降分辨率。
- Megaby 视频入口只公开 `sd2`、`sd2-mini`、`minimax-h3` 三个稳定商品身份，不把分辨率或供应商池拆成平行模型。2026-08-21 使用真实凭据完成了 `sd-mini-480p` 和新价表 `sd2-mini` 的创建/轮询验证；实时 `/v1/models` 与接入文档示例不一致，且 `videos-mini` 明确返回 `model_not_found`，所以目录不会发布这些不可执行示例别名。`task.megaby` 根据请求的 `resolution` 确定性选择上游 ID，并转换 `duration`、`ratio` 以及最多 9 图/3 视频/3 音频的 camelCase 参考数组；供应商不支持的首尾帧会在付费提交前显式失败。渠道成本保存在 new-api 模型规格价合同中，`price_ratio=1.3` 统一形成 30% 溢价并同时作用于真实扣费与发布价格。Web 对实时 new-api 目录模型统一持久化 `vendor=auto`，Hono 再以“启用状态 + 有效协议端点 + 正价格”验证可执行性，不维护模型名白名单，也不会把新模型名误当成本地厂商 key。完成后的短期 `/content.mp4` 仍由现有媒体交付链下载并上传本站 OSS，不能作为长期资产 URL 直接持久化。

官方 TapCanvas CLI 的安装授权会签发归属当前用户的 `tc_sk_*` API Key。该 Key 在服务端通用
`authMiddleware` 中与浏览器 JWT 解析为同一个用户身份，因此 CLI 支持的模型目录、项目、章节、素材、
记忆、任务日志、agents chat 与画布工具接口不得再出现“公共接口可用、登录态接口 401”的双轨权限。
账号删除/禁用、真实数据库角色、Origin 白名单、计费团队和 Key last-used 审计仍逐项执行；API Key 不会
提升用户角色。CLI `doctor --json` 同时验证公共模型接口和受保护的启用模型目录，任一失败都不能返回
`ok:true`。

CLI 业务工具采用与 Web agents bridge 相同的结构授权面：`tapcanvas_tool_catalog_get` 只返回当前
`project/canvas/chapter_canvas/book/node/execution` envelope 已满足的注册工具名称、用途和执行语义，
`tapcanvas_tool_schema_get` 再返回选定工具的实时 schema，真实调用仍由同一个 execute handler 执行项目归属、
计费、幂等、真实资产与破坏性操作校验。规范 `book-<bookId>-ch<N>` 章节 ID 会确定性形成 book scope；
CLI 显式 `bookId` 与该推导值冲突时必须原地失败。该能力对齐只覆盖当前用户按真实数据库角色可见/可操作的业务工具，
不开放内部恢复、宿主工作区或运维入口，也不允许通过 API Key 提升数据库角色。管理员身份的 CLI scope 会额外看到
`workflowTrigger/workflowStage` 的 `tapcanvas_flow_patch` schema，以及要求 `idempotencyKey` 的
`tapcanvas_workflow_run`；普通身份的 catalog/schema 不披露这些入口，即使手工伪造 execute 请求也会得到 403。

管理员直接在画布编辑 Workflow IR，并查看对应的持久执行事实；系统不再提供独立“编排设计”页签，
也不从 prompt、历史 trace、`docs/`、Hono 固定模板或 agents-cli 内部决策循环反推一张不可执行的设计快照。
Workflow IR 显式描述 source/agent/media/skill/tool/control/artifact/delivery 节点、typed ports、边与 executorRef；
运行投影来自同一 execution 的 node-run、attempt、artifact、effect 与 event journal。设计图与运行事实可以互相追溯，
但不得把 agents-cli 的内部规划过程包装成第二套管理 API 或执行控制面。

管理员画布编排复用现有 React Flow 编辑引擎，但不把浏览器图当作业务执行器。共享
工作流节点卡只承担身份、端口、状态与结果摘要；管理员点击节点后，右侧统一检查器以
“配置 / 输入 / 输出 / 运行”四个事实面板编辑参数、检查上游端口、查看真实结果或发起执行。
桌面端检查器保持非模态右侧停靠，窄屏改为画布底部停靠；标题栏的上一个/下一个操作按画布位置在同一工作流节点间切换并同步真实选中态，无需关闭面板或在遮挡区域反复点击节点。
这套交互复用同一个 Workflow IR，不为一键成片、Agent、文本或脚本各建一套表单。
工作流 Agent 节点以 `executionId + nodeId` 生成稳定的 session/public turn 身份，并通过
agents-cli 的 LogicalTaskGraph 与交付证据续跑同一逻辑任务。agents bridge 的 SSE 若在终态
`result` 到达前断开，会返回结构化 `agents_bridge_stream_interrupted`，工作流只把该节点记为
`waiting_external` 并持久化中断证据。后续外部检查只读取该稳定 session/public turn 的 agents-cli
durable status：仍 active 时继续等待，`succeeded` 时取回已经通过 agents-cli terminal arbiter 的
持久终态正文并据此恢复节点输出；禁止把 `await_external` 实现成第二次普通 `/chat`，否则会覆盖
原回合 checkpoint 并争抢同一 LogicalTaskGraph lease。不得把连接层的
`terminated` 投影为用户目标终态失败，也不得重新投递用户消息或重复已经有证据的动作。
普通模型错误、交付合同不满足和非恢复型协议错误仍显式失败，不会被连接恢复语义吞掉。agents-cli 发送的持久 bridge error event 会以 `agents_bridge_stream_failed` 保留完整失败正文，并对同一个 continuation、同一模型和同一 DAG cursor 做有界重领；operation fence 与任务回执禁止重复副作用，达到上限后仍显式失败。
对话历史的物理 session key 可以带有 `:skill:<skillId>` 能力后缀，但该后缀不构成会话身份。
agents-cli 的 PostgreSQL 读取会按 `:skill:` 之前的稳定 family key 同时读取当前 lane 与历史 skill
lane 的 append-only event，按事件时间合并并消除完整旧 transcript 的前缀重叠；不会删除或覆盖旧会话，
也不会把不同项目、画布、会话或 lane 的记录混在一起。这样 UI 侧切换 Skill 后，模型拿到的仍是同一条
真实对话历史，而不是只看到新 skill 的空子会话。项目故事板/预览图片在付费提交前仍确定性读取项目锚定候选；若当前项目存在可用角色、场景、道具等参考资产，而生成节点未携带稳定 `referenceAssetIds`、`referenceImageNodeIds` 或资产绑定 ID，Hono 把候选资产 ID 写入节点的 `storyboardAnchorDiagnostic(blocking=false)` 并继续当前生成。资产是否匹配当前镜头属于 agents 的创作语义，不能由 Hono 以“已有锚却未绑定”为由返回 409 或要求用户重试。已显式引用的资产仍执行权限、资产存在性、ID 解析、真实 URL、供应商参考图上限和付费幂等等确定性协议。
provider 返回“无正文且无工具调用”时，agents-cli 以结构化 `llm_empty_response` 记录请求摘要，禁止在
LLM adapter 内原样重放；Agent Loop 丢弃该空回合，在同一模型、同一逻辑任务和已持久事实内做一次有界续跑。
连续空响应耗尽供应商中断预算后才进入 `provider_stream_interrupted` 的 durable continuation，禁止改用备用模型、
新建 Workflow execution 或把空响应伪装成节点成功。Hono 只消费上述终态/暂停事实，不按错误文案建立第二套恢复分支。
`workflow-kernel-protocol@1` 定义节点端口、executor 引用、admin 权限以及
`manual/schedule/webhook/event` 四类触发器。`manual` 已接通两种显式执行身份：
`one-click-production/v1` 与 `agent-workflow/v1` 都先校验画布上从触发器可达的
原子节点及当前端口连线；前者携带来源事实并交给
`tapcanvas-video-workflow` 进入既有 durable 视频主链，后者保存画布后由 `/executions/run`
按 `triggerNodeId + workflowInstanceId + reachable DAG` 冻结唯一执行版本，并由 ExecutionDO/Queue
逐节点推进文本、Skill、工具 allowlist、Agent 与交付验收。上游输出按显式 source/target port 从
`workflow_node_runs.output_refs` 传给下游；每个节点都记录 executorRef、typed ports、artifact identities、
事实证据、错误和墙钟时间，Web 将这些真实 node-run 事实投影回节点检查器。每个 Agent 原子节点必须显式声明自己的
任务目标、输出产物合同和本节点交付合同；Agent executor 只把这些本地合同与输入端口事实交给 agents-cli，禁止把最终视频交付要求泄漏给上游拆分或提示词 Agent。工作流 executor 通过 Hono 内部 options 开启 `executeForcedAgentDirectly`：当前物理 Agent 直接加载所选 Agent definition 的完整角色 prompt、该 definition 自己声明的 `skillBundle`，并按该角色的领域 tools、继承规则和 `disallowedTools` 收窄业务工具面。工作流节点即使没有配置任何业务工具也必须发送 `executionToolPolicy={mode:"restricted",allowedTools:[]}`；空 allowlist 表示无远程业务工具，不能省略后退成默认全工具面。纯文本/JSON 的一次性 typed 转换统一选择 `workflow-transformer`：该角色显式声明空工具面、不继承父工具、不加载 Skill，最多 4 个模型轮次且墙钟上限 120 秒；完整视频 authoring specialist 只用于满足其 versioned BeatSheet/continuity/asset 输入合同的生产节点，禁止拿来执行简单的逐项文本转换。direct forced Agent 的实际 `maxTurns` 取调用方与角色声明中更严格者，角色 `timeoutMs` 同时绑定请求级 AbortSignal，角色预算因此不能只停留在 definition 元数据。工作流 runtime 已经持有唯一调度与用户级终态控制面，所以原子 Agent 按子执行单元运行，不再获得团队协调、任务图、shell、文件、后台进程，也不重复获得 `record_user_intent / report_delivery / request_user_input / read_delivery_reference` 等 root 任务协议工具。原子 Agent 的最终响应只交付自身 typed `outputContract`，不得把 `expectedDelivery / deliveryEvidence / deliveryVerification` 协议字段或验收报告混入业务产物；需要精确文本产物的节点使用 `json_artifact` 外壳，由 executor 确定性剥离后只把 `text` 写入输出端口。当 agents-cli 已裁决该子执行成功且输出通过声明的确定性编码/产物合同，而 root 级 delivery metadata 因子执行模式按设计为空时，Workflow executor 将这些事实投影为本节点的 `expectedDelivery -> deliveryEvidence -> deliveryVerification`，不会重跑一套 Hono 语义验证，也不会覆盖 agents-cli 显式返回的 unsatisfied 结论。产物随后由 typed output port 持久化并交给下游；整条工作流的用户级终态仍由下游 delivery verifier 统一裁决。完整上游端口数据因此只进入一次模型上下文，不再由 director 转述给同名子 Agent；公开 chat extras 无法开启该内部模式。普通聊天面板的手动角色指派仍保持显式团队委派语义，两者不能互相冒充。

ExecutionDO 是单个 execution 的唯一 DAG 调度权威，Queue 只承载可重投的节点执行消息。节点内部状态把“依赖尚未满足”的
`pending` 与“已经形成持久投递意图”的 `queued` 分开；前者只由 DAG 调度器选择，后者必须携带不可变
`nodeRunId + attempt` 后才能进入 Queue。启动恢复和常驻 reconciler 会重新投递仍处于 `queued` 的精确 attempt，
因此进程在数据库提交后、队列发送前中断不会留下永久卡死节点。worker 的 start/progress/wait/complete 全部校验同一
`nodeRunId + attempt` fence；恢复产生新 attempt 后，旧 worker 的迟到回报只能追加
`node_stale_attempt_ignored` 事件与已有资产引用，不能覆盖当前节点状态、端口或错误。`pending` 仅是内部调度事实，
API 与 Web 继续统一投影为 `queued`。整图 `concurrency` 只限制同一个 execution 的并行节点，collection
`itemConcurrency` 只限制同节点的 item 窗口，图片/视频供应商容量继续由各自订阅与提交队列负责；三层不得互相冒充，
也不得用进程内 semaphore 伪造跨进程全局容量。并发只提升吞吐，节点输出稳定性仍由 immutable flow version、typed ports、
attempt fence、幂等副作用与持久恢复合同保证。

装配给小T的工作流不再把整图 DAG `concurrency` 暴露为模型调用参数；调度并发属于作者冻结的机器执行合同，由触发器节点的 `workflowExecutionConcurrency` 声明，缺失时才按内核默认值 `1` 执行，非法值原地拒绝。显式管理员 `/executions/run` 仍可覆盖该值用于诊断。这样质量平台自身的 suite/case 并发只控制同时运行多少条评测，不能再意外把单条视频工作流的独立 DAG 分支串行化。一键成片 v38 冻结整图并发 `8`、Clip writer item 并发 `8` 和视频提交 item 并发 `8`，使 BeatSheet 完成后视觉资产规划与 Clip 编写并行推进，并在全部前置媒体就绪后一次并发提交当前章节的动态 Clip。每个 Agent item 仍须经过统一准入调度器：本地部署把 Ultra 的账户并发能力显式配置为 `100`，进程自身保留独立的全局容量和有界队列；账户或进程活动槽位暂满时请求排队并支持取消，不再返回 `agents_bridge_per_user_limit` 终止同一工作流。只有有界队列本身已满时才显式返回容量错误。账户并发 `100` 是准入上限，不会覆盖工作流内核逐节点的安全上限 `8`，也不改变计费身份或资产幂等合同。

一键成片 v68 起（当前 v71）在 `tapcanvas.video.generate/v1` fan-out 之前由触发器直接驱动 `video.voice-manifest.empty/v1`，确定性冻结空 `VoiceManifest`；`production-handoff` 同时取得 Prompt Package、estimate、全部视觉资产和该原生音轨合同后放行。整章图不再运行不会被供应商消费的音色目录、选声 Agent 与试听物化，也不维护按运行时条件切换的声音双轨。已经受理的视频 item 仍只在同一物理 execution 内协调同一 receipt。

工作流一旦由唯一终态裁决进入 `failed`，所有尚未调度的兄弟节点统一标记 `skipped`，仍处于 `running/waiting_external` 的兄弟节点关闭本执行的跟踪生命周期并标记 `canceled`，避免终态执行继续向页面暴露“正在执行”。这不会撤销、覆盖或丢弃已经被媒体供应商受理的任务：外部任务及其资产仍由独立任务账本和资产终结器保留，迟到的节点输出也继续走 canceled-node 的追加证据路径；终态收口只停止 DAG 继续调度。

Agent 检查器把“节点可用范围”和“本轮实际读取”严格分开。所有 Workflow Agent 默认可检索完整 Skill 目录与完整向量知识库，不提供逐节点搜索、挂载、停用或解除挂载配置；`skills/tools/knowledge-candidates/knowledge-evidence` 端口只承载显式上游数据，不改变这一统一访问范围，也不能作为实际使用证据。agents-cli 终态返回的规范
`meta.executionProvenance` 会由 Hono 校验后写入 node-run 的
`outputRefs.evidence.executionProvenance`，输入页再据此回显实际加载的 Skill、Reference、知识卡标题、来源数量、内容字数、哈希和模型；Skill 与知识正文均不向检查器展开。候选检索尝试另以 `promptExampleCandidateSearch@1` 从 agents-cli runtime trace 投影到 Workflow item evidence，保留 `status/attempted/candidateCount/rationale/toolCallId`；它不进入正文 provenance。执行快照中的知识聚合节点是 `skipDagRun=true` 的证据视图，不是独立 DAG 节点：详情页不得再把它显示成“该节点没有运行记录”，而要分别显示检索尝试、异常数、候选数与正文读取数。没有检索证据且没有 provenance 时才显示“全库可检索 · 本轮未读取”；已有历史 execution provenance 但旧版本未持久化搜索回执时显示 `unrecorded/历史未采集`，不得猜成未检索或检索成功；`searched`、`search_failed` 与 `actual_read` 也必须分开展示，禁止把检索失败压成“可检索”。首次作者窗口统一开放 `skill_search/Skill/knowledge_search/knowledge_read`；视觉资产规划与 Clip writer 同时开放受 typed scope 约束的 `prompt_example_search/prompt_example_read`。Clip writer 的 `required_non_blocking` scope 由 runtime 在第一次创作推理前执行一次候选搜索；候选仍不等于正文已读。正文读取零条、一条或多条均合法。搜索、弃选、零命中或检索异常进入 diagnostics，只有真实 Skill/Reference/知识卡/案例正文读取回执才以卡片 ID、字数与哈希进入 provenance；目录可见、候选召回与节点媒体标签本身不能冒充实际读取。根代理进入 action-only 阶段时，任何已通过认证目录 schema 激活但尚未成功消费的只读工具都会成为唯一前置事实边界：schema helper 与 catalog call wrapper 同时收窄到这些精确只读名称，相关读取成功后才重新开放 mutation，避免章节目录已读但章节正文被后续工作流动作越过。

图片/视频案例检索的远端失败由 agents-cli 记录为 `retrievalStatus=failed + blocking=false + diagnostics`：同一逻辑任务、同一媒体类型只真实请求一次，后续改写 query 或 limit 只能复用失败回执，不能再次撞相同向量依赖，也不能阻断原创交付或伪称已读取案例。agents-cli 的无工具结构化控制面复核在请求合同上显式声明两次瞬态重试，按 5 秒起步、30 秒封顶指数退避；普通模型调用仍不自动重放。复核仍未形成有效结论时，Hono 只续领带同一候选和 evidence revision 的持久 continuation，禁止重新生成候选、重放业务动作或把内部网络瞬断升级为用户级失败。

v29 把完整章节从文本编排到 Clip 的五分钟目标落实为有界执行合同：BeatSheet、资产计划和单 Clip writer 的输出预算分别收口为 `12288/4096/4096`，逐 Clip writer 的 collection 并发提高到 12；这些值只控制同一节点的有界文本生产，不改变图片/视频供应商队列，也不制造进度。当前 v14 Clip writer 的模型输出只拥有 `shots/continuity/speakerBindings/speechEvents/depictedStoryEventIndices` 等创意字段，agents-cli 在返回 Hono 前删除模型偶尔回显的 `clipId/clipIndex/durationSeconds/characterRoleNames/exitState/assetObjectContracts/shots[].speechEventIds` 与覆盖图副本，Hono 再从冻结上下文投影身份，并在模型首稿已经精确闭合的最终 Shot 时钟上编译对白引用和时间覆盖；Hono 不缩放镜头秒数、不吸收余差，也不重映射剧情事件索引。时间编译发现其它结构缺陷时，身份投影仍保留，精确失败路径进入持久 outputContractFailure，诊断因此指向真实剩余问题而不会先误报模型抄错 `clipIndex`。`speakerBindings` 只描述说话人身份，不再被当成实际供应商参考音频数组；真实音色引用继续在付费提交边界解析并以已有 `audioDegradation` 事实追加诊断。对白原文出现在 action、状态或表演文字中仍不充当语义闸门；BeatSheet 中已经冻结的真实发声正文和正数 `dialoguePaceRate` 会形成确定性物理容量事实：agents-cli 首轮编译器与 Hono admission 编译器逐行按可发声字符计算并向上取 0.5 秒；若唯一矛盾是合法本地时间轴不足以容纳冻结人声，两端统一把 `durationSeconds` 向上投影到下一整个供应商秒，只延长最后一条 `storyEvents`，并同步重编译可选逐秒状态轨和 `sourceFidelityAudit.sourceBeatLedger`。该投影不改写、不增删、不移动任何台词、事件或来源身份；时间轴不连续、语速非法、来源映射错误等真实结构缺陷仍按原合同显式失败。这样纯算术派生量不再耗费第二次模型纠偏，也不会成为五分钟生产截止线前的语义闸门。本地不再根据“急喊/快嘴/低语”等提示词关键词猜测语速；表演判断归 agents-cli，Hono 只消费正数语速事实并执行供应商硬上限。章节目录读取也改为 metadata-only，`tapcanvas_project_chapters_list` 不再泄漏 summary/正文；任何依赖章节内容的任务必须再调用 `tapcanvas_project_chapter_get`，确保工作流启动前的目录、正文和素材三类上下文均有独立真实回执。

当前工作流与 Video Writer v14 允许 `shots[].action` 省略：静态、建立或纯构图镜头只要存在非空 `visualTask`、连续 `shotNo`、正数最终 `durationSeconds` 与非空 `depictedStoryEventIndices` 即可进入时间编译；action 省略时只在机器状态轨中逐字复用该镜 `visualTask` 作为可见过渡。逐镜秒数由模型在唯一首稿中提交并必须精确闭合冻结 Clip，总和不符、单镜缺失、零值或负值均记录精确结构路径后结束该 Writer，不改成 `1`、不归一化、不回传修订。运动枚举、精确 Clip 时钟、对白容量/坐标、冻结身份、资产 URL 与供应商硬边界继续严格验证；这保持“模型一次出好数据、确定性失败立即落地”的单轨策略，不增加中途模型重写、默认模板或静默模型降级。

画布会把上述“实际读取”证据派生为所属 Agent 下方的 Skill/知识库引用节点，并用 `reference_only` 彩色虚线及方向箭头显式连接；引用边不进入可执行 DAG，也不能删除历史证据。每个 Agent、每类资源只占一个聚合抽象节点，不按条目膨胀画布。节点始终表达“完整目录可检索”，角标与列表只统计本轮 provenance 中真实读取且去重后的条目；零表示尚未读取，不表示知识库为空或没有权限。点击派生节点只读展示本次 provenance 冻结的 `name`、`description`、来源、哈希与物理 execution，不再请求目录补齐历史说明，也不提供挂载、启停或解除挂载动作。旧画布残留的 `workflowRequiredSkills/workflowKnowledgeCardIds/workflowDisabled*` 字段在模板升级和执行装配时被移除或忽略，不能再影响工具面、checkpoint 或下一轮读取。

同一逻辑 Agent 节点跨越物理预算或供应商中断续跑时，每个物理执行窗口的
`executionProvenance` 都会追加到持久回合的 `executionProvenanceHistory`，并由
`/chat/status`、Workflow executor 与 node-run evidence 原样投影。历史按真实
`executionId` 分窗展示，禁止把多个物理窗口伪装成一次执行，也禁止只保留最后一次
续跑而丢失前一窗口已经读取的 Skill/知识证据；单窗口运行仍保留原
`executionProvenance` 字段作为最近窗口投影。

物理 continuation 接管同一个 public turn 时，还必须从完整历史派生 `semanticDependencyPins`：冻结本逻辑执行的
`requiredSkills` 集合、`UserIntentContract.contractHash`，并记录已经读取过的每个 Skill body/section/resource 与知识卡的精确身份和 SHA-256。新窗口再次读取同一身份时若内容哈希变化，agents-cli 写入
`semanticDependencyObservations={kind:skill_source_changed|knowledge_source_changed,blocking:false,...}`，明确本窗口使用的新版本且禁止伪称与历史相同；该版本差异不得把用户任务投影为 failed/blocked。尚未读取过的新引用仍可由
Agent 按渐进披露自主加载，并在本窗口 provenance 落盘后成为下一窗口的已知依赖。只有 `requiredSkills` 身份被未授权扩展或冻结的 `UserIntentContract.contractHash` 漂移才作为合同完整性错误拒绝当前恢复；这是确定性身份边界，
不是语义质量闸门，也不阻断、回滚或丢弃已经受理或生成的媒体资产。


同一共享协议另外定义 `workflow.plugin-manifest/v1` 用户节点目录合同，以及
`workflow.plugin-executor/v1/{pluginId}/{pluginVersion}/{nodeType}/{nodeVersion}/{capabilityId}/{capabilityVersion}`
的严格、全版本固定 executorRef。目录节点实例化为 `WorkflowNodeDefinitionV1` 时会把 plugin/node/capability
三组精确版本同时写进 executorRef 与端口 dataType，config 也必须通过该节点的 closed bounded schema；不存在
“取当前最新版”或旧引用兼容分支。Hono 的 `WorkflowPluginRuntimeRegistry` 只接受通过 trusted admission 的 manifest，
并要求 manifest 声明的 kind/ownerId/runtimeVersion 精确命中启动方显式注入的 owner adapter；目录注册后不可替换。
权威目录由 PostgreSQL 的 `workflow_plugin_versions + workflow_plugin_admissions` 持久化：version 行保存规范化 manifest
原文、SHA-256、publisher 与 runtime owner 的不可变身份，admission 行独立保存 permission grant、admitted/revoked 状态与
单调 `decision_revision`。同一 `pluginId + pluginVersion` 禁止覆盖，admit/revoke 使用 revision CAS；读取时必须重新计算
manifest 原文哈希并核对表列与 manifest 身份，任一 admitted 行损坏都会让本次目录装载整体失败，禁止跳过后暴露部分目录。
生产 Queue 只有在节点 executorRef 明确带上述 plugin 前缀时才装载持久目录，普通内置节点不依赖插件目录。装载完成后形成
当前执行窗口的只读 registry；数据库、网络 URL、环境变量与插件自声明 entrypoint 都不能创建可执行代码。owner adapter
只能由 Hono 可信启动代码随版本发布，并按精确 kind/ownerId/runtimeVersion 注册；当前可信 adapter 列表为空，因此目录与
admission 底座已可审计，但任何插件在真正随代码交付 owner adapter 前都会明确拒绝 admission，不能把用户 manifest 变成
任意 Worker 代码执行。通用 Workflow executor 只按上述协议前缀进入一次 registry 分派，不为具体 pluginId/nodeType
增加 if/switch。调用前后分别按 capability input/output
closed schema 做确定性校验，未知字段、缺失必填端口、版本漂移、未授权权限或 owner 不匹配都会原地失败。owner adapter
的结果统一为 `settled / accepted / unknown_outcome`：只有 settled 释放 typed 输出；accepted 与 unknown_outcome 都保留
原 executorRef、owner evidence、幂等键和 provider receipt 后进入 `waiting_external`，供同一节点后续对账。付费 capability
必须声明 required string 幂等键和 required string provider receipt，缺任一字段都不能注册或把受理状态投影成成功。
未显式注入 registry、未注册精确目录版本或缺少对应可信 owner adapter 时，节点明确返回 executor/runtime 错误，不会回落
到内置节点、默认 owner 或其它插件版本。

完整运行只有触发器一个入口。非触发节点的“执行到此节点”仍从同一触发器创建正式 execution，但请求携带
`stopAfterNodeId`；Web 与 Hono 都只冻结该节点及其全部可达祖先依赖，排除旁支和后继，并在目标节点成功后自然终止。
该前缀运行不要求图中已经包含最终 delivery/output，仍复用同一 immutable flow version、ExecutionDO、Queue、node-run
历史和失败语义。节点的“仅隔离测试/预览”只验证当前确定性节点，不创建持久工作流执行，也不能冒充前缀运行。

本地开发 compose 显式设置 `WORKFLOW_LOCAL_JAVASCRIPT_ENABLED=true`，只服务开发模式/Admin 工作流中的可信 JavaScript 节点。整图执行在无继承环境变量、无网络能力的独立 Node 子进程中运行，单次 5 秒超时；生产 compose 不默认开启。长文模板用该节点做换行归一化和段落结构整理；15 秒叙事单元数量与边界由后续 Agent 动态规划，再交给 collection split 与逐项提示词 Agent，禁止用固定字符数冒充语义拆分。
只有 agents-cli 返回的本节点 `requestTerminal.status=succeeded` 且 `deliveryVerification.status=satisfied` 才释放下游；`failed/needs_input` 保留 task/evidence 并显式失败，不允许进入付费媒体节点。工作流原子 Agent 的角色语义保持 `depth=1`，但它同时显式声明自己是当前节点的 physical root，从而创建独立 root execution ledger。若 agents-cli 因物理执行窗口到达预算边界或连续供应商流中断返回 `requestTerminal.status=suspended`，Agent 节点会先清空未完成端口与产物，把 continuation reason 与 `physicalRunId + progressRevision` 持久为 `waiting_external`，再由同一 ExecutionDO/Queue 使用稳定 session identity 和前一窗口 evidence 自动续跑同一逻辑任务；物理窗口结束不能投影成用户任务失败，不能在 Hono 的最终 delivery envelope gate 中被当成 `succeeded` 验收，也不允许出现 recoverable reason 缺少 recovery checkpoint 的状态。每个新物理窗口还会从同一 durable conversation 中按 `assistant Skill call id -> 成功 tool receipt` 配对重建已经加载成功的精确 Skill `section/resource` 索引；后续同参数读取只返回 already-loaded receipt，不再重复注入正文。对于没有 durable frontier、只欠 typed output 的 direct Workflow Agent 续跑窗口，Hono 明确要求复用已经加载的 Skill 与上游事实，禁止再调用 Skill/search/Todo 等准备工具，并直接通过结构化终态协议交付本节点产物。该索引只承担同一逻辑 turn 的只读幂等，不把旧用户回合的 Skill 当成本轮授权，也不把失败 receipt 记成已加载。root ledger 除持久进度外还保存每个逻辑动作的自修复次数、重规划次数、重复失败签名、已关闭动作和已经注入过的 failure continuation；续跑窗口恢复这些状态，而不是为同一确定性失败重新发放一套内存预算。unsafe mutation 的关闭跨窗口永久生效，只读动作的关闭仍绑定 `readStateEpoch` 并在真实持久状态推进后失效。`/chat/status` 与 `/chat/interrupt` 必须共用同一个 checkpoint 构造器；后者即使当前物理进程已退出，也会对精确 `sessionKey + turnId` 把非终态 checkpoint 持久转成 `failed/chat_turn_user_interrupt`，清除 physical suspension，并由 Hono 以 CAS 取消尚未认领的 continuation。恢复轮先查询同一 public turn 的 durable status，禁止再次调用普通 chat 创建第二个任务；当 status 明确为 `root_physical_execution_budget_exhausted` 或 `provider_stream_interrupted` 时，workflow runner 调用统一的持久 resume service，CAS 认领该 turn 的服务端 continuation 并调度下一个物理窗口。历史上若宿主投影错误把已有 `result.runOutcome=suspended` 的 trace 终结成 failed，恢复查询只在同一 trace 同时存在允许的 recoverable reason 与非空 `runtime.suspension.physicalRunId` 时读取其不可变 `request.accepted`；普通 failed trace 仍不可重建。continuation 尚未可认领时保持 `waiting_external`，其他协议错误原地失败，禁止用新 prompt、换模型或默认任务兜底。语义规划、自修复以及
`executionMode=each` 的 `itemConcurrency` 同时约束同步执行和跨轮 `waiting_external` 项：等待中的 item 持续占用其并发窗口，节点必须先持久化当前 item 的恢复证据并暂停派发新的 item；只有该 item 成功或确定性失败后才补充窗口。这样逐镜 Agent 的画布进度始终对应真实活动游标，不能在第 1 镜仍续跑时提前启动第 2 镜并让节点快照长期停在旧 receipt。

用户中断会把公开 turn 投影为 `cancelled`，但同一失败物理 run 的 `recoveryCheckpoint` 仍作为审计与 continuation 取消证据保留。Hono 的状态解析器接受这组结构化事实，不因公开状态名变化丢弃 checkpoint；它不能据此恢复已取消任务，真正的恢复资格仍由服务端 continuation 认领合同单独裁决。
`expectedDelivery → deliveryEvidence → deliveryVerification` 仍由 agents-cli 收口，Hono 不做文本匹配或平行验收。agents-cli verifier 会按冻结合同把冲突或未解决 criterion 否决为未满足；Hono 的协议归一化拒绝 `status=satisfied` 却含 `conflict/unresolved` criterion 的自相矛盾投影，并只按机器字段验证 verification 的 `contractHash` 与 evidence 引用。这些检查只保证交付信封自洽，不重新判断创作质量或用户语义。恢复轮查询 `/chat/status` 遇到临时 transport unknown 时保持同一 durable turn `waiting_external`，状态响应结构损坏或身份错配等确定性协议错误才原地失败。每次外部检查只写入有界恢复摘要；Workflow Agent 以 `progressRevision + physicalRunId` 执行 no-progress 动作保险丝，准备性读取、诊断、被拒绝的完整草稿或持久化活动量都不构成业务进展。新的完整物理窗口仍无进展时，只退休当前 generation 并进入持久退避；同一逻辑任务到期后自动续跑，禁止要求用户“继续”、无限即时重放或换模型掩盖失败。

恢复状态查询或 bridge 传输本身中断时，中间 `workflow_agent_transport_recovery_pending` evidence 必须同时保留 `physicalRetryOrdinal` 与上一份 `recoveryWindow(progressRevision/physicalRunId/windowsWithoutProgress)`；任何临时传输层都不得把恢复计数洗回初始值。后续取得新的 root checkpoint 后才按相同 revision 与新的 physicalRunId 单调累计窗口，业务 revision 确实变化时才重置。

agents-cli 控制面的 `/chat/status` 与 `/chat/interrupt` 调用必须由每个 Hono 调用方显式提供正数墙钟 deadline；runtime helper 不提供隐式默认值。deadline 到达会真实 abort fetch，并返回 `agents_chat_runtime_timeout + operationOutcome=unknown`，连接故障返回 `agents_chat_runtime_transport_unknown + operationOutcome=unknown`，禁止把“没有拿到控制面响应”描述成远端动作确定失败。公开聊天中断区分两个机器作用域：会话切换、HMR 与旧流清理使用 `physical_only`，只关闭当前 transport/runtime/continuation；用户点击“中断当前任务”必须发送 `logical_task`。后者除 `localTransport / runtime / continuations` 三路正交回执外，还沿持久 `agent_capability_invocations` 的 `userId + sessionId + publicTurnId` 精确归属取消本轮启动且仍为 queued/running 的工作流，并返回独立 `workflowExecutions` 回执。新 invocation 把 `publicTurnId` 写入不可变输入日志；历史 invocation 仅在缺少该字段时，才允许使用同一 status 快照中的 agent execution provenance 做精确识别，显式属于其它 turn 的记录永不匹配。工作流取消复用统一 owner-scoped cancel service：ExecutionDO 原子停调度、本地 node job abort、Workflow Agent turn 与其全部 continuation 同时收口，已成功节点、供应商已受理任务和已生成资产继续保留。任一分路返回 `failed/unknown` 都会令总 `fullyInterrupted=false`，禁止只把聊天气泡标成 cancelled 后宣称整项任务已停止；`physical_only` 不得取消已经独立持久化的交付。

agents bridge 的 `/chat` 请求头超时不再使用 `AGENTS_BRIDGE_DROP_ON_TIMEOUT` / `bridgeDropOnTimeout` 把上游结果直接投影为 504，也不重放这个可能已产生副作用的请求。Hono 必须使用原始 `sessionId + publicTurnId` 调用 agents-cli durable `/chat/status`：只有 status 中精确相同的 public turn 才能把 `acceptance` 证明为 `accepted`，并返回 `agents_bridge_request_accepted_pending` 的 suspended 结果；身份不匹配、status 不可用或对账超时只能得到 `acceptance=unknown + recovery.kind=status_reconcile`，禁止描述为“未受理”或创建第二个 `/chat`。agents-cli 的每个 physical executor 退出还会在 `trace.runtime.physicalRunExit` 提供 `PhysicalRunExitV1`；其中 `handoff` 必须携带身份、revision、reason 完全自洽的 `ContinuationTicketV1`。Hono 现有 `task_statuses` continuation scheduler 直接把该 ticket 的 `ticketId + taskRevision` 作为恢复身份和单调进度，不再要求仅靠 root budget 或错误文案猜测可自动续跑。

公开 JSON 与 SSE 错误共用用户任务层级的失败事实。SSE `error` 强制携带 `terminal / scope / retryability / acceptanceKnown / sideEffectOutcomeKnown`，可恢复时再携带稳定 `recovery.kind + referenceId`；`AppError` 默认仍是 `terminal=false`，因此 Web live-run 只能把它投影为 suspended/reconciling，不能因为物理流发出 `error + done` 就把逻辑任务写成 failed。只有具有正向终止证据的调用方可设置 `terminal=true`。未处理的 500 错误只向客户端返回稳定 `internal_error` 公共 envelope；stack 与 cause 只写服务端日志/trace，不再放入公开 response details。

agents-cli 的单会话 admission 在执行器真正 active 之前先建立不可并发穿透的 `reserved` 保留态。`/chat/status` 必须把该保留态投影为同一 turn 的 `active=true + phase=accepted + reason=chat_turn_admission_reserved`，而不是短暂返回 inactive；`queueMode` 在保留态必须以终态 `chat_turn_admission_pending` 拒绝，并声明 `acceptance=rejected + operationOutcome=not_started`，禁止把控制消息写入尚未激活的旧队列。Web 的 resume 回执只证明 continuation 已被认领和调度，不证明新物理运行已经 active；恢复 hook 必须持有精确 `turnId + continuationId` claim 并持续查询权威状态，直到同一 turn 进入 active 或终态后才重新开放普通新回合。若 admission 拒绝，agents-cli、Hono JSON/SSE 与 Web 必须逐层保留结构化错误码和上述确定性未启动事实；不得在 `error + done` 收口时降级成原始技术文案气泡，也不得因此留下临时用户/助手消息。该协议只读取 turn 生命周期事实，不解析用户正文或业务类型。

`execution_traces.id` 是单个 physical execution 的不可复用身份：`beginExecutionTraceRun` 只允许首次插入，冲突不会再把既有 `succeeded/failed/cancelled` 终态重开为 `running`。finalize 只允许从 `running/waiting_async` 做一次 CAS 到终态；相同终态重放是幂等 no-op，不同终态的迟到写入以 `execution_trace_terminal_conflict` 显式失败。物理重试必须创建新的 physical trace identity，并通过 `logicalTaskId/rootTraceId/parentTraceId` 关联到同一逻辑任务。

普通 `POST /public/agents/chat` 必须携带调用方在提交前生成的 `clientPendingId`。Hono 使用 `userId + normalized sessionKey + clientPendingId` 生成不暴露原始身份的稳定 SHA-256 `publicTurnId`，并把它同时用作 root trace、agents-cli public turn、status/interrupt 与广播关联身份；同一幂等键重放若 trace 已存在，只返回 `agents_chat_turn_already_exists + recovery=status_reconcile`，禁止启动第二次 bridge 或媒体副作用。`queueMode` 是已存在 turn 的控制消息，不创建新 turn，仍按独立队列合同处理。

Workflow Agent 同样消费该 `status_reconcile` 合同：节点提交若收到 `agents_chat_turn_already_exists`，说明同一 `publicTurnId` 已被持久运行时受理，执行器必须立即读取 durable turn 的真实状态，并依据 running/suspended/succeeded/failed 接管同一任务；禁止把“已经受理”投影成节点失败，也禁止创建第二个 Agent 回合。

agents-cli 的 A2A compatibility surface 现在同样服从持久任务合同，而不是独立内存状态机：A2A task ID 绑定唯一 `LogicalTaskGraphV2` root，终态必须来自同一 delivery verification，状态、artifact、push outbox 与 SSE sequence 均来自 append-only task journal。A2A SSE 断线只解除订阅，不触发任务取消；`tasks/resubscribe` 使用 `Last-Event-ID/afterSequence` 重放遗漏事件，`tasks/cancel` 才能写入不可重开的 canceled 终态。Hono 若代理 A2A，仍只负责认证、公开 endpoint 注入和协议转发，不得把连接关闭、本地非空文本或 Redis 投影当作完成/取消事实，也不得建立平行 A2A 任务真源。

A2A task 投影与事件重放按公开 task ID 对应的 `logical_task_id` 查询 agents-cli journal；push outbox 通过协议事件索引一次定位 `a2a/v0.3` 任务，只读取命中的 root，不再每 5 秒加载全部 TapCanvas LogicalTaskGraph 根快照，也不再用内部 root node ID 做缺少前导索引的单列事件查询。该修复仅收敛 A2A bridge 的读取成本，不改变 Hono 协议转发、其它任务消费者或任何终态判断。

agents-cli 会话也已硬切到 `AgentSessionEvent@1` append-only 真相：PostgreSQL `agent_session_messages.message` 与本地 SQLite `session_messages.message_json` 保存版本化 history/state 事件，模型上下文由事件序列重放，不再通过删除尾部或全量覆写恢复。`agent_sessions.meta`、`last_response_id/last_sync_index` 和 Redis history 只可作为查询/短 TTL 投影；Hono 不得把这些投影反向提升为会话真相，也不得为旧裸 Message 行增加静默兼容路径。旧行若尚未经一次性迁移会在 agents-cli 明确失败，避免新旧双轨产生不可审计上下文。

历史 PostgreSQL 行的切换由 agents-cli 的 `session-events:migrate` 单次运维命令承担，不放进 Hono 启动、`api-init` 或请求处理链。运维者必须先执行 `--mode=plan` 获得只读计数、投影摘要和数据库指纹，再停止 agents bridge 写入；`--mode=apply` 要求精确 plan 指纹、旧事件数量与显式确认标志。默认还必须提供备份文件路径和该文件的 SHA-256，工具读取非空普通文件并复算摘要；若操作者明确承担无备份迁移风险，则只能使用与备份参数互斥的 `--waive-backup`，并把 `backupWaived: true` 写入迁移 receipt，禁止伪造摘要或静默略过。备份验证或显式 waiver 完成后，工具才会在同一数据库事务内重新核对并锁定 session 表，只把每条旧消息无损包裹为 `history.appended`、为缺失 session 追加 `session.state.updated`，不删除会话、消息或现有 v1 事件；事务后必须用生产解码器证明旧格式为零、状态投影完整、消息投影 SHA 不变。Hono 同名 Prisma migration 是无副作用的运维边界标记，不读取或改写会话数据，也不把人工切换变成整个 API 的部署前置条件。若历史版本的只读断言已经在 `_prisma_migrations` 留下失败记录，部署器只在当前 migration 明确声明 `manual-operation` 标记、且旧失败日志精确命中声明的断言签名时将该次尝试记为 rolled back，再正常应用当前无副作用版本；其他 Prisma 失败一律保持原地失败。Hono 不得为了绕过旧会话读取失败而重新添加旧行兼容、默认空历史或后台自动改库。

PostgreSQL 的一次性硬切迁移会把每条旧裸 Message 原位包装为有序 `history.appended` 事件，并为受影响会话追加当前 `agent_sessions.meta` 对应的 `session.state.updated` 事件；原消息内容、顺序与会话身份全部保留。迁移后仍出现无版本行必须显式失败，运行时 decoder 不保留旧格式兼容分支。

Workflow 原子节点的缓存只接受服务端 purity registry 明确认定的纯节点，并要求作者提供的 `cachePolicy` 与服务端合同逐字段一致；缓存键由 owner、executor/version、规范化输入、上游 artifact identity 与 policy version 共同计算。命中只复用不可变输出内容，仍创建本次真实 node run，并由运行时重新绑定当前 execution/nodeRun/attempt provenance。外部媒体调用、逐项执行、缺 artifact identity 或未登记 executor 一律不参与缓存，不能凭节点名称、prompt 或历史输出猜测纯度。每个节点终态由 `workflowProvenance@1` 统一盖章，记录精确 flow version、executor、attempt 与上游 node-run/artifact 绑定；图片/视频产物同时使用 `WorkflowMediaAssetV1`，条件、人审和 terminal receipt 使用独立版本化控制合同。Web 执行记录只解析这些机器事实，协议损坏显式报错，不从输出正文反推来源或媒体类型。

通用任务恢复与用户通知共用 PostgreSQL 真源：`GET /tasks/pending` 只读取当前用户 `task_results` 中的 `queued/claimed/running`，不再把 10 分钟 Redis progress snapshot 当作刷新恢复事实；损坏 JSON、资产结构或时间戳会原地失败。`upsertTaskResult` 和 `failTaskResultIfNonTerminal` 在同一个数据库事务内写终态与确定性 `user_notifications(type=task_result)` outbox，重复写同一 task 只更新同一个通知且保留既有 `read_at`。终态仲裁禁止迟到的 running/failed 覆盖真实 succeeded，但允许后到的真实 succeeded 资产纠正较早 failed 投影；`POST /tasks/:taskId/link` 只更新章节/节点引用，不能再覆盖 status/vendor/kind/result。`GET /tasks/inbox` 仅投影最近的媒体与 3D 生成终态日志（成功/失败），并把 `task_results` 的真实资产、`vendor_api_call_logs` 的生成提示词与失败原因、以及持久通知已读状态合并到同一响应；Web 底部任务 Inbox 点击日志后内联展示提示词和产物，点击产物再进入媒体预览，仅在点击真实通知后调用既有 read receipt。进程重启、页面刷新和短暂断线不得制造第二个任务、丢失终态或把 ephemeral toast 当成通知交付。

一旦 bridge 已返回结构化 result，用户交付与宿主投影分离：trace finalize、conversation/rollup/ledger 发布、实时广播和 continuation scheduling 各自记录 `postResultProjectionFailures`，任一步失败都不得把已取得的 result 改写为本轮失败或阻止 JSON/SSE result 返回。公开聊天入口只生成一次 stable `publicTurnId`，并在首次 bridge 请求及所有 continuation 中原样转发；agents-cli durable turn、Hono execution trace、accepted request snapshot、status 查询和恢复认领必须共同使用这一逻辑身份。面向 Web、conversation 与 outbox 的 response trace 会把 `requestId` 绑定稳定 `publicTurnId`；bridge 的物理 HTTP request id 仍保留在原始 result/meta 与 execution event 中作传输诊断，不能反向覆盖逻辑 turn identity，也不能成为 agents-cli 的 checkpoint key。conversation/rollup/ledger 另通过现有 `task_statuses` 保存 `agents_chat_publication` durable outbox；初始回合以 stable `publicTurnId` 作为 publication identity，后台 continuation 则以 `continuationId:attempt` 作为独立 physical publication identity，同时保留同一 `publicTurnId` 关联。这样每个 continuation 的 assistant-only/silent 投影都可独立幂等重放，不会覆盖根回合消息，也不会为了补会话历史而重放 agents bridge 或已受理媒体副作用。投影成功后 outbox 才进入 completed；数据库失败保持 waiting 并由既有内部 sweep 认领重试，坏合同明确转 failed，达到有界重试预算后保留最后错误。trace 与实时广播仍分别按自身事实记录诊断：广播不是 durable 交付事实，trace 终态由 execution trace CAS 保护。所有投影失败都必须保留明确 step/error 诊断，禁止静默宣称已落库。
`task_statuses` 同时以 `(provider,status,created_at)` 与 `(provider,status,updated_at)` 组合索引服务 continuation/publication 的 provider 级认领、陈旧任务扫描和恢复轮询，避免 outbox 增长后退化为整表扫描；两个在线索引各自放在仅含一条 `CREATE INDEX CONCURRENTLY` 的独立 migration 中，避免 PostgreSQL 多语句隐式事务导致部署失败。迁移只新增索引，不改写既有任务状态。

每个 Agent 节点必须显式保存 `workflowAgentMaxOutputTokens`（128–32768）。该调用方拥有的资源合同作用于 agents-cli 的每个物理 LLM turn：Chat Completions 下发 `max_tokens`，Responses 下发 `max_output_tokens`；不能用 prompt 中的“简短输出”冒充硬约束，也不能在 durable continuation 或模型网关中丢失、放宽或替换为默认值。节点还可显式保存 `workflowAgentReasoningEffort`，Hono、continuation task capsule、agents-cli 和供应商请求必须逐跳原样传递。默认短节点使用 4096；当前 v71 完整章级 BeatSheet 使用 8192 输出预算与 `low` 推理预算，在保留整章结构化产物字段的同时限制关键路径序列化规模。已有节点缺失资源合同时原地校验失败并要求管理员配置，不保留隐式兼容路径。

管理员可通过 `POST /executions/:id/cancel` 按唯一 execution identity 显式中断整次持久运行。ExecutionDO 原子把运行态改为 `canceled`，清空 ready 队列，并将尚未完成的 queued/running/waiting_external 节点统一记为 canceled；已经成功或失败的节点事实、产物和逐项证据不回滚。Node Queue 同时按该 execution identity 向本地在飞执行器传播 `AbortSignal`。Workflow runner 会把宿主权威的 `sessionKey + logicalTaskId` 写入每个 suspended item receipt；取消路由同时读取这些 receipt 与同 execution namespace 下仍为 `running/waiting_async` 的 trace，覆盖刚启动但尚未来得及写 checkpoint 的物理 turn。每个精确 turn 都并行执行本地 transport abort、agents-cli `/chat/interrupt` 与 continuation CAS 取消；continuation 无论仍为 `waiting` 还是已经 `claimed` 都会被收口，迟到 worker 不能再把它恢复成可续跑。回执明确区分 `interrupted / already_inactive / failed` 并返回 `fullyInterrupted`；任一平面失败或结果未知都不能被“工作流状态已取消”掩盖。身份提取只读机器协议证据与宿主生成的 execution namespace，不依赖节点标签、角色、工作流名称或 prompt。重复中断终态 execution 是幂等 no-op，不能误杀后来启动的另一 execution；中断竞态中迟到的真实节点输出仍以 `node_output_after_cancel` 事件追加保存，但不会恢复下游调度。外部媒体供应商若不支持撤销，则只停止后续推进并保留已受理/已生成资产，禁止把“停止调度”伪报为供应商任务已撤回。

除用户主动取消外，任一节点的非等待失败在 `nodeComplete` 已持久记录后，Node Queue 必须立即按同一 execution identity 中止仍在飞的本地兄弟/重复作业，并记录 `workflow_execution_terminal_failure_jobs_aborted` 结构日志；禁止让 execution 已经终态失败而遗留 Agent 继续耗费模型时间。该清场只终止未完成的本地执行窗口，不覆盖失败节点、成功上游、逐项产物或真实外部供应商资产。

管理员工作流的 Pin Data 与局部重放共用一套 durable output reuse 合同。画布只保存 `sourceExecutionId + sourceNodeRunId`，禁止内嵌或手填伪造端口结果；启动执行时 Hono 必须按当前 owner/flow 重新读取该成功 node run，校验节点 identity、executorRef、声明输出端口和 `WorkflowNodeOutputV1` 后，才把完整来源输出冻结进本次不可变 flow version。ExecutionDO 为每个复用节点创建本次新的 success node run，并追加 `node_output_reused` 事件及 pin/replay 来源，不得把旧 execution 直接冒充新执行。局部重放通过 `replayFromExecutionId + startFromNodeId` 指定边界：只复用边界之前、且位于首个非成功事实之前的严格成功上游；上游出现 `failed/skipped/not_selected` 时，该节点成为新的 rerun frontier，它和全部后代重新执行，不能因为它位于失败节点的祖先集合就被错误送入成功输出 validator。失败 collection 若持有合法逐 item checkpoint，仍只复用其中已成功 item 与可核验 provider receipt；没有可复用事实则从该 frontier 正常重跑。上游节点执行配置或端口连接与来源版本任一不同仍显式拒绝，边界节点及其下游始终重新执行。用户显式 Pin 优先于本次自动重放来源；工作流跨项目导出会删除 Pin identity，避免模板引用原项目历史。该能力不修改 agents-cli 的语义决策，也不能把本地预览、文本占位或未完成供应商回执升级成真实成功输出。

若局部重放边界本身是 `executionMode=each` 的失败节点，且当前边界节点执行数据与来源冻结版本完全一致，Hono 会把来源 `output_refs.itemRuns` 中的 success 项作为 `replay_checkpoint` 写入新执行的 queued node run；failed/waiting/missing 项不跨执行复用，仍由新执行生成自己的持久任务身份。集合运行时只跳过这些已验证 success 项，再执行其余项并重新聚合完整端口。边界节点数据发生任何变化时不注入 checkpoint，因而完整重跑该节点；上游变化仍显式拒绝重放。checkpoint 不会把失败节点伪装成 success，也不会提前解锁下游。
Workflow Agent 的 `publicTurnId` 同时作为 agents-cli durable turn、Hono execution trace 与续跑查找键，统一在生成时截断到协议上限；禁止只截断 agents turn 而让 trace 保存另一条更长身份，否则物理窗口恢复会找不到原始 `request.accepted` 快照。
非流式公开聊天与 Workflow Agent 首次物理运行统一进入 `runPersistedAgentsChatTask`：必须先写根 trace 和唯一 `request.accepted`，再调用 bridge，随后根据真实 result 登记 continuation、完成 trace 并调度已登记的下一个物理窗口。Workflow 不得绕过该服务直接调用 bridge，否则 agents-cli 虽然留下 suspension，Hono 仍无法恢复。公开请求快照与服务端专属执行合同分离持久化：前者继续由 `AgentsChatRequestSchema` 校验；后者只保存 `directForcedAgentExecution`、`outputContract`、`responseFormat` 与 `maxOutputTokens`，同时进入 continuation task capsule。后续窗口必须恢复同一角色执行方式、typed-output 合同和输出资源上限，公开 API 不能注入该内部合同。普通根任务的 continuation 仍只传不可变 goal hash 并从 durable session 恢复正文；无独立业务副作用的 typed Workflow Agent 原子节点则必须从服务端不可变 task capsule 重新注入完整原始节点目标与上游端口事实，避免长 writer 跨物理窗口后因会话压缩丢失当前 item 输入。该例外只由 `directForcedAgentExecution` 机器合同开启，不从 prompt、角色名或工作流名称推断。continuation 重建公开请求时只恢复通过 `AgentsChatRequestSchema` 的真实字段，机器续跑不构造空 `displayPrompt`；用户消息抑制仅由内部 `suppressUserTurnProjection` 合同承担。若重建校验失败，日志必须记录脱敏后的 Zod issue code/path/message，禁止只写无法定位的笼统错误。durable turn 的 `state=succeeded` 只证明物理 Agent 回合结束，不能直接投影成 typed 产物已满足；恢复结果必须先通过节点的 `outputEncoding + outputArtifactType` 结构合同，再由 Workflow executor 构造本节点的 satisfied delivery verification。
Agent 输出端口另有一层纯结构协议：`plain_text` 接收非空正文；`json_object` 按节点声明的
`requiredStringFields + allowedFields` 接受严格 JSON 对象；`json_artifact` 只接受精确
`{"artifactType":"<节点声明类型>","text":"<完整产物正文>"}`；`json_array` 的业务端口仍接收顶层非空 JSON 数组，供后续 collection split / each 消费，但模型传输统一使用 `{"items":[...]}` 对象信封，并可由节点声明精确条数、逐项必需字段、调用方冻结事实及允许字段集合。Hono 对所有结构化 JSON 端口下发 `submissionPolicy=single_submission_record_and_fail` 与同一份 agents-cli `outputContract`；BeatSheet 合同从 `canvasFacts.authoritativeSources` 构造来源 identity/fingerprint。模型只提交一次完整最终消息；Markdown 前后缀、残留字符、缺失必需结构、悬空引用或供应商硬枚举非法会记录原始候选后结束节点。Hono bridge 与 agents-cli HTTP admission 不要求或转发候选 checkpoint，不接受对象 delta，也不启动新的结构化生成。语义质量、节奏、创作参数和来源叙事合理性只记录 diagnostics，不读取正文关键词、不设最低字数，也不改写候选。

同家族 replay 会先用当前 typed contract 复验成功 Agent 祖先。若唯一变化是当前未改变节点声明中的顶层 `exactStringFields`（例如协议版本字面量），这些字段属于调用方冻结事实，恢复器会机械投影到旧 JSON 后再执行完整当前 verifier；只有完整复验通过才直接复用端口。其它字段、嵌套创作内容、缺失结构或 versioned verifier 失败一律不合成，仍形成 replay checkpoint 进入同链修订。这样协议字面量升级不会让数万字符的已验收 BeatSheet 重新调用模型，同时也不会把旧合同产物未经当前验收直接放行。
图片生成原子节点使用 `tapcanvas.image.generate/v1`，只消费上游 Agent 的
`tapcanvas.image-prompt-package/v1` 严格对象（当前字段为非空 `prompt + negativePrompt`），并使用节点上显式保存的实时模型、比例、尺寸与 `layout/style/identity/content` 资产绑定提交图片任务。供应商一旦受理，执行器持久化稳定 `taskId + canvasNodeId + effectId` 并仅协调同一任务；恢复时缺少持久收据会显式失败，禁止重新付费提交。图片 delivery 节点只校验真实 HTTP(S) URL 与产物身份，不对提示词或画面做语义质量闸门。主题预设只能修改上游主题文本和参考资产绑定，不能把本地模板 prompt 写进图片节点；最终提示词必须在每次运行时由 Agent 动态产生，并随生成结果节点持久化以便追溯。
同一启动能力也投影为管理员业务工具 `tapcanvas_workflow_run`，供 CLI/Agent 在完成 catalog → schema 发现后运行已保存图；
调用必须提交 `triggerNodeId + idempotencyKey`，相同 key 只能得到同一个 execution/flow-version 身份，禁止工具重试重复创建 Agent 工作。

管理员 AI 编排的能力节点现在区分“授权、检索、读取、执行”四类事实。`工具授权（agents.tool.allow/v1）` 只把精确工具 allowlist 传给 Agent，不产生工具副作用；`工具调用（agents.tool.invoke/v1）` 从当前 owner/project/flow 真实工具目录解析指定工具的实时 JSON Schema，先做纯结构校验，再复用 `/public/agents/tools/execute` 的权限、计费、幂等和业务执行边界，未知工具或 schema 漂移原地失败。知识链复用 agents-cli 的同一 pgvector `KnowledgeRetriever`，而不是在 Hono 建第二套 RAG：`知识检索（agents.knowledge.search/v1）` 生成 `workflow.knowledge-candidates/v1` 持久候选集，冻结 sourceRoot、cardId、排序、分数、摘要与 requestHash；Agent 可基于候选事实选择 cardId，`知识读取（agents.knowledge.read/v1）` 只允许读取该完整候选集中的成员，并输出带 candidateSetId/requestHash 的 `workflow.knowledge-card/v1` 证据。候选集可跨 Queue/DO 重启验证，不依赖进程内 candidateSetId；篡改候选、越过检索直读或 bridge/向量库不可用都显式失败。Agent 自己仍可按任务需要自主执行其原生 `knowledge_search → knowledge_read`；画布知识节点用于管理员明确要求可见、可接线、可复放的知识证据，不取代 agents-cli 的语义选择。

控制流采用端口事实而不是节点名称或文案推断。`条件分支（workflow.control.condition/v1）` 只支持显式 JSON Pointer 与 equals/not_equals/exists/布尔/有限数值比较，并且一次只发布 `matched` 或 `unmatched` 端口。ExecutionDO 为每条边持久维护未解析入度和活动入边计数；未命中路径写为独立 `not_selected` 终态并递归传播非活动边，它既不会执行，也不会被当成上游失败。活动分支到达并行汇合时仍可继续；恢复过程会根据已持久的节点输出端口重建相同选择，不能把重启后的未命中分支重新排队。`人工审批（workflow.human.approval/v1）` 进入 `waiting_external` 并保存 request/response/actor/time，管理员经 `POST /executions/:id/human-response` 恢复同一个 execution/node run。`明确终态（workflow.control.terminal/v1）` 以机器字段声明 succeeded/failed：失败保留 terminal receipt 后如实终止，成功保留结果回执；等待不由终态文案冒充。执行成功的判定以所有节点真实成为 success/not_selected 为准，仍在 `waiting_external` 的节点不能被 indegree 算法提前宣称完成。

除手动与定时外，触发合同已接入真实 Webhook 与事件入口。Webhook 使用 `POST /workflow-triggers/webhooks/:webhookId`，强制 `x-tapcanvas-delivery-id` 和 `x-tapcanvas-signature: sha256=<HMAC-SHA256(rawBody)>`，正文上限 1 MB；画布只保存 `env://<binding>` secretRef，服务端环境变量缺失返回 503，禁止把密钥写进 flow。deliveryId 与 flow/trigger identity 共同形成幂等键，重复投递返回同一 execution。事件由已认证管理员调用 `POST /executions/events/deliver`，按当前 owner、精确 topic 与 payload 顶层标量过滤器匹配；过滤不做语义判断。两类触发都会把 deliveryId、receivedAt、workflow identity 与原始 JSON payload 冻结进本次 immutable flow version，由 `workflow.trigger/v1` 原样输出给下游。`子工作流（workflow.subworkflow.run/v1）` 必须显式绑定 target flowId、不可变 flowVersionId 与该版本内 triggerNodeId；父节点保存唯一 childExecutionId，后续只对账该子 execution，成功后输出全部子 node-run 回执。owner/version/trigger 不一致或版本 ancestry 形成递归环时显式失败，禁止漂移到目标 flow 最新版或创建无限递归执行。

Workflow IR 的每个原子节点必须显式声明 `executionMode=once|each|collect`。共享
`workflow.collection/v1` 合同为每个数据项保存稳定 `itemId/index/lineage`：`each` 对齐 itemId 后逐项调用同一 executor，
标量输入只广播，多集合不对齐时在执行前显式要求 Zip/Cross Join，禁止采用“重复最后一项”补齐；`collect` 只在上游集合
完整后整体执行。基础节点 run 的 `output_refs.itemRuns` 保存每项 runtimeNodeId、端口、产物、证据与错误，部分失败也保留
已经产生的真实资产。Web 默认只显示 `完成项/总项`，用户可在节点旁铺开只读运行投影，或把已有真实视频 URL 显式固化为
普通可编辑视频节点；运行投影不改写 Workflow 定义。章节语义拆分仍由 Agent 输出结构化数组，
`each` 节点可在共享 Workflow IR 显式声明 `itemConcurrency=1..8`，省略时严格顺序执行；运行时采用有界 worker，输出仍按原始
item 顺序归档，并把实际并发上限写入 evidence。单项 executor 抛错只形成该 item 的失败证据，其他已授权数据项继续完成，
不会因并发而丢失成功产物。编辑器只在 `each` 模式展示该配置，非法持久值在编译和服务端执行两侧都显式失败；画布节点首行
直接显示“单次 / 逐项 · 并发上限 N / 汇总”，避免把并发上限误读成数组长度；实际总项数只来自上游 collection，并通过运行中的 `完成项/总项` 展示。
每个 item 结束后，Queue 都通过 ExecutionDO 的 `nodeProgress` 原子入口把当前有序 `itemRuns` 与
`completedItems / failedItems / waitingItems / settledItems / totalItems` checkpoint 到同一个运行中的 node-run，并追加
`node_progress` 事实事件；检查器因此能在整批结束前展示真实进度。checkpoint 写入失败会让当前节点显式失败，不能继续制造
未持久化结果。重启恢复会给重新入队的节点显式携带 `phase=recover`；即使 Queue 投递边界只留下普通 execute job，只要 Agent node-run 已存在合法 `output_refs`，executor 也必须从该事实进入 resume，不能创建第二次初始执行。恢复中的增量 checkpoint 按 `itemId/runtimeNodeId` 与上一个快照合并，已成功或已失败的 item 不再重复执行，进度计数也不得回退，最终 nodeComplete 只负责冻结整批终态。
逐项 Agent 中只要一个或多个 item 进入上述 `waiting_external`，`output_refs.itemRuns` 会同时保存已完成项与等待项；续跑只调用等待项，已完成/已失败 item 按原始 `itemId/runtimeNodeId/lineage` 原样保留，禁止重复消耗模型或覆盖历史结果。
节点检查器的“运行”页同时通过管理员只读接口 `GET /executions/node-history?flowId&nodeId&limit` 查询该节点最近的
持久运行记录；服务端直接按 owner/flow/node 联表过滤，不做前端 N+1 查询。每条历史保留父 execution 状态、时间、错误和
完整 `output_refs.itemRuns`，因此一次章节拆分为两项时会展示两条独立视频及真实 URL；选择历史运行可重新铺开逐项投影，
但不会重跑 Agent、重新提交媒体任务或改写 Workflow 定义。
工作流级历史统一以 execution 为主索引：`GET /executions?flowId=...` 在一次查询中返回节点状态计数，以及按
`failed -> waiting_external -> running -> queued` 确定性优先级选出的事实停留节点；它不读取节点文案，也不把普通排队
臆测成业务失败。`GET /executions/:id/snapshot` 只读取该 execution 绑定的 `flow_version_id`，不会读取或拼接当前 flow，
因此历史画布、原始 JSON、节点状态和事件日志可以共同复原当时运行事实。管理员显式调用
`POST /executions/:id/rerun` 时，服务端从不可变快照内的 `workflowExecutionScope` 恢复触发边界并创建新的 execution；
旧 execution、旧 flow version 与已生成资产保持不可变。重跑前必须剥离只属于旧物理运行的
`workflowResolvedOutputReuse` 与 `workflowResolvedReplayCheckpoint` 回执，避免把旧输出冒充新执行，或让旧祖先的部分失败检查点覆盖上一代已经成功的结果；用户明确保存的 durable Pin 仍属于版本定义并按原合同验证。
`workflow.collection.split/v1` 从节点 `workflowAtomicSpec.inputPorts` 声明的首个 typed input 读取集合源，再按显式路径、JSON 格式和 itemId 字段做结构转换；executor 不假定端口名固定为 `value`，也不在 Hono/Web 用关键词判断章节边界。
Split executor 必须把集合发布到当前节点声明的真实输出端口，而不是写死为 `items`；因此同一结构执行器可以安全承载
`items`、`clips`、`asset-items` 等 typed collection。flow version 还会把本轮显式引用的普通画布组及其子节点冻结到
`workflowSourceSnapshots`，source executor 只读取该不可变快照，运行期间画布后续编辑不会改变已启动 execution 的输入事实。
“文档 → 动态 15 秒提示词”模板提供不产生媒体费用的通用 map 链：TXT/Markdown/DOCX 文本输入 → 本地 JavaScript 正文结构整理（once）→
结构批次 Split → 单元规划 Agent（each，逐批输出 `arr<ClipPlan>`）→ Clip Split → 提示词 Agent（each）→ 交付验收（collect）。DOCX 在浏览器按需加载 `mammoth` 抽取完整纯文本，节点同时保存来源文件名、
字节数和导入时间；解析为空或失败必须原地报错，不截断、不生成假正文。导入后若管理员手工修改正文，节点会同步清除旧文件来源元数据，
避免把修订后的文本错误标记成原文件原文。JavaScript 只输出完整正文与稳定 paragraphId，不判断章节边界；规划 Agent 根据叙事语义和
15 秒可呈现容量输出带唯一 `clipId` 的动态 JSON 数组，数量不固定。Hono/Web 只校验 JSON、字段和身份结构，不解释正文语义。模板的逐项提示词 Agent
显式采用最多 3 项并行，并使用 `json_artifact` 锁定 `tapcanvas.video-prompt/v1` 类型；管理员可在节点配置中调整并发为 1–8；每项 Agent 输出的
`ports/artifacts/itemId/lineage` 进入持久 node-run；当前或历史执行都可把全部文本结果一次物化为
独立、可编辑且与来源 Agent 节点相连的普通文本节点，并以 `runtimeNodeId + itemId + executionId` 保留追踪身份，重复物化保持幂等。
需要真实视频时，用户可再连接独立视频生成节点；提示词模板本身不隐式触发付费。
动态 fan-out 的权威语义固定为 `Agent -> arr<T> -> Collection Split -> each -> collect`：Agent 根据当前完整内容与用户显式合同决定 `arr.length`；Split 只展开实际数组；`itemConcurrency` 只影响调度并发，不得成为片段数量。除非用户显式指定数量，模板、Skill 和工作流标签都不得写入“恰好 N 项”。`json_array` 合同可以固定每项的字段、类型与用户明确指定的单项规格（例如每项 15 秒），但动态规划时必须省略 `expectedArrayLength`。本次执行的总项数只在 Agent 数组通过结构合同后从实际 `arr.length` 冻结进 collection/node-run evidence，不跨 run 继承为默认值。
agents-cli 的 provider working-set 投影必须在测得的任务消息预算允许时逐字保留最新 Workflow 输入，不能用固定 8K 头尾摘录改写完整 DOCX 的事实范围；只有序列化消息真正超过硬预算时才允许压力投影并显式暴露缺失范围。Workflow 原子 Agent 直接消费该无损输入，不再经过 root→child 的二次转录。普通团队任务中已完成 `spawn_agent` 返回的结构化文本产物仍作为当前交付事实无损保留，已消费的子 Agent 大 prompt 参数可结构压缩，禁止因物理窗口切换只剩结果头尾而让 root 重新生成或伪称覆盖全文。
该模板把逐批规划节点显式绑定为受限 `writer`、逐项提示词节点显式绑定为 `video-prompt-writer`，后者同时加载 `tapcanvas-video-prompt-writer + tapcanvas-video-reviewer`，在同一逐项执行中按统一权威合同完成写作与自检；管理员可在节点配置中改绑到
agents-cli 实时目录里的其他身份。编译器与服务端 executor 都拒绝没有 `workflowAgentDefinitionId` 的 Agent 节点，禁止把空身份静默解释为主 Agent。
每个 Agent 节点还必须从实时启用的 text 模型目录显式保存 `workflowAgentModelKey`；运行时把该精确键传入 agents bridge，
不继承可能漂移的服务端默认模型，也不在 `model_not_found` 时静默切换。目录失败时检查器保留原值并禁用选择；持久模型已下线时要求重新选择，若仍从外部触发则由上游真实 `model_not_found` 明确失败。

“章节 → 多段视频”模板据此保持一条紧凑设计链：文本 → 拆段 Agent → Collection → 逐项提示词 Agent → 逐项视频生成原子节点 →
集合交付验收。视频节点不再伪装为一个调用媒体工具的 Agent：`tapcanvas.video.generate/v1` 要求从实时模型目录显式冻结
modelKey、时长、分辨率和画面比例，每项首次执行只提交一次；供应商返回 `running + taskId` 后，节点持久进入
`waiting_external`，后续队列只读取同一 canvas node/taskId，真实持久 HTTP(S) 视频 URL 到达后才转 success 并释放下游。
外部等待期间已成功项、逐项 lineage、taskId 和画布 nodeId 全部保存在 `output_refs.itemRuns`；进程重启会扫描并恢复等待项，
队列重投若观察到已持久等待收据也只切换到 await phase；恢复阶段缺少或损坏收据会显式失败，禁止再次触发付费提交。
本地 Node runtime 重启时还会从 immutable `flow_version`、`workflow_node_runs` 与事件最大序号重建
ExecutionDO 的 indegree/ready/running 游标，避免仅剩 queued 节点的执行永久停住。每次启动会把所有节点的
`workflow.execution-semantics/v2` 冻结进 immutable flow version；恢复、重试和对账只读取这份版本化事实，不再按 executor 名称、前缀或本地列表猜执行语义。内建 executor 使用同一声明式注册表同时驱动注册与语义投影；插件 executor 从本次已准入的不可变 manifest capability 合同投影，缺失或损坏语义快照会显式失败。
execution 已落库但尚未来得及初始化 ExecutionDO 的 `queued` 崩溃窗口也会在启动扫描中重新调用同一 `/start`；
`queued → running` 使用数据库条件更新做唯一 claim，重复扫描或并发副本得到 HTTP 208 幂等回执，不会重复排队根节点。
纯结构 executor 可重新排队，`tapcanvas.video.generate/v1` 只能通过稳定 effect claim 对账后继续；正在执行的
Agent 和管理员 JavaScript 因其冻结语义无法证明没有外部副作用，会写入 `node_restart_interrupted` 和 `execution_failed`
后明确结束，禁止盲目重放。若失败执行中已有视频处于 `waiting_external`，队列仍继续查询原 taskId 并把真实资产
追加到节点运行证据；失败不会成为丢弃已受理媒体结果的理由。事件序号以父 `workflow_executions` 行的
PostgreSQL `FOR UPDATE` 事务锁为唯一分配边界，再从数据库最大值续写；多个 Worker/DO 实例同时恢复同一 execution
时也不能分配相同 `(execution_id, seq)`。序号不再由单进程 Durable Object storage 决定，进程重启和并发恢复都不会
覆盖历史事件或因唯一键冲突撕裂 node/execution 终态。
`workflow_node_runs` 只保留当前节点投影；每次 initial、恢复执行、runtime recovery、自动重试或人工修复都在
`workflow_node_attempts` 留下独立账本行，并冻结当时的执行语义、输入、输出、工具调用、声明式 provider receipt、错误与时间。旧 attempt 先结算再创建新 attempt；自动重试的节点/执行计数与账本在同一事务推进，runtime recovery 只增加 attempt、不冒充业务重试。每个 execution 同时归入稳定 `execution_family_id`：根执行与 resume/rerun 后代通过有界 `GET /executions/:id/family?cursor&limit` 分页查询；单个物理执行的 attempts 通过 `GET /executions/:id/attempts?cursor&limit` 分页查询。两类游标都先重新验证 owner 与 family/execution 作用域，不能跨用户、跨执行或跨家族复用；返回的 `nextCursor=null` 才表示当前序列读完。family 成员只投影身份、状态、恢复关系、错误与时间，不查询或返回 `userInput/projectContext/assetSnapshot`；需要重上下文时必须按 execution 使用专用详情接口，禁止把整份项目资产快照重复注入小 T 的恢复链诊断。family 接口只返回最新物理执行、活跃执行、执行/成功/尝试计数与分页执行事实，不在 Hono 本地裁决用户级逻辑任务终态；最终是否满足交付仍服从统一 delivery verifier。生产部署 `20260820120000_workflow_execution_semantics_attempt_ledger` 前必须先排空 `queued/running` execution；迁移在显式 PostgreSQL 事务中取得执行表独占锁后复核该事实，发现活跃执行、孤儿恢复链或循环恢复链时整笔回滚，禁止留下半迁移结构。
每个 runtime item 使用稳定 effectId 与稳定输出视频 nodeId，运行时生成的普通视频节点可直接在画布查看；
“铺开”仍是只读运行投影，“固化”优先关联已存在的真实视频节点，不能复制一份相同资产。
直接工作流视频节点在供应商 POST 前还必须先把 `workflowEffectId + workflowSubmissionState=submitting`
写入该稳定输出节点；该写入失败时供应商请求不得发生。只有持久状态明确为
`rejected_pre_upstream` 也属于该 effect 的终态失败，同一 effect 不再重试；`submitting/uncertain` 或任一缺少 provider taskId 的非终态
同样必须 fail-closed，禁止以“画布暂时没有 taskId”推断上游没有受理。新的提交只能由新的显式执行族产生新的 effect 与画布节点身份。
供应商回执落库后状态推进为 `accepted`，真实 HTTP(S) 视频写回后推进为 `materialized`。这条画布 claim
提供 TapCanvas 侧的 at-most-once 付费安全；在供应商没有幂等键、且尚无独立通用 workflow effect ledger 时，
进程恰好崩溃在 provider 受理与 taskId 持久化之间仍只能报告不确定并停止，文档和 UI 不得伪称可自动恢复或 exactly-once。
通用 Workflow 的视频费用节点按 Agent 最终交付的动态 clip 数量、实时模型目录和用户显式规格生成冻结 `estimateIdentity`；后续视频提交必须逐项携带并验真同一 identity，禁止估价后改模型、分辨率、比例或数量继续扣费。BeatSheet Agent 负责语义切片，`clip-fan-out` 只做确定性事实校验；Prompt Package 再验真完整 SpeechEvent、镜头交集引用、speakerBindings、资产消费精确集合和 authoring provenance。视频结果和 concat 只接受持久 HTTP(S) URL，单 clip 直接复用原 URL，多 clip 才调用 media-worker。多 clip 拼接是正式交付边界，未配置、RPC 失败和空响应都保留为 node-run 的确定性恢复证据；同族恢复以前沿为起点复用已成功 ancestor、item 和真实资产，不重做已经成功且有持久 URL 的付费视频。持久 Workflow 节点由独立 `workflow-runtime-worker` 执行，因此开发与生产 Compose 都必须为该进程显式注入与 API 相同的 `MEDIA_WORKER_GRPC_ADDR`，并等待 media-worker 健康后启动；只给 API 配置该地址会在所有付费片段成功后才让 concat 必然失败。concat 的主片只写入当前 workflow node-run 的 `master-video` 输出与 delivery evidence，不向章节画布再造第二个主片身份。

一键成片 v52 对首视频快速通道与提示词作者身份同时做硬切换：删除独立的 `launch-beat-agent`，完整生产和“首视频验证”都先由同一个 `beat-sheet-agent` 基于完整 authoritative source 产出全章 `chapterArc + speechLedger + sourceBeatLedger + beats`，`beat-sheet-format` 通过后才由 `video.beat-sheet.take/v1` 确定性投影第 0 项。章级改编方法只来自预载的 `tapcanvas-dramatic-adapter`，单 Clip 创作方法只来自 `tapcanvas-video-prompt-writer` 及 `tapcanvas/video-prompt-authoring@3.3.3`；Workflow IR 只声明节点职责和 JSON 协议，Hono 只传冻结事实并编译机器字段。退役且无生产调用者的 `buildWriterClipPayload` 固定任务书已删除，画布中的二次密度包装也已删除，`task.agents-bridge` 的通用视频节点 schema 也只描述最终 prompt 字符串而不再夹带镜头密度方法，因此不再存在一份要求 writer 输出 `shots[].speechEventIds`、另一份要求宿主编译，或一份允许静态镜头省略 `action`、另一份要求每镜强制 `action` 的冲突来源。3.3.2 规定上游未冻结场景锚、道具、身体落位、光源或反应含义时保持通用或未指定；3.3.3 继续清除领域 reference 内部的默认 `15 秒 / 9–12 镜 / 固定爆点频率 / 8K / PBR / 16:9 / 60 帧 / 院线调色 / 最长拍长优先`，这些事实只能来自用户、真实资产和动态 generation contract。章级 `film_spec` 同时硬切删除 `enableQa`：前端不再提供“出片前质检”开关，API 对旧字段显式拒绝；创作复盘只在同一作者上下文内推动修订，不取得开始生产、任务完成或用户级终态的裁决权。

一键成片 v55 的“首 Clip 前缀 + 其余 Clip”双轨已被 v59 完整删除；v60 在此基础上把完整 BeatSheet 的身份事实压成一次性的根级 `objectRegistry`，逐 Beat 只保留 `objectStates`，Hono 再为资产规划和 Clip writer 展开兼容的 `assetObjectContracts`。资产规划只为每个唯一肉身建立一张 `character-card/v3` 身份锚，并通过 `consumerClipIds` 复用于全章；附体、伤痕、情绪、服装和故事阶段只属于同一身体的表演/妆造状态。Collection 运行时借鉴 n8n fan-out 的“先物化稳定 item 身份、再批量发布”边界：具有幂等键和持久供应商回执的图片/视频 item 不因第一条 `waiting_external` 暂停，而是按 4/8 路配置继续提交全部 item；每次 checkpoint 同时持久化 `configuredItemConcurrency/startedItemIds/activeItemIds/peakActiveItems`，UI 展示真实已启动、活动与峰值并发，不能把配置值或节点 `running` 伪装成实际生产进度。
v55 同时修复快速分支的媒体配置来源漂移：`launch-asset-image-generate` 与 `launch-cost-estimate` 不再各自保存或向根 Agent 索要另一套模型/画幅/分辨率/图片尺寸，而是通过 `workflowConfigurationSourceNodeId` 指向章级主分支的唯一权威配置节点。能力描述在装配时先确定性解析该关系；执行受理时再次把同一配置物化进不可变 flow version，缺来源、链式来源或副本值冲突均以结构错误显式失败。用户本轮明确冻结的字段仍可在继承完成后作为按次覆盖；未冻结的时长、画幅与分辨率由 agents-cli 在工具调用前要求省略，账号偏好、模型目录默认值、历史 run 与旧成片不得升级为本轮覆盖。Web 的章级入口只传交付范围，不再常驻注入“继承账号偏好”的创作指导。因此 `75s`、`15s×N`、`480p/16:9` 或旧模型都不能再仅因模板缺字段而成为产出依据。
v71 的画布定义版本与指纹由共享 video-orchestrator protocol 提供，Web 模板、能力舱装配边界和服务端执行目标使用同一结构常量。能力舱会把冻结版本低于当前定义或指纹不一致的已添加工作流标为待更新，从 Agent 工具面移除，并在检查、重新添加或执行旧冻结版本时返回 `capability_workflow_definition_outdated`；它只比较结构化 `workflowKey + workflowCanvasDefinitionVersion + workflowCanvasDefinitionFingerprint`，不读取名称、prompt 或创作质量。工作流编辑器也以版本号与指纹共同决定是否显示“升级到当前模板”，避免结构已变化但版本号未同步时留下不可见的过期附件。已保存旧图即使“附件 sourceVersionId=当前 flow sourceVersionId”也不能再被误判为可执行，必须按正式检查/装配协议重新冻结当前定义，历史版本与历史执行继续保留。
视频生产启动状态由真实供应商回执裁决：只有可追溯 `taskId/providerAcceptedAt` 才是 started，缺失时保持“尚未受理”并展示当前 Workflow/Agent/供应商事实，不再因为固定五分钟墙钟写入用户级 failed、取消未受理分支或终止 continuation。历史 execution 已写入的 deadline 事件保持不可变审计记录；新执行不继承、不复用，也不会由状态查询再次触发。供应商回执和已有资产始终继续对账，不删除、不覆盖。
视频 collection 中一旦任一 item 已取得确定性终态失败，该失败立即优先于兄弟 item 的 `waiting_external` 成为当前 execution 的用户可见终态；禁止为了等待其它已受理任务而继续占用主工作流预算或把页面留在“处理中”。所有兄弟 item 的稳定 `taskId`、canvas node identity、artifacts 与 external-check receipt 仍完整保存在 node output 中，项目级视频孤儿回收器继续独立对账并把后续成功/失败结果写回画布，因此“父工作流立即失败”不等于取消、删除或丢弃已经受理的媒体。
供应商返回结构化素材拒绝时，Hono 只按 HTTP 资源身份把 `rejected_urls` 确定性连接回本次冻结的 `referenceId`，持久化 `workflowSubmissionState=rejected_by_provider + providerRejectedReferenceIds`；签名 URL 仅留在服务端画布诊断，不进入 Agent 提示。视频 runner 在提交调用退出后会 fresh-read 并再次 CAS 写入同一稳定节点，避免并发 sibling 写入把失败节点遗留为 `submitting`。下一次显式 `fresh_only` execution 的 ProjectContext 直接按拒绝 reference ID 将该资产标记为不可生产，不做语义审片、不改图、不原样重试，也不调用额外放行模型。
资产规划的零项结果由冻结 BeatSheet 的显式对象合同决定，不由 Hono 猜题材：如果 `assetObjectContracts` 全部声明 `referenceRole=none`，运行时得到的 visual-reference role 集合就是确定性的空集，此时 `asset-coverage` 以 `minimumArrayLength=0` 结构合同直接结算 `[]`，不启动一个没有合法 role 可写的 Agent turn，也不生成图片、占位资产或伪造引用。后续 fan-out 保留真实零项 collection，并让纯 T2V Clip 继续进入 writer、估价和视频提交。只要冻结合同中存在任一需要视觉参考的 role，空资产计划仍显式失败，必须由同一 Agent 链交付与这些 canonical role 对应的真实计划；该零项路径只处理机器可判定的空集合，不做语义质量判断或默认降级。
BeatSheet 唯一首稿还必须由当前用户所选模型判断对象是否真的需要跨 Clip 可辨认连续性：一次性路人、匿名围观者、背景人群与只承担群体反应的非核心群体，在个体身份不参与后续因果时使用 `referenceRole=none` 且不绑定/生成角色卡；确有连续性职责时才建立相应 reference role。Hono/Web 不用人物名称、题材关键词或本地模板替模型做该决定，运行中也不返回纠偏。
逐 Clip Agent 不声明机器 `assetId`；它在 BeatSheet 后立即消费不带 ID 的冻结对象合同并与资产规划并行。`video.asset-plans.split/v1` 是正式注册、无副作用的确定性执行器，在图片付费前验证每个计划项具有非空 `consumerClipIds`；同一 `asset-items` 一路进入图片生成，另一路在 `prompt-package` 汇总边界按 canonical role 绑定到 Clip。不存在、尚未生成、缺少持久 URL 或无法解析到稳定 node/asset 身份的引用仍在付费提交前显式失败，禁止从画布任意挑图。图片和视频 executor 对已经持久化的 `canvasNodeId + provider taskId` 在每次 `waiting_external` 检查时只对账同一 receipt；浏览器刷新、关闭或 autosave 不承担推进职责，终态失败也不会触发另一笔提交。
`tapcanvas.asset-plans/v1` 的 `role` 是协议身份而不是描述文案，固定使用 `character|scene|prop|vfx|palette|composition://canonical-name`。该格式由 artifact 级 `itemStringFormats.role=asset-role-v1` 结构合同统一注入，并从冻结 BeatSheet 的可视觉生产 object contracts 推导唯一 `itemStringAllowedValues.role`，直接进入首次 agents-cli 指令、结构验收与终态工具 JSON Schema 的字符串 `enum`。`exactStringFieldsByIdentity` 中的 `existingAssetId/existingProjectId/existingNodeId` 等调用方机器元数据可由 harness 唯一投影；Agent 已给出但与冻结值冲突的字段绝不覆盖。繁简体漂移、改名或 consumer 绑定错误只记录首次产物与精确允许值并结束节点，不做名称归一化、模糊匹配、有界重编译或原样重试。只有首次提交即通过该合同的计划才允许进入资产 fan-out 和媒体提交。
已装载工作流的触发入口统一读取嵌套 `triggerPayload`；模型或适配器把已声明的媒体字段展平时，只做结构性投影，嵌套值与展平值冲突则显式失败，禁止静默落回模板默认模型、分辨率、比例或时长。
一键成片的媒体合同会把实时模型目录计算出的 `providerSubmissionTopology`（调用者显式 `requestedClipCount` / `requestedClipDurationsSeconds` 或模型最大时长策略）同步冻结到 BeatSheet Agent 的 JSON 合同，精确约束物理 Clip 数、有序逐项时长及相邻 `exitState` 承接。只有数量而没有总时长时，`requestedClipCount` 仍直接冻结 `expectedArrayLengths.beats`，而逐项时长只受实时 `durationOptions` 约束；存在真实 `requestedClipDurationsSeconds` 时，执行节点必须重建同一冻结拓扑，禁止只保留总时长与数量后重新分配成另一组合法秒数。`clip-fan-out` 会逐项核对 BeatSheet 时长与冻结拓扑，`5+5` 不得被创作层改写为 `6+4` 后继续付费提交。剧情事件仍写在各 Clip 内的 `storyEvents`，不再把语义节拍当作额外物理片段。`project_context` 源节点同时投影 `authoritativeSources`；BeatSheet Agent 还会看到当前项目全部已就绪可生产图片的紧凑身份候选，并在唯一首稿中用精确 `referenceAssetIds` 冻结跨章复用。历史 `canonicalName` 完全相等仍可作为稳定结构身份的机械快路，但不是语义复用前提；名称别名、人物称谓或章节差异由 Agent 依据 `sourceFacts` 判断，Hono 不再通过字符串相等强迫重复生成或否定精确 ID。`preview_only/story_preview`、越权 ID 与过期工作流产物不成为复用事实，由运行时 Asset Resolver 按 ID 验真。项目节点资产的恢复校验使用稳定内容身份，不会因同画布其它节点写入而误报版本漂移；缺少该身份的旧执行快照在恢复时从同一授权画布重新水合。BeatSheet v20 的冻结结构合同明确 dialogue delivery 枚举、跨 `storyEvents` 的状态接力、显式来源 `sourceBeatId`，以及根级 `objectRegistry -> beats[].objectStates` 的稳定引用；`beats[].characters` 是宿主从对象状态编译的本 Clip 真实出场角色投影，纯场景段确定性得到 `[]`。无新增叙事人声时的无损 `{lines:[]}` 投影按“无额外人声”处理。节点只使用不可变 Workflow 定义中显式冻结的首稿输出预算，Hono 不再为 BeatSheet 暗中抬升到 16K/32K；结构化候选在唯一模型提交后一次验收，失败只记录原始候选与精确拒因并立即结束当前节点，不提供路径补丁、修订预算、同 execution family 重派或等待态。
Workflow Agent 的 Skill/知识能力不再由节点配置：执行器统一授予 `skill_search/Skill/knowledge_search/knowledge_read`，节点 `allowedTools` 只保留经过认证的业务工具上限，并与显式工具端口去重后交给 agents-cli，不形成 Hono 固定意图路由。独立 `agents.skill.require/v1` 原子节点仍可作为可接线、可复放的显式 Skill 数据操作，但不收窄其它 Agent 的全目录检索范围。
Agent 节点的“执行智能体”只从 agents-cli 当前
`/public/a2a/agents` 目录读取真实可委派定义，并把精确 `agentDefinitionId` 与输出产物合同写入 Workflow IR；
目录读取失败时，检查器保留并显示已持久化的原始 `agentDefinitionId`，同时禁用选择、显示真实错误和重试入口；不会因目录空白让用户误以为配置丢失，也不会在未验证身份时继续执行。
每个 Agent 原子节点都把自己的身份作为 `forcedAgentRole` 与唯一 `allowedSubagentTypes` 交给 bridge，并由内部 direct execution option 把该身份安装为本物理节点的执行角色；多 Agent 图由
ExecutionDO 按真实边独立调度各 Agent 节点，不再要求一个 root Agent 在单次聊天中模拟整张图，也不允许该 root 为角色指派再创建第二跳。工作流节点绑定优先于聊天面板的临时角色选择；目录不可达、身份失效或
Agent 不可委派时必须显式失败，禁止静默回到小T或其它角色。一键成片默认图的 BeatSheet 与资产规划使用受限 `writer`，逐镜提示词使用 `video-prompt-writer`；小T root 只负责在工作流外识别需求并调用已保存 Flow，不能在原子节点内部重新规划、委派或模拟整条一键成片链。Web 只做 DAG、空值、身份和权限等结构校验，不从节点标题或正文
推断语义路线。一键成片管理员图把用户显式的来源、执行范围与 typed DAG 冻结为真实可执行 Workflow；删边、改线、模型未配置或端口缺失会在首个外部副作用前
原地暴露精确结构错误。通过结构检查后，画布播放按钮直接创建该 Flow 的持久 ExecutionDO 运行，不再向小T聊天框派发消息；小T的一键成片请求通过 `tapcanvas_equipped_workflow_run` 调用当前 attachment 的同一触发器。浏览器只负责保存、启动与投影，不在本地执行媒体节点。画布组原有的“一键成片”按钮和小T自由创作请求统一进入 `tapcanvas-video-workflow` 并启动已装配 Workflow IR。Agent 默认模板的 Skill 与工具节点不再串在 Agent
输出之后：触发器分别驱动文本、Skill、工具，三者通过 `input/skills/tools` 端口汇入 Agent，Agent 的 `result`
再进入交付验收，因此画布连线与真实执行依赖一致。Agent 下方的聚合 Skill / 知识库节点属于运行引用投影，不参加 DAG 调度；Web 用无箭头、无流向动画的紫色 Skill / 青色知识库关系线连回所属 Agent，0 项仍保留弱化虚线，实际读取则按执行证据高亮，禁止把引用关系伪装成主链执行方向。`forcedAgentRole` 由 Web → public chat DTO → Hono bridge →
agents-cli `/chat` 全链透传；身份失效由 agents-cli 原地 400，不能静默回落到 director。`schedule` 必须显式携带 schedule identity、Cron、IANA
时区、misfire policy 与 catch-up 上限，Webhook 只保存 `secretRef`。自托管 Node API 现在每 30 秒扫描一次已保存且显式启用的 schedule：
它从 flow 的 `updated_at` 或该 schedule 最后一个 execution occurrence 续算，只接受当前仍有效的管理员 owner，
并把 `flowId + triggerNodeId + scheduleId + scheduledFor` 编译为稳定 occurrenceKey、executionId 和 immutable flow-version id。
多副本或重启后重复扫描同一时刻只会命中现有 execution；`skip` 强制 `maxCatchUpRuns=0` 且只接受 90 秒准点窗口，`run_once` 强制 `maxCatchUpRuns=1` 并把停机期间错过的时刻合并为一次最新补跑，
不会同时冲出一批付费执行。画布配置在启用前必须调用 `/executions/schedule/preview` 由服务端 cron parser 验证表达式和 IANA 时区；修改任一调度参数会自动关闭节点，
用户重新验证、显式启用并保存画布后才生效。调度执行复用 `/executions/run` 相同的 scope/support 校验、ExecutionDO、Queue、node-run 历史、媒体 effect claim 与重启恢复，
不维护平行执行链。Webhook 已通过签名公开入口接入，event 已通过管理员认证入口接入；两者都复用同一 start service、ExecutionDO 与 Queue，并冻结幂等 delivery 事实。平台发布 executor 仍未接通，Web 不得伪报为已发布。一键成片的两份不可变模板不再要求
用户在创建入口预选来源组，也不再把七个观测阶段冒充可编辑步骤；“画布来源”可显式选择真实组或输入测试文本。
`prompt_only` 模板固定为七个原子节点：`canvas-source / delivery-contract / beat-sheet-agent / beat-sheet-format / clip-fan-out / clip-writer-agent / prompt-package`，图中不存在资产准备、声音物化、费用、供应商提交、结果等待或合成节点，运行合同也明确禁止媒体副作用。`media_delivery` 模板固定创建十七个原子节点：
`canvas-source / delivery-contract / beat-sheet-agent / beat-sheet-format / asset-coverage / asset-fan-out / asset-image-generate / clip-fan-out / clip-writer-agent / prompt-package / voice-materialize / cost-estimate / production-handoff / video-submit / video-results / concat / delivery-verify`。
其中 `asset-image-generate` 在管理员投影中表达对真实 `asset:coverage.required/available/missing` 的逐资产验真与补图进度，不得伪造 URL 或把 planned metadata 冒充图片产物。来源组在“画布来源”节点内从当前真实普通组显式绑定；执行时同时冻结显式 `workflowExecutionScope`，禁止用播放按钮临时覆盖为另一执行范围。
完整模板包含 19 条 typed port 依赖：资产 coverage 先展开真实 required 集合，Clip 展开同时消费 BeatSheet 与已验真的资产集合，生产交接同时消费提示词包与费用预估。编译器拒绝循环、悬空边、重复节点 identity、旧通用 handle、未声明端口、无入边的声明输入与 source/scope 不一致。
管理员一键成片 Workflow 的 Agent 节点必须显式保存执行智能体、实时文本模型和输出 Token 上限；`delivery-contract` 必须显式保存正整数目标总时长与用于读取实时 `durationOptions` 的视频模型；图片节点必须显式保存模型/比例/尺寸，费用节点必须显式保存与交付合同相同的视频模型及分辨率/比例。缺失、模型不一致或只填写部分参数都会在启动前原地失败，禁止忽略配置、读取聊天面板临时选择或补默认值。`prompt_only` 图不包含媒体节点，因此只要求时长能力模型，不要求分辨率/比例，也不会提交媒体任务。
`apps/web` 的 `/executions/run` 与 Hono start service 接受结构、权限和节点配置均通过校验的 `one-click-production/v1`。画布播放与 `tapcanvas_workflow_run` 是同一启动服务的两个入口，不维护平行执行链；前者不打开或写入小T聊天会话，后者保留小T对已保存 Workflow 的直接调用能力。浏览器历史
`oneClickVideoOrchestrator`、前端 feature flag 和本地四阶段进度 store 已退出运行时引用，不再构成第二条一键成片执行链。
ExecutionDO 的事件追加在同一对象实例内串行分配 `seq`，避免节点进度回调与用户取消同时写入时争用 `(execution_id, seq)`；取消仍按精确 execution identity 幂等执行并保留已完成产物。Web 从 node-run 的 durable evidence 投影 `Agent 生成中 / 同链续跑中 / 等待续跑 / 连接恢复中` 与最近心跳，不再把所有内部阶段压成一个长期不变的 `running` 文案。

工作流权限不是纯 UI 隐藏。普通 `/flows` 读取、公开项目读取和 agents `/public/flows` 读取都会删除
`adminWorkflow`/admin-only permission 节点及其相连边；非管理员保存投影后的普通画布时，服务端保留原有受保护
节点和边，并丢弃伪造的工作流节点。章节 `canvas_flow` 的读取、整图 CAS 保存和实时 canvas patch SSE 使用同一
权限投影，不能从章节接口或协作通道旁路读取编排 payload。包含受保护编排的 flow 也不能由非管理员经普通 flow
删除接口删除。Web
管理员专用的 AI 诊断、状态存储与运维页只向 admin 渲染；项目 owner 仍可使用项目上下文页，但不能
看到这些 admin 能力。Workflow IR 的设计与运行投影统一留在受权限保护的工作流画布中，不再维护平行的“编排设计”页签。

Web 新增节点入口采用两级目录：一级为“创作素材 / 媒体处理 / AI 编排”，二级才显示具体节点，搜索跨全部可见
分类。`AI 编排` 分类整体受 admin 权限投影控制，不能通过搜索泄露给普通用户；当前完整铺开空白智能体工作流、
文档动态 15 秒提示词模板、章节多段视频模板、一键成片完整成片/仅提示词两份不可变原子模板、手动触发器、定时触发器，以及 source/agent/skill/tool/control/artifact/delivery 原子节点。选中现有工作流组
或组内节点再添加原子节点时，新节点继承该显式工作流身份；未选中时创建独立节点，不猜测要加入哪个工作流。
节点目录同时完整提供“文本输入”和“JavaScript 脚本”。空白智能体模板以显式文本输入作为首个数据节点，
缺少文本、Agent 目标或交付要求时结构校验原地失败。JavaScript 的浏览器测试使用无同源权限、禁网络、
执行后销毁的隔离 iframe/Worker，只允许 JSON 输入输出。整图本地执行注册 `workflow.script.javascript/v1`：
仅自托管 Node runtime、仅管理员工作流、仅在显式设置 `WORKFLOW_LOCAL_JAVASCRIPT_ENABLED=true` 时启动独立子进程，
5 秒超时并要求 JSON 输入输出，错误原样写入 node-run。该子进程隔离进程生命周期但不是不可信代码安全边界；
多人生产环境不得把开关当沙箱。Cloudflare Sandbox 不是 Agent、Skill、媒体供应商、视频持久化或本地可信脚本的
前置依赖，只有未来允许不可信第三方代码时才需要独立安全执行基础设施。
开发模式提供严格受 `import.meta.env.DEV` 保护的 `/__workflow-development` 内存验收入口：它直接复用正式 Canvas、
Workflow IR 模板和节点检查器，退出时恢复原 Zustand 状态，不保存画布、不触发模型或媒体。该入口只用于本地 UI/交互验收，
真实 Agent 目录仍遵守当前登录身份，不伪造管理员、目录结果或执行记录；生产构建不会暴露该路由。

AI 诊断首页从结构化 `completionTrace/toolExecutionIssues/deliveryVerification/requestTerminal` 和实时事件构造
事实型诊断摘要，直接列出缺失交付条件、下一步动作、错误码与对应图节点。它不读取 prompt 正文、不用关键词猜根因，
也不把已受理的异步任务或单个局部动作失败误判成整个逻辑任务失败；只有权威终态失败、持久事件错误或明确未满足的
交付验证才投影为失败问题。

普通对话与执行对话共用同一条 agents-cli 主链。Hono 的对话 system 片段只编译本轮已经确认的事实：
项目/书籍/章节身份、选中节点、引用媒体槽、显式所选 Skill、画布作用域以及结构化执行建议；它不再读取
persona 文件、静态模板、`docs/`、`assets/` 或 `ai-metadata/`，也不按本地意图枚举拼接方法论/SOP。
创作方法、Skill 选择、意图冻结、任务拆解、工具选择和最终自检均由 agents-cli 在同一执行链完成。

Skill 上下文装配由 agents-cli 使用单一渐进披露合同：无论本地复跑、`tapcanvas_public`、宿主子代理或 Workflow 原子节点，`requiredSkills` 都只在首轮预读 frontmatter 与完整标题骨架；模型随后把骨架机器索引给出的稳定 ID 原样传给 `Skill.sectionId`，读取一个 `SKILL.md` 标题的本地正文，通过 `Skill.resource` 读取一个明确 reference，或同时提供 `resource + sectionId` 只读取该 reference 内的一个 Markdown 标题单元，sectionId 不递归包含子标题。三种读取具有独立的持久幂等身份，同一 reference 的不同 sectionId 不会互相吞掉，也不会因一次局部读取误判整份 reference 已加载。显式白名单仍只是工具能力上限与协议授权事实；Skill 未注册、加载失败或正文不可用会写入 `skill_preload_observations` 诊断，并在当前事实足够时继续执行，不得把知识/方法论缺失投影成用户任务的 blocked/failed。只有 malformed schema、权限/身份冲突等确定性协议边界才可拒绝该动作。Hono 只透传调用方显式 Skill 身份与真实项目事实，不选择章节、不维护另一套 prompt 套餐。writer 的 reviewer 依赖由 `requires-skills` 结构化注入 prerequisite-only 骨架；Skill 工具从当前 run 已加载父 Skill 的依赖闭包识别该授权，因此依赖 Skill 无需重新参加用户意图候选召回。writer、reviewer、workflow、API 与治理 Skill 统一声明同一个 authoring contract 版本。

物理续跑不会假设模型仍持有前一窗口读过的静态协议正文。`Skill` 与 `tapcanvas_get_tool_schema` 都属于无副作用、可安全重放的 content receipt：如果 agents-cli 的持久工具 trace 仍保存同一事实作用域的完整成功正文，新窗口会以新的 `toolCallId` 回放该正文并记录 `receiptReplayedFromToolCallId`，而不是只返回“复用旧回执”却不给模型实际内容；如果历史 trace 已压缩且没有正文，则允许重新执行一次真实静态读取。provider working-set 只在这份 Schema 之后已经成功执行同一逻辑工具、同一 selector operation 时才移除它；例如 `preflight_get_beat` 的成功不能消费随后加载的 `preflight_patch_beat` Schema。回放不执行远程写操作、不改变业务 revision，连续回放仍受统一次数保险丝约束。mutation、付费生成和普通动态事实读取继续服从各自的幂等、状态 epoch 与 factual-scope 合同，不能借此路径重放。

根任务的开放式只读准备预算属于同一逻辑任务的持久执行状态，而不是单个 5 分钟物理窗口的临时计数。agents-cli 在 root execution ledger 中保存 `open_exploration / targeted_repair` 阶段与连续只读回合数：开放准备最多两个模型回合；确定性动作失败后的定向补证据最多一个模型回合，并允许把相互独立的必要读取并行完成。达到对应预算后，后续窗口继承 action-only 工具面，只保留 schema discovery、真实状态变更、`report_delivery`、verifier 明确要求的证据工具，以及成功候选召回对应的精确消费工具（`skill_search -> Skill`、`knowledge_search -> knowledge_read`）；action-only 可以关闭新的开放检索，但不得在候选已经产生后拆断自己的消费协议。Skill 成功加载同时构成能力面 revision：lean tool surface 的缓存身份包含当前已选 Skill 集，其声明的 runtime tools 必须在下一模型回合出现，不能因为 allowlist 未变化继续复用加载前的旧工具面。真实状态变更成功会清零并回到开放阶段；新的确定性动作失败才重新进入定向修复。工具回执 checkpoint 与批次归并后的 runtime-state checkpoint 分开持久化：前者保存业务事实，后者立即保存更新后的读取阶段/计数，避免进程恰好在两者之间重启时恢复旧工具面。该机制只约束执行停滞，不读取提示词正文、不评价创作语义，也不替代 writer/reviewer 的同链质量责任。

`preflight_get_header` 是同一视频 run 的只读权威 revision 恢复操作。续跑 checkpoint 可能在 header revision 刚完成 CAS、但新的 receipt 尚未进入压缩前沿时短暂保留旧 draft fence；因此 agents-cli 不得用本地旧 fence 拦截该读操作，无论模型省略 revision，还是使用远端 mismatch 已明确返回的新 revision，都交由 Hono 对当前 durable draft 做事实校验。成功回执随即进入本物理窗口并成为后续写操作的最新 fence；`preflight_get_beat`、patch、commit 等其余操作仍严格拒绝旧 revision，不能借恢复读放宽写入保护。

BeatSheet draft 的每个 begin/get/put/patch/continuity 响应都必须以该操作完成后的 `assembleBeatSheetDraft` 返回值作为 repair 真源，禁止从写入函数携带的操作前 draft snapshot 投影 `repair:null`、旧 issues 或旧 clipIndexes。存在 repair issues 时，`allowedNextActions` 与顶层 `nextAction` 先列真实 repair edge，`preflight_commit` 只能排在修复动作之后；两者必须由同一个 progress cursor 生成，不能一个宣称 commit、另一个仍要求 patch。视觉状态修复错误同时返回当前 `temporalContext.stateScope` 和覆盖该 clip 的可用 `{stateScope,stateVersionId,stateKey}`，operation schema 明确 `characterStateVersions.*.stateId` 引用 `stateVersionId` 而非 `stateKey`；这些都是确定性协议事实，不替 agents 编写可见状态语义。

BeatSheet durable draft 在 `preflight_begin` 时硬绑定父代理的稳定逻辑执行身份 `{sessionId, model, apiStyle}`，并保留首次 `executionId` 作为审计事实。物理预算续窗可以更换 `executionId`，但后续 put/patch/continuity/commit 必须继续来自同一 session、同一模型和同一 API 风格；任一字段漂移都原地拒绝，禁止新对话、旧任务或备用模型接管既有 run。旧的无绑定 draft 不做兼容迁移，部署切换后必须显式失败。repair cursor 同时携带每个待修 clip 的当前 `beatRevision`，供 agents 直接构造精确 CAS patch；局部 beat 修订不会提前清空整组 verifier repair frontier，只有成功 commit 才清除修复快照，避免修完第一段后目录错误收窄为 commit、其余段落被逐轮阻塞。

硬切换后的无绑定 draft、其它无法解析的持久 draft，或代理在尚未执行 `preflight_begin` 时误入 draft read/write/commit，都不做字段回填、兼容迁移或原地复活。草稿存储层用独立的 `beat_sheet_draft_not_found` 区分“整份 draft 不存在”和“某个 beat/preflight 记录不存在”；前两类确定性草稿错误返回通用 `restart_preflight` recovery：旧 run 保留为审计证据，游标唯一开放全新的 `preflight_begin`，没有 draft revision 时以被放弃的 run identity 作为恢复 cursor revision。因为 preflight graph 尚未产生媒体 taskId、真实 URL 或供应商受理，该动作可在同一逻辑任务、同一 session、同一模型内安全重规划；一旦存在媒体副作用则不得使用这条 recovery。Redis/数据库不可用、普通 beat 缺失以及其它非草稿损坏错误不会伪装成 restart recovery，而是保留精确错误码；普通可修订的 header/beat 校验错误仍走原有精确 patch frontier，不能借 restart 逃避修复。

API 与 agents-bridge 的容器健康探针使用短于 Docker health timeout 的进程内硬超时。服务或数据库阻塞时，每一轮探针必须自行退出，禁止裸 `fetch` 长时间残留并累积 Node 子进程，进而放大 CPU/PID 与磁盘 I/O 压力。探针失败只影响容器健康事实，不改变逻辑任务终态，也不自动重启 PostgreSQL、清理数据或切换模型。

结构校验器返回的 `beats[n].field...` 只是一条 JSON 地址证据，不是可提交字段名。agents 的同链 recovery 必须根据当前 exact operation schema 把它重建为 `patch.field...` 的嵌套对象；禁止把 validator path 扁平化成 patch key，也禁止把错误文案里的概念名臆造为 schema 字段。Hono 仍只拒绝未知字段和错误结构，不替模型生成语义内容。

agents-cli 的 context budget 诊断区分“持久任务窗口”和“实际 provider payload”：前者只用于计算确定性 working-set 投影，`runtime.contextBudget`、实时日志中的 `providerEstimatedTotalTokens/overBudget` 与性能快照必须基于投影后的真实 `system + messages + tools` 重新测量；压缩前估值仅作为 `contextTransform.preProjectionEstimatedTotalTokens` 诊断，禁止把它冒充供应商实际收到了超限请求。若 Responses SSE 缺少权威 terminal event 但已经取得 provider `responseId`，客户端先按该精确 ID 查询原请求终态；查询窗口随显式 `maxOutputTokens` 有界扩展、最长十分钟，只接收供应商返回的 completed/failed/cancelled/incomplete 事实，禁止在原请求仍可寻址时直接重放推理。精确恢复仍未取得终态、chat provider 缺少 finish reason，或 Responses provider 以 `incomplete_details.reason=max_output_tokens|max_tokens|length` 返回未完成正文时，部分正文与工具参数都不写入会话、不执行、不交付；agents-cli 只允许在同一模型、同一持久会话内做一次有界语义续跑。对输出上限型 incomplete，续跑必须基于已保留事实重新生成一份更精炼但完整的结果，禁止拼接未知半截 JSON；两类事件都把 provider `responseId`（若存在）与 `providerInterruptions` 结构化写入 trace。连续第二次仍未形成权威完整终态时收口为 `waiting_for_evidence/suspended`，禁止切换模型、把半截内容当成功或重放已成功/已受理的工具动作。
本地 initial/post-tool inference deadline 只关闭正在消耗墙钟的 SSE 传输；若该流已经收到稳定 Responses `responseId`，解析器会在 deadline abort 时保留有界事件状态，并用独立的只读 recovery signal 查询该精确响应。显式用户中断、宿主取消与其它 abort 仍立即生效，不会被 detached poll 吞掉；独立查询也不能创建第二个 provider response。当前本地部署把大型工具后 typed-output continuation 与单次请求边界统一为 10 分钟，并继续受 15 分钟 root 物理窗口收窄。精确 ID 查询若连续三次得到 `404`，说明当前网关未持久化该响应或不支持该读取面，解析器立即以缺失 provider 终态收口当前物理动作，不再对永久不存在的 ID 空轮询到总截止。这样 10 分钟本地推理边界不会和网关丢失 `response.completed` 叠加成一次昂贵的从头重放，也不会留下假性 `running`。

公开聊天的 `logical_task` 中断会以精确 `publicTurnId` 作为 `owning_chat_turn` actor，先由 owner-scoped invocation journal 解析该回合实际创建且仍活跃的工作流，再把同一个用户取消原因交给 ExecutionDO。ExecutionDO 将 `owner_admin` 与 `owning_chat_turn` 同等视为 `user_requested` 的合法用户来源，恢复器 actor 仍只能使用 `workflow_recovery`；因此画布停止不再因 actor 枚举漂移出现“聊天已停、工作流仍跑”，同时普通会话切换的 `physical_only` 不会扩大成工作流取消。
公开客户端不能提交 `userIntentContract` 或 `userIntentContractLocked`；这些字段只允许由服务器创建的可信
continuation 从已持久会话恢复，防止调用方伪造已冻结目标或绕过首次意图捕获。

对话交付合同由 agents-cli 生成并验证。Hono 只对开放的 `deliveryContract.kind`、canonical
`deliveryEvidence@2`、`deliveryVerification@2` 做结构校验和投影，并追加宿主执行的确定性定位事实；不运行第二套
语义 verifier，也不根据正文、prompt、工具名、节点数或资产类型重新解释完成态。请求终态只投影 agents-cli
`runOutcome@1`；唯一允许的 Hono 侧终态修正是协议事实自相矛盾（例如 `needs_input` 却没有结构化问题）时显式标为
协议失败。缺少 `completion@1` 或 `runOutcome@1` 直接返回 `agents_bridge_completion_protocol_invalid`，不能用非空正文
补成成功。

public response 的 rich trace 使用显式投影状态：完整时为
`traceProjection={status:"complete"}`；缺少 raw meta 或任一可选 trace 字段不符合 schema 时，保留已验证的
`requestTerminal` 和可安全读取的结果，同时返回 `status="failed"`、稳定错误码与 issue path，禁止静默丢弃诊断。
Web 的 SSE consumer 对每种 event 使用严格 schema；未知事件、非法 JSON 和字段漂移都会原地报错，`interrupted`
作为独立 done reason 展示，不再被当作普通失败或自然完成。画布节点快照保持 60 项上限，但会优先纳入本轮明确
选中的节点，避免大画布仅截取数组前缀而丢失当前操作锚点。

公开 AI 对话的过程审计现在使用单一持久执行实例，不再依赖浏览器内存日志。Hono 在调用 agents bridge 前以
服务器 `requestId` 创建/确认 `execution_traces` 根记录；若根记录或首条 `request.accepted` 无法写入，本轮不会
启动 Agent，并返回 `execution_trace_persistence_unavailable`。bridge 发出的 content、block、Agent role、Skill、
tool、todo、item lifecycle、result/error 等命名事件按到达顺序追加到 `execution_trace_events`，每条记录包含
`seq/eventType/eventKey/phase/status/payload/createdAt`；序号分配与事件插入使用同一条 PostgreSQL CTE，不能由
进程内计数器或客户端时间代替。事件载荷保留可检查的输入/输出正文，同时按结构化密钥字段脱敏 credential、
token、cookie 与 API key。流式和非流式入口共用同一 recorder，终态再更新根记录的 status、meta、tool calls、
结果或错误。Agent 已经开始后，单条审计写入失败只会写入明确的
`executionEventPersistence={status:"degraded"}` 诊断并记录服务端错误，不得取消、回滚或丢弃已经受理的媒体资产。
持久异步 continuation 以自身 continuation ID 建立子执行实例，并在 meta 中保存 `parentTraceId`；后台 sweep 对每一条 `waiting` 持久行都必须形成明确结果：无法解析为当前 continuation 合同的旧版或损坏载荷会以精确 `task_id + provider + waiting` CAS 收口为 `failed`，保留原始 `data` 供诊断并记录结构化错误，禁止静默过滤后永久留在等待队列，也禁止猜测缺失字段、重放业务动作或迁移成另一条任务。视频依赖按持久 BeatSheet 的结构化 `executionScope` 判断真实后台终点：`media_delivery` 等待生产 run `concatenated`，`prompt_only` 在 `authoring_done` 后立即唤醒 Agent 做最终 Prompt Package 交付验收；失败、取消或 asset repair 仍唤醒 Agent 处理结构化失败事实。禁止把所有视频类 run 都硬等到不存在的 concat 阶段。物理 execution trace 同样由 append-only 终态事件和运行租约对账：`response.completed/execution.failed/execution.cancelled` 已持久化但 trace 投影仍为 `running` 时按结构化终态修复；没有终态事件且超过调用方物理运行窗口的 `running` trace 收口为 `execution_trace_lease_expired`。该 sweep 不触碰 `waiting_async`，也不把物理 trace 超时提升为逻辑任务完成。新建
continuation 同时冻结根 `rootRequestId`，因此物理预算续跑、依赖恢复和重试不会从根对话审计链中丢失。

管理员通过 `GET /admin/agents/diagnostics/executions/:traceId/events` 按 `afterSeq` 分页回放同一执行实例。Web 的
Agent 管理页先从持久 `agent_pipeline_runs` 中筛选 `progress.product="agent_api_video"` 的真实 Agent API job；选中 job 后，
诊断查询按 `id = jobId OR root_trace_id = jobId OR logical_task_id = jobId` 读取同一用户拥有的完整 trace family，依次展示根执行与每个 continuation，并把选中的物理 trace 交给事件检查器。事件检查器按数据库序号展示请求输入、Agent/Skill/tool 生命周期、最终输出和错误原始载荷；
固定七阶段图只用于非 Agent API 诊断的高层交付摘要，不能覆盖或冒充 Agent API 的真实执行链。管理员可以在 job 下切换任一物理执行并实时追尾、筛选或导出对应持久事件；
旧 trace 没有事件时明确显示“旧记录不可回填”，不会从终态文本伪造过程。媒体交付范围的一键成片七阶段仍只表达
生产 DAG，不新增虚假的第八阶段；`prompt_only` 展示独立提示词创作图，不能借用“资产准备/媒体生产/合成”节点
伪造未发生的阶段。运行级日志和 Knowledge 收据作为同一执行实例的检查投影挂在右侧面板。

供应商远程任务日志以 `userId + canonicalVendor + taskId` 表示一次真实供应商尝试；`newapi` 与
`newapi:<channel>` 统一投影为同一个 `newapi` 身份，requested kind 与供应商实际 effective kind 分别保存在脱敏
payload 中，列表主类型使用实际 task result kind。轮询取得 `succeeded/failed` 后必须在不重复结算积分的前提下回写
同一日志终态。管理员分页查询同时用同用户、同供应商、同 taskId 的 `task_results` 终态纠正历史陈旧 `running`，
并把旧内外层别名行折叠成一条事实记录；这是只读事实投影，不删除或改写历史审计原行，也不触发供应商查询或任务重提。

公共对话不得开启本地 bash/resource path、特权工作区访问或自动项目目录授权；命中任一字段返回
`public_agents_local_resource_access_forbidden`。Node bridge dispatcher 初始化与本地 bridge autostart 失败也会暴露
稳定错误码，不再退回默认超时或吞掉启动失败。Node API 启动会对已配置 bridge 做短稳定性复检，避免采用即将随旧 API
退出的 bridge 子进程；已配置的 loopback bridge 不健康时只在原 host/port 拉起，不得改投默认端口，远程 bridge 不健康时
明确失败且不得由本地进程冒充。显式启用 autostart 后若仓库定位、spawn 或健康等待失败，API 不进入 ready。
工作流 `/cancel` 的 Durable Object 内部合同必须携带结构化 `reasonCode + actorType + actorId`：管理员主动取消记录
`user_requested/owner_admin`，余额恢复与模型切换对旧物理执行的围栏分别记录
`provider_balance_recovery/agent_model_cutover + workflow_recovery`。节点取消文案和 append-only `execution_canceled`
事件都由该事实生成，禁止再把内部恢复围栏伪报为“用户取消”；缺少或冲突的取消来源原地失败。
Node API 收到 `SIGINT/SIGTERM` 后先关闭 readiness、工作流 scanner/reconciler/retention 与本地周期 timer，再等待 Nest
关闭；SSE/WebSocket 等长连接最多占用 10 秒排空窗口，超过后记录 `graceful shutdown deadline exceeded` 并以非零状态
强制结束，禁止留下已 draining、无监听端口但仍驻留的幽灵进程干扰下一次恢复。
外部宿主目前只实现 `generationMode="host"`；声明
`managed`/`both` 会返回 `host_generation_mode_not_implemented`，直到真实工具、计费和资产回传合同全部落地。

模型目录中的可选状态只证明该模型可被用户选择，不等于 agents-cli 已掌握其上下文窗口。每个实际发往 provider
的模型标识必须命中带来源的 `model-context-metadata`；未知标识在请求 provider 前显式失败，禁止猜窗口、套用通用
默认值或自动换模型。`gemini-3.1-pro` 当前按 Google 官方模型文档登记 `1,048,576` 输入 token 窗口；
`doubao-seed-2-0-{pro,lite,mini}-260428` 按火山引擎官方 Seed 2.0 计费规格登记 `256,000` 输入 token 窗口；
其它新模型也必须先取得对应的一手规格证据再登记。通过本地上下文校验后，provider 返回的余额不足、配额耗尽或
鉴权错误仍按真实动作失败回灌同一逻辑任务，不得把 catalog 可选、HTTP 受理或另一模型可用冒充本次执行成功。

### 一键成片持久工作流内核（2026-08-10 硬切）

一键成片必须显式冻结 `executionScope`。`media_delivery` 的高层观测合同固定为 `one-click-production/v1` 七阶段：`production-contract -> story-adaptation -> clip-contracts -> asset-preparation -> media-production -> composition -> delivery`；这七个阶段不是可编辑业务调度器。真实领域控制图由持久 `graph:manifest` 定义，并按 clip 动态展开 `clip:* / video-submission:* / video-result:*`，由 authoring/production worker 依据 artifact 状态、effect ledger、lease 与 wake queue 推进。LangGraph checkpoint 只同步七阶段观测游标，不能代替领域 scheduler 或单独宣布完成。`workflowRunId` 固定等于权威 `video_runs.id`；同一 run 按 `video-atomic-workflow@2` 额外投影十五个稳定原子操作 ID，clip 或资产数量只扩展原子节点内部的逐项运行，不改变管理员画布的十五节点骨架。

`prompt_only` 是同一 BeatSheet/clip-writer 协议下的零媒体执行范围，持久图固定为 `beat_sheet -> clip:N writers -> assembly:verification -> prompt:package`。writer 直接依赖 BeatSheet，不创建 asset coverage、estimate、provider submission、video result、concat 或 delivery verify 节点，也不创建/同步七阶段生产 checkpoint。终态必须同时具备 `authoring_done` 与 ready 的 `prompt:package` 工件；status 返回逐 clip 可执行提示词和显式的零副作用证据。`video_runs.state` 不得被投影为 `concatenated`，后台 recovery tick 也不得把 prompt-only run 送进媒体 driver。缺少 `executionScope` 时原地失败，禁止默认进入付费生产；幂等 `loop` 回放的 commit receipt 若没有重复携带 scope，只能从同一 `runId` 的持久 BeatSheet 逐值验真恢复，解析失败仍原地失败，不能默认推断执行范围。

`UserIntentContract.delivery.kind` 描述本轮真正的终态产物，而不是内容所属领域：prompt-only 必须冻结为 `prompt_package`（或能力合同明确声明的等价开放类型），只有真实视频 URL/资产交付才使用 `video`。Prompt Package 属于执行型持久产物，验收证据来自 `artifact`/`persisted_state` 与 writer/reviewer provenance；不得因为 authoring graph 位于视频领域就让 verifier 转而等待视频节点或媒体 URL。

PostgreSQL 仍是唯一业务事实真源。`production_effects` 在外部媒体调用前登记稳定 effect identity、revision、输入哈希和状态；`accepted/uncertain/materialized` provider 证据不可因取消或后处理失败被覆盖、回滚或丢弃。`production_workflow_events` 使用 run 内单调 `seq` 追加事实事件。跨进程 run 驱动互斥只使用 PostgreSQL server-time lease；续约失败会中止当前驱动，不允许 Redis 或进程内锁兜底。BullMQ 只承担持久唤醒、delay、重试与 worker 接管，稳定 job ID 关联同一个 run；队列 job、Redis 状态和 LangGraph checkpoint 都无权单独宣布业务完成。

用户取消 run 时，仅 `reserved` effect 可确认变为 `cancelled`；已经进入 `submitting` 的 effect 变为 `uncertain` 等待事实核对，已经 `accepted/uncertain/materialized` 的任务身份与资产继续展示。取消后的供应商调用边界会再次读取权威 run 状态；若该 provider 已受理但不支持确定性取消，系统保留回执并继续追加 reconciliation 证据，不能伪称供应商动作已经撤销。
effect 取消事务通过 PostgreSQL transaction advisory lock 串行化；该锁语句必须走 execute-only 协议，因为
`pg_advisory_xact_lock` 返回数据库 `void`，不得交给 Prisma query decoder 反序列化。这样 run 已取消后不会因锁结果
解码失败向前端伪报 500，effect ledger 的取消/uncertain/保留证据仍在同一事务内提交。

Writer 子代理从 Hono 到 agents-cli、再到 delegated child 的传输合同携带完整 `workflowContext = { workflowKey, definitionVersion, workflowRunId, workflowNodeId }`；字段缺失会显式拒绝，不猜默认阶段。agent turn 只作为对应固定节点的追加事件，不再成为新的顶层 workflow node。Hono 只传输这个结构身份并持久化事实，不用 tool name、prompt 文案或本地 route 推断阶段语义。

最终交付继续统一使用 `expectedDelivery -> deliveryEvidence -> deliveryVerification`。最终 URL、逐 clip durable URL、媒体探测、确定性叙事合同和技术合同共同构成交付事实；主观创作质量诊断只追加 diagnostics 和修订建议，不得在媒体已经生成后拦截或丢弃资产。任一确定性证据缺失会产生可见 `partial/unsatisfied`，真实 clip 与成片 URL 仍保持 ready 并可交付，但不能因此宣称用户的整章目标已经满足。最终成片的媒体探测属于可补齐的外部事实：缺少 `finalMediaProbe` 时，`delivery:verify` 必须保持 `waiting_external` 并继续驱动，同一成片 URL 不重生成、不覆盖；探测预算按冻结成片时长扩展并限定在 2–15 分钟，避免长片下载被请求级 30 秒截止时间误杀。生产 worker 的认领集合由 run 生命周期与持久 DAG 事实共同构造：即使 run 行已经进入 `concatenated`，只要结构化交付收据仍等待外部证据，就必须重新认领该 run 只补验证。历史上已写成 `ready + partial` 的结构化收据也按同一事实合同重新投影为等待证据，补齐探测后才关闭生产 DAG。

Web 的只读“AI 执行工作流”继续消费后端固定七阶段 definition 和 node projections，承担高层运行概览。可编辑的管理员画布消费正式 `video-atomic-workflow@2` 结构与运行投影：`canvas-source / delivery-contract / beat-sheet-agent / asset-coverage / asset-fan-out / asset-image-generate / clip-fan-out / clip-writer-agent / prompt-package / cost-estimate / production-handoff / video-submit / video-results / concat / delivery-verify` 各自从真实 run、`graph:manifest`、authoring artifacts 和 production effects 构造独立状态、输入/输出 artifact、错误、计数、墙钟时间及逐资产或逐 clip itemRuns，不再用 `workflowProjectionNodeId` 把多个节点压回同一个粗阶段。`asset-fan-out` 与 `asset-image-generate` 只投影持久 `asset:coverage` 的 `required/available/missing` 和真实修复进度；没有持久 HTTP(S) URL 的项保持 waiting，不生成假 artifact。节点检查器按 `workflowRunId + atomicNodeId` 从 video runtime 读取历史；普通工作流仍从 `workflow_node_runs` 读取，两个执行器的记录不得混用。画布触发器冻结不可变 `workflowExecutionScope`：`media_delivery` 使用完整十五节点结构，`prompt_only` 只包含 `canvas-source -> delivery-contract -> beat-sheet-agent -> clip-fan-out -> clip-writer-agent -> prompt-package`。两者的播放都编译为 canonical agents-cli 请求并由同一 video runtime 生产；管理员结构图本身不逐节点执行媒体。逐 Clip 提示词直接来自 `clip:*` payload，供应商提交来自 `video-clip:*` effect，视频结果与最终成片只接受持久 artifact 中的真实 URL；无输出、等待外部结果、损坏 JSON 与显式失败均如实展示。`prompt_only` 图中不存在付费/媒体节点，运行时也禁止补回图外节点或调用 estimate/start/concat。工作流 Agent 的 `json_object` 合同在进入 agents-cli 前经过确定性能力适配：当对象唯一的结构要求是一个顶层数组时，Hono 将复数 `requiredArrayFields:[field]` 转为 agents-cli 的非空 `requiredArrayField:field`；其他对象仍只下发 agents-cli 原生支持的非空字符串约束，完整的 number/object/array/allowedFields 合同继续由 Hono 在端口落库前严格复核，禁止把跨层 schema 方言差异投影成模型失败。工作流投影的统一 `timing` 合同由节点关联的 run/artifact/effect 持久时间构造，包含 `startedAt/updatedAt/finishedAt/durationMs`；未开始节点保持空值，运行中节点由 Web 依据当前观察时刻实时跳秒，终态后冻结。实时 trace 的工具 `started/completed` 事件仍按 `toolCallId` 聚合成一次具名业务调用；局部 schema/action 失败只形成当前节点事实，不能夺取逻辑任务终态。节点事件通过管理员诊断接口按 `beforeSeq` 游标分页读取，异步诊断只聚合 `MAX(seq)` 水位，不把全量事件塞入 React Flow state。

工作流项目是可重复执行的 authoring definition，不是最近一次运行的结果页。进入 `projectKind=ai_workflow` 项目时，Web 从已清除运行字段的 Flow 快照恢复全部节点为待执行，只自动投影仍处于 `queued/running` 的真实执行；已成功、失败或取消的终态不再在页面进入、窗口聚焦或节点历史刷新时重新染回工作流画布，完整记录继续保留在执行历史、节点历史和快照弹窗。当前页面会话新触发的执行仍通过 watcher/SSE 实时显示，并可保持终态直到用户离开；普通内容项目继续维持最近执行回显语义。

持久工作流的图片节点一旦获得供应商 `taskId`，`workflow_node_runs` 中的 `waiting_external` receipt 就成为该任务的权威恢复游标。每次 durable external check 必须先通过统一 `reconcileImageNodesForFlow` 查询并回填画布，再从 fresh flow 快照判定 `success / waiting_external / failed`；不得依赖浏览器轮询或等待整个 flow 的 `updated_at` 进入孤儿 sweep 的静置窗口。这样即使页面持续 autosave、刷新或关闭，已被供应商受理/完成的图片也不会被重复提交、丢失或永久卡在 running；后台 stale-flow sweep 仅保留为没有活跃工作流 owner 时的最终兜底。

普通工作流中的图片/视频逐项生产也遵循同一条已受理媒体合同：一旦持久输出证据含稳定供应商 `taskId`，画布节点在并发回填或服务重启窗口中短暂不可见，只能继续记录为 `waiting_external` 并复用原任务身份，禁止投影为 item failure 或再次付费提交。只有任务身份缺失，或节点/供应商持久事实明确进入 `failed/error`，才允许终止该项；后续恢复检查从原 `workflow_node_runs.output_refs.itemRuns[].evidence` 读取 `canvasNodeId + taskId`。

工作流创建的媒体节点以非空 `workflowExecutionId/workflowEffectId/workflowRuntimeNodeId` 标识持久所有权；它们的供应商轮询、终态回填与 orphan reconciliation 只由 Workflow runtime 执行。Web 的四秒通用媒体轮询器只处理用户手动提交、没有上述工作流身份的图片/视频节点，禁止并发查询同一工作流 taskId 或覆盖 durable runtime 已写入的终态。手动视频任务若失败，Web 必须从嵌套 provider error 中分别保留真实 `errorMessage/errorCode`；持久视频检查同时兼容读取 `errorMessage/clipSubmitError/error/lastError`，不再把供应商的版权、策略或其它确定性拒因压成“newapi 视频任务失败”。该边界只按结构化所有权与供应商回执工作，不读取 prompt，也不触发模型纠偏；所有已成功资产与已受理 taskId 原样保留。

管理员 `tapcanvas_workflow_run` 除普通触发外，可成对提供 `replayFromExecutionId + startFromNodeId`，由工作流内核验证同一 owner/flow、冻结版本拓扑与严格上游祖先输出后，从指定节点建立新执行；缺任一字段均拒绝。重放到图片节点时，执行器只在稳定输出节点的 `prompt / negativePrompt / modelKey / aspect / imageSize / referenceAssetBindings` 与当前请求逐项一致时复用现有 success/running 任务；任何合同差异原地报冲突，禁止覆盖旧媒体或再次提交同一稳定槽位。

“镜头合同”节点同时投影版本化的 `promptAssembly` 来源收据，按真实顺序解释 `UserIntentContract -> generationContract -> filmBible/beat facts -> Writer Skill/本轮实际加载的 reference -> structured shots -> deterministic compiler -> assetObjectContracts`。agents-cli 的 execution provenance 只在 `Skill` 工具成功读取后追加精确来源：`loadedSkillSources` 记录 Skill 主体、section、reference、外部 Skill 与前置 Skill 的 `sourceKind/source/contentHash/contentChars`，reference 同时投影为 `loadedSkillResources={skill,resource,contentHash,contentChars}`。哈希针对真正注入模型上下文的原始内容计算，不对 `<skill-loaded>` 包装或“已加载”回执计算；旧记录缺哈希时 Web 明确标为“部分可追溯”。Hono 基于持久 BeatSheet、authoring artifact 与该 provenance 生成六步收据，Web 只做严格结构解析和展示，禁止从 prompt 正文、文件名关键词或业务文案反推来源。reference 仅在本轮真实读取时标记“已使用”，未读取时显示“本轮未用”，历史记录缺少精确资源证据时显示不可追溯，禁止猜测或补造。来源只允许指向本轮真实 `skills/`、当前代码、项目/Clip 事实、工具输出和资产合同；`docs/`、`assets/`、`ai-metadata/` 不得重新成为运行时知识来源。`promptAssembly@2` 为每个 clip 独立展示完整原文跨度、对白合同、时间层、场景入口、人物状态版本、writer 结构输出、实际 Skill/reference 收据及完整确定性编译提示词与 SHA-256；空的章级对象明确标为未提供，不再伪称“已应用”。界面明确标注该提示词位于供应商 `@图N/@音频N` 绑定之前，不能把它冒充实际 provider-bound 请求；真实资产绑定后的唯一提示词仍以成功视频节点及其 `promptDeliveryContract` 为准。

每次 `/public/agents/chat` 会在 agents dispatch 之前创建正式 `execution_traces`，并先持久化唯一的 `request.accepted`；该首事件失败时请求原地失败，禁止运行一个无法追溯的对话。后续 SSE/bridge 事件按 producer event id 幂等批量追加到 `execution_trace_events`，高频正文以 48 条或 300ms 刷盘，工具、Skill、Agent、结果与终态事件作为 flush barrier 立即落库。事件携带 `logicalTaskId/rootTraceId/parentTraceId/physicalRunId/workflowRunId/workflowNodeId/agentId/toolCallId/effectId/providerTaskId/spanId/attempt`，便于把逻辑任务、物理续跑、七阶段节点、子 Agent、工具和供应商任务串成一棵执行树。trace schema 只允许由部署链创建和扩展：`api-init` 先通过 `schema.sql` 对 runtime-era 已有 journal 表执行纯追加的 `ADD COLUMN IF NOT EXISTS` 修复，并保证补列早于引用新列的索引；随后 Prisma migrations `20260810130000_execution_trace_event_journal` 与 `20260810140000_execution_trace_payload_metadata` 负责数据回填、非空约束和最终结构收紧。schema bootstrap 任一语句失败时日志必须包含语句序号、总数与 SQL 摘要并原地终止；public request 仅做只读 readiness 检查，禁止运行时 DDL。事件正文触发有界脱敏器的字符串、数组、对象键或深度限制时会持久化 `payloadTruncated=true`，诊断页明确显示“已截断”，不能把有界载荷冒充完整原始输入。

管理员诊断页按 1.5 秒增量游标追尾仍在运行的 trace，可暂停、按 class/status/节点/关联 ID 搜索，并基于事件数量、最大序号、唯一入口、终态事件与 `finished_at` 计算结构完整性；`turn.completed` 只是物理 turn 结束，不算逻辑 trace 终态。系统健康汇总直接统计疑似卡住、序号缺口、终态矛盾、断裂父链和持久化降级，不用 prompt 关键词推断状态。单次诊断包导出严格绑定当前用户，最多包含 5000 条已经脱敏的持久事件，并明确写出 `includedEventCount/truncated`；它不会导出 Skill 正文，只包含来源路径和内容哈希。事件存储容量以 `totalEventCount/totalPayloadBytes` 观测，当前不启用自动删除；任何 retention 清理都必须另行确认保留期并通过显式迁移或运维任务执行。

多段视频的最终合成是可能持续数分钟的同步 media-worker 调用。生产状态机必须在调用 media-worker 前确认全部 clip 已有真实持久 URL，然后依次推进为 `concatenating`、把 `clipsDone` 写为 `totalClips`、创建 `concat:auto` 的 `running` artifact、同步 LangGraph checkpoint 并广播 run status；以上任一步失败都禁止启动外部合成。media-worker 使用版本化合成合同（用户、按序 clip URL/截取范围/转场、比例、xfade 与颜色匹配）计算 SHA-256 内容地址 OSS key；重启或调用方丢失回执时先对该精确 key 执行 HEAD，对象已存在则返回同一持久 URL，不再次运行 ffmpeg 或上传。合成完成后才把 `concat:auto` 与 run 推进为 `ready/concatenated`。因此合成等待窗口稳定显示“合成 12/12”及 composition 阶段墙钟耗时，不再把 media-worker 耗时错误记到资产准备或媒体生产，也不以预测值伪造进度。

普通持久工作流的 `video.concat/v1` 在拿到最终 master URL 后，还必须通过统一的 delivery projection 在同一项目/章节作用域幂等写入 `film-<executionId>` `composeVideo` 节点，并按 `clipIndex` 建立片段到母片的溯源边；执行状态成功但画布缺少母片不再被视为完整可见交付。该投影只写入已经生成的真实媒体结果，不重新提交供应商任务；若服务重启或恢复重放，使用同一 executionId 更新原节点，不创建重复母片。

画布按钮、节点操作和 Skill 启动等机器编译入口必须同时提交两种不同职责的文本：`prompt` 是给 agents-cli 的完整执行合同，`displayPrompt` 是用户可理解的简短动作摘要。Web 聊天气泡、持久会话广播、标题与 `/chat/status` 的 `requestText` 只投影 `displayPrompt`；完整 `prompt` 仍进入 agents 执行和受保护诊断证据，禁止为了界面简洁而截断执行合同，也禁止按正文关键词决定是否隐藏。Canvas SSE 的普通用户/助手消息必须携带与 live、history、recovery 共用的稳定 public `turnId`，Web 先把它绑定为同一对稳定消息 ID 再合并；缺 `turnId` 的普通投影直接拒绝，禁止作为第三条消息追加。唯一允许无 `turnId` 的聊天投影是持有结构化 `pendingUserInput.requestId` 的后台真人确认卡，其身份由该 request ID 保证；广播时间统一格式化为本地短时间，不直接展示 ISO 原文。所有聊天任务清单（包括一键成片）只展示 agents-cli 通过结构化 `todo_list` 事件或同源正文 Todo 块声明的计划；结构化事件存在时拥有优先级，`workflowKey`、npm workflow definition、`VideoRunState`、`VideoAuthoringState` 和前端枚举均不得合成、替换或补齐 AI Todo。没有 AI Todo 但已进入工具执行时，结构层只展示统一“动作执行”阶段并从首次工具开始连续计时，两个工具调用之间的模型思考间隙不冻结阶段计时。工具回执仅是动作级证据：`failed/denied/blocked` 且整轮仍活跃时，顶层进度必须说明正在确认后续处理，不得把工具失败冒充聊天终态；一旦收到结构化 `agent_continuation`，Web 必须替换过期的失败摘要并明确投影“正在调整并继续处理”，失败回执仍作为独立事实保留在运行诊断中，通用的中间失败延迟投影策略可以在同链自修复期间暂不把它展开到紧凑聊天卡。只有 `result/error/done`、durable `/chat/status` 或用户 interrupt 形成的根回合终态才能停止 Loader 并移除停止按钮。一键成片的七阶段业务状态继续由独立生产进度卡和执行诊断投影，当前阶段耗时优先读取 run 的持久 `updatedAt` 作为本次 durable 阶段观察起点并连续跳秒；它不再进入聊天任务清单，也不再冒充 agents 的计划。管理员工作流图仍以 node projection 的持久 `timing` 为准。单次工具耗时默认折叠为次级诊断，阶段失败时才默认展开相关工具证据。

聊天生产进度同时区分逻辑任务、物理执行窗口与业务阶段：`asset_repair_required` 明确显示“等待补齐前置视觉资产”，并投影为 paused/waiting，而不是继续显示 `0/N 段提示词已冻结` 或用 Loader 暗示当前已有生图任务在运行；只有 durable active turn、真实后台 agent 或仍由父任务负责的异步 artifact 等证据才能恢复 active。带 `completionBoundary="submission"` 的画布图片 receipt 会保留在交付 trace 中，但不会登记进聊天侧 `asyncArtifacts`；父任务完成后不再展示“后台素材正在生成”或继续轮询，图片节点自身负责显示和回填后续状态。该等待卡保留基于 run 持久时间的阶段耗时，便于识别长时间没有新增证据的孤立 DAG 节点。没有 durable active turn、后台 agent 或异步 artifact 活跃证据时，物理 run 的 `suspended/failed/cancelled/needs_input/succeeded` 都必须覆盖仍处于 collecting 的业务卡，分别显示挂起、失败、取消、等待输入或“执行已结束但生产未完成”，并停止 Loader。异步素材进度还服从单调终态：同一 `assetType + nodeId` 的 `deliveryEvidence.materialized`，以及权威画布 hydration 后节点上的真实 `imageUrl/videoUrl/audioUrl` 或结果数组 URL，都会把该 artifact 收口为 `succeeded`；迟到的 `accepted_async`、`queued` 或 `running` 投影不得把它回退为生成中。`root_physical_execution_budget_exhausted` 只表示当前物理窗口结束并正在切换同一逻辑任务的续跑窗口，不能写成“已提交异步交付”；只有存在真实 accepted/scheduled/taskId 等交付证据时才可声明异步提交。进程退出或传输断开可能留下 inactive `unknown/failed` 物理 checkpoint；同模型 provider 响应流在有界内部恢复耗尽后会留下 `suspended/provider_stream_interrupted` checkpoint，此时用户文案明确说明“模型响应流已中断、持久进度已保存、正在续跑”，不得冒充外部异步交付等待。agents bridge 若在 `accepted/agent_running/completion_verifying` 阶段重启，且持久 root ledger 仍有 physical run，则 status 会把这个事实投影为 `unknown/provider_stream_interrupted` 并从最新持久工具回执与 runtime ledger 构造恢复检查点；不能继续暴露 `unknown/initial_execution` 却不给续跑器可认领合同。两种可恢复 suspension 都从 agents-cli root ledger 导出同一结构化恢复检查点 `{reasonCode, physicalRunId, progressRevision, durableTaskReferences, durableProgressClaims}`；预算挂起还要求独立 suspension 证据逐值一致，provider 流中断则直接以该检查点重建缺失的 continuation。continuation prompt 会把有序 receipt journal 编译为唯一 `authoritativeProgressFrontier`：同一 tool/run/task/graph 保留 `completedUnitIds` 单调最强的 cursor，新 run/task 身份才按新收据切换；agent 与工具 fence 都只能推进其 `requiredReadActions/allowedNextActions`，不能从历史收据中另选旧前沿或创建平行业务 run。已分类的 `agents_bridge_stream_interrupted` 会按持久 retry 计划继续同一 session、同一模型与同一 cursor，未分类网络错误仍显式失败。Web 对这三类未完成状态都只用同一次 status 返回的 `sessionKey + turnId` 请求 resume，Hono 仅 CAS 认领同用户、同 session、同 public turn、仍在上限内且带失败证据的持久 physical continuation，不接受 prompt/runId/cursor，也不创建新业务 run；显式 orphan resume 在同一 session/root 下始终优先认领 `createdAt` 最新的持久 continuation，stage 只用于创建时间相同时的确定性排序。语义依赖变化或恢复检查点可能合法地建立更新但 stage 重新开始的分支，旧分支即使 stage 更大也不得被复活并与新 owner 抢同一会话。即使数据库里已经存在可认领 continuation，调度前也必须把同一次 agents status 的最新 `durableTaskReferences/durableProgressClaims` 合入本窗口对象，防止复用旧 payload 导致 frontier 回退与重复读取。continuation 继续冻结原始模型，禁止借恢复切换供应商或模型。后台以相同 public turn id 启动续跑后，`/chat/status` 的 `activeTurn=true` 必须把前端同一 request 从旧终态重新投影为 `running`，清除旧 finishedAt，而不是让旧窗口快照遮住新窗口。恢复同一 turn 时只补建缺失的进度气泡；如果会话中已经存在正文完全一致的用户请求，不重复插入第二条用户消息。这里的精确正文相等只用于 UI 去重，不参与意图识别或任务路由。
恢复检查点还携带 `userIntentContract`。该合同只能由 agents-cli 从当前用户回合内成对且成功的 `record_user_intent` 工具回执恢复，并在 Hono 认领旧 continuation 后以 hash 校验通过的机器合同合入、持久化再调度；旧 continuation 已有合同与检查点合同不一致时原地失败，禁止从自然语言重推、忽略或覆盖。失败的物理 continuation 保留原始失败码作为检查点原因；它只允许补全并认领数据库里已经存在且可重试的失败回执，不进入缺失 continuation 重建路径，也不伪装成 provider 流中断。

依赖型 durable continuation 的 ready 判定同时读取精确画布节点和持久 `dependencyTaskIds`，不能再把“节点不存在”默认解释为“仍在生成”。真实 task 仍为 `queued/waiting/claimed/running` 时才保持等待；task 已成功而目标节点仍存在时允许一次结果对账，目标节点已被删除则关闭旧 continuation，禁止擅自重建用户删除的节点；task 已失败、取消或不存在时同样形成终止证据。缺失或作用域不一致的依赖 run 也属于终止事实，不得每个 tick 反复加载画布。这样 sweep 只保留有真实 active owner 的等待项，并用 waiting-state CAS 保证并发回收最多发生一次。

多副本 agents bridge 的在飞 session 采用显式进程亲和协议：Hono 根据规范化后的 `effectiveUserId + sessionKey` 计算版本化 SHA-256 摘要，并在首轮 chat、steering/follow-up queue、status、interrupt 与 continuation 的内部请求上统一携带 `x-tapcanvas-agent-session-affinity`；摘要只用于路由，不暴露原始用户或 session 标识，也不替代 PostgreSQL checkpoint。agents-bridge LB 使用 HAProxy `server-template` 把 Docker DNS 返回的每个副本地址物化为独立 hash peer，再按该摘要做 consistent hash；缺少 session header 的无状态请求使用 HAProxy 默认分配。同一 session 因此持续命中持有 `activeChatSessions` 的真实副本，另一个副本不能再因本地 Map 缺项把正常执行误投影为 `provider_stream_interrupted`。LB access log 只捕获 opaque affinity 摘要、实际 backend peer、HTTP 状态与传输耗时，不记录 prompt、鉴权、用户或 session 明文；运维可据此验证同一 session 的状态请求是否稳定绑定。`POST /chat` 不允许由代理跨上游自动重放；选中副本不可达时请求显式失败，再由持久 checkpoint 与既有 continuation 合同恢复同一逻辑任务，禁止重复物理执行或重复媒体副作用。

物理预算 suspension 现在通过 status 显式投影 `physicalRunId/progressRevision/progressSinceRunStart/budgetKind/observed/limit`。Web 只有在 `requestTerminal.reason=async_execution_suspended_until_delivery_verified` 时才显示“后台任务已受理”；普通物理预算挂起不会再冒充已受理媒体任务。浏览器 SSE 是可丢失的展示通道，不是 durable run 的完成条件：Hono 对每次浏览器 `writeSSE` 使用固定短期限，关闭或背压的 consumer 超时后只停止该连接的后续事件转发，仍继续消费 agents bridge、追加 execution trace、持久化最终结果并登记 continuation。

Hono → agents-cli 的首包关键路径采用并发事实装配：所选 Skill 引用、flow 归属、用户生成偏好与 chapter-book scope 互不依赖，统一并发读取后再做确定性范围校验；依赖 chapter scope 的 book resolution 仍严格后置。该并发只改变等待拓扑，不缓存请求级用户事实、不改变失败语义，也不跳过权限、schema、计费或交付验证。每次 bridge 调度输出 `message=agents_bridge_performance` 的结构化 JSON 日志，包含 `requestId`、`preludeMs` 与 `dispatchReadyMs`，用于对比 Hono prelude 与 agents-cli 自身 `performanceSnapshot`，禁止用伪造阶段或静态估值替代真实耗时。

显式 resume 在持久 checkpoint 证明会话仍未完成时，可优先重新认领同一 session 已持久化但因旧物理窗口失败的 continuation，并把当前 `durableProgressClaims` 合并进 frontier；这仍是原逻辑任务，不创建新业务请求。claims 中的精确 `toolCallId` 可跨物理窗口参与 agents-cli 通用交付验收，工具名、状态文案和模型自述均不能替代成功收据。

所有 AI 请求统一进入 agents-cli 的 `LogicalTaskGraphV2`。Hono 只传递稳定身份与一手事实：显式 `logicalTaskId` 优先，否则由 agents-cli 复用 `publicTurnId` / `clientPendingId`；同一请求的物理续窗、异步 continuation、用户回答与委派节点必须保持该身份。Hono 不创建平行 task graph，不把 HTTP/LLM run 结束、非空正文、子代理 completed、wait 返回或“曾写画布”解释为用户任务完成。旧 `pending/completed/blocked` 任务双轨已退出 agents-cli 运行时。

LogicalTaskGraphV2 的节点快照、append-only 事件与 transactional outbox 由 agents-cli 在同一 SQLite 事务提交。每次 worker claim 都获得新的 lease fencing token，running 节点写回、续租和物理 run 收口必须持有当前 token；旧 run、过期 worker 或并发第二个 root run 不能复用 owner 名义写回。root runtime 在启动 heartbeat 前先安装同一份不可枚举 lease binding，初始 lease 默认 15 分钟且每分钟续租，确保 5 分钟物理预算边界上的在途 provider 响应和收口仍持有原 token。completion signal 只在 AgentSessionEngine 产生时写一次，外层 runtime 不重复应用；避免第一遍合法落库后第二遍恰逢 lease 过期而把整个 `/chat` 变成 500。已绑定 delegated task 的子代理同样自动 heartbeat；子代理 token 只驻留当前 agents-cli 进程内存，不进入持久 agent 状态、事件或 outbox。异常中断或没有结构化 completion signal 时进入同一逻辑任务的 `repair_required`，已成功副作用仍保留。物理续跑 checkpoint 除异步 `durableTaskReferences` 外，还携带 agents-cli root ledger 投影的 bounded `durableProgressClaims`（稳定 key/fingerprint、精确 toolCallId、revision、observedAt），用于证明没有 runId/taskId 的同步持久动作 frontier；Hono 只校验并透传这组事实，不据工具名推断业务语义。Hono 不接管 lease、不从 HTTP 连接状态猜任务终态，也不另建 retry/outbox 双轨；需要向外发布的任务事件由 agents-cli outbox 消费者按自己的发布租约显式 ack/retry。

SSE 具名协议显式包含 `status-update` 与 `artifact-update`：前者只传递模型轮次、续跑阶段和真实截止时间，后者只传递已产生的结构化 artifact 增量。agents bridge 与 Web 必须使用同一字段合同解析和记录这两类事件；合法事件不得被包装为 `agents_chat_stream_payload_invalid`，未知事件或字段漂移仍须显式失败。它们只用于过程可观测性，不构成交付完成证据，也不允许推测业务阶段或完成比例。

唯一交付链是 `UserIntentContract(expectedDelivery) -> decisionBasis -> deliveryEvidence -> deliveryVerification@2 -> LogicalTaskGraphV2 -> requestTerminal`。每个 root（包括纯文本和只读查询）先捕获 intent，再提交 `report_delivery`；`must/forbid/prefer` 只允许 `source=user` 的明确用户要求，项目、画布、资产与 agent 观察只能作为 `confirmedFacts`，执行步骤、重试建议和 DAG 动作不得被持久化成用户 must。`referenceResolution` 除新任务与已交付产物引用外，提供字段封闭的 `continuation` 模式：它只表示用户继续同一个尚未交付的目标，不需要、也禁止把 physical run、execution 或 async continuation ID 冒充 actionable delivery reference；原有 `selected_exact/derived/needs_user_choice` 仍只接受当前 `actionable_delivery_references` 中的真实引用。`decisionBasis` 由 agents-cli 在收口时语义自分类为 `factual_only` 或 `professional_method`：仅复述、核对或转换确认事实才可使用前者；任何新增的专业建议、设计选择、创作判断、技术策略或方法框架，即使不执行一键成片、不写画布，也必须使用后者。专业只读交付可由当前原始请求召回并真实加载匹配 Skill；runtime 从 `executionProvenance.loadedSkillSources/loadedKnowledgeSources` 自动绑定精确来源，缺 Skill 来源时记录 `method_evidence_missing(blocking=false)`，禁止伪称已引用，但不得否决当前报告或终止用户任务。Skill frontmatter 的 `decision-basis-role=evidence_only` 会随每次 hash-addressed 正文读取写入 provenance；来源覆盖、协议和审计类 Skill 只证明其真实读取范围；是否还要补读方法型 Skill 由 agent 依据当前任务决定，缺失仅作为诊断。正向知识卡只有会实质影响结论时才由 agent 选择读取，不建立固定 `Skill -> knowledge_search -> knowledge_read` 套餐。该依据合同不阻断、回滚或丢弃已经受理/生成的媒体；任何交付的方法来源缺失都只追加 `method_evidence_missing(blocking=false)` 诊断，不得把 Skill receipt 变成图片、视频、分镜、提示词或叙事生产的运行时权限闸门。Hono 不根据 prompt、关键词或 route 判定专业性，也不选择 Skill/知识卡。

若 durable cursor 在当前状态只声明一个 `allowedNextAction`（或一个尚未满足的 `requiredReadAction`），catalog 的结构化拒绝必须附带同一逻辑工具、同一 revision 与该唯一 selector 的 `recovery` 合同。agents-cli 将其作为有界同链自修复，而不是开放式重新规划；模型仍负责依照精确 schema 构造该节点的业务字段，本地只冻结确定性的工具/selector 身份，不生成或改写创作语义。唯一 frontier 以逻辑工具名投影到 provider，但执行仍穿过统一 catalog wrapper；模型若因持久历史直接发出 wrapper，只有其精确内部逻辑工具名也在本回合能力面时才允许执行，未暴露的隐藏目标继续原地拒绝。cursor 有多个合法分支时不得生成 recovery，继续由 agents 做语义选择。

通过 verifier 的终态回复还必须由 `report_delivery.followUp` 自分类为 `none` 或 `actionable`。可继续生成、修订或执行的提示词、方案、脚本、规格与资产会由 agents-cli 写成不可变 `ActionableDeliveryReference`，在 `agent_sessions.meta` 中持久化精确正文、正文哈希、公开 turn ID 与开放的 `executionTarget={kind,output,durationSeconds?,clipCount?,aspect?,resolution?}`；Hono 只持久化和透传该事实，不解析回复正文。下一轮 `record_user_intent.referenceResolution` 必须声明 `new_task`、`selected_exact`、`derived` 或 `needs_user_choice`，provider-facing schema 与 runtime normalizer 共用同一判别式合同：`new_task` 只允许 `mode`，`selected_exact/derived` 只允许 `mode + referenceId`，`needs_user_choice` 只允许 `mode + candidateReferenceIds`；结构错误必须指出精确非法路径，不能先向模型暴露宽松字段组合、再由运行时用另一套规则拒绝。意图条目的内部 ID 不属于模型语义输入：provider-facing 的 `must/forbid/prefer/confirmedFacts` 不暴露 `id`，前三类也不暴露固定的 `source=user`；agents-cli runtime 按类别和 statement 指纹生成互不冲突的稳定 ID 后再冻结合同。Hono 只接收并透传冻结后的完整合同，禁止另行生成、修复或兼容旧的模型自报 ID。`selected_exact` 的执行规格必须与引用逐字段相等，例如一个 25 秒、1 clip、内部含多个子镜的提示词不能被旧画布规划扩大为 180 秒、7 clips；只有用户本轮明确修改规格时才可使用 `derived`。agent 通过只读 `read_delivery_reference` 按稳定 ID 取回精确正文，不从历史摘要重构；多个引用都可能成立且当前事实无法消歧时，必须调用 `request_user_input` 展示候选并等待结构化选择，未选择前 agents-cli 的通用 ask-before-spend 边界禁止任何付费媒体提交。失败、局部报告、物理预算挂起与仅等待异步证据的回复不会注册新的 actionable 引用，避免把未交付过程误当成下一轮可执行对象。该机制不使用关键词、正则、画布旧计划或默认 workflow 做语义兜底。

只读专业正文跨物理窗口续跑时，宿主冻结的目标、输出和成功标准必须原样复用；`deliveryContract` 由 runtime 自动绑定，只有执行型交付才要求模型携带真实执行证据。报告纠偏只在“相同 settled 证据、相同失败指纹”重复时限流；报告暂时隐藏期间仍保留当前授权的只读证据工具，新增 Skill、Knowledge 或事实证据会自动恢复收口能力。

终态正文的权威来源按结构确定：先前无工具回合已经生成、仅因缺少交付 envelope 而暂存的完整正文优先；否则必须使用已通过 verifier 的 `report_delivery.finalResponse`。与 `report_delivery` 同一模型响应携带的普通文本属于未结算工具前言，不能覆盖 verified finalResponse，也不能被写入 recent conversation 冒充成功答案。Hono/Web 不按文案关键词猜测哪段更像结论。

非空 restricted root 工具面必须始终保留 `record_user_intent`、`report_delivery`、`read_delivery_reference`、`skill_search` 与 `Skill` 协议工具；Skill 工具只读取方法来源，不扩大本轮业务授权。真实 mutation / paid generation 在合同冻结前不得开始。`record_user_intent` 是本地协议状态变更，不是外部业务副作用；intent revision 推进会重新开放此前因缺少合同而被抑制的 `report_delivery`，但不会重放已经成功的业务动作。首次捕获不完整时只允许 agents-cli 在同一物理链、尚无交付证据且尚无成功外部执行时修订，失败的结构 preflight 不会把残缺合同永久冻结。首个成功 external mutation/paid generation 或物理 continuation 会关闭修订窗口，后续合同哈希不可迁移。runtime 绑定精确正文 SHA，并核对成功 tool call、artifact/asset URL、持久状态与 requirement 引用；`tool_call.sourceRef` 必须是本轮已 settled 成功的精确 `toolCallId`，evidence `attributes` 只允许最多 32 项 string/finite number/boolean/null 扁平事实，集合与复合状态用 count/hash/assetId 等确定性字段表达，禁止数组和嵌套对象。正向 `must` 必须有有效事实证据，负向 `forbid` 使用 agents 输出的结构化 `avoided/conflict/unresolved` 语义结论，`avoided` 不强求不存在事件的正向证据，`conflict/unresolved` 仍阻止收口。执行型任务不能只用正文证明完成。`deliveryContract.kind` 是开放的 capability schema id，媒体、分镜、剧本等 scope 由对应 Skill/工具合同表达，核心 verifier 不按 prompt、关键词、workflow 名、节点数量或质量分数写 case patch。Hono 只传输合同、trace 与事实证据，并继续执行权限、schema、计费幂等、真实资产 URL 和供应商硬上限。

长剧本、多章节、多文件与视频时间轴的跨阶段追溯由 agents-cli `SourceLineageV1` 持久化，不由 Hono 维护第二套语义分类器。结构层级固定为 `collection/phase/unit/artifact`，业务 `categoryId` 使用 Skill 自己声明的开放 taxonomy，重要度为 `required/supporting/optional`；Hono 不按这些 category 做 route。SourceLineage 的 complete/partial/unverifiable 只投影为 supporting persisted-state evidence，固定不能独立满足媒体交付 requirement；视频/图片/画布完成仍要由 settled tool、真实资产 URL、节点或权威持久执行状态证明。所有谱系 revision 都保留为追溯与同链修订事实，不能回滚、覆盖或丢弃已生成/已受理资产。相关本地工具由已加载 Skill 的 `runtime-tools` 声明按需开放，简单对话不常驻这组 schema。

生产工具若能提供来源追溯，应在成功的结构化结果根级返回 `sourceLineageReceipt@tapcanvas-source-lineage-receipt/v1`；agents-cli 会在真实 tool success 之后自动投影 revision，并使用稳定 `receiptId` 幂等去重。Hono 只透传该版本化事实合同，不代替工具按 URL、工具名、prompt 或业务关键词生成分类，也不通过缺失回执否决已经成功的媒体动作。回执无效会成为 agents-cli 持久 diagnostic 和同链修复事实，原工具产物、日志、节点结果与资产 URL 必须继续保留。工具未声明该字段时 agents-cli 不做语义猜测，仍可由已选 Source Coverage Skill 显式调用 lineage 工具补录。

任务状态只由 agents-cli 的终态裁决器投影：verified delivery 才是 `satisfied/succeeded`；供应商已受理但资产尚未物化是 `waiting_for_evidence/suspended`；真正缺少不可推导事实或授权是 `needs_input`；局部动作或 verifier 不通过是同链 `repair_required`；所有已授权安全路径耗尽后才是 `failed`。`request_user_input` 不再生成伪成功信号，回答必须以结构化 `requestUserInputResponse` 回填同一 `logicalTaskId` 后才能重新 claim。Hono 不维护第二套 completion gate，也不通过本地 prompt 补丁修正 agents-cli 的交付偏差。

agents-cli 的只读预算只关闭连续、开放式的探索，不关闭后续确定性动作失败所证明必需的一手事实读取。真实动作被拒绝后会开启新的有界修复阶段：仍禁止重复已成功读取或改写参数绕过预算，但允许调用当前授权面中直接提供缺失字段的只读工具一次，再立即重构原动作。非终态参数错误、普通 blocked/failed 调用或仍有重规划预算的动作，不能作为 `report_delivery.mustStop=true` 的任务终止证据；只有工具明确关闭该动作，或 runtime 已耗尽该动作的结构化自修复/重规划预算后，才允许进入“所有安全路径是否耗尽”的终态裁决。系统本可读取的章节、画布、资产或工具事实不得被包装成用户输入 blocker。

独立旁白与音乐不再暴露 `tapcanvas_audio_generate_to_canvas` 代理专用直生成入口。agents 通过唯一的 `tapcanvas_flow_patch` 写入 `kind=audio + prompt/text + audioType + enabledAudioModels 中的精确 audioModel`；成功画布 mutation 的 trace 把该节点标记为 executable，Web 复用与手动点击“生成”完全相同的 `CanvasService.runNode -> DAG -> runNodeAudio` 执行器。即使代理的最终 completion claim 失败，只要已存在成功 flow-patch 的 executable node evidence，前端仍可继续这项已持久、可结构校验的安全动作；没有该 evidence、缺正文、缺精确模型、节点已 running/success 或已有真实 `audioUrl` 时都不会提交。该规则同样由通用节点 readiness 与执行 trace 驱动，不解析用户文案，也不把 mere node creation 冒充供应商受理或资产交付。

异步执行一旦产生带稳定 `nodeId/taskId/runId` 的结构化受理证据，agents-cli 默认把当前物理回合收口为 `waiting_for_evidence`，并保留 `requiresExecutionDelivery=true` 的执行交付合同。后续正文不能把同一逻辑任务降级成非执行文本交付；runtime 回灌真实受理证据并禁止重放业务动作。唯一例外是工具在完成父任务授权范围后显式返回 `completionBoundary="submission"`：此时同一回执成为 persisted-state 终态证据，父任务成功结束，子节点继续独立物化。异步证据身份由规范化的 `toolName/kind/state/nodeId/taskId/runId/clipIndex/completionBoundary` 与最强 durable source 计算，不使用物理窗口内的数组序号；同一 durable 状态即使由新的 tool call 重放也生成逐字段相同的证据并幂等去重，状态、任务、clip 或边界发生真实变化则生成新的 evidenceId 追加到 journal，绝不覆盖旧证据或放宽 append-only 约束。`tapcanvas_image_generate_to_canvas` 的单图与批量入口统一拒绝 `waitForResult:true`：供应商一旦返回 queued/running 和 taskId，Hono 必须先把同一 taskId 写入 running 节点再响应，由画布 SSE/reconcile 收取结果，禁止在持久化回执前进行分钟级 HTTP 轮询。图片与视频 reconcile 共用单一的供应商错误提取协议；上游终态失败时，图片节点必须保存有界的 `error/errorMessage/providerStatus`，并在 `details[].errorMessage` 返回相同诊断，禁止只留下无法行动的 `failed`。装备 Workflow IR 的 execution receipt 与代理直接受理的图片生成使用同一个通用异步证据投影，但只有后者当前声明提交即父任务完成；浏览器节点执行器随后受理的音频任务以画布节点状态、taskId 与 `audioUrl` 进入同一事实验收层，不由已退役的代理音频工具伪造受理证据。

同一冻结 run 的幂等 `loop` 回放也必须唤醒一次受 run-drive lease 保护的 graph drive；幂等只禁止重写 DAG、重派 writer 和重复供应商提交，不能退化成“返回 accepted 但不入队”。真实 `/public/agents/tools/execute` 的 existing-run 快路径必须先进入统一 async acceptance，禁止提前返回旧 receipt 绕过唤醒。处于 `asset_repair_required` 的权威 run cursor 会把任何旧 graph action 结构化协调为 `wait_asset_repair`，禁止因 graph artifact 仍投影为 pending/stale 而静默 yield；随后 fresh-read 当前画布并重算 clip-bound coverage：仍缺资产就保持等待，真实资产已补齐或旧 coverage 因合同升级失效时则 CAS 回到 `beats_committed/script_approved` 继续。所有恢复依据都是持久节点状态、真实 URL、结构化身份与 clip 绑定，不读取错误文案或提示词语义。

公开作品的“查看制作过程”以完整源项目为读取边界。`GET /projects/:id/flows` 在项目公开时返回项目根画布
与按目录顺序排列的全部章节画布；`GET /projects/:id/conversation` 返回该项目命名空间下的项目级与章节级
真实会话。Web 复用正式画布工作区展示这些事实，只关闭编辑、生成和发送能力，不再把章节来源作品缩窄成
单章分享页，也不把空的项目根画布当作完整制作过程。

原创视频请求在用户已明确交付范围时，不再把角色、场景、道具或动作方向升级为用户选择闸门。
章节“一键成片”通过 `film_spec.adaptationMode` 显式选择改编方式，不再接收 `freeAdaptation`：`faithful`
把原文影视化并按供应商合法时长压缩；`creative` 把原文作为创作底稿，在核心人物关系、世界规则、主线因果与关键结果不偏离的前提下，允许 agents-cli 同链新增人物行动、桥段、对白、冲突、反转、视觉包装与商业化表达，同时保留原文台账和新增内容的来源锚点。两种模式都不得省略理解主线所需的身份、背景、动机与结果，也不覆盖已生成资产。
agents-cli 负责自主完成创作规划：先形成 BeatSheet 章级头和逐 beat 节点，调用
`preflight_begin -> preflight_patch_header* -> preflight_put_beat -> preflight_commit` 持久化汇编并冻结结构合同。`preflight_begin` 只接收事实身份、冻结模型、交付范围和预计 beat 数。章节作用域把当前章节原文冻结为 source authority；公开画布聊天把 Hono 已在 `request.accepted` 中持久化的原始用户 `prompt` 冻结为 `public_chat_turn` authority，稳定 `publicTurnId` 只由 bridge 的可信远程工具信封传递，不进入模型可编辑 args，因此空画布上的自然语言视频请求无需先伪造文本节点；受信 Agent API 则继续冻结持久 job prompt。只有不具备上述三种可信来源的非聊天 standalone 调用才必须额外提交当前授权画布中一个已存在、`kind=text` 且 `content` 非空的 `sourceNodeId`。服务端保存来源身份、逐字文本和 SHA-256 指纹，后续 draft 与 loop 只读这份 durable 快照；缺失 accepted snapshot、空原话、缺节点、越权、作用域冲突或同 run 切换来源都显式失败，不根据节点标签、位置、连线或模型转述猜测来源。拿到 source unit 目录后，agent 可用一次 revision-fenced `preflight_patch_header` 同时写入 `sourceCoveragePlan`、`meta.aspect/resolution` 与所有已经形成的可选创作 section。只有原文覆盖和可执行画幅/分辨率阻止 beat 提交；`filmBible/adaptationStrategy/castManifest/editingStyle/filmGenre/language` 缺失只进入诊断，不构成媒体生产闸门。随后再依据同一合同建立资产 DAG、补齐对应角色卡、场景卡和其它视觉前置，
最后通过 revision-fenced `preflight_patch_header` 或 `preflight_patch_beat` 只替换引用发生变化的顶层字段、再次 commit，并携带最新 preflight 证据调用公开 `loop`；`loop` 必须只携带
`beatSheetRef:"preflight"`，由服务端按同一 runId 读取 Redis 中已冻结的完整合同，避免再次把 BeatSheet
全文传给模型和上游；
禁止缺少真实身份资产时派 writer 或启动视频。若提交后仍发现前置资产缺口，authoring 状态进入
`asset_repair_required`，由同一 agents-cli 链消费 `assetRepair`、生成并回收真实图片，再通过
`repair_assets` 回填同一 run 继续，不重新提交 BeatSheet。补资产不是全有或全无批次：任一 binding 通过
稳定 ID、权限、结构身份与真实 URL 验真后，Hono 立即把它 CAS 写入同一冻结 BeatSheet/plan，并在画布状态
节点持久化递增 revision、累计 resolvedBindings 和缩减后的 requiredAssets。后续物理 run 只消费剩余 frontier；
最后一项闭合时才由确定性 join 恢复 writer/estimate/start，已完成项不会因上下文压缩或执行窗口结束丢失。
bridge 仅在 `assetRepairResolved:true` 时调用 authoring continuation 或 `start`；
`asset_repair_progress_saved` 只持久化缩减后的 frontier 并立即返回，不得把局部 `ok:true` 误当成 join 完成。
`request_user_input` 仅用于不可从真实上下文
推导的用户事实、范围、权限或不可逆授权。BeatSheet authoring schema 已硬切为最小可执行合同：每个 beat
只要求 `clipIndex/logline/sceneName/durationBudget/dialogueScript/videoReferenceNodeIds/continuityMode/assetObjectContracts`。
`sceneName` 是唯一需要单列的对象选择器：它必须命中一个 `kind=scene` 对象；单场景时 runtime 可确定性投影，
多场景回忆/转场时由 agents 显式选主场景，避免内部 validator 要求公开 schema 没有暴露的字段。
`startKeyframe/endKeyframe/exitState/storyFactLocks` 可按需要提供；节奏角色、弧线、戏剧变化、观众体验、
payoff、情绪、pacing 与 film bible 留在 agents-cli 的创作过程和最终 writer 输入，不进入 operation schema，
也不会因为缺字段、枚举偏差或信息密度不足阻断 preflight、资产生成、视频提交或交付。章节忠实度由
runtime canonical `sourceCoveragePlan + speechLedger + spans` 验真，不再要求模型用另一套创作字段重复证明。
其中 source span 只执行非空、地址连续、数量可覆盖与原文逐字命中的结构校验；不再用每拍/每段最低字符数、
生产层级、节奏标签、prompt 后缀或其它本地语义启发式充当运行时质量闸门。Hono 继续验真 schema、真实资产 URL、
供应商帧数/时长硬上限与权限边界，创作密度和专业判断由 agents-cli 在同一执行链内生成、自检和修订。
后补资产与旧资产换版统一走结构化引用修复：driver fresh-read 当前画布后，仅以 BeatSheet 已冻结的
`assetObjectContracts.kind/name` 匹配同时具有 durable image URL 的当前节点。旧 nodeId 已删除，或节点仍存在但
其结构化身份已经不再等于冻结的 `kind/name` 时，都必须改绑到唯一的当前同身份节点；不能把“ID 仍存在”误当成
“资产身份仍有效”。
若唯一同身份节点不存在或存在多个候选，`current_identity_missing/current_identity_ambiguous` 不再抛成普通
`asset_coverage_inspection_failed`：driver 必须把冻结 kind/name、原 nodeId、影响 clipIndexes 和 sourceEvidence
编译进同一 `assetRepair/v3`，将 run CAS 到 `asset_repair_required`，并在公开 `loop/status` 回执中优先暴露
`waitingFor=agent_asset_repair + nextAction=repair_assets`。只有缺少结构化 kind/name、无法构造安全修复边界的
孤立引用才保留显式 inspection failure。历史 run 若仍停在
`collecting + authoring_failed + asset_coverage_inspection_failed`，`status` 必须优先返回唯一
`recover_authoring` 动作，禁止因为存在 pending writer artifacts 而投影成 `writer_repair_pending`；恢复动作重新
进入同一 coverage 节点后生成上述 repair frontier，不新建 run、不重写 BeatSheet、不触发供应商付费。
合同原本为 `referenceImageNodeIds=[]`、而资产修复后出现唯一真实候选时做首次绑定，并同步加入该 clip 的
`videoReferenceNodeIds`。零候选或多候选都不猜测、不按名称关键词兜底。绑定结果先 CAS 写回同一 BeatSheet，
再用 hash 已验真的 writer 工件与最新 BeatSheet 重新投影 executable storyPlan，因此补资产前冻结的 clip 副本
不会继续携带空引用进入 estimate/start；该过程只修改运行时资产身份字段，不重写 shots 或创作文案。
初始 coverage 需要 agent 修复时，公开回执固定先给出 `assetRepair/nextAction/message/warningCount`，再把完整
`warnings` 放在对象尾部；这样即使诊断很长，agent 也能在结构化输出截断前读到唯一合法动作，同时诊断不丢失。
authoring coverage 与付费提交边界共享 `classifyCanvasCardForRegistry` 这一份资产身份真源；角色必须携带
`referenceType=character + roleName + characterProfileVersion=character-card/v3`，场景必须携带
`referenceType=scene + sceneName + sceneProfileVersion=scene-card/v1`，道具使用
`referenceType=prop + propName + propProfileVersion=prop-card/v1 + materialIdentity`，并保留对应 board/function 合同。
角色/场景不会由素材库物化节点补字段；缺口回到 agents-cli 单轨。展示 label 不参与角色/场景身份匹配。
production graph 只有在所有已受理/运行中的独立 sibling 都完成收证后，才允许把剩余失败节点投影为 run
失败；某一镜 submit/asset 失败不会丢弃或中断已经进入 provider 的其它镜，也不会触发重复付费提交。
失败 run 的恢复只走公开 `replan_beats` 唯一合同：operation-scoped schema 只暴露 `sourceRunId`、全新
`runId`、`cloneSourceBeatSheet:true`、显式 `beatReplacements` 与 `preservedClips`。运行时原子读取源 run 的冻结
BeatSheet；`beatSheet`、`beatSheetRef`、`preflightRevision`、`preflightFingerprint` 不属于该操作，绕过 schema
提交也会原地拒绝。新任务仍只走 `preflight_* -> loop`，不会与失败恢复形成第二条 BeatSheet 输入路径。
`preservedClips` 只声明逐 clip 的 `sourceClipIndex -> targetClipIndex` 候选，允许为空；声明本身不等于接受复用。
runtime 会为每个目标 clip 重新计算冻结 writer 输入指纹（beat、filmBible、adaptationStrategy、writer 合同版本），
并同时核验源视频唯一 success 节点、真实 `taskId/videoUrl`、生产该视频的原始 writer 血缘、绝对镜号与输出哈希。
只有全部逐字一致的 clip 才会改绑到目标 run；当前 source run 后来生成的新 writer 工件不能反向证明旧视频与新输入
一致。未声明、已删除、内容已替换、生产血缘缺失或输入指纹漂移的 clip 都在目标 run 重新生成，旧 run 与旧资产
继续保留。真实 `nodeId/taskId/videoUrl` 由服务端从当前画布事实解析，禁止让模型手工转录。
成功视频即使已被后续 replan 改绑到另一个 `clipRunId`，仍可通过不可变的
`reusedRenderedClip.sourceRunId/sourceClipIndex` 归属于原 source run；恢复链不需要覆盖旧节点或丢失真实资产，
也不会把后来生成的 writer 工件错配给先前视频。
取消源 run 的数据库聚合计数不再凌驾于当前逐 clip 证据：即使其 `total_clips=0`，画布上仍可能有上一轮无损
重规划后保留的成功节点。runtime 对每个声明复用的 clip 分别验证当前节点、终态、任务 ID、URL、目标位置与
未替换 beat；未声明的成功节点留在旧 run，不会因整体存在节点而阻止新的合法生产。
单个或少量失败 clip 的局部恢复不重建全章 authoring 图：调用方使用 `cloneSourceBeatSheet:true + beatReplacements`，
每项只提交发生变化的 replacement beats 与相邻 replacement 的原文逐字起始 marker。runtime 克隆源 run 的冻结
BeatSheet，确定性继承未变化 beats/header/speechLedger/资产合同，重新生成连续 canonical coverage 与 clipIndex；
公开 schema 已删除整份内联 `beatSheet`，且 replacement beat 只暴露
`logline/durationBudget/dialogueScript` 三个创作字段。场景、资产合同、视频引用、首段连续性与边界状态由 runtime
从源 beat 继承并按拆分位置裁剪；镜头级扩写继续由 writer skill 消费源 span 与继承合同完成，避免 authoring 动作
携带大块嵌套资产 schema 导致模型输出超长或 JSON 结构失稳。
局部 transform 只在 `bounded_duration` 等有明确目标时长的范围重算 `meta.targetDurationSeconds`；
`full_chapter` 会删除该字段并由完整 `beats[].durationBudget` 唯一求和，避免 runtime 先生成非法字段、再被自己的
BeatSheet schema 拒绝。
runtime 继续执行冻结合同来源互斥、
源 run 终态、真实 `videoUrl`、映射唯一性与计费事实校验。已经成功的 clip 原样复用，恢复合同不得因工具
schema 投影裁掉字段而迫使 agent 重做整章或丢弃真实资产。
`repair_assets` 完成结构化资产重绑定时，会把被修复 clip 的 `video-result:*` 与其 concat/delivery
下游闭包标为 stale 后再恢复同一 run；已经持久化的 `video-submission:*` provider receipt 和其它独立
clip result 不失效，因此旧失败图节点不会在 worker 复活后立即二次终止，也不会重复创建已受理任务。
绑定项目级 `referenceAssetId` 时会在同一次 BeatSheet/plan 写入中清空该对象原有的章节
`referenceImageNodeIds`，并从 `videoReferenceNodeIds` 删除这些旧 ID；绑定当前章节 `nodeId` 时同样以新 ID
替换旧 ID。写入顺序固定为先 CAS 更新作为恢复权威的 BeatSheet，再更新其 executable plan 投影；部署恢复、
worker 重建或 reference-authority 投影不得从旧 BeatSheet 复活已替换 ID。新旧引用不会并存进入 provider 边界。
单个失败 clip 的 repair declaration 若只暴露了当前 clip，服务端会把修复范围扩展到同一冻结 plan 中
`kind/name` 相同且携带完全相同旧 `referenceImageNodeId` 的 sibling clips，一次消除同源陈旧引用；同名但旧
reference ID 不同的状态版/场景版本不扩展，禁止用名称相等替代结构证据。
若进程恰好在 durable plan 已写入、但 production artifact 尚未失效之间中断，旧版可能已提前清除画布 repair
声明。此时 `repair_assets` 只接受显式 `clipIndexes`，并逐项核对同一个 `kind/name/nodeId|referenceAssetId`
已经冻结在对应 clip 的对象合同中，才重建一次性 repair cursor 并执行上述失效闭包；任何新身份、新引用或
扩大 clip 范围仍原地拒绝。该幂等重放只修复提交边界的原子性，不从 prompt、label 或错误文案推断语义。
原文跨度、交付范围、场景/角色/道具/VFX 的 canonical 对象合同则是付费执行前的事实追溯合同：
每个 beat 必须逐字复用 runtime canonical `sourceStartMarker/sourceEndMarker`；模型只从 `preflight_begin` receipt 的 `sourceUnitCatalog` 选择每拍结束 unit，`full_chapter` 的精确 offset 由服务端从原文开头连续生成到结尾。
每个付费 clip 必须通过唯一 scene 对象合同绑定真实场景资产；`sourceTreatment` 不属于执行协议，也不参与拦截。结构不成立时只
否决当前 preflight/动作，并把精确 issues 回灌同一 agents-cli 链修复；不会把用户总体任务直接判失败。
`storyFactLocks.bindings` 只承载 agent 明确消费的额外事实与揭示门禁；空 bindings 不代表脱离原文，也不会在
最终 commit 才触发全章返工。章节忠实度的确定性真源是 runtime 编译的 `sourceCoveragePlan`、逐拍 canonical
source markers 与 speech ledger，避免要求模型为同一原文跨度重复创作语义 binding。
BeatSheet 业务 draft 与 deterministic repair cursor 使用不同 Redis key：repair 更新只校验 draft revision 后写入
独立调度记录，禁止通过 Lua `cjson` 重编码整份业务 payload（空数组必须保持 JSON array，不能退化成空对象）。
`repair.header=true` 时允许 `preflight_patch_header` 对 verifier 指向的单个既存 header section 做 revision-fenced
替换；正常 authoring 仍只能写 `nextHeaderPatchField`，且任意替换都必须重新通过完整 header 结构合同。
任意 provider 若把唯一必填对象 envelope 的子字段误放到同级，agents-cli 只在“恰好缺一个必填对象、存在
额外同级字段、重组后完整 exact operation schema 零错误”三个条件同时成立时恢复该层包装；该修复纯由
已授权 JSON schema 证明，不读取字段语义、prompt 或关键词。候选不唯一或仍有结构错误时继续显式失败。
`castManifest` 只保存 canonical 资产登记与 material identity，不再单独构成 authoring 生图门禁；`assetObjectContracts` 负责声明对象出场，但对象出场不等于必须为它单独生成参考图。runtime 从该唯一对象源的 `kind/name` 确定性投影 `characterRoleNames/sceneName/propNames/vfxNames`，并从 `dialogueScript` 投影 `speakerNames`；模型不再重复提交两份集合，也不存在集合逐字相等闸门。纯文生视频或用户明确不要生成/绑定参考图时，对象必须显式填写 `referenceRole=none`；canonical 对象、状态与运动事实继续进入 writer，但不会进入 authoring 生图 DAG。`referenceRole=identity/wardrobe/environment` 的合同即使草案引用为空，仍是执行前必须闭合的隐式视觉身份依赖；`prop/vfx/palette/composition` 只有携带显式稳定 `referenceImageNodeIds/referenceAssetIds` 时才进入前置图片 coverage。manifest-only 的布景、普通出场道具和无引用视觉描述可以保留在创作合同中，但不会被错误提升为孤立必备图片卡；显式引用的对象即使漏出 manifest，仍须有真实 URL 或进入同 run 的 `asset_repair_required`。
`loop` 在返回后台受理回执前只同步执行一次有界的初始资产 coverage 检查，不派 writer、不轮询供应商。coverage 已齐才交给后台 ready queue；缺资产时直接返回 `assetRepair/v3` 和 `waitingFor=agent_asset_repair`，避免先宣称等待视频、随后后台才发现 agent-owned repair 的竞态。对象合同只要求 `kind/name/referenceImageNodeIds/referenceRole`；身份不变量、禁止迁移、起止状态、空间关系与运动说明属于可选创作信息，缺失时不会阻断 authoring。repair cursor 只投影真实存在的证据，不伪造空缺语义；agents-cli 可回读精确 beat、source span 与项目事实写补图 prompt，禁止自行补年龄、关系、时代、地点或外貌。
已经处于 `asset_repair_required` 的 run 只在 `repair_assets`、幂等 `loop` 重放或显式 `recover_authoring` 等真实事件按 `runId` 唤醒时 fresh-read 当前画布、重新计算 coverage，并把同一次计算得到的最新 `assetRepair/v3` 刷新到状态节点；全局 authoring 恢复扫描与单 run Production Workflow 都不得在没有新证据时周期认领或自我续排这个 `WAITING_EXTERNAL` 状态。部署前已经排队的旧 wake 允许做最后一次 lease-protected 验真，但必须返回 `continuation=null` 并自然移除 BullMQ job，不能再生成下一条延迟 job。这样等待记录可持久保留且不占 worker、租约或队列资源，同时也不会只更新内部 artifact 而把旧版或过期修复声明继续留给 agents-cli。
进入 `asset_repair_required` 只表示同 run 已冻结 `assetRepair/v3` 修复前沿，不等于已经派发图片生成；driver 日志必须明确写成“已纳入同 run frontier，本步骤未派发生成任务”。continuation 最终进入 nonretryable 或 attempts-exhausted 时，会先读取其持久 task 引用：只要仍存在真实 active task 就继续保留等待；否则使用 `runId + owner/project/flow/chapter + collecting + asset_repair_required` 的窄 CAS 将当前物理 run 收口为 `authoring_failed`，错误事实为 `asset_repair_executor_terminal`。该收口不删除、不覆盖 BeatSheet、coverage、frontier 或任何已生成资产，也不宣称用户目标已经完成；显式 `recover_authoring` 只有在重新验证 v3 合法且不存在供应商视频副作用后，才允许恢复同一 run 并创建新的执行窗口，禁止复活旧 terminal attempt。
production driver 在供应商 POST 前收到 `video_failed + assetRepairRequired + assetRepair/v3` 时，只允许把当前物理 run 规范化为可恢复的失败事实，必须同时原样保留并投影该 repair frontier。托管 `video-run-status` 显示的是 agent 自动补素材阶段，不能改写成用户级“整章成片失败”；durable continuation 以同一 `runId` 唤醒 agents-cli，后者生成缺失身份图、逐项 `repair_assets`，最后由 `start_same_run` 只续跑未完成片段。只有没有合法 `assetRepair/v3` 的真实供应商/媒体失败才进入普通终态归因路径。这样物理 run 的幂等边界与用户逻辑目标分离，既不重放付费提交，也不把系统可生成的角色、场景或道具素材退回给用户。
画布身份卡被用户或 agent 明确写成 `approvalStatus="rejected"` 时，节点、真实 URL 与历史版本继续保留，但 authoring coverage、BeatSheet 引用重绑定和项目节点素材投影都不得再把它当作可执行资产。该规则只读取结构化状态，不分析提示词或图片语义；重新计算 coverage 后，该身份会进入新的 `assetRepair/v3.requiredAssets`，由同一 run 追加正确版本。未明确拒绝的 `needs_confirmation` / `approved` 节点仍按真实 URL 与结构化身份正常参与解析。
同一拒绝状态也作用于 AI 对话的媒体装配边界：Hono 保留选中节点的 `nodeId/label/approvalStatus` 作为事实证据，但按该节点 ID 和精确 URL 从 `assetInputs/referenceImages` 删除其图片字节，并清空该选中节点携带的 storyboard reference protocol 图片。其它本轮手动上传或选择的媒体不受影响。该过滤只读取显式 lifecycle 状态和稳定身份，不分析图片、名称或 prompt，避免被用户拒绝的旧图继续污染后续图片生成。
agents-cli 收到该 v3 receipt 后会把普通资产的 `{kind,name}` 和人物状态锚的 `{kind,name,stateVersionId,stateKey}` 安装为当前执行窗口的结构化付费前沿；repair kind 与 Hono 合同一致支持 `character/scene/prop/ensemble`，群像身份通过精确 `ensembleTitle` 绑定。`ok:false` 只表示用户目标尚未满足，不会再导致 runtime 丢弃这份权威 frontier。人物状态锚声明同时携带 `stateScopes/clipIndexes/visualFacts`：生成节点必须由同名基准身份卡 image-edit 得到，写入逐字相同的 `roleName/stateKey/stateVersionId/visualStateFacts`，并在 `referenceImageNodeIds` 中保留该基础卡的当前画布 nodeId；binding 只能使用当前画布真实 `nodeId`，不得用基态、另一状态或跨章版本替代。物理 run 恢复时，任一已授权工具结果内若结构化遍历得到唯一合法的 `assetRepair/v3`（例如托管 `video-run-status` 的 flow projection），同样恢复这一前沿；候选不唯一时不猜测。章节作用域的 `status` 查询只要携带真实 `chapterId` 就会读取章节 flow 中的 `assetRepair/v3`，不再错误依赖可选的项目根 `flowId`；公开回执同步投影规范化 `progressCursor`，确保恢复链立即取得相同的待补资产集合与支撑工具声明。状态 binding 通过后，Hono 会 fresh-read 引用节点，确认它是同名、无状态版本且有真实图片 URL 的基础角色卡；状态锚保持当前画布版本权威，不进入基础角色素材同步。随后 Hono 同时把 `anchorNodeId` 写回章级 `visualStateTimeline`、对应 beats 的 `visualStateAnchorRequirements` 与最终 plan；业务参考清单确定性移除该人物的基础卡，只保留精确状态版本。图片生成无论 direct 还是经 catalog wrapper 调用，都必须逐节点命中机器身份字段；整批中有缺失、重复或集合外身份时，在请求到达 Hono 前原子拒绝并同链纠偏。部分 `repair_assets` 成功会以服务端缩减后的 requiredAssets 更新前沿；若 fresh coverage 再次报告一个历史 resolved 身份，说明当前绑定已被删除、拒绝或失效，carry-forward 必须提升 revision、把该身份重新放回 pending 并移出当前 resolved 投影，不能用历史成功回执掩盖现在的真实缺口。只有显式 `assetRepairResolved:true` 或 `assetRepairRequired:false` 才清除前沿，不能因为工具 mode 名为 repair 就提前清除。Hono 仍会 fresh-read URL、身份、权限和当前 durable declaration 作第二道确定性校验；两层都不读取 prompt/label 语义，也不形成平行工作流。
可选 `shot_table_critic` 也已删除 `adaptationCourage/adaptationStrategy` 输入与“删戏、并戏、自造钩子才算好”
评分维度，避免开启 QA 后反向奖励偏离原文；它只诊断镜头执行质量，不能推翻冻结的来源合同。
Hono 不恢复已删除的整章 `patch_beats` 双轨；`preflight_patch_header` / `preflight_patch_beat` 只对已持久 header/beat 做 revision-fenced 节点修订。beat patch 支持精确到无效 JSON 路径的结构化深合并（对象递归合并、数组整体替换），避免为了修一个连续性边界而重传并改写完整创作对象；合并后仍走原完整节点校验。Hono 只保留协议、权限、
真实资产 URL、计费幂等、供应商硬上限和并发事实复核。preflight/loop 失败只关闭当前动作，完整合同由
agents-cli 在同一执行链内修订，不把内部结构纠偏变成用户可见步骤。
当 agent 已明确声明 `inheritsPreviousExit=true` 且一个或多个入口没有逐字承接上一出口时，`preflight_repair_continuity` 只接收 `runId + draftRevision`，由服务端在同一持久 draft 中计算并批量修复 `repairClipIndexes` 内仍真实不一致的边界。它不要求模型逐拍读取或搬运 beatRevision，从而避免长图恢复时反复拉取完整 Beat；每个写入仍使用当前 durable beatRevision 做 CAS。该操作不解释 prompt、不创作事实、不改变 current exit，也不会触碰未声明继承或不在持久修复目标内的 beat；draftRevision 过期、草稿不完整、缺 exit 或没有合法目标都会显式失败。其他结构错误继续走 `preflight_get_beat -> preflight_patch_beat`，不得借连续性批量操作改写语义。

repair cursor 是某次 `preflight_commit` 验证的事实快照，不是可跨节点修订长期复用的真源。任一成功的 Beat 节点替换都会在同一 Redis CAS 内原子删除旧 repair snapshot；header revision 替换也继续清除旧 snapshot。cursor 以确定性的 validator JSON path 拆出 `header / clipIndexes / continuityClipIndexes` 三种地址，并只暴露能够处理这些地址的 operation：只有 `.continuityLedger.entry.*` 边界问题才允许进入 `preflight_repair_continuity`，人物状态时间线、对象合同、时长等 Beat 问题只能走 `get_beat -> patch_beat`。`preflight_repair_continuity` fresh-read 后若声明边界已一致，只移除它负责的边界 issues；同一 snapshot 中尚未处理的其他问题与精确地址必须保留，`nextAction` 从剩余合法 actions 取得，禁止越权清空后错误引导到 commit 循环。

`preflight_commit` 在 canonical source coverage 或章级 `speechLedger` 与逐拍 `dialogueScript` 的结构化守恒失败时，也必须先把 validation snapshot 写成 durable repair cursor，再返回非终态修复 receipt，禁止只抛错误文本并让旧 cursor 继续锁死在 `preflight_commit`。source coverage 的确定性 owner 是 header；发声守恒同时比较 header ledger 与所有动态 beats，因此 runtime 暴露 `get/patch_header` 和按 `expectedBeatCount` 推导的 `get/patch_beat` 地址，但不替 agent 决定哪一侧语义错误。agent fresh-read 原文后在同一 draft 修订，成功 mutation 清除旧 snapshot，再重新 commit；本地不通过标题、引号、关键词或错误文案做语义裁决。

修复分支的 `get_header/get_beat` 是带 revision fence 的只读地址，不应把 durable repair snapshot 伪造成已修改。但它们的当前 receipt 必须在对应 patch action 仍属于 `allowedNextActions` 时把 `nextAction` 投影为 `patch_header/patch_beat`，而不是再次返回修复列表第一个 get；`draftRevision / beatRevision / nextAction` 等导航事实必须排列在长 authored payload 之前，保证有界工具预览也能先看到下一合法动作。该投影只表达结构上的相邻操作，不判断修改内容；可防止物理窗口续跑后循环重读同一地址。

Web 的显式节点命令使用按钮携带的 `canvasNodeId` 作为唯一事实锚点。此类请求不会再附加画布上残留选中
图片的 `assetInputs/referenceImages`；选中资产只属于没有显式节点锚点的普通自由对话。这样“本章做成视频”
不会因用户此前点过角色卡而把该卡人物错误提升为章节主角，同时不影响用户在自由对话中主动选择参考图。

`preflight_begin` 只承担新建职责，公开 operation schema 的顶层与 `beatSheetHeader` 均不暴露 `runId/draftRevision`，服务端总是分配新的
逻辑身份；即使绕过 schema 在顶层提交 `runId/draftRevision`，或在 header 内嵌旧 `runId`，也会以 `preflight_begin_identity_forbidden` 原地拒绝，禁止
把“恢复旧任务”静默解释成“新建另一任务”。恢复已知 run 统一先调用只读
`preflight_get_header(runId)`；该读操作可省略未知或已丢失的 `draftRevision`，由服务端 fresh-read 当前最新
fence 并原样返回。取得 fence 后，所有 patch/put/commit 继续强制 revision CAS。
结构化 recovery 的不可变身份只包含 `runId`，不包含会随每次成功 patch 前进的 `draftRevision`；revision 仍由每个
写 operation 的 schema 与服务端 CAS 逐次验真。agents-cli 对 catalog wrapper 也统一用解包后的逻辑工具名与逻辑参数
记录失败和计算动作指纹，因此 commit 失败只约束该 commit，不能把同 facade 下合法的 header/beat 读取误关掉。
本地 revision 围栏还以当前已加载的 exact operation schema 为准：schema 将 revision 声明为可选的 fresh-read 可以省略，
写 operation 仍必须携带且命中最新 fence。模型若给 required 字段自造别名，agents-cli 只在 JSON Schema 能证明唯一
一一映射且重建后的完整 payload 零错误时做结构恢复；映射有歧义就显式拒绝，不读取字段文案、prompt 或业务关键词猜测。
每个 beat 还拥有内容哈希 `beatRevision` 与不可变历史。首次写入不需要 replacement fence；已有节点的正文
发生变化时必须先调用只读 `preflight_get_beat(runId,draftRevision,clipIndex)` 取得当前完整节点和
`beatRevision`，再以 `preflight_patch_beat(replaceBeatRevision)` 只替换错误顶层字段。首次创建仍用完整 `preflight_put_beat`；盲写、并发覆盖或旧 revision 写入会原地拒绝，字段修复
因此不会因 provider history 压缩而脱离原剧情事实。agents-cli 把最新工具批次中的每个
`preflight_patch_beat` 的 verifier 修复还可补写当前 exact beat schema 已声明但持久节点暂缺的顶层字段；允许集合直接由当前 schema 投影，不读取字段文本做语义猜测。未知字段仍由 patch 层拒绝，合并节点仍必须通过完整节点、原文覆盖与 revision CAS 校验后才能持久化。
`preflight_get_beat` 按 `(runId,draftRevision,clipIndex)` 作为独立的 cursor-critical fact，完整保留其 beat 正文和
`beatRevision` 到紧接着的模型回合；并行读取的不同 clip 不再因共享逻辑工具名而互相覆盖。旧的、已被更新节点
取代的读取结果仍可退出 provider 临时工作集；持久 session 与历史 revision 仍完整保留用于事故取证，但不会自动回滚。
章头使用对称的 `preflight_get_header(runId,draftRevision)` 返回当前完整 `beatSheetHeader`、
`expectedBeatCount` 与 revision；commit 报告 header 路径错误时，agent 必须先读该 durable 节点，再携带当前
`draftRevision` 调 `preflight_patch_header` 做 revision-fenced 修订。header patch 产生新 revision，并在同一 Redis transaction 中把未修改的
Beat 节点及其 revision 复制到新图，随后 agent 仍可用 `replaceBeatRevision` 显式修改错误节点；这属于版本快照，
不重新创作、不改变 clip 内容。若事故发生在该事务能力部署前，可用当前 `draftRevision` 作为 fence，并通过
`sourceDraftRevision` 只读旧不可变图的 Beat，再写入当前图；不能把旧 revision 直接提交或回滚为当前图。
公开 `beatSheetHeader.storyFactsContext` 与 commit 复用同一份严格 schema，不再在 draft 阶段声明
`additionalProperties:true`、到 commit 才换另一份合同。`preflight_begin` 只校验并持久化最小 starter；durable cursor 只列出执行必需的 `sourceCoveragePlan` 与 `meta.aspect/resolution`。`preflight_patch_header` 的 operation schema 允许同一 revision-fenced mutation 批量提交 sourceCoveragePlan、filmBible、adaptationStrategy、castManifest 与多个 meta 叶子；空 patch、未知字段、未授权覆盖事实身份仍原地拒绝。首个 `sourceCoveragePlan` frontier 返回确定性 `sourceUnitCatalog[{unitId,startOffset,endOffset,text}]`；unit 是原文地址目录而非交付片段，因此保留每一个由换行、句读、逗号或冒号产生的作者结构边界，即使相邻地址不足 12 个归一化字符也不合并；无标点长段再补固定宽度地址。agent 可以跨多个 unit 选择一个 clip 边界，最终编译出的 source span 仍统一执行最小长度约束。这样相邻完整对白之间的原文坐标不会被固定宽度切块吞掉，同时整个目录只消费标点与换行，不做剧情语义判断。`preflight_get_header` 在后续修订窗口始终返回同一 source authority 生成的完整 catalog，避免 header 已补齐后续跑代理失去合法边界坐标。agents 只提交 `endUnitIds + speechLedger[{lineId,speakerName,text}]`，其中 `full_chapter` 固定从 0 到最后 unit，`bounded_duration` 必须另行显式提交授权范围的 `startUnitId`。Hono 按冻结 source authority 的顺序确定性定位 ledger 的 text，冻结逐字正文与 `sourceMarker`，再用选中的 unit 生成 canonical `spans[{clipIndex,sourceStartMarker,sourceEndMarker,sourceStartOffset,sourceEndOffset}]`；模型不能提交 marker/offset，且任一非末段边界如果落在 frozen speechLedger 某条完整台词的内部会确定性拒绝，防止单句对白被拆到两个 clip 后由 writer 丢字。`preflight_get_header/preflight_get_beat` 与所有消费 source anchor 的写操作使用同一份 durable source authority，因此物理窗口续跑不会得到空 source catalog。`preflight_commit` 的冻结收据同时保存 source fingerprint，`loop` 重新读取并逐字匹配后才进入执行。每次 patch 都产生新 revision，`meta` 与 runtime 冻结字段结构合并；该过程只检查字段、类型、枚举、原文坐标、稳定 ID/指纹与 null/数组边界，不判断创作质量。
当 cursor 仍有执行必需字段时，header patch 只有真正清除当前第一个 missing frontier 才能产生新 revision；只改写可选 `filmBible/meta`、重复提交当前值或跳过前序 meta 叶子会以 `beat_sheet_header_required_frontier_not_advanced` 原地拒绝。这样 continuation 的 `progressRevision` 只代表 DAG 的真实结构进展，不能被创作元数据反复改写虚增；该检查不读取字段正文，也不做任何语义质量判断。
`preflight_put_beat`、`preflight_patch_header` 与 `preflight_patch_beat` 合并后的节点都在写 Redis 前校验当前节点自包含的确定性形状：`durationBudget` 必须命中冻结模型档位，`dialogueScript` 必须是合法逐行结构，`continuityMode` 必须是可执行枚举，`assetObjectContracts` 必须有唯一场景并使用合法对象 kind/referenceRole。角色、场景、道具、VFX 和说话人由唯一结构源投影，不再校验模型重复填写的 selector 集合；可选 `storyFactLocks` 只有在实际提交时才检查 null/数组/绑定边界。确定性错误在单节点写入时一次性返回，不等到整图 commit 后触发全章返工。
`preflight_put_beat` 不再要求模型重复提交 `sourceStartMarker/sourceEndMarker`：这两个坐标已经由
`sourceCoveragePlan` 按 `clipIndex` 唯一冻结，Hono 在持久化 Beat 前确定性投影 canonical marker，模型只提交
Beat 的语义内容。任意文本、标点、长章节或物理续窗因此不会因模型再次截断/改写同一坐标而失败，下游
BeatSheet 仍始终持有完整逐字来源锚点。
`preflight_begin` 会把实时启用目录解析出的完整 `generationContract` 冻结进 header；后续 put/patch 只读取该快照，
快照缺失、无效或与 `videoModel` 漂移都原地失败，不再回读实时目录补旧草稿。单节点写入与最终 commit 共同调用
同一个 `validateBeatAssetObjectBindings` 结构真源，统一核对对象 kind/name/referenceRole、唯一场景、真实引用与供应商硬上限；因此服务端不会先接受最小合法对象，再在整图 commit 阶段用一套更深的创作合同否决。
`dialogueScript` 是逐 beat 冻结的原文逐字发声合同，每行必须有唯一 `lineId`、canonical `speakerName`、逐字 `text` 与
`delivery=on_screen|off_screen|voice_over`；当前原文跨度没有明确发声文本时必须明确提交空数组。agents 另外可在
`narrativeAudioPlan={strategy,rationale,lines}` 中冻结源事实支撑的补充人声裁决；每条 line 可保留 Agent 已明确提交的 `delivery=on_screen|off_screen|voice_over`，也可把该镜头语义延后到 Clip writer。延后时 Hono 不猜测默认值，Clip writer 必须在可执行 shot 上明确选择三种合法 delivery 之一；选择完成后即被冻结并由后续执行链逐字验真。`afterSourceLineId=null` 表示先于第一条原文人声，或引用当前 `dialogueScript.lineId` 表示紧随其后，同锚点保持数组顺序。它与原文对白分账保存，按该位置合同合并后才是
writer/renderer 唯一允许发声的集合。动作、神态、环境、镜头与画面说明不进入任一人声 lines，也不能由 writer 临时改写成人声。
Hono 只校验字段形状、lineId 唯一性、插入锚点与执行前 delivery 已解析等确定性边界；说话人索引由人声行自动投影，语速与容量只保留为诊断，不判断是否“应该有补充人声”，也不把声音设计变成生成门禁。
缺字段的节点不会污染 durable graph。需要全章或 header 才能判断的合法时长档、来源连续覆盖、
跨 beat 连续性与真实资产合同仍由 `preflight_commit` 统一校验；创作质量元数据缺口仍只产生 warning。
项目视觉圣经不再由 Hono 自动把 global core 和全部 optional sections 注入每个视频 writer。preflight 只冻结
当前激活版本的 `assetId/revision/hash/availableSectionIds` 描述符；agents-cli 依据当前章节的真实时代、地点、
物理光源与剧情事实显式选择适用 section，选择结果才进入 filmBible。视觉规则与章节事实冲突时以章节原文
为准；视觉圣经不能覆盖模型、时长、比例、分辨率、帧率，也不会给视频注入画风锚图片。
项目视觉圣经上传入口先把用户原文确定性写成当前画布的 `kind=text + productionLayer=anchors +
semanticKind=projectLookBible` 来源节点，再把稳定 `sourceNodeId` 与原文交给 agents-cli 解析；受限执行面只保留
`project_look_bible_get/confirm`。agent 禁止通过通用 `flow_patch` 再复制整段原文，避免长文本在工具 JSON 中重复
转义、截断或形成空写入；Web 必须等待当前画布保存成功后才派发该回合，保存失败则不启动 agent。`confirm` 仍
fresh-read 已持久节点并原子激活不可变版本，未持久或合同不符会显式失败。
agents-cli 同时把最新 `draftRevision/preflightRevision/preflightFingerprint/acceptedAsync` receipt 投影为 graph phase
fence：处于 `preflight_draft` 时只允许 `preflight_begin/get_header/get_beat/put_beat/patch/commit`，禁止在生产 run 尚不存在时调用
`status/recover_authoring/resume_pre_submit/loop`。当前物理 run 的成功 commit receipt 可立即推进 phase，不必等待
下一次 continuation；该 fence 只消费协议收据，不做 prompt 或创作语义判断。
bridge 在收集 continuation receipt 时以 `tapcanvas_equipped_workflow_run` 返回的 execution identity 为唯一完整成片启动凭证；
后续只消费 Workflow execution、node run、event 与 output port 的持久事实。旧编排入口不再进入工具目录、schema discovery 或执行分发。
所有视频生产 mode 在 agents-cli 侧还要求冻结的 `UserIntentContract.unresolved` 为空，并要求合同至少包含一条
带 evidence 的 `source=user` 原始用户事实。首次物理 run 的合同会随 continuation receipt 原样快照，续跑请求
携带 `userIntentContractLocked=true`；agents-cli 拒绝把它替换成“继续未完成任务”等 agent 派生合同，Hono 也会
在 host 合同哈希与 PostgreSQL 已持久合同不一致时原地拒绝。该字段只允许记录必须
由用户补充、且无法从本轮请求、项目事实、实时目录或已授权规划职责推导的事实/授权；整章范围下的总时长、
beat/clip 数、镜头拓扑、节奏、提示词与供应商合法时长选择属于 agents-cli/DAG 的规划产物，必须在首次合同中
保持 resolved。若 agent 仍误记，首个生产动作会被拒绝并要求同链更新合同，而不是留下“动作已执行、续跑锁
无效”的分叉。该校验只消费结构化来源、哈希与字段合同，不解析 prompt 文本，也不把创作判断下沉给 Hono。

章节“一键成片”已硬切为持久异步任务：`loop` 在 BeatSheet 与 authoring artifacts 原子落库后
立即返回 `video_loop_accepted_async + acceptedAsync:true + shouldYield:true + runId`；`start` 在冻结可执行计划
落为 `scheduled` 后返回同类 receipt。agents-cli 将这类结果收口为 `waiting_for_evidence`，HTTP 请求内
不再执行 20–23 分钟的 authoring/production 轮询。authoring worker 负责单 clip writer、装配、资产验真和
生产交棒，video-run worker 负责幂等提交、供应商回收与最终拼接。`accepted_async` 只证明有稳定持久
身份的任务已被内部执行器受理，不是供应商受理，更不是成片完成；只有真实 `concatVideoUrl`/节点证据
通过 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 才能声明最终交付。重复 `start` 幂等返回
同一 run receipt，不并发驱动、不重复付费。

一键成片 run 把版本化 `graph:manifest` 写入现有 `authoring_artifacts`，完整执行词汇为
`beat_sheet -> asset_coverage -> clip_writer* -> assembly -> estimate -> production_handoff ->
video_submission* -> video_result* -> concat -> delivery_verify`。`clip_writer*`、`video_submission*` 与
`video_result*` 依据冻结 BeatSheet 的真实 clipIndexes 动态展开，不是固定镜头数。manifest 在提交时执行节点
唯一性、依赖存在性与无环校验；BeatSheet run、manifest 与全部动态 clip 节点在同一个 PostgreSQL 事务提交，
worker 不能观察到半张图。ready queue 只调度依赖已 ready 的节点，供应商已受理但尚未物化 URL 的结果节点
进入 `waiting_external`，不会被当作完成，也不会唤醒 LLM 轮询。相同 status/content hash 的 worker 观察不会刷新
节点水位；真实 clip URL、concat URL 与 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 分别成为
`video_result`、`concat` 与 `delivery_verify` 的持久证据。`authoring_state` 和生产 `state` 仅保留为 UI/查询生命周期
投影，不再选择下一动作；没有 BeatSheet 的独立 direct-video run 通过 `beat_sheet IS NULL` 明确区分，不使用
`authoring_state=null` 兼容一键成片。节点 `failed` 是确定性终态；已证实尚未触达供应商、或用户显式授权替换的
提交边界写为 `stale`，保留旧证据并重新进入 ready frontier，避免误判失败和重复扣费。历史 BeatSheet run 已通过
迁移补齐 manifest、资产依赖和 production handoff。

异步 continuation 的通用 artifact identity 同时支持 `nodeId`、`taskId` 与 `runId`。一键成片刚落库、
尚未创建媒体节点时，使用 `video:run:<runId>` 注册持久 continuation；worker 不会因为每个 tick
就重启对话，只在 run 进入 `concatenated`、`asset_repair_required`、`authoring_failed`、
`failed` 或 `cancelled` 这些“最终验收/需 agent 动作”边界时恢复原会话。恢复后必须 fresh-read
画布和 run，修复同一交付合同，不得把已受理的付费任务重投。

视频理解/视频参考计费同样由 Hono 的事实性计费协议负责：模型目录发布 `duration_metered` 价格规格，
服务端媒体 worker 先生成真实视频时长与文件大小证据，再按同一套 Seedance 2.0 480P 基准价格和
Pro/Lite/Mini 模型比例计算报价，随后才冻结团队积分。成功任务扣除该报价，预处理、执行边界或上游
失败则释放冻结；前端只展示后端目录和视频 metadata 得出的估算，不在本地推断模型价格。计费版本为
`video-analysis-duration-v1`，实际 transport 中的 `durationSeconds` 是交付与计费审计证据。

图片理解固定使用 `gpt-5.6-luna`；视频理解改为从 new-api 实时目录选择已声明 `tapcanvas:capability=video-analysis` 且有按时长计费的 Ark Doubao Seed 2.0 Pro/Lite/Mini 模型，调用方只能提交目录返回的精确模型身份，不能触发备用模型或本地降级。`/agents/llm/v1/video-understand` 提供 `shot-table-v1`（逐帧拉片结构化观察表）、`speech-audit-v1`（真实可听人声及时间轴）和 `free-text` 三种输出合同；前两者都要求严格结构校验、真实视频代理、前置时长/文件大小/帧率计价与可检索执行证据。公开 `/public/vision` 接口支持直接传入 http(s) `imageUrl`，并按 Responses API 的 URL 图片输入契约执行；`tapcanvas_analyze_video` 继续负责代理转码、切段和 provenance。agents-cli 的 `tapcanvas_public` / `host` 会话从历史恢复、当前请求到运行时内部纠偏一律剥离主模型图片块并关闭 URL 自动解析；媒体字节只能进入理解工具，主代理只消费纯文本结果或结构化失败证据。

自 2026-08-04 起，`/public/agents/chat` 只有一条 canonical 路径。普通对话和带
`intent + chapterContext` 的章节请求都由 `public-agents-chat -> task.agents-bridge ->
agents-cli /chat` 处理；`intent`、触发节点、章节快照、生成配置、变体参数和画风参考只作为
结构化事实传递。Hono 不再运行平行 intent bridge、intent-to-skill 映射、固定 flowPatch/finalize
子流程，也不在请求进入 agents-cli 前生成本地 goal、执行计划或语义路由。
Web 生成的 `m_ai_pending_*` 只是本地 UI 占位身份，现以 `clientPendingId` 显式穿透；SSE
`turnId`、agents-cli internal turn/run 仍是独立的 durable identity。显式 interrupt 路径会持久化
`public turnId <-> clientPendingId <-> session/diagnostic`，不再因 abort throw 跳过 public turn 记录。Web 传入的
Web 只传 `chapterCanvasReference@1(scopeKey/nodeCount/edgeCount/selectedNodeId?)`，不再发送
截断节点列表。agents-cli 需要具体节点时必须通过 `flow_get/flow_search` 读取当前真实画布，
不能把节点数量、摘要或选中身份当作节点正文事实。

画布组节点的“一键成片”按钮也只进入这条 canonical chat 链：Web 仅发送组节点身份与显式规格事实，
并以 `attachCanvasContext + freshConversation` 请求当前真实画布和本轮 Skill；它不再在 Web 侧扫描组内视频、
估算积分、创建本地 compose、调用供应商或自行推进固定阶段。agents-cli 负责读取组内真实节点、规划连续性与资产
职责、选择合法工具并把结构化 clip/run 事实写回画布。画布只把服务端已写回的 `clipRunId/clipIndex`、状态、
`videoReferenceNodeIds`、角色/场景/道具合同、首尾帧和真实 URL 投影成镜头卡与聚焦检查器；已进入该 run 的镜头
提示词在画布内只读，修订、引用修复和恢复按钮都重新投递给 agents，由同一条执行链保留 lineage 与已有资产。
普通无 `clipRunId` 的单镜节点仍是独立画布生成能力，不被误当成编排镜头。

“当前项目”素材库是项目根画布、章节画布和 shot 节点的实时只读投影，不要求用户额外执行“保存到素材库”。
从个人、团队或其它项目点击“添加到当前项目”时，Web 在当前画布创建新的项目内节点身份，并显式保留
`materialKind/referenceType`、角色/场景/道具 canonical 名、真实图片、源项目、源资产和源版本 provenance；
不会把旧项目的 material asset ID 冒充为当前项目资产。保存后的节点立即进入当前项目投影，AI 与一键成片按
最新 canvas revision 读取它。角色卡只有同时具备 `referenceType=character + roleName + characterProfileVersion=character-card/v3`
才被识别，场景卡只有同时具备 `referenceType=scene + sceneName + sceneProfileVersion=scene-card/v1` 才被识别；
新道具卡使用 `referenceType=prop + propName + propProfileVersion=prop-card/v1 + materialIdentity`；展示 label、裸名称字段和历史卡版本不再建立 canonical 角色/场景/道具身份。

角色卡创作方法只有 agents-cli 的 `tapcanvas-character-card` 一条路径。基础卡统一写
`characterAssetRole=identity_anchor + characterProfileVersion=character-card/v3`；状态卡使用同名基础/上一状态的
精确 node、asset 或 version ID 做 image-edit，并携带 `stateKey/stateVersionId/stateDescription/visualStateFacts`。
Hono 不保存角色原型表、性格到骨相映射、随机瑕疵池、禁词审查或角色 prompt 套餐，也不根据 label/prompt 猜身份。
模型可见的 `identityBoardSpec` 只验证 `identity_board_four_view` 的结构事实：正面脸、3/4 脸、正面全身、背面全身、
跨视图一致、参考职责隔离、中性参考背景、无文字与无品牌。旧的九头身超模、默认真人写实、微仰拍、85mm 和固定深灰
影棚字段已硬删除；人物体型、媒介、镜头和生活痕迹由 agents-cli 根据用户要求、故事事实、完整 cast 与项目 style lock 决定。
这些是同链创作责任，不形成 Hono/Web 的语义质量闸门；供应商已受理或已产出的角色资产始终保留，只能追加诊断或修订版本。
书级 Style Bible 不再保存或生成 `characterPromptTemplate`；章节 metadata ensure-window 也不再自动创建带固定模型和本地 prompt 的
draft roleCards。Style Bible 只提供项目级画风事实，角色 prompt 必须由 `tapcanvas-character-card` 在当前执行链编译。

场景卡与场景灯光同样只由 agents-cli 的 `tapcanvas-scene-card` 创作。canonical 空间写
`sceneAssetRole=space_anchor + sceneProfileVersion=scene-card/v1`；同空间的灯光版或物理状态版必须引用精确基态/上一状态
node、asset 或 version ID。模型可见的 `sceneLightingSpec` 只保存 `scene-lighting/v1` 的结构事实：叙事阅读目标、物理主光源、
方向、色温关系、光质、阴影、介质、材质反射、实用灯、连续性锁和可选变化。Hono 不根据情绪关键词选择顶光/逆光，不维护
世界观表、兼容/借鉴 prompt、固定电影感前缀、style reference 缺失闸门、固定图片模型/规格或 scene URL 物化路径。
`tapcanvas-generate-scene-references` 只做清单、ID 对账和节点编排；空间设计与灯光不足在同一 agents-cli 链内修订，不形成
Hono/Web 语义门禁，已受理或已生成场景资产同样只能追加诊断和版本。

道具卡创作方法只有 agents-cli 的 `tapcanvas-prop-card` 一条路径。基础卡统一写
`propAssetRole=identity_anchor + propProfileVersion=prop-card/v1 + materialIdentity.mode=base`；状态卡以精确 canonical asset
派生，并写 `propAssetRole=state_variant + materialIdentity.mode=state`。模型可见的 `propBoardSpec` 只表达按当前几何与交互歧义
动态选择的非空视图职责集合、跨视图一致、参考职责隔离、中性基态与尺度来源；`propFunctionSpec` 只表达物理包络、方向锚、交互锚、
支撑/受力路径、可动部件、材质响应与连续性锁。Hono 不固定面板数、X 光、4:3、棚拍前缀、8K、渲染器或题材道具模板，
也不根据名称发明能力、材料和内部机构。项目素材登记会无损保留这些结构字段与 `materialIdentity`，供后续分镜和视频按真实 ID 消费。

旧模型可见 `novelDoc.role-card` 与 `image.role-portrait` presets 已删除；Hono 图片执行边界也不再注入随机 Face DNA、cast-repel
面部枚举、same-face 负向词或按角色名自动拼角色外貌。角色与场景方法都来自相应 agents-cli Skill，Hono 只暴露结构字段、
解析已授权的结构化引用 ID、执行确定性协议并保留真实生成结果。历史 `CHAPTER_ANCHOR_AUTOBIND` 也不再根据
`lockedAnchors.character/scene` 与 label 按名称补角色/场景 URL；图片与视频只从 agents-cli 明确提交并经身份合同验真的
nodeId/referenceAssetId 解析角色和场景。该自动绑定模块仅保留风格锚与道具锚。

聊天回合状态同样只有一条 durable 恢复链：agents-cli 在 `waiting_for_input` checkpoint 中持久化完整的
`pendingUserInput` 合同（`requestId/questions/options`），`/chat/status` 原样做结构校验后由 Hono
透传给 Web；前端刷新或断线恢复时据此重建可点击选择卡，不以“任务正在等待用户输入”的摘要替代真实交互内容。
root 物理窗口在完整 `expectedDelivery` 尚未冻结时也允许以同一 session/用户意图合同续跑；只有已受理外部依赖的
dependency continuation 必须持有完整 immutable delivery lock。失败工具参数的 `toolArgumentFailureEvidence` 只是诊断
摘要，运行时禁止把它回放成真实动作或成功 no-op。公开 trace 的 storyboard plan/continuity/source bundle 与 node/video
bundle 字段和 bridge 事实结构保持同一 schema，避免富 trace 降级后让前端看不到真实挂起与续跑状态。

模型工具参数先经过统一 JSON 完整性入口：合法对象直接执行；完整且括号、方括号、字符串闭合的对象信封若仅存在
JSON 语法损坏，由 agents-cli 已安装的 `jsonrepair` 做一次纯结构修复，再重新解析并继续接受原工具 schema、权限、
计费幂等和业务合同校验。该步骤不补业务字段、不解释 prompt、不恢复缺失语义；未闭合、provider length stop 或其它
截断参数仍写入不可逆 `toolArgumentFailureEvidence` 并拒绝执行，禁止把自动补尾后的半份付费参数送给供应商。
画布 SSE 的聊天投影标记为 agents transport，Web 在同一会话已有相同角色与正文时合并本地消息，避免
实时广播与持久历史使用不同消息 ID 导致重复气泡。该合并只依据回合传输事实和结构字段，不对创作正文做
关键词或语义判断。

会话标题是静默辅助元数据，不属于主 AI 对话。Web 只在主回合收到可验证的
`requestTerminal.status=succeeded` 后，通过独立
`POST /agents/llm/v1/auxiliary/chat/completions` 触发 `auxiliaryPurpose=conversation_title`；`suspended`、
`needs_input`、`failed` 以及持久历史中缺少终态证据的 assistant 消息均不得触发。辅助端点不进入
`/public/chat`，不登记 active/inflight turn，不写主会话消息，不广播画布聊天，不参与
`expectedDelivery -> deliveryEvidence -> deliveryVerification`，也不创建或领取 durable continuation。
辅助执行类禁止 stream 与 tools，使用独立日志标签和 15 秒硬超时；Web 以 detached promise 发起，不等待它
推进主对话状态机。标题生成失败、超时或空结果只记录辅助错误并丢弃，不能中断、覆盖、结束或恢复用户生产任务。

画布节点类型由 agents-cli 依据本轮用户交付语义选择，Hono 只提供结构化协议约束。`shotTable` 是唯一的
结构化“分镜表 / shot table”节点类型，包含可编辑的镜号、时间、景别、机位、运镜等字段；`storyboardScript`
仅用于用户明确要求的纯文本“分镜脚本 / 逐镜文本”，不是分镜表的替代类型。远程
`tapcanvas_flow_patch` 契约已将这一区分写入工具说明，避免把“添加分镜表”落成纯文本节点；
`patchNodeData` 仍只接受真实节点身份，服务端仅将显式的 `nodeId` 结构别名归一为 canonical `id`，
不会根据标签、位置或语义内容推断节点。

Hono 只透传调用方显式提供的 `requiredSkills`，不根据 workspace action、章节 intent、prompt、
模型、节点类型或 `autoApprove` 自动增补 Skill；也不向 agents-cli 下发 Hono 计算的 `maxTurns`、
`goalSuggestion`、`executionPlanningDirective` 或其它本地任务语义。意图识别、技能发现、规划、
多轮推进、子代理委派与同链自修复由 agents-cli 负责。普通 public 请求不再读取或传递 Lark 凭证，
也不预取文档正文；未来需要远程 Lark 能力时必须先建立懒加载的服务端凭证 broker。当前仅显式本地
`local_code` 表面可使用已验证的 Lark 事实；Hono 不常驻注入“遇到 URL 必须调用 `lark_cli`”之类 SOP。

创意对话上下文中的 `chatMode` 与 `creativePhase` 也是调用方提供的结构化事实，Hono 只负责校验、透传并放入
事实型上下文；它不把创作对话改写成固定工作流、预制台或菜单。`chatMode=creative` 且
`creativePhase=prep` 或 `writing` 时，harness agent 负责保持视频共创对话的连续性，并把时间轴、物理 clip 的起始状态、
过程变化、动作因果、反作用、退出状态和跨 clip 承接作为可见工作稿展开；用户明确锁定提示词、开始生产或执行
工作流后，agents 再把已确认工作稿交给对应的生产能力。这样“先把提示词聊清楚”是小T的运行时能力，不是新增的
用户侧预制阶段。

如果用户明确要求本轮“只回答/只讨论/不要调用工具/不要读画布/不要生成”，该限制优先于通用交付收口：harness
必须保持纯文本回合，不调用画布、Skill、memory、`record_user_intent`、`report_delivery` 或其它工具，也不把
解释性回答投影成“动作执行”。只有用户明确要求持久化、画布修改、工作流、媒体生成或读取项目事实时，才进入工具链。

视频总时长不能只由 `30s + 10s` 等 clip 数字证明。公共创作对话中的 harness agent 还必须为每个 physical clip
建立连续子时间轴，让准备、发力、移动、接触、反馈、调整、再次攻防或新选择、后果和退出状态填满实际时间；
用户指出“内容撑不起时长”时，agents 直接重建具体时间段，不把扩写/压缩/重标记包装成用户选择题。`report_delivery`
校验、协议修复和内部重规划只属于运行时控制面，不得出现在用户可见的创作正文中。

当用户要求提前把视频提示词聊清楚时，这属于 harness 内部的 `prompt_only` 视频提示词编译能力，不是普通创作简报，
也不是新增的用户侧预制台。agents 负责按现有视频工作流与 prompt authoring 合同组织两层工作稿：先继承全局风格、
材质、速度、VFX 与声音边界，再按可执行事实、故事因果、状态连续、镜头执行、领域表达和修饰润色的优先级落到每个
clip；用户明确的 VFX/冲击帧规则必须绑定到真实发力、接触和受力后果，不能用特效或运镜替代主体动作。
提示词不要求逐帧旁白，而是固定关键状态锚点并写清锚点之间的因果过渡桥：重心、位移、手/武器、视线、相对距离、接触受力和环境反馈如何连续变到下一状态；可以省略不重要的中间帧，但不能省略让观众读懂动作的状态变化。

`agentDecision` 只描述已发生的执行类型、画布动作与资产事实，不再包含
`requiresConfirmation`，也不能把 plan/canvas plan 投影成用户级等待态。`suggest_replies` 是非阻塞的
下一轮快捷建议，不得拦截同回合中已授权生成；只有结构化
`request_user_input(needs_input)` 能表示确实缺少不可推导的用户事实。agents-cli 根 run 的局部
收尾报告缺口与单个自修复分支关闭只触发同一物理 run 内的 ephemeral 重规划；root 的
`maxTurns/maxToolCalls/maxTokens/maxWallTimeMs` 任一物理预算到达时，则携带
`root_physical_execution_budget_exhausted + physicalRunId + progressRevision` 安全挂起。Hono 只按这份
结构化 receipt 登记同 session continuation，并在当前回合落库后自动领取新的物理窗口；它不要求存在
异步媒体 artifact，也不把预算边界伪装成用户任务失败。若进程在即时领取前退出，持久 continuation
worker 会从同一 task-status receipt 恢复，不依赖浏览器继续在线。
若旧版本曾卡在浏览器 SSE 写入处，形成“agents-cli 已持久化物理预算 suspension、Hono 尚未写 continuation”的裂缝，`POST /public/agents/chat/resume` 只允许用 status 中的结构化 suspension，加同用户、同 turn、仍为 running 的 execution trace 在执行前已写入的 immutable `request.accepted.request` 重建一次 continuation。agents-cli 同时从当前物理 turn 的持久消息尾部按 `toolCallId` 配对成功工具调用与结果，只抽取 `runId/taskId/draftRevision/beatRevision/preflightRevision/preflightFingerprint/clipIndex/acceptedAsync/progressCursor` 等稳定协议字段形成 `recoveryCheckpoint.durableTaskReferences`；不读取提示词、BeatSheet 正文或其它创作语义。Hono 只在内部恢复链消费该 checkpoint，公开 status 会剥离它。只要 suspension 声明已有 `progressRevision > 0`，却无法恢复至少一个精确 durable frontier，恢复必须以 `chat_resume_durable_frontier_missing` 和 HTTP 409 原地失败，禁止仅凭原始请求重新执行、让模型猜测旧游标或创建新的业务 run。原请求必须通过当前 schema 且 session 完全一致，否则同样 409；这条恢复不读取聊天文案做语义判断，不创建新用户消息，不新建业务 run，也不复用其他 run。
continuation 的 `id` 是稳定逻辑任务身份，不再同时充当每次领取的物理 execution trace。每次 claim 使用
`<continuationId>:attempt:<attempt>` 作为独立 trace，并把稳定根请求写入 `rootTraceId/logicalTaskId`；失败重试
因此保留旧 attempt 的追加式事件与终态，不覆盖旧 trace，也不会因同一逻辑 continuation 再次领取而触发
`execution_trace_identity_conflict`。同一个物理 attempt identity 也必须作为该次模型执行的积分冻结 `effectId`；
稳定 `rootRequestId/publicTurnId` 只负责逻辑关联，禁止复用为 continuation 的冻结标识，否则会与根回合的
不可变冻结记录冲突并在进入 agents-cli 前失败。首个 continuation 的根身份固定使用 Hono 在请求入口生成并用于 public turn 的 `requestId`；不得依赖
provider/agents 返回的可选 `meta.requestId` 再投影一次。第二个及之后的 stage 必须同时继承父 continuation 已持久化的根
`rootRequestId`，并使用精确 `parentContinuationId` 表达物理窗口父链；即使内部续跑请求没有新的 transport request id，也不得丢失根身份或生成 stage-local 根身份。登记结果会记录 status、reason、session/project、physicalRunId、progressRevision 与
continuationId；身份或作用域不完整时显式记为 registration failed，禁止前端把它展示成“后台任务已受理”。
CLI 或运维恢复不得向普通 `/public/agents/chat` 发送“继续”文本；同一 session 的新用户回合仍是新语义请求，
没有资格自行恢复旧 run/cursor，可能重新 `preflight_begin`。显式恢复统一使用
`POST /public/agents/chat/resume`：调用方先从 `/public/agents/chat/status` 取得精确 `sessionKey + turnId`。
若同一 API 进程重启后 status 已证明物理执行者不存在，但 continuation 行仍停留在 `claimed`，显式 resume 可按该行精确 `updated_at` 做 CAS 重领；任何并发 worker 心跳都会改变 fence 并使重领失败。这样既不等待固定租约 TTL，也不允许两个物理执行者并发消费同一 continuation。
Hono 认领成功后还会只在内部 bridge 请求中附加 `physicalContinuationLeaseTakeover@1`，并把其中 `logicalTaskId` 绑定稳定 `rootRequestId/publicTurnId`；普通 public chat 不产生该字段。agents-cli 只允许这份精确身份声明在同 owner、同 workspace lane 上替换仍活跃的旧物理 lease，并签发新 fencing token，使失联旧进程的后续心跳或写回必然失败。字段损坏、身份不一致或非可信请求都原地失败，禁止用等待 TTL、自然语言“继续”或新业务 run 绕过。
同一逻辑 turn 的 `executionProvenanceHistory` 还冻结 agent 已选择并在后续窗口晋升为必需依赖的 Skill 身份。孤儿 checkpoint 从根请求重建时可能只能恢复根请求最初的 `requiredSkills`，因此 agents-cli 必须在任何 Skill 预读和模型执行之前，用同一 `publicTurnId` 的持久 provenance pins 补回其后由 agent 真实选择的 Skill；新请求缺失 pinned Skill 属于可恢复的物理投影缺口，不得误报为语义目标变化。请求若夹带 pins 中不存在的 Skill 仍以 `semantic_dependency_changed` 原地失败；Skill 身份被未授权扩展仍作为冻结合同漂移拒绝；Skill 正文/section/resource 的内容哈希变化只写入非阻塞 observation，禁止伪装为旧版本，但继续同一逻辑任务。
对于工具明确返回 `retryableInCurrentAgentChain=true` 的确定性合同错误，continuation 的 `actionRecoveryFacts` 必须同时保存该次失败动作的精确结构化输入（上限 512KB），并在下一物理窗口作为机器 checkpoint 原样交还 agent。这样 BeatSheet、资产计划等尚未通过提交门的草稿可以在原稿上修正，不会只保留一条错误文案后跨窗口重新创作，造成时长、clip 数或叙事规划漂移。只有服务端显式声明可同链修复的失败才允许携带输入；普通失败、成功动作、超限输入与任意 prompt 文本均不得进入该字段，成功动作仍按原规则清除对应 recovery fact。
服务端只接受两种 inactive checkpoint：带 `root_physical_execution_budget_exhausted` 的 suspended 回合，或仍停在
`accepted/agent_running/completion_verifying` 阶段、但已不存在执行进程的 `unknown` 回合。前者原子认领当前用户、
当前 session 下 waiting 的 `resumeTrigger=physical_budget` continuation；后者只允许原子重领同 session 最新一条、
仍在重试上限内且已持久化失败证据的 root physical continuation。失败 continuation 不进入后台无条件 sweep，必须
先由这次精确状态握手证明 checkpoint 已失联，避免在旧执行进程仍存活时并发重放。Web 的 durable recovery hook
发现该结构事实后会自动执行一次握手并重新读取权威状态，不要求用户刷新或发送“继续”。它不读取 prompt、不判断
业务语义，也不创建新任务；真正的重规划、资产修复与交付裁决仍在恢复后的同一 agents-cli 逻辑任务内完成。
自动握手被服务端明确拒绝时，Web 必须保留权威 inactive checkpoint，并把原错误投影为同一回合唯一的终态错误卡；
后台状态轮询可以继续观察状态变化，但不得再次领取同一 checkpoint，也不得继续用 Loader 宣称正在切换窗口。
只有用户显式刷新状态时才允许对该精确 `sessionKey + turnId` 再尝试一次，仍禁止另建或重发业务任务。
请求不能提交 prompt、runId、cursor、模型或交付合同；没有合法 receipt、回合已变化、已有 active turn 或旧合同
无法按当前 schema 解析时均 409 显式失败，禁止猜测、兼容重建或退回普通 chat。这样 CLI 恢复、Web 断线接回、
自动领取与 worker sweep 共用同一份服务器真源。
服务器生成的 continuation prompt 永远不投影为用户消息。`requestTerminal.status=suspended` 的中间物理窗口
（包括首个物理窗口）只写 public turn ledger/continuation receipt；公开 response 的 `text` 固定为空，不写或广播
assistant 聊天气泡，但首个窗口的真实 user message 仍正常持久化。旧版本已落库的挂起回复只在权威回合仍为
`running/suspended` 时由 Web 按消息顺序移除“最后一条用户消息之后的历史 assistant 投影”，不得按回复正文、
关键词或通用 `run_outcome=hold` 判断；后者也承载合法的纯文本成功结果。逻辑任务到达 `succeeded`、`failed` 或
`needs_input` 时才发布一条 assistant-only 终态结果。这样自动续窗与依赖回调保持可审计，但不会制造“用户再次
发送了继续”或以挂起摘要打断原始一键成片对话。
内部 continuation 在 bridge 请求上显式携带 `suppressUserTurnProjection=true`：agents-cli 仍以完整机器 checkpoint
执行，续窗沿用根 `publicTurnId`。每个物理窗口保留自己的 execution trace，但 `/chat/status` 始终以根 turn identity 投影同一
逻辑任务，Web 也会结构性合并旧物理窗口遗留的 pending progress card。`/chat/status.activeTurn.requestText` 固定为空。Web 只在该字段确有真实用户正文时重建 user bubble，
不得用“已恢复的当前任务”或机器 prompt 兜底；原始用户消息保持唯一。进度区同时显示从首次 public request
`startedAt` 计算的逻辑任务总耗时与从权威 workflow `updatedAt` 计算的当前阶段耗时，物理窗口续领只更新阶段事实，
实时 SSE 首包一旦返回根 `turnId`，Web 必须把本地临时 user/assistant message id 原子绑定为与 durable recovery 相同的稳定 id；
随后无论流式结果先到还是 `/chat/status` 终态先到，都只能更新这一对消息。禁止按正文相等做语义去重，也禁止让实时流与
恢复投影各追加一条助手终态消息；若两条传输投影发生竞态，以携带本地 tool/todo 明细的实时消息为 canonical card。
`/memory/context` 同时返回持久消息自身的 `messageId` 与所属根 `turnId`；Web 用同一 `turnId` 重新构造上述稳定消息 ID，
历史快照与实时卡只按该结构身份合并，正文、资产、TODO 和展示状态均不得参与身份计算。查询回合映射时读取会话最新 turn runs
并恢复为时间正序；同一根 turn 的多个物理窗口若留下多条 assistant 历史投影，只保留最后一条终态投影，再由实时富卡覆盖。
这避免长会话因只读到最早一批 turn、或 continuation 留下多个传输记录而再次产生重复卡片。
执行型与非执行型任务的 canonical card 都只使用 agents-cli 从 `PendingTerminalDelivery@2` 结算并通过事实 verifier 后返回的
终态正文，不使用此前的 assistant 候选或过程句。agents-cli 对根代理的 provider 文本 delta 采用
“内部草稿、终态结果”语义：候选复核失败、同链修复、物理预算挂起或等待证据期间不向 SSE 发布正文；唯一终态裁决完成后，
agents-cli 仅返回裁决正文，不触发根代理 `onTextDelta`。Hono 在 bridge 返回结构化终态后先发送 terminal `result`/`done` 事件，
再异步完成 checkpoint、turn verdict、conversation、outbox、实时广播与 continuation 等 post-result projection；这些投影分别记录
失败证据，不能阻止已经取得的终态正文返回。Web 只从该终态事件投影正文，权威 trace/outbox 仍按自身持久化结果收口；不得因为任一
投影延迟把聊天卡永久留在 running。Web/Hono 不检查正文关键词，也不改写内容。
候选 reviewer 或事实 verifier 返回的 `reasonCode/rationale/missingCriteria/requiredActions` 会与 pending candidate 一起 checkpoint；
下一物理续跑复用该结构事实继续修订，并从认证 catalog 恢复所需工具面。Hono 只恢复 durable session 与 continuation，
不生成报告工具、不解析错误文案，也不按 Skill 名或业务 prompt 做语义分流。
不得重置总计时，也不得把 `asset_repair_required` 在没有供应商 `taskId/imageUrl` 时显示成正在生成图片。
continuation receipt 必须同时冻结并恢复原始认证请求的 `projectId/flowId/chapterId/bookId/canvasNodeId`、
实际模型、required Skills、`executionToolPolicy` 与真实工具返回的 `durableTaskReferences`。后者只投影
`toolName/mode/runId/taskId/draftRevision/beatRevision/preflightRevision/preflightFingerprint/clipIndex/acceptedAsync`
及通用 `progressCursor={graph,scopeId,phase,revision,executionGeneration,completedUnitIds,pendingUnitIds,allowedNextActions,requiredReadActions,allowedSupportingTools}`，其中 `revision` 与不透明的物理租约 `executionGeneration` 是两份独立 fence，
不携带 prompt、BeatSheet 正文或工具大参数；物理续窗必须继续首个稳定视频 runId，尝试新建或改名会在
agents-cli 的远程执行 chokepoint 以 `video_logical_run_identity_mismatch` 拒绝。后台 sweep 使用的内部 Hono context 不代表新的用户请求；
未解决的确定性动作失败另外按通用 `actionRecoveryFacts` 投影：每个声明式 `toolName+mode` 只保留最新的
`status/code/message/runId/draftRevision`，后续同 operation 成功即移除。物理续窗把这些结构事实直接放进
`continuation_checkpoint`，使 agent 从失败的协议边界继续修正，而不是重新加载完整 Skill、重复读取来源或按
错误文案做本地语义路由；该投影不包含 prompt、创作正文和旧工具大参数。
原始 restricted tool policy、模型配置，以及 agents-cli root 已写入 durable session 且通过独立复核的 `UserIntentContract`。Hono 从
`trace.runtime.userIntentContract` 做纯结构投影，构造同一逻辑任务的 `expectedDelivery`；每个 continuation（包括
已经受理异步资产的 dependency continuation）必须据此注入不可迁移的 machine-owned contract lock。
公开 `AgentsChatRequestSchema` 继续以 `never` 明确拒绝客户端提交 `userIntentContract/userIntentContractLocked`；
内部 continuation 不再把这两个 machine-owned 字段混进公开请求事实后再用同一 schema 解析。恢复器先只用公开 schema
验证持久化的原始请求事实，再对 continuation 中的合同做结构与 `contractHash` 完整性校验，最后仅通过
`trustedPublicContinuation` bridge extras 注入 `userIntentContractLocked=true`。因此公开伪造仍原地失败，可信物理续窗也不会
被公开字段禁令误判为 `Expected never`。
`UserIntentContract` 在首次 `record_user_intent` 只冻结用户语义要求；至少一项 requirement 必须来自
`source=user`，其 `evidence` 数组只作可选追溯信息，不是重复执行闸门。媒体 delivery 必须显式携带 `mediaType=image|video|audio`，
并可携带开放的 kind/output 与用户明确的时长、片段数、比例、分辨率；非媒体必须为 `mediaType=null`，不得重复声明 provider 或模型目录事实。canonical videoModel 只从实际
`BeatSheet.meta.videoModel` 进入实时目录校验并冻结 generationContract；不可用模型在任何付费副作用前原地失败。
物理预算窗口可能在交付合同尚未成功冻结前结束；此时只有 `resumeTrigger=physical_budget` 可在不制造
伪合同的情况下恢复同一 durable session，以完成/修正首次意图冻结。恢复时旧的不完整媒体合同会
按当前 schema 失效，远程媒体动作仍要求新的完整合同，因此不能越过意图冻结重复提交。任何 dependency callback
都不允许走该路径：合同缺失、仍有 unresolved 项或被投影成 `active:false` 时必须显式失败。
只有由服务器从已认证 public turn 创建的 durable continuation 才可显式恢复 public 工具来源，客户端字段不能开启该权限。
可信 continuation 调用 TapCanvas 业务工具时不持久化或复用浏览器 JWT，而是由 Hono 使用既有
`tc_internal:v2:<payload>:<signature>` 一小时有效的 HMAC 服务间凭据恢复原始用户身份；凭据不包含 `INTERNAL_WORKER_TOKEN`，普通请求不能取得该凭据，
内部 worker token 缺失时 continuation 明确失败为 `async_continuation_internal_auth_unavailable`，禁止匿名重试。
因此物理窗口切换后不会丢失 TapCanvas direct/catalog，也不会因当前 HTTP context 缺少 `publicApi` 标记或
浏览器 Authorization header 而退化成空工具面/匿名工具调用。
自动续领还受逻辑 no-progress 预算约束：Hono 只比较 monotonic durable `progressRevision`，同一 revision 连续三个物理窗口没有新增持久动作、任务状态版本或交付证据时，不再因新的 `physicalRunId` 继续生成无限 continuation，而是写入 `logical_task_no_progress_budget_exhausted` 明确失败终态和包含 revision/window count 的诊断 receipt；任一真实持久进度使 revision 增长后计数自然重置。该保险丝不检查 prompt、题材、关键词、审查分数或创作正文，也不会回滚已经受理或生成的媒体资产。
物理窗口挂起时若 durable receipt 已包含 `acceptedAsync + runId`，Hono 会把该 run 映射为 continuation 的
`dependencyRunIds`；continuation 同时持久化显式 `resumeTrigger=physical_budget|dependency`，禁止再通过
`dependencyRunIds` 是否为空反推续跑类型，因为一个正常的物理预算续窗也可能已经持有已受理 runId。
章节画布以 `projectId + chapterId` 验证作用域，不要求伪造项目根 `flowId`。后续物理窗口只在
run 到达 `concatenated` 或进入需要 agent 处理的明确失败/修复态后领取，禁止在供应商仍运行时提前唤醒并用旧画布
快照得出“尚未起跑”的过时结论。
工具后模型续跑首次超时也在同一 run 内复用完整历史自动恢复，连续第二次仍超时才以
`continuationFailure` 如实结束当前物理回合。两次路径都不会要求用户发送“继续”来恢复，已受理任务 ID
与付费证据始终保持同一份权威轨迹，防止新 run 重提。
如果 provider deadline 因 root 物理窗口剩余 wall time 更短而被收窄，则该 deadline 到期后由 agents-cli
重新读取 root ledger：一旦 wall time 已耗尽，必须投影为带 `physicalRunId + progressRevision` 的
`root_physical_execution_budget_exhausted`，由本节同一物理续窗注册器接管；不得保留为没有 continuation receipt
的孤立 `post_tool_continuation_timeout`。只有 root 预算仍未耗尽时，才使用独立模型续跑超时证据。

物理续窗还冻结 `taskCapsule={version,goal,requestFacts}`：`goal` 始终是首个物理 run 的原始任务，后续 continuation
只能复用，不能被“继续处理”之类恢复提示替换；`requestFacts` 保存经过请求 schema 验证且排除认证、transport、
session 和模型覆盖字段后的原始结构事实，作用域、策略与认证身份仍由服务器从持久 continuation 单独恢复。
`goal` 的完整正文只保存在 durable agents session 与 task capsule 中供审计；恢复 prompt 把
`continuation_checkpoint` 放在最前，只追加 `{sha256,chars,source=durable_agents_session}` 的不可变原任务引用，
不在每个物理窗口重放长篇原文或视觉文件。持久会话事实不可用时必须显式失败，禁止用默认任务猜测。
当 continuation 尚未形成任何可执行 `authoritativeProgressFrontier` 时，`null` 只表示业务 DAG 尚未开始，不能被解释为“禁止所有业务动作”。只要没有 durable progress claim、待处理的 dependency task/run 或带精确 `retryInput` 的失败动作，历史只读/已取消 receipt 与无可重提输入的旧失败都只是审计证据；续窗应从不可变 task capsule 恢复必要上下文并执行第一个合法业务动作。已经存在真实 frontier、异步依赖或可修正动作草稿时仍严格服从对应游标，不能借此重复付费或创建平行 run。
由小T通过 `tapcanvas_equipped_workflow_run` 启动的工作流属于同一条 Agent 执行链。工具桥要求并冻结服务端确认的 `parentAgentExecution.model/apiStyle` 到不可变 flow version；内部 `agents.logical-task/v2` 节点的唯一物理提交使用该父模型，画布节点保存的模型只供手动/API 非父代理工作流使用。typed 节点不存在候选形成前后的第二模型窗口；父执行身份缺失或不合法时显式失败，禁止静默回落到节点默认模型。
`ExecutionDO` 是 Workflow 节点生命周期的唯一写 owner。同一个 Durable Object 实例内，`start / recovery / nodeStarted / heartbeat / waiting / progress / nodeComplete / cancel` 全部进入同一条串行 transition lane；原因是外部数据库调用发生 `await` 时请求仍可能交错，单靠 `nodeRunId + attempt` 只能挡住旧 attempt，挡不住同一当前 attempt 的重复投递。当前 attempt 的终态因此只能提交一次：重复 `nodeComplete` 读取到已结算状态后幂等返回，不能再次递减 DAG 入度、再次释放下游或让迟到 progress 把终态改回 running。队列 worker 每 15 秒以同一不可变 attempt identity 续租 heartbeat；失去所有权时旧物理 worker 立即中止。恢复时 DAG 游标始终从持久 node facts 重建，内存 `ready/indeg` 只是可重建投影，不是完成事实。失败后的 resume 仍属于同一逻辑 execution family，必须逐字复用源 execution 冻结的 Flow 与 `workflowProjectContext`；即使旧快照缺少后来新增的资产身份字段，也禁止重新扫描当前可变画布。运行期间新增的节点、资产和项目版本不能反向进入本任务输入；只有用户显式发起新逻辑任务时才能收集新的画布上下文。

Agent 节点的恢复身份必须进一步区分“同一物理 execution 的 runtime restart”与“execution family 内新建的 recovery execution”。前者即使本地尚未来得及保存 `output_refs`，仍可凭完全相同的 `executionId + nodeId + attempt` 恢复该物理窗口的 durable turn；后者只有在当前新 execution 自己已经持久化了可认领 receipt 时才允许 `resumeOnly`。如果新物理 execution 的失败前沿没有自己的 receipt，节点必须用冻结输入、模型和 typed `outputContract` 启动新的物理 Agent turn，不能拿笼统的 queue `phase=recover` 去恢复上一代 session。这样 execution-family 级重试不会丢失结构化输出合同，也不会把上一代失败会话误当作当前活跃 owner；已有持久 receipt 的媒体与 Agent 副作用仍按各自稳定身份对账，不会重复提交。
BeatSheet 的通用 artifact 合同把 `sourceId/sourceFingerprint` 识别为正式 lineage 字段，正常执行再从冻结输入追加精确值约束；恢复复用检查不得因为没有重建 input bindings 就把已验证 lineage 误判成额外字段并重跑 Agent。
`agents.logical-task/v2` 的恢复复用按真实 execution mode 验证：`once` 验证单一 port 值，`each` 必须逐项验证 `workflow.collection/v1.items[].value.text`。禁止把整个 collection 当成单一文本解析失败后将所有后继（尤其已扣费媒体节点）错误失效。

内部 Workflow Agent 的执行 owner 是 `ExecutionDO`：`runWorkflowAgentNode` 是已认证的内部执行边界，它发起的 `directForcedAgentExecution` 固定声明 `trustedInternalExecution + trustedPublicContinuation`，所有权不依赖可选的 `INTERNAL_WORKER_TOKEN`。typed output 只有一个物理提交窗口：成功即交付；候选合同失败保存原始候选证据；供应商流中断、进程重启、429、墙钟或 suspension 在候选前发生时保存执行失败证据。两者都结束节点，不写 `waiting_external`、不创建 `physicalRetryOrdinal`、修补 checkpoint、structured retry 或整体重生。节奏、语义连续性、参数合理性和质量诊断只写 trace。普通公开聊天与已受理异步媒体仍按自己的 continuation/receipt 合同处理，不能借用 typed 节点生成第二份内容。
独立 Workflow Worker 还维护进程内执行租约，租约只代表“该 Worker 内的当前物理执行协程仍在”，不替代数据库里的 node attempt 身份。周期恢复器会同时补发持久 `queued`、`waiting_external`，并扫描仍为 `running` 但已经没有本地执行租约的 execution；后者统一进入与进程重启相同的 `ExecutionDO /recoverAfterRestart` 合同，按不可变执行语义重放、reconcile 或显式收口，而不是继续把失去执行器的 `running` 当成进展。只要同一 execution 还有本地执行租约就不允许周期接管，避免健康长任务被重复派发；短暂数据库断连、队列回调异常或延迟任务丢失则会在下一轮恢复，无需用户发送“继续”或重启服务。节点 attempt、provider receipt、effect identity 与成功 sibling 仍保持幂等和单调，周期恢复不得重复扣费或覆盖已生成资产。Compose/生产部署必须保持 `workflow-runtime-worker` 单副本；切换时先 drain Worker、再停止 API，等待旧数据库命名空间租约真实释放，然后依次拉起 API 与新 Worker，禁止两个版本同时消费。
`/chat/status` 只在物理执行器不活跃时把 `recoveryCheckpoint` 投影为可认领恢复合同。结构修订或物理续跑已经重新进入 `activeTurn=true + state=running` 后，agents-cli 必须抑制继承自上一窗口的 checkpoint；Hono 对滚动部署期间短暂携带的旧 checkpoint 只视为历史证据并从规范化状态中剥离，不校验其旧 reason，也不允许任何恢复 owner 据此重复认领。这样状态轮询不会把正在运行的小T误判为失败，同时 inactive、suspended 与 terminal 的恢复边界仍保持严格验真。
开发与生产 Compose 的每个 `agents-bridge` 副本必须显式持有 `TAPCANVAS_API_INTERNAL_BASE=http://api:8788`。Workflow Agent 的物理续跑可能在原始 HTTP 请求装配已经消失后独立恢复，因此远程工具回调基址不能只靠首轮请求临时注入，也不得回退到公网 Origin、宿主地址或默认值；缺失时必须显式失败。该部署合同保证重启恢复仍走同一 Hono 权限、计费、trace 与画布工具边界，不建立第二条执行路径。
远程工具面存在但回调基址不可见时，还必须追加只包含请求作用域与 context/process 配置存在性布尔值的诊断日志；禁止记录实际基址、凭证、prompt 或工具参数，也禁止用请求 Origin 猜测回调地址。该诊断用于区分 Compose 漏配、WorkerEnv 装配遗漏与非 Node 运行时，不改变显式失败语义。
物理续跑还服从单调代际 fencing：启动第 N 代 Workflow Agent session 前，必须按同一 `executionId + nodeId` 派生的精确身份退休仍可能被延迟 continuation 唤醒的 N−1 代；只有 local transport、runtime 与 continuation 三个取消平面都确认安全后才允许 N 代入场。任一平面结果未知或失败时，节点必须持久化 `workflow_agent_physical_generation_fence_pending` 与原 physical retry ordinal，在同一逻辑节点继续确认，禁止投影成节点失败、重开整条工作流或越过 fence 启动新模型调用，避免同一 typed artifact 出现两个并发模型作者。机器退休使用 `provider_stream_interrupted` 原因同时贯穿 local transport 与 runtime；local transport 不得把它改写成 `chat_turn_user_interrupt`，否则迟到的旧代 status poll 会把内部代际切换误判成用户取消并终止整条工作流。该合同只读取持久执行身份与重试序号，不依赖 prompt、工作流名称或媒体语义，也不会取消已经被供应商受理的媒体任务。
恢复 prompt 同时携带最新通用 `progressCursor`，只允许推进 `allowedNextActions` 中能减少 `pendingUnitIds` 的动作，
不得重新探索 `completedUnitIds`，也不得在 pending 单元仍存在时尝试终态报告。若游标结构性证明全局只有一个
ready operation，agents-cli harness 会在 provider 推理前加载该 operation 的精确 schema，并把本轮模型工具面
收窄为这一个图节点；调度器决定 DAG 边，LLM 只填写该节点的语义 payload。多 ready node 仍保留真实分支给 agent，
每个新物理 continuation 在 provider 推理前，都会从本轮已认证 catalog 和持久 cursor 安装唯一 ready operation 的 discovery entry 并加载精确 schema；该过程不依赖上一物理进程的 `toolDiscoveryCatalog` 内存，也不会把其它 catalog 工具加入能力面。当前物理窗口已预加载或成功读取某 operation schema 时，continuation prompt 要求 agent 直接执行 ready action；禁止重复读取同一 schema 消耗有界窗口。
不会按 prompt、题材、关键词或本地 route 代选。当前一键成片 preflight 只是该通用
游标协议的第一个映射：begin/header/beat/commit 都返回同一结构；协议不识别题材、prompt 或具体 LLM，后续领域可
投影自己的 graph/phase/unit/action，而不用新增 case-by-case continuation 分支。

工具后的续跑超时以“本物理 run 是否已有真实工具动作”判定，而不以 assistant 是否同时输出过程文本判定；因此带文本的工具回合也仍受同一超时与有界同链重规划保护，不能把后续模型调用伪装成新的初始回合而无限等待，也不能在上游持续失活时无限原样重试。首个模型调用同样受相同物理请求时限约束，避免没有前置工具的 writer 子代理因上游连接失活而永久显示为运行中。

初始推理与工具后的 continuation 使用不同的结构阶段预算：初始推理默认 `900000ms`，允许长结构化 writer 在首个 tool 之前完成完整输出；已经取得工具结果后的 continuation 默认 `300000ms`。两者仍受 root 物理执行剩余预算取最小值约束，因此延长首稿窗口不会绕过物理执行边界，也不会让失活上游永久显示运行中。

工具失败的用户可见性与内部失败证据分离：agents-cli/Hono 始终保留完整 `toolCalls`、结构化失败、恢复/重规划轨迹及最终 delivery verification，不能删除或改写这些诊断事实。Web 聊天对失败和 warning 采用终态延迟投影：同一执行链仍在继续且最终为成功、异步挂起或等待不可推导用户事实时，中间失败只保留在内部 trace，不污染聊天步骤；只有权威 `requestTerminal.status=failed` 或流异常无法形成终态时，才把暂存失败步骤补入用户可见错误。该规则按结构化状态与终态执行，不按工具名、错误文案或关键词做语义判断。

agents-cli 对工具执行设置三层结构性重复调用安全边界。第一层保持精确逻辑动作（逻辑工具名加规范化参数）连续最多 5 次，并在第 6 次执行前返回结构化 `consecutive_tool_call_limit_reached`。第二层对所有声明为 `sideEffect=none + retrySafety=safe` 的只读工具维护独立于 provider history 的 run 级“事实作用域”计数：`chapterNumber/chapter/chapterId` 会归一到同一章节身份，`fields/mode/contentMode/include/limit` 仅是投影视图、不能伪装成新的事实目标，Skill/schema/其它只读工具穿插也不会重置计数。普通实时事实同一状态 epoch 最多成功读取 5 次；同一 Skill 或同一工具 schema 这类静态协议资源每个 epoch 只允许成功加载一次。计数在工具 settled 后依据真实成功 receipt 写入，执行前被 schema、ready frontier、网络或其它协议边界拒绝的读取不消耗额度，后续仍能按同一 selector 重试；不能再把失败的 schema discovery 误报成“已经成功加载”。第三层依据工具声明的执行语义阻止付费或外部副作用动作被原样重放：完全相同、已成功且声明 `sideEffect!=none + retrySafety=unsafe` 的动作在执行前返回 `unsafe_action_already_succeeded`；此前失败、不同参数、要求幂等键的动作和只读轮询仍可按各自合同推进。旧的特定视频工具“双起跑”判断已删除，不解析业务输出文案来猜动作是否成功。只有声明具有副作用、tool trace 为 `succeeded` 且 receipt 本身与嵌套 `data` 均未返回 `ok:false` 的结果才开启新的状态 epoch；失败、blocked、嵌套业务失败、Skill、schema 和轮询均不能重置。阻断发生在执行前，因此不会产生超限调用的副作用；不同节点、章节或工具 schema 仍分别计数。

并行工具批次还维护 provider tool-call 的配对不变量：批次内某个动作失败后，尚未启动的调用不会产生副作用，但 runtime 会为每个原始 tool-call 写入结构化 `parallel_batch_cancelled_after_failure` tool-result 与 `blocked` trace，再进入下一轮 continuation。这样失败只关闭当前批次动作，模型仍能收到完整事实并流转到下一个安全任务，不会因缺少 tool-result 触发上游协议错误或 `live failed`。

远程工具的 HTTP 200 只证明回执可达，不代表业务动作成功。任意层级结构化 payload 的 `ok:false`（包括
`severity=warning`）统一记录为 `failed` action trace 并回灌同链修复；warning 只描述严重度，不能增加 durable
progress、不能进入成功收据，也不能触发 `unsafe_action_already_succeeded`。只有真实 `ok:true` 的业务回执才可
占用不可重放动作的成功锁。

远程任务的 provider 上下文仍以当前 task window 为边界；在后续已取得权威工具事实后，agents-cli 会结构性移除已消费的知识卡全文与其配对调用，保留持久会话和真实画布/任务证据可再读取。这只避免把方法论检索结果无限重放到每次续跑，不摘要、截断或覆盖受保护的创作事实。

Skill/domain/prompt-example 召回统一进入 agents-cli `RetrievalSandbox@retrieval-sandbox/v1`，Hono 不建立第二个检索 Agent、固定 SOP 或语义路由。每轮运行时固定保存用户原始请求；Workflow 原子 Agent 另外把真实上游端口中的 `canvasFacts.text` 作为优先原始检索请求，缺少该结构化来源时才使用完整上游端口 JSON。同时 Hono 生成有界 `retrieval-context/v1`：只包含节点 instruction、交付 requirement、输出 artifact type、forced role 和最多四个真实输入端口投影，不做关键词提取或语义分类。`retrievalUserRequest + retrievalContext` 都写入 trusted task extras 与 machine-owned continuation execution contract，物理续跑必须原样恢复，不能被 continuation prompt 稀释或替换。该检索上下文只影响候选召回，不替换模型实际收到的完整节点任务。

`skill_search`、`knowledge_search` 与 `prompt_example_search` 必须把原始请求作为第一检索视图；模型生成的查询改写、冻结合同和结构化输入事实只能作为附加候选证据，不能替换用户诉求。沙盒只返回由本请求至少一个 query view 支持、score>0 的有界高排序候选，不设置绝对语义相似度闸门。每次工具回执都包含 `retrieval-sandbox-receipt/v1`：requestHash、candidate kind、queryViewIds、scope、初排/返回数量、abstained、`blocking=false` 与 `bodyAccess=candidate_set_required`；Hono trace sanitizer只保留这些结构字段和候选元数据，不落用户检索正文。Web 执行脑图展示“返回数/初排数”和正文边界，不把候选命中显示成已读取。

`knowledge_search` 会对去重后的
原始请求、must/prefer、已确认事实与 Agent 补充查询分别生成 embedding，并以结构化来源权重融合各视角的
vector rank 与 cosine similarity；用户原话、明确名称与 must 权重最高，Agent 改写不能擦除原始请求命中。
同一知识卡跨视角只保留一个候选身份，`matchedQueryIds` 记录实际支持该候选的视角，最终 score 是有界融合排序分，
不是伪造的语义置信度。向量查询在同一批次并行执行；单次召回最多执行 16 个去重视角，超出时只按结构化证据
优先级保留用户原话、明确名称与 must，再保留 Agent 查询、prefer 和事实视角，并在 diagnostics 明确记录请求、执行和
省略数量，避免超大合同制造无界数据库扇出。提示词案例检索在同一媒体 source root 内同时执行 pgvector 与
Postgres `simple` 词法召回，按向量相似度、RRF 风格 rank evidence、词法得分与视角覆盖做有界融合，并按标题+正文去重；
显式 `model/provider` 事实只提升同模型案例排序，不排除可迁移的跨模型视频案例。词法侧不可用时保留向量结果，
向量侧不可用时按确定性边界原样报告；两侧均无候选也只是 `no_match` 诊断，不是任务失败。相关
`lexicalCandidates/lexicalHits/lexicalSearches/lexicalSearchAvailable/deduplicatedResults` 与原有向量诊断一并写入 trace。
Skill 候选集记录后再由 agents 选择并调用 `Skill` 读取正文；加载带 `knowledge-domains` 的 Skill 不再自动注入
`knowledge-preflight`，也不构造固定 `Skill -> knowledge_search -> knowledge_read` 前置。生产执行授权与专业方法加载相互独立：当前交付若只是确认事实可以不加载 Skill；若要形成不能由事实直接推出的专业结论，则不论是否执行生产，都先加载正向 Skill，再在当前节点输出合同确实缺少实质专业事实、且已有 Skill/项目/工具证据不足时按本轮请求检索领域知识。领域知识
只返回候选元数据，不返回正文或正文预览，再由 agents 调用 `knowledge_read` 精确读取单卡；`knowledge_read` 必须携带当前 candidateSetId，旧节点挂载不再构成旁路。未命中不是媒体执行或交付闸门。“有哪些知识卡/知识库是否为空”等
结构性问题使用 `knowledge_catalog`。无正向证据返回空集，不使用默认 Skill/domain 或零分卡片填空。Hono
不实现上述召回、RRF、重排或语义选择，只透传结构化事实、权限和工具协议。依附在 Skill 下的
`get_playbook` 也不能绕过这条链路：它只有在当前 run 已经选中/加载父 Skill 后才能读取 references；
同一执行链内已经成功的 Skill/reference 与检索候选集会按当前用户请求复用，避免重复向量/文本召回和重复注入；
三种搜索回执都携带完整、可校验的 candidate set receipt 与 Retrieval Sandbox receipt，并且一律不含正文或正文预览。typed 图片/视频提示词范围只约束 `prompt_example_search` 的同媒体 source root；正文必须通过携带同一候选回执的精确 read 工具选择性读取。通用 `knowledge_search` 同样不因媒体提示词范围自动预取正文。物理模型窗口切换时，
agents-cli 从持久 tool message 与 continuation receipt 恢复它，并重新校验 candidateSetId、候选顺序、分数、来源、
逻辑任务与原始请求哈希；因此已召回候选可以直接继续消费，不会因运行窗口切换重新召回后漂移，也不能把旧用户回合或
被篡改的候选当作授权。Skill 正向候选尚未消费时，运行时只认可当前物理 run 实际加载的 Skill，不允许历史 session
里的同名加载冒充本任务选择；模型可见的 `Skill` JSON Schema 同时把 `skill` 收窄为该 receipt 的 candidateId 枚举，
并把 `selection.candidateSetId` 固定为同一 receipt。这样候选身份由协议携带，而不是依靠续跑 prompt 记忆或模型猜测名称。
只有证据明确不足或用户提出新的独立范围时才追加检索。
Skill 候选文档只由 `name`、`description` 与结构化能力合同构成；旧的 `activation-keywords`、
`activation-patterns`、`force-on-match` 已从 Skill 格式、loader 和创建工具中硬删除，Hono 与 agents-cli
均不得恢复关键词命中、正则匹配、强制预热或兼容解析。description 负责说明正向适用场景，边界与禁用场景
留在 Skill 正文供 agent 选择后判断，避免词法召回把否定示例误当成正证据。
远程 `tapcanvas_public/host` 运行对 Skill 正文采用渐进披露：首次 `Skill` 只返回有界骨架与标题索引；该骨架只构成发现证据，不写入 `loadedSkillSources`，也不能满足专业交付的 `decisionBasis`。
模型进入具体生产阶段后，只能把 Skill 骨架 `availableSections[]` 中机器提供的稳定 `sectionId` 原样传给 `Skill.sectionId` 读取单个 Markdown 标题单元；自由文本 `Skill.section` 已硬删除，不做标题、编号、前缀或模糊匹配。精确 sectionId/resource 或其它真实完整正文才形成可绑定的方法来源。明确声明的 `resource` 仍只读取请求的
单个 references 文件。本地代码表面保留完整正文读取。SkillLoader 仍在 agents 侧读取真实文件并保留完整
执行审计，但不会把 74KB 级别的整份 SKILL.md 常驻或重复塞进远程 LLM 上下文。
历史回合加载过的 Skill 不会解锁本轮 playbook。项目级导演人格只作为用户已选定的项目事实传递，
不会由 Hono 固定指示读取某个 domain；是否需要该知识仍由 agents 根据本轮请求决定。

章节级导演/影调覆盖同样作为当前章节的显式事实传递：Web 将 `styleProfileOverride` 持久化到章节，
并把其中已选的 `chapterDirectorPersona` 与 `chapterStyleOverride` 放入本章节聊天上下文；它只覆盖当前章节，
不改变项目级默认配置。导演人格列表固定高度滚动；目录人格只传 `personaId/personaName/source=catalog`，
用户新增的本章导演人格则传 `source=custom + prompt` 原文。Hono 只做结构与长度边界校验，agents-cli
将自定义 prompt 作为本章用户事实注入，不把它伪装成知识卡，也不由 Web/Hono 解析其语义。
项目角色技能配置存放在项目作用域的 `projectAgentRoleSkills` 资产中，`roleSkillAssignments` 携带每个角色的
系统 Skill 标识或用户填写/上传的自定义 Skill 文本。Hono 只做结构、数量、来源和权限边界校验并透传，
agents-cli 在根代理和委派角色的执行链中按角色应用对应配置，负责系统 Skill 加载与自定义文本注入；
常驻 system context 只保留角色/Skill 索引、来源和自定义正文长度，custom 正文保留在本轮 runtime meta，
仅当对应角色真正执行或委派时才注入该角色正文，避免把项目所有角色的 Skill 全文带入每次规划；
前端和 Hono 不根据角色名、Skill 文本或关键词自行路由创作流程。

领域知识的检索实现仍完全归 agents-cli 的 `knowledge_search` 工具所有，Hono 不按 intent、prompt
或关键词选择检索路径。运行时只有一条知识路径：agents-bridge 通过独立的
`AGENTS_EMBEDDING_BASE_URL` 调 new-api `/v1/embeddings`，并从主 Postgres 的
`agent_knowledge_vectors`（pgvector）召回向量候选；`knowledge_read` 与 `knowledge_catalog` 也只从
该物化表读取卡片正文和目录。本地 `apps/agents-cli/knowledge/` 仅是可审计存档与显式增量同步源，
模型侧工具不会扫描或直接读取这些文件。embedding 默认使用与当前 pgvector 列一致的
`doubao-embedding-vision-251215`/2048 维，调用凭证复用 `AGENTS_API_KEY`，可由
`AGENTS_EMBEDDING_API_KEY` 显式覆盖；阿里云上游密钥留在 new-api 渠道，不下发到 Hono 或
agents-cli。embedding、pgvector 扩展、表结构或维度任一确定性边界失败都会原地报告，
不得回退本地检索或其它模式；向量候选仍需提供正相似度，不能把无证据 top-k 当成默认知识。`knowledge_read`
还会绑定本轮 `candidateSetId` 与原始请求哈希，旧回合候选或直接 cardId 读取都会被 agents-cli
显式拒绝；工具返回请求/执行/省略的查询视角数、实际向量检索次数、各视角命中总数、融合后向量候选数、已索引卡数、
embedding 模型、每张候选的 vector rank/score/matchedQueryIds，以及混合召回的词法命中、去重和可用性字段供诊断。
Hono trace 只持久化这些非正文证据，
Web 执行脑图据此区分“检索视角”“视角命中”“融合候选”，不把候选命中显示成已经读取知识卡。
后台管理员通过 `/admin/knowledge` 管理同一份向量物化数据：列表与编辑由 Hono 做 JWT/管理员权限校验，
再通过受 bridge token 保护的内部 `/admin/knowledge` 端点调用 agents-cli。GET 查询硬切为服务端分页合同，
支持 `collection/page/pageSize/query/domain/facet/roleScope`，统一返回内置知识、图片提示词与视频提示词三个
source root 的计数、筛选选项、分页事实和当前页正文；查询词只用于数据库字段过滤，不承担语义路由。
提示词案例以 `editable=false` 只读展示，后台不得借知识卡保存端点覆盖提示词库真源；单卡新增、编辑与
`POST /admin/knowledge/sync` 仍只作用于可编辑的内置知识集合，“全量同步”不得误报为全部提示词案例重嵌入。
保存一张卡会使用与运行时
相同的 `AGENTS_EMBEDDING_MODEL` 配置重新生成 embedding，并在 embedding 成功后写入
`agent_knowledge_vectors`；`POST /admin/knowledge/sync` 会显式重新嵌入当前索引中的全部卡片。bridge
容器内的 `knowledge/` 挂载仍是只读文件系统，后台不会覆盖它。后台修改写入向量表后立即成为运行时
候选。仓库随附的内置卡可同时携带 `tapcanvas.compiled-knowledge-vector/v1` 编译向量；启动同步只接受正文哈希、cardId、模型、编码与 2048 维全部一致的产物，禁止以零向量、随机向量或缺配置时的默认值代替真实 embedding。
向量行的 `source_kind` 区分 `filesystem` 与 `admin`：单卡后台保存切换为 `admin`；
文件存档执行显式增量同步时会跳过同 ID 的 `admin` 卡，避免本地存档覆盖后台版本。管理员的全索引
重嵌入保留原有来源标记，不会把全部文件卡批量变成后台卡。

内置 `apps/agents-cli/knowledge` 的向量 `source_root` 使用稳定逻辑标识
`builtin:agents-cli/knowledge`，不使用宿主机或容器绝对路径。向量相似度本身不依赖路径，但
`source_root` 是向量表的知识库隔离命名空间；写入与增量同步统一收敛到逻辑标识，避免 Docker、
宿主机和 CI 的本地存档绝对路径进入运行时身份。
文件知识的日常物化使用 `knowledge:vectors:sync`：先按 `contentSha256 + embeddingModel` 比较指纹，
只为新增或变化卡生成 embedding 并 upsert，保留同 ID 的 `admin` 卡且不执行隐式删除；显式全量重建
仍是独立维护动作。数据库里的绝对 `source_path` 只作为审计来源信息，不参与运行时候选身份；
运行时以规范化的 `source_root + card_id` 读取物化卡片。
agents-cli 的常驻 prompt 也不再要求任务结束后自动反思、写记忆或启动领域学习；旧的环境开关式
后台 `skill-curator` 同样已删除。这类学习动作只有用户明确要求时才进入当前任务，已满足的交付
不会为了“沉淀经验”追加模型轮次、工具调用或同步 session-rollup/memory-summary 重建。context pipeline
也不再按反馈关键词分类、扫描并持久化 Skill inventory、注入 learned profile；run 收尾不再写 tool-stats。
会话历史仍按 checkpoint 持久化，跨会话长期记忆只接受显式 memory 工具写入。

agents-cli 的记忆入口现已收敛为统一的 `MemoryBackend` 合同：`memory_save`、`memory_search`、
`memory_forget`、反思提交，以及 context pipeline 的分层召回/提示片段装配都通过同一个 backend 适配层，
默认实现为 `LocalMemoryBackend`（本地文件存储）。显式设置 `AGENTS_MEMORY_BACKEND=memory-core` 后，
runtime 会使用 `MemoryCoreAugmentedBackend`：显式 `memory_*` 工具仍保留本地归档/反思语义，MemoryCore
负责跨 session 的 conversation L0/L1/L2/L3 召回与会话 capture；其中 L0 原始对话会在每轮上下文装配时通过
`/v3/conversation/search` 参与跨 session 召回，L1/L2/L3 继续通过分层接口提供结构化记忆；两者由同一个 backend 工厂装配，
并在 runtime trace 的 `runtimeMeta.memoryBackendKind` 记录实际 provider。该模式必须同时配置
`AGENTS_MEMORY_CORE_ENDPOINT`、`AGENTS_MEMORY_CORE_API_KEY`、`AGENTS_MEMORY_CORE_SERVICE_ID`，并由 bridge 传入规范化的
`teamId/agentId/userId/sessionId`（其中 agentId 由服务端 `AGENTS_MEMORY_CORE_AGENT_ID` 配置；`userId` 永远来自当前认证请求的
`effectiveUserId`，禁止使用进程级固定 `AGENTS_MEMORY_CORE_USER_ID`，仅受信任的内部工作流可显式覆盖 agentId）。`teamId` 优先使用当前请求的
`activeTeamId`，仅在本地单团队请求没有该字段时使用 `AGENTS_MEMORY_CORE_TEAM_ID`。缺任一确定性身份或配置会原地报错，
不会隐式切回本地。`apps/agents-cli/src/core/memory/memory-core-client.ts` 负责严格类型的 v3 HTTP
请求、身份 headers/body、atomic/scenario/core 召回和 conversation 写入；远端失败只写入
`memoryProviderDiagnostics`/`memoryCaptureDiagnostics`，不伪造共享记忆成功，也不阻断原始用户交付。
HTTP `/chat` 与 CLI runtime 共用同一个 backend 工厂：带 `sessionId` 的小T回合在 admission 时先把 user 消息
追加到 MemoryCore，拿到 assistant 可见正文后再追加 assistant（包括 `suspended`/`partial` 物理窗口），并把
capture receipt 放入 runtime diagnostics，并在 `/chat` 响应的 `trace.runtime.memoryProviderDiagnostics` /
`memoryCaptureDiagnostics` 暴露实际召回条数、写入条数和失败阶段；捕获失败只记录诊断，不回滚已经返回给用户的正文，也不依赖后续完成验收或租约结算。
若物理回合只有用户输入、assistant 正文尚未产生，则仍追加 user-only 的 L0 记录，空 assistant 不会让整批 capture 被协议拒绝。
agents-cli 的 schema discovery 在没有授权 catalog 时保留合法基础参数 schema，
禁止把空 `oneOf` 发送给模型网关。

MemoryCore 的运行时记忆作用域分为两类：用户级记忆按 `teamId + agentId + effectiveUserId` 隔离，
项目级记忆必须由项目权限校验后以显式项目作用域装配；不能把项目 ID 塞进 `userId`，也不能把
管理员查看权限混入普通 Agent 的召回上下文。管理员的全量会话查看属于独立的管理查询路径：先由
Hono 主用户库验证管理员对团队/项目的权限，再按正式用户列表分页查询 MemoryCore 并在 API 层聚合，
不做跨数据库 JOIN。MemoryPanel 的 Chat Memory 管理员视图把每个正式用户投影成独立的只读块，
详情和搜索继续携带同一用户作用域；导入、分配、编辑和删除不会对管理员开放。8798 回归脚本产生的
合成身份只存在于测试数据域，不反向注册为正式用户。当前 MemoryCore v3 的 L0 conversation 接口原生只支持
`team_id/agent_id/user_id/task_id`，尚未提供 `project_id` 字段；因此现阶段 L0 对话仍按用户级保存，
项目级共享记忆使用带项目元数据的 Memory Asset/知识资产：资产创建、更新或重命名后，Hono 会在本地
`memory_entries` 写入一条 project-scope `artifact_ref` 索引（仅包含 `projectId/assetId/updatedAt` 以及
结构化类型、真实 HTTP(S) URL 等引用元数据，不复制原始素材）；同一资产的新版本会将旧索引标记为
`superseded`，保留审计记录但不再参与 active 召回。项目内不同 Flow 共享这份索引，具体会话仍按
`sessionKey` 隔离；agents 需要使用项目/资产工具解析引用的事实源。MemoryCore v3 的 L0 conversation
接口仍只支持 `team_id/agent_id/user_id/task_id`，因此不能把 `project_id` 塞进 `userId`，也不能用
`task_id` 或固定用户桶冒充项目隔离。

画布远程工具采用两层、每轮替换的 canonical 合同。普通 public chat 按认证请求的结构 scope 确定性暴露
高频 direct 工具；具体数量由同一 `REMOTE_TOOL_CONTRACTS` 真源和当前 project/canvas/chapter/book/node/execution
作用域计算，不在文档另维护会漂移的固定计数。direct 只包括高频只读结构工具，以及 requiredScope 完整满足时的 `flow_patch` / `node_text_edit`；
付费生成、媒体分析、导演台和低频持久化继续进入轻量 `remoteToolCatalog` 名称/能力标签/执行语义注册表，并为每项附加
`requiredScope`（`project/canvas/chapter_canvas/book/node/execution`）和 `capability`。完整参数 schema 不随每轮
聊天请求搬运；agents-cli 只有在模型请求某个精确 catalog 名称时，才通过同一认证工具桥按需读取该工具的完整
schema，并将本轮已读取的 schema 放入瞬时发现缓存。catalog 外工具不可执行；调用方显式 `executionToolPolicy.allowedTools` 与
direct + catalog 取交集，原本属于 catalog 的工具仍保持 deferred，入口缩小能力面不会把大型 schema 提升为常驻 direct；未知名称继续 400。catalog 还必须满足真实
callback envelope：`project/canvas/chapter_canvas/book/node/execution` 的每一个 requiredScope 都必须已由
当前请求满足，缺少任一 scope 的工具不会进入 direct 或 catalog。模型之后在 tool args 中提供的
`bookId/nodeId/executionId` 不能扩大本轮能力面或 wrapper enum。该划分只读取已验证的
`projectId/flowId/bookId/chapterId/nodeId/executionId` 与权限事实，不读取 prompt，不做 intent route、
关键词或正则语义判断。

两数组在每个请求里都必须显式发送（包括 `[]`），禁止与 session 旧值 union。无授权 project 时两者
都为空；project-only discovery 以 direct 方式提供有界结构工具，只有 requiredScope 已满足的低频工具才进入
cold catalog；建立 canvas/chapter/book/node/execution scope 后，各结构域按合同增量开放。`project_flows_list`、
`books_list` 这类只用于发现既有作用域的工具可在对应 scope 已由请求 envelope 建立后移除；但
`tapcanvas_project_context_get` 在项目根画布与章节画布都保持 direct，因为其中版本化的 `CREATIVE_BRIEF.md`
是手动连载与导入书籍共用的跨章节叙事真相源。它只在 agent 明确调用时才读取正文，不会随每轮工具定义预载大文件。
`tapcanvas_project_creative_brief_update` 是 PROJECT 作用域下的 cold、unsafe、exclusive 持久化工具：调用前先读当前
project context，随后以完整 Markdown 替换 `CREATIVE_BRIEF.md` 并保留不可变版本历史；它不修改自动投影的
`PROJECT.md/RULES.md/CHARACTERS.md/STORY_STATE.md`。世界规则、故事/人物圣经、全书总纲、未决伏笔与章节计划都可由
agents 根据本轮用户确认事实组织进该文档，Hono 只执行权限、长度、文件名和持久化协议，不解析正文语义。

项目章节事实与上传书籍事实严格分离。`tapcanvas_project_chapters_list` 读取 `chapters` 表中的全部真实章节，覆盖手动新建
与书籍关联章节，但只返回 ID、顺序、标题、状态、来源书 ID 与时间戳等目录 metadata，明确不返回 summary 或任何叙事正文；`tapcanvas_project_chapter_get` 按章节行 ID 返回本章 metadata（含手动输入的 summary）与独立
`chapters.canvas_flow` 的 revision/节点事实。`tapcanvas_books_list=[]` 只证明没有上传书籍，绝不能推出项目没有章节；
项目根画布节点为 0 也不能推出章节独立画布为空。章节画布的默认节点返回继续使用 slim 投影，精读正文时必须显式传
`nodeIds + fields`，避免跨章读取把全部长文本一次塞入模型上下文。
`tapcanvas_hyperframes_render` 是明确的 project-only 付费渲染例外：真实 callback 在 flow row 读取前执行，
素材完全由 args URL 提供，因此以 PROJECT cold catalog 暴露并继续携带 `paid_generation/unsafe/exclusive`
执行合同。execution list 在 PROJECT+CANVAS 下是 direct 结构诊断；get/node-runs/events 还要求当前 envelope 已带
`executionId`，callback 必须验证 execution 属于当前用户、当前 flow 且该 flow 属于 envelope project，
跨用户、跨 flow 或跨项目一律按不存在拒绝。`tapcanvas_shot_table_critic` 作为可选 reviewer 默认既不进
direct 也不进 catalog，只有调用方显式 execution policy 才能授权为 opt-in direct；即使显式授权，verdict 也只作为
ephemeral 修订证据回灌同一 agents-cli writer 链，不进入 Hono/Web 的生成闸门、完成态或用户可见 blocked/failed。

`tapcanvas_get_style_reference` 是 PROJECT 已满足时的只读 cold 工具；完整视频链路需要读取
项目画风事实，但该工具只返回存在性、数量与 `server_auto_inject` 策略，不返回存储 URL，也不写入项目。
`tapcanvas_project_look_bible_get/confirm` 同样属于 PROJECT / PROJECT+CANVAS 的 cold catalog：前者读取
项目当前激活的不可变视觉圣经版本，后者要求 `kind=text + productionLayer=anchors +
semanticKind=projectLookBible` 的真实来源节点并 fresh-read 后确认。Project Look Bible 使用开放
`sections[].dimension` 承载影调、色调、灯光、时代、美术、材质或未来视觉维度；本地不维护语义枚举。
追加时 agents 必须先读当前版本、保留本轮未覆盖 sections，再提交完整 Vn+1。版本保存在既有项目
`assets` 关联中，不新建平行本地文件或数据库表；`GET /materials/project-look-bible?projectId=...` 仅返回
当前激活摘要供 Web 展示。图片生成边界读取最新激活版本，角色卡只使用 global character projection；
普通图片可使用 agents 显式选择的 section ids。视频 preflight 从数据库冻结版本 hash 与文字投影进
BeatSheet，后续 writer/driver 不随项目新版本漂移。项目画风锚图片仍只属于图片链，不进入视频输入。
Web 的项目视觉入口通过显式 restricted execution policy 只授权 look-bible get/confirm、flow patch 与
node text edit 四项真实画布能力，并用独立 `displayText` 展示用户友好文案；完整内部合同和第一方原文仍
只作为 agent request，不回显成用户聊天气泡。`requiredSkills=tapcanvas-style-pack` 已在执行前预读，入口
明确禁止模型再次裸加载同名 Skill。章节长文按 skill 合同先创建带唯一短占位的候选节点，再以
`tapcanvas_node_text_edit` 精确替换正文，避免把长文本与 flow-patch 结构 JSON 混合；项目根画布不支持
node text edit 时才复用同一候选节点做 `patchNodeData`，不得因参数失败重复创建节点。
agents bridge 回调遇到 `ECONNREFUSED` 时，只在“TCP 连接尚未建立、远端不可能已受理动作”这一确定性
条件下跨越短暂 API 滚动重启做有界重试；`ECONNRESET`、超时等可能已经受理的写入继续服从原工具的
retrySafety，禁止模糊重放或重复付费。传输回执必须显式携带 `acceptanceKnown + sideEffectOutcomeKnown`；
对受理状态未知且 `sideEffect!=none + retrySafety=unsafe` 的精确动作，agents-cli 立即关闭该 action key，
只允许先走状态/任务/资产证据对账或选择另一个已授权安全动作，不能让模型原样重提。动作关闭不等于逻辑任务失败。
agents-cli 的 durable turn checkpoint 会保存 verifier 已通过后的
`finalResponse`。浏览器 SSE 在回合受理后断开时，Web 先按稳定 turnId 重查 `/public/agents/chat/status`：
仍运行则切换到既有恢复投影继续观察，已终态则用 checkpoint 的真实 finalResponse 收口原气泡；只有多次
状态查询均不可达或无法匹配同一 turnId 时才显示 network error，禁止把后台已成功的任务伪装成失败。
对话恢复权限严格绑定已经解析完成的精确 conversation session identity。项目/flow/chapter 作用域解析过程中
短暂出现的默认 key、上一个 key 或中间 key 不查询也不认领 orphan checkpoint；显式“新建对话”或生产入口的
`freshConversation=true` 会在旋转 base key 前同步撤销旧状态请求的恢复资格，旧请求即使稍后返回也不得调用
`/public/agents/chat/resume`。该入口在发送边界显式声明创建新逻辑任务，不能被旧 React 快照改投成旧 turn 的
follow-up；只有用户恢复同一历史 conversation 时，才允许用该 conversation 返回的精确 `sessionKey + turnId`
恢复同一物理执行窗口。新对话因此保留模型/比例/分辨率等合法生成偏好，但不继承旧 run、旧 checkpoint、
旧 BeatSheet 或旧任务修复上下文。
完整视频任务只发现和调用 `tapcanvas_equipped_workflow_run`。动态 schema 从当前用户已装配 attachment 的冻结 Workflow IR
推导真实必填字段；存在未固定模型的 `agents.delivery.contract/v2` 节点时，`triggerPayload.videoModelKey` 必填且 enum
只包含实时启用 canonical modelKey。入口在创建 execution 前再次验证 attachment、模型、权限与幂等，不提供默认模型，
也不允许根代理用裸媒体工具或普通工作流建立平行生产链。章节入口显式请求 `full_video|first_video` 时，能力舱装配服务必须先按该结构化变体验真冻结版本、画布定义版本与指纹、作者图一致性、路由确认和用户开关；没有匹配附件或附件过期时，请求在模型调用前以精确 `capability_workflow_*` / `capability_attachment_*` 终态失败，禁止把已装备但不可执行的工作流静默移出工具面后再泛化成 `agents_execution_tool_policy_unknown_tool`，更禁止进入纠偏、重试或悬空等待。普通
PROJECT+CANVAS chat 不再预取模型目录或把 `<enabled_video_model_catalog>` 常驻塞进 system prompt；只有
agents 真正选择媒体工具后，schema/preflight 才按需读取当前模型合同。`tapcanvas_image_generate_to_canvas`
的实时 schema 会附带 `executionCatalog`（目录 revision、读取时间、精确图片 `modelKey`、规格与价格事实），
agent 必须把其中一个键原样写入 `node.data.modelKey`，不得杜撰、缩写、翻译或替换模型身份。若首次调用仍
遗漏模型，`image_model_required` 会返回同结构目录供同一 agents-cli 执行链修正；目录读取失败或为空分别以
`image_model_catalog_unavailable` / `image_model_catalog_empty` 显式失败，不提供默认模型。所有公开图片任务
在创建 task id、写入 running 状态、计费或启动 detached worker 之前，都会用同一 fresh runtime 合同同步
校验模型；失效模型以 `new_api_model_disabled` 返回精确 `executableModels` 且
`upstreamRequestAttempted=false`。后台真正提交上游前再次校验，以显式处理受理后到提交前的实时停用，
不会把确定性无效模型伪装成已排队任务。estimate 的计费、逐段与片段数事实只服务于服务端内部核算与 reconcile。公开 agents 工具
通过 allowlist 投影只返回 runId、总时长与必要模型合同，不返回可解码计费令牌；AI 对话只展示“20 秒”
这类总时长和真实执行状态，不展示价格、积分、片段数或逐段计费。
catalog wrapper 只属于传输层身份。agents-cli 在未脱敏的运行时参数上解析内层逻辑能力，并让 SSE `toolName`、
durable rollout tool event 与 Web 执行详情统一记录真实业务名（例如 `equipped_workflow_run`）；仅在二者不同时附带
`transportToolName="tapcanvas_call_tool"` 供诊断。Hono 原样透传这两个结构字段，不从已脱敏 input 反推工具名，
也不把 wrapper 名称当作用户可见业务步骤。最终 tool trace 还会独立持久化 `logicalToolName`；续跑器、durable
receipt 与异步交付证据都直接读取这个非敏感协议字段，禁止再从已哈希的 `input.name` 重建业务工具身份。这样批量
图片/视频任务即使输入按诊断策略脱敏，真实 `nodeId/taskId/runId` 仍能被登记为 continuation 依赖，而不会误判为
`async_continuation_no_progress`。
模型 deadline 区分初始推理与工具后续跑：初始结构化生成默认允许 900 秒，工具后续跑默认 300 秒，二者仍受当前
root 物理窗口剩余预算的更小值约束。这样无前置 tool checkpoint 的大型 specialist 首稿不会在供应商仍持续推理时
被较短的 post-tool deadline 截断；工具结果后的恢复仍保持较短、有界，且两类超时分别记录
`initial_inference_timeout` / `post_tool_continuation_timeout`，不得互相冒充。
远程 public/host surface 的 required Skill 先注入有限骨架（标题、依赖、初始摘要）；Skill frontmatter 明确声明的
`autoload-resources` 会随骨架只注入那些小型、必需的结构合同，其余阶段内容仍由模型用 `Skill.sectionId` 按机器索引精确
Markdown 标题读取。父标题返回超过 12,000 字符时只保留结构性前缀并列出可继续读取的子标题，不得把完整 74KB
`SKILL.md` 或一个 37KB 父 section 重复带入后续回合。`Skill.resource` 只读取明确指定的一份 references 文件；
本地 code surface 仍保留完整 Skill 行为。该边界是字节/标题结构裁剪，不是按主题关键词选择内容。
用户明确要求生成媒体即授权当前冻结范围，完整成片状态机在内部 estimate 成功后直接对同一 run 执行唯一一次 start；`estimate_ready` 只是可恢复瞬时态，不再写确认卡、等待第二次答复，也不因历史 pending choices 或 `autoApprove` 缺失停住。agents-cli 的旧视频 start consent gate 已从执行路径移除；真正缺少项目权限、余额、scope 或新增/扩大的用户范围时仍按确定性事实显式失败。
旧的 `meta.durationPlanningEvidence`、理论最少窗口比较和“尽量减少片段”偏好已从运行时删除。
`deliveryScope=full_chapter` 禁止调用方提交 `targetDurationSeconds`：agents 先覆盖完整原文，再按对白容量、动作完成、
连续性和动态 `durationOptions` 选择每拍合法时长，成片总时长由全部 `beats[].durationBudget` 求和。只有用户明确指定
`bounded_duration` 时才提交目标时长，并要求逐拍求和精确命中。服务端仍只校验结构、合法时长、计费与真实资产事实，
不从“高燃/疯切/多镜”等文案推断分段，也不替 agents 选择或重写创作方案。
agents-cli 仍负责把用户显式事实或账号偏好写入生成合同；Hono 只为没有历史选择的新账号补齐产品初始偏好，不把目录顺序解释成默认模型、路由或创作决策。
`[agents-bridge.tool-surface]` 每轮记录 requestId、真实 scopes、policy、direct/catalog/hidden 数量、direct definition
字符数与 catalog wrapper enum 字符数；开启 `AGENTS_BRIDGE_DEBUG_LOG` 时再记录具体编排工具所在层，均不把完整工具 schema 写入日志。

standalone 的 `add_clips` 首批可以在尚不存在 run 时创建新的 collecting run；Hono 只对已经存在且处于
`beats_committed` 到 `assets_ready` 的 run 拒绝手工收批，避免与状态机双开。不存在 run 不是资源 404，
否则首批 authored clips 永远无法落库；跨用户、跨项目或跨 flow 的已存在 run 仍按不存在拒绝。

Public chat 在把请求送入 agents-cli 前会读取当前认证用户的 `users.generation_prefs`，并将经过结构化清洗、再按新账号初始值补齐的
`imageModel/imageSize/videoModel/videoResolution/videoAspect` 作为只读事实注入本轮 system context。画布中用户每次明确切换模型、图片规格、视频分辨率或视频画幅时，Web 会把对应字段按操作顺序合并回账号偏好；节点显式值仍优先，保存失败必须在当前 UI 显式报错。旧的时长、片段数量、节奏与额外片段
披露字段即使残留在已保存 JSON 中也会被清洗丢弃，不再影响新任务。模型与规格不是提示词建议：
只要没有更高优先级的本轮显式覆盖，agents-cli 必须直接复用，不能再次询问同一尺寸、分辨率或视频模型。
偏好读取失败会显式返回 `generation_preferences_unavailable`，不会把读取故障伪装成“请用户重新选择”。
章节“一键成片”不再维护模型、比例、分辨率的第二套选择：`chapters.film_spec` 只保存交付范围，以及仅在用户明确指定时存在的目标总时长；单章节用户操作默认固定为最终版完整成片（`media_delivery/full_video`），不会因为可用的首视频验证 attachment 而缩短为首个视频。
与创作授权，读取旧记录时也会丢弃历史 `aspect/resolution` 字段。模型、比例、分辨率和分段策略只能由本轮
生成偏好（或用户本轮显式覆盖）进入 BeatSheet，再与实时 `enabledVideoModels` 冻结 generationContract；分段不再是持久偏好。新账号初始值固定为 `gpt-image-2 / 1K` 与 `minimax-h3 / 768p / 16:9`，不是“目录第一项”；Web 偏好弹窗的分辨率与画幅选项直接来自当前视频模型的实时目录合同，不维护第二套静态规格列表。任何初始值或最近选择不在实时可执行目录时都原地失败，不能自动选择另一个候选。
StoryPlan 缺 `aspect/resolution` 会显式失败，提交边界也不会再用历史组节点或静态 `720p` 覆盖本轮冻结值。
固定偏好若不在实时目录中，agents 必须报告目录不一致，禁止换成 2.0 等其他模型继续生成。

章节请求只带 `chapterId` 时，bridge 会先在当前认证项目内 fresh-read `chapters.source_book_id`，再解析并冻结
同一项目的真实 `bookId`；显式 book 与章节来源不一致时原地返回 scope conflict，不把缺失 book scope 伪装成
工具不存在。因此一键成片的 restricted surface 只保留当前必需的
`record_user_intent/Skill/book_chapter_get/image_refs_get/material_assets_list/equipped_workflow_run`，模型不能在执行前漫游
项目、execution 或无关 schema。该切片只使用认证 scope 和显式按钮合同，不读取用户正文做语义路由。
真实媒体执行的首次 `record_user_intent` 不再承担第二份模型选择合同。视频 BeatSheet 的
`meta.videoModel` 必须来自本轮实时目录事实；agents-cli 在远程调用前
只验证该结构字段存在，Hono 随后 fresh-read enabled catalog、拒绝不存在的固定偏好并冻结唯一 generationContract。
preflight/commit 后续阶段只消费该合同并确定性核对 `generationContract.videoModel`，不从用户文字推断模型，
也不提供默认或备用模型。
视频付费提交边界同样不再使用历史 `[4,15]` 钳制。编排节点以冻结 `generationContract.durationOptions` 为准，独立节点则 fresh-read 所选实时模型目录；请求时长必须精确命中合法档位，否则在供应商 POST 前以 `video_generation_duration_not_supported` 显式失败。因而 `doubao-seedance-2.5` 目录声明 4–30 秒时，30 秒会原样提交，不会被改写成 15 秒；`defaultDurationSeconds=5` 只表示 UI 默认值，不能替代目录计算出的 `maxDurationSeconds=30`。

视频参考图的编号也遵循同一条事实链：agents 冻结的 `assetObjectContracts`（`kind`、canonical
`name`、`referenceImageNodeIds`、`referenceRole`）先由编排器解析成真实画布节点，并原样冻结到
视频节点；最终生成边界再按 nodeId 解析当前真实图片 URL，把合同身份回填到同一 URL 的
`referenceMediaManifest`，避免图片任务收尾后 URL 变化或旧 binding 退化为泛化 label。最终
`video-prompt-writer` 不再预估 `content[]` 图序；它在结构化字段与全部可执行视觉正文中只使用
canonical 资产名，禁止写 nodeId、URL 或 `@图N`。最终付费提交边界完成参考图去重、模式选择与
`referenceMediaManifest` 冻结后，才按真实 `content[]` 顺序把 `@图N（资产类型:canonical 名）`
集中渲染到逐镜表之前的参考资产锁定；同一对象有多张身份/状态图时保留全部实际编号。画内说话人
同样只从这个最终映射取得图片编号，结构化 `dialogue` 正文逐字不变，`speakerName`/
`speakerBindings.name` 始终是 canonical 外键。该转换只比较合同 nodeId 与 manifest 的结构化
`assetKind/assetName`，不扫描、替换或猜测 prompt 文案，因此参考图去重、首尾帧模式或 manifest
重排不会让正文中的预估编号错绑角色、场景或道具。

项目画风锚只在付费图片生成边界自动注入；任何视频路径（独立视频节点、完整成片 preflight/drive、
重制与 recovery）都不读取、不预留、不提交项目画风锚图片。视频 `generationContract.referenceImagePolicy`
直接采用实时模型目录的 `maxReferenceImages` 作为全部业务图片上限，`maximumBusinessImages` 必须等于
`maximumTotalImages`；例如 `doubao-seedance-2.5` 实时目录为 30 时，30 个去重后的图片槽都可供本镜
故事板、角色、场景和道具使用。authoring 工具 schema 不再声明静态 `maxItems`；入口只接收结构化节点 ID，
最终由实时 `generationContract.referenceImagePolicy.maximumBusinessImages` 这一处权威校验去重后的真实图片槽，
避免入口固定 8 张而执行合同允许 30 张的双轨误拦截。最终付费边界还会从旧节点 `referenceImageBindings` 中剥离历史
`systemStyle:true` 图片，禁止重制时把旧画风锚重新送入供应商。

实时运行时目录没有声明参考图能力时，合同冻结 `maximumTotalImages=maximumBusinessImages=0`，而不是阻断纯文生视频；
只有请求实际携带图片引用时，统一 manifest 上限校验才以 `actual > 0` 显式失败。目录声称支持参考图却缺少硬上限仍是
不完整运行时合同并原地失败，禁止把零容量当作静态默认或隐式降级。

冻结 clip 的 `speechEvents[].speakerName` 与投影出的 `speakerBindings.name` 共同构成说话人唯一结构化事实；shots 不再拥有 speakerName。生产 driver 只消费 `voice-plan-agent` 与 `voice-materialize` 已冻结的 `VoiceManifest`，并在供应商 POST 前 fresh-read 精确 `voiceCharacter + doubaoVoiceId + audioUrl`。已有同名真实卡保持原 voiceId，不同 voiceId 的同名卡、目录外 voiceId、非法 speaker 合同、物化失败或 manifest 缺项都会原地显式失败。该链路不解析 prompt 猜说话人、不回落默认旁白、不按性别关键词或硬编码池选音，也不会在任何供应商任务已受理后重建或覆盖配音卡。

缺名、重名、错绑或 manifest 退化为泛化标签时，Hono 只拒绝当前尚未提交的动作并记录
`video_reference_identity_mismatch`，不会让模型按图片顺序猜角色，也不会重提已经受理的付费任务。

`videoReferenceNodeIds` 表示 agents 已在冻结合同中明确选中的业务参考资产。编排执行不再按节点的
`productionLayer/referenceType` 把它二次分类为“规划板/禁止来源”；只要求节点属于当前授权画布并存在真实
HTTP(S) 图片 URL，再进入供应商真实参考图数量上限核算。专属 `storyboardImageNodeId`、首尾帧与 blocking
证据仍各自遵循其结构化槽位合同，不能用文本或占位 metadata 冒充真实资产。
站位上下文与 writer 创作提示词不设本地字符上下限；agents-cli 在同一执行链负责信息密度与创作完整性自检。
Hono 不在 POST 前猜测供应商提示词长度边界；若实时供应商确有协议限制，以其真实响应显式失败，不截断、
不覆盖、不静默降级。

run driver 对提交前确定性 4xx 合同错误不再维持 `scheduled` 并由 worker 无限原样重试；它会把该动作投影为
带 code/message 的事实失败，让同步 agents 链继续修复或换合法路径。408/409/425/429、连接故障和容量等待仍按
可变化的瞬时事实重试；已经被供应商受理的任务与已生成资产始终保留，不因后处理或 authoring 状态回滚。

这类供应商 POST 前身份失败由 Workflow IR 的资产节点写入当前 execution 的结构化缺失证据，而不是直接投影为用户级终态失败。节点只列出当前失败事实涉及的 `requiredAssets`、受影响 clip 与已验证素材；同一 execution family 的恢复会复用当前画布/项目中已有真实图片，只为仍缺失的独立身份或场景执行补图，再把稳定 `nodeId/referenceAssetId` 通过 typed port 交给后续节点。Hono 只按稳定 ID fresh-read 并验证 URL、类别、项目权限、拒绝状态与幂等边界，不比较名称语义；已成功节点和已受理媒体保持冻结，禁止重新启动一条平行生产链或重复付费。

`asset_repair_required` 是 delivery graph 的持久 `WAITING_EXTERNAL` 状态，不属于后台 writer/assembly 的内部静默死锁阶段；等待 agents 或用户提供新资产证据时，45 分钟 authoring stall 计时器不得把它改成 `authoring_failed`。旧版本已经被该计时器误收口且仍为零生产的 run，只能通过统一 `recover_authoring` 先完成无供应商任务/无真实视频资产的证据审计，再原子恢复同一 `asset_repair_required` 状态；不新建 run、不重写 BeatSheet、不重复付费。
Workflow IR 的每个节点由版本化 executorRef、typed input/output ports 与冻结 node spec 定义自己的确定性合同；
执行查询统一使用 execution identity，不再存在需要模型猜 mode/runId 的隐藏状态机 schema。

媒体生成不再读取 `autoApprove`、`meta.autoStart`、durable/Redis 预授权标记或历史 answered choice
决定是否起跑。用户本轮的明确生成指令就是当前冻结范围的授权事实；内部 estimate
后直接 start，不创建或消费任何视频确认卡。`request_user_input` 只服务于任务中真正缺少的
不可推导事实、新增范围或权限，不是 estimate/start 协议的一部分。

项目素材库的运行时真源是当前项目下的项目画布、全部章节画布和镜头画布节点，不是
`material_assets` 登记表。`tapcanvas_material_assets_list`、`tapcanvas_storyboard_anchor_candidates` 和一键成片
authoring 都读取同一份只读节点投影；投影 ID 保留 `ownerType/ownerId/flowId/nodeId`，版本来自画布 revision，
不复制媒体 URL、不创建第二个资产身份。只要节点已持久化且存在真实 HTTP(S) 媒体 URL，就天然属于当前
项目可用资产；上传或重新生成覆盖节点后，下一次 fresh-read 立即看到新 URL，无需“添加进素材库”或等待
自动登记。个人、团队和官方素材仍是项目外的可复用收藏源；画布上的“保存到素材库”只表示把当前项目节点
复制进个人/团队收藏，不决定它在当前项目内是否可用。
面向视觉资产的 `tapcanvas_material_assets_list` 默认只返回已具备真实图片 URL 的生产就绪节点；文本节点、计划节点和
其它仅有 metadata 的视觉占位不会被列为可复用图片，也不会写入 `referenceAssetIds`。确需审计这些占位时必须显式传入
`includeDrafts=true`，该结果只用于补图规划，不能直接进入图片/视频提交。工作流启动时同样只把生产就绪图片 ID
冻结进 `WorkflowProjectContext.selectedAssetIds`；完整项目快照仍保留所有节点供诊断，因此“可枚举”不再等价于“可供模型复用”。
项目节点投影以 `project-node:<ownerType>:<ownerId>:<nodeId>` 作为跨画布稳定资产 ID。
`tapcanvas_material_assets_list` 返回的 `referenceAssetIds` 必须保留该完整 ID；后续章节将其放入
图片/视频对象合同的 `referenceAssetIds`，不能把来源章节的裸 `nodeId` 冒充当前章节的
`referenceImageNodeIds`。名称不同但确属同一角色、场景或道具时，只能由 agents 依据章节原文与项目资产事实
显式选择该稳定 ID；Hono 不做别名表、关键词或模糊匹配。图片引用解析器会先
按项目权限读取全部项目/章节画布，再从投影的 origin 定位来源节点，并在付费执行边界 fresh-read 其真实 URL；
因此资产可以跨章节复用，但不能跨项目逃逸。一键成片 authoring 对角色/场景只验真 agents 明确选择的稳定资产 ID，
不再把其 URL 物化成当前章节角色/场景节点；缺新版结构化节点或显式资产 ID 时编译 `assetRepair` 事实回灌同一 agents-cli 链。
道具仍保留既有确定性物化协议。
新建可复用的角色卡、场景卡或道具卡时，agents 必须在节点创建/生图请求中同时写入结构化
`referenceType` 与对应的 `roleName/sceneName/propName`；角色与场景还必须分别写入唯一 profileVersion。
`label` 只负责展示，投影层不解析标题猜资产身份。
章节画布在拖动/缩放期间可以暂存远端 SSE 图补丁，但只有补丁真正应用到本地 graph 后才推进对应 revision；
禁止先确认 revision 再让旧内存整图保存，否则会把 agent 刚写入的资产字段覆盖掉。
一键成片 authoring 复用当前项目节点时也不再调用 `syncCanvasCardToMaterial`、不写 `materialAssetId` 或
`materialRegisteredImageUrl`；它只读取原节点事实，跨章节消费时按来源 nodeId 留下 provenance。这样 AI 执行
不会把“项目内可用”偷偷变成一次素材表写入，而用户显式点击“保存到素材库”的个人/团队收藏能力仍完整保留。
投影默认按 `updatedAt DESC` 排序；同名状态资产先精确匹配 `stateKey` 再取最近更新节点。工具还接受精确
`sourceChapterId` 与 `nodeId`，用于锁定指定章节或指定物理节点；未指定时不会再用“章节距离”压过更新时间。

项目节点优先不等于
“按图序猜身份”：每个 `assetObjectContracts` 必须以结构化
`kind/name/referenceImageNodeIds/referenceAssetIds` 绑定到一个唯一当前节点或由 agents 明确选择的同项目
canonical 资产；服务端校验项目归属、类别、真实图片与 `approvalStatus !== rejected` 后才物化。同一节点或
同一真实图片 URL 被多个非 ensemble 身份占用时，authoring 记录
`node_already_bound_to_other_identity` / `image_already_bound_to_other_identity` / `canvas_identity_mismatch`
并停在资产覆盖修复，不改写节点、不按当前图片序号重命名、不让最终 manifest 取最后一个合同。
authoring 复用跨章节节点时把来源节点作用域写入当前生成节点的 provenance，不再要求先同步为
`materialAssetId`。项目节点缺少旧库专用的 styleFingerprint 时也不会因此被判定为不可用；图片生成仍在自身
付费边界按当前项目画风合同注入风格参考，而视频生成继续遵守“绝不注入项目画风锚”的独立合同。
画布边（edges）只表达节点关系，不能替代这条资产执行合同：视频生成仍必须同时拥有明确的
`videoReferenceNodeIds`、`assetObjectContracts`、节点真实图片 URL 与 manifest 身份。没有这些事实时，
系统只拒绝当前未付费动作并保留原因，不按边序或图序猜角色。当前项目资产的统一只读投影实现为
`modules/material/material.project-node-assets.ts`，鉴权聚合入口在
`modules/material/material.project-node-assets.service.ts`；
AI 远程工具面不再暴露 `tapcanvas_material_assets_sync`，避免模型为本来已可用的节点多走一次登记往返。
最终 URL/身份闭合在
`modules/task/agents-tool-bridge.generate-video-to-canvas.ts` 与
`modules/task/video-reference-manifest.ts`。投影统一读取 `imageUrl` 或 `imageResults[]` 等节点真实结果，
因此网页端恢复任务只写结果数组时也不会把已有图片误判成“无资产”。
如果模型错误地把已暴露的 direct 工具包进 `tapcanvas_call_tool`，agents-cli 会明确提示“Call <tool> directly”，
不会把协议错误误报成资产缺失并进入无意义重试。

提示词的领域编排不在 Hono：Hono 只传递父任务冻结的戏剧/资产事实、实时供应商执行合同与
agents-cli 已冻结的 `meta.userIntentContract`。该合同在 `/collab/spawn` 经过结构校验后原样传给每个
`video-prompt-writer`，Hono 不解释 `must/forbid/prefer`，不重排优先级，也不把用户语义改写成固定 prompt。
提示词 authoring 的版本真源是 `tapcanvas/video-prompt-authoring@3.6.0`；它统一声明 writer、workflow host 与 embedded authoring 自检共享的维度、owner、
字段落点和 extension 边界，但不构成 Hono/Web 语义质量闸门。3.6.0 继续把 `tapcanvas-video-prompt-writer` 设为单 Clip 创作方法的唯一 owner：writer 根据 BeatSheet v20 的冻结 `storyEvents`、展开后的对象状态、人物与 sequenceContext，在当前同链临时建立互动轴、机位侧、轴线策略和逐人因果账本，并区分角色剧情刺激与剪辑切点，跨 continuity/shots/editRhythm/creativeReview 复核一致性。多主体围绕同一共享物体时，每个排他接触阶段必须只有一个控制者、活动肢体和接触目标；其他主体通过正向可见的手部、持物、支撑、距离、遮挡与刺激后反应保持非竞争状态，封闭不透明边界也不能在普通单一机位里提前暴露互相遮蔽的两侧。3.6.0 新增一等 `originality_and_rights_safe_projection` 维度：没有明确授权事实的第三方提及、回忆、类比和风格参考只保留其剧情功能、因果、情绪、关系、事件顺序与冻结人声，供应商可见的身份、造型、世界、走位、效果材质、声音、摄影轴线和剪辑节奏由 writer 在唯一结构化提交前编译为原创实现；项目自有 canonical 对象与明确授权资产保持不变，提及或资产存在本身不被推导为授权。这个方法只属于 writer 的单次模型响应内部创作和 embedded review，不新增 Hono/Web 名称表、关键词路由、相似度评分、语义校验、提交后模型纠偏或完成闸门。这些 staging 事实不再由父 BeatSheet 重复序列化。Workflow/Hono/Web 的指令面只允许携带不可变事实与机器协议，不能追加镜头、对白、节奏、风格或质量方法来覆盖 writer；上游没有冻结的具名空间、道具、身体落位、光源和反应含义也不得由 writer 自行补成故事事实，领域 reference 也不得补入固定时长、镜数、爆点频率、画幅、帧率、渲染质感、调色或供应商消费策略。
3.3.x 同时采用唯一的字典序冲突裁决：P0 可执行事实（100）→ P1 陌生观众故事可懂（90）→ P2 人物/空间/动作状态连续（80）
→ P3 镜头执行（60）→ P4 当前场景领域表达（35）→ P5 修饰润色（15）。权重只决定 agents 同链创作时谁让位，
不是重复次数、token 配额、评分或运行时拦截条件；提示词拥挤时从低层开始压缩，不能先删主体、动机、因果、结果或状态接力。
连续动作、显式蒙太奇、短过桥后主段、对白表演与产品展示共用同一 `clips[].shots[]` 根结构，只由 writer 根据冻结的
`temporalContext/sceneState/continuityLedger/sourceSpanText/startKeyframe/endKeyframe/durationBudget/UserIntentContract`
选择当前内容密度与表现方法，不按关键词或固定题材模板分流。
其中对白坐标统一为 Unicode 码点半开区间；对白容量只按“去标点码点数 ≤ 镜头秒数 × `dialoguePaceRate`”判断，
禁止把 `dialogueStartOffset/dialogueEndOffset` 直接与秒数比较。有任一来源对白、旁白、内心声或新增叙事人声的 beat 必须由 BeatSheet Agent 根据真实表演情境明确提交正数 `dialoguePaceRate`；Hono 不再以固定 4 字/秒、环境变量或题材默认值替 Agent 决定整章时长，只验证数值、物理上限和逐行可发声容量。该规则由 writer 与 standalone reviewer 共同读取，
只用于 agents 同链创作复盘和离线 `agents_judge`，不下沉为 Hono/Web 语义闸门。
消费该合同的 Skill 通过标准 frontmatter `metadata.contracts` 字段声明版本依赖；本地 audit 与单元测试只核验 JSON 结构、版本、
消费者声明、角色装配和退役状态等确定性事实，不读取 Skill 正文并用正则或关键词推断创作语义。提示词是否忠实、
连贯、可拍、具有足够信息密度以及 writer/reviewer 是否真正遵守各维度，统一由 `agents_judge` 读取同一合同的
`dimensions[].reviewerChecks` 和声明的 eval suite 做 LLM 语义评测；评测结果用于离线迭代与版本发布证据，
`runtimeGate=false`，不得变成生产提交、持久化或交付门禁。
`agents-cli` 的 `video-prompt-writer` 只预载 `tapcanvas-video-prompt-writer`；通用 Skill loader 在首次上下文中同步注入其声明的
`autoload-resources`，所以 3.3.3 合同与 embedded authoring 自检维度无需额外 Skill 轮次。writer 在同一上下文检查首稿并直接修订，不创建独立代理、
不挂载到剪辑师/后期角色，也不提供出片后的 `mode=video` 生产门禁；其他分镜、导演、情绪、镜头与 Seedance Skill
只向父任务提供领域方法或结构化事实，最终供应商提示词的唯一真源仍是 writer 当前合同，
不返回服务端 verdict，也不形成生成门禁。writer 再根据本轮结构化事实按需加载一份主 skill 的领域 reference
（文戏/对白、战斗动作或材质化 VFX）；Hono 不把通用 Seedance 的普通短镜
“一个动作/一个运镜”规则拼进 writer，也不按关键词替 writer 选择题材或压缩镜头。战斗 reference 已吸收
2040 动作参考中可迁移的空间路线、受力链、材质反馈与高密度剪辑机制，但这些机制服从 UserIntentContract，
不会自动新增慢镜、抽帧、定格、英雄峰值或每 clip 的固定高潮。这样同一套 `clips[].shots[]` 协议可以保留
各领域的动作密度、对白表演与特效材质合同，领域失败仍以 agents-cli
同链事实显式报告，不由 Hono 做语义闸门或静默降级。供应商终态失败时，Hono 会保留上游嵌套
`error.message/error.code` 到视频节点与 run 归因（例如 `OutputVideoSensitiveContentDetected.PolicyViolation`），
使 agents 能按 IP-safe 规则改写设计后再提交新 run；版权/输出审核拒绝不得原样重试，也不会被泛化为无原因的“视频生成失败”。

可装载的一键成片图从 canvas definition v9 起也服从同一入口：BeatSheet 语义节点固定加载 `tapcanvas-video-workflow` 与
`tapcanvas-dramatic-adapter` 等方法不再由 Hono 固定预装；正式 authoring 节点与其它 Workflow Agent 使用相同的完整 Skill/知识目录渐进检索能力，由 Agent 自主选择并读取，候选与来源只能增强创作和诊断，不能成为并行最终标准或生产闸门。
逐 clip 节点的必需 authoring 输出是 `clips:[{speechEvents:[...],shots:[...]}]`；无人声 Clip 显式提交 `speechEvents:[]`。`selfQaNote`、`creativeReview` 与 `sourceFidelityAudit` 只作为追溯证据，不成为生产门禁。Prompt Package 是唯一 authoring→execution 编译边界：服务端从冻结 Clip context 投影机器身份、总时长、角色、退出态和对象合同，从 `storyEvents + shots` 编译覆盖与时间轨，再把完整 SpeechEvent 物化为逐字正文并校验镜头交集引用。统一 renderer 只向供应商输出 `AUDIO / ENTRY+REFERENCES / SHOTS / EXIT`；原始 JSON 信封、审计元数据和图片 prompt 不进入视频模型正文，旧的“把 Agent result.text 原样当 prompt”路径已硬切删除。

一键成片的媒体阶段继续携带同一份结构化 clip，而不是只携带已渲染字符串。图片完成后，production plan 用冻结 `assetId` 找到真实绑定；当前交付画布的裸节点引用写回 `assetObjectContracts.referenceImageNodeIds`，项目级、跨章节或已有稳定资产身份的引用写回 `assetObjectContracts.referenceAssetIds`，视频提交边界统一 fresh-read 后根据最终去重的 media manifest 重新渲染 `@图N`。手工编排 run 与可装载工作流共享该 structured renderer，但工作流保持自己的 effect identity、checkpoint 和恢复语义，不伪装成 `clipRunId`。资产/风格参考只负责身份、外观、空间、材质和风格基线；`continuity/shots/exitState` 必须承担动作、表演和相邻关键状态过渡。合同不要求逐帧叙述或固定每秒字数，但位置、方向、速度、姿态、持物、接触、受力与环境结果发生变化时，必须由 writer 给出可执行桥接，镜头切换不能重置世界状态。

运行时 Knowledge 的权威投影也已硬切到当前来源合同：`executionProvenance.requiredSkills/loadedSkills`、
`loadedSkillResources/loadedSkillSources` 中实际成功读取的 Skill reference、`loadedKnowledgeSources` 中经
`knowledge_read` 成功读取的知识卡标题、正文哈希与字符数、当前项目/BeatSheet/clip 事实、工具结果与确定性
compiler/asset binding 规则。后端已经退役的 knowledge-card projection 不再是 Web 解析 provenance 的必填字段，
也不会重新接回运行时。提示词组装诊断把每个 clip 的来源、使用状态、精确 Skill reference 路径、组装步骤、
最终 prompt 预览与哈希投影成收据；固定七阶段图在 `clip-contracts` 显示逐 clip 收据，并在运行级 Knowledge
面板聚合“小T主代理”和各 clip writer 实际使用者。`docs/`、`assets/`、`ai-metadata/` 仍不得成为运行时来源。

公开聊天终态把同一份 `executionProvenance` 结构化投影到 `response.trace.executionProvenance`；Web 只从
其中的实际成功读取证据生成并挂载在对应 assistant 回复下方的只读引用区。引用区按 `Skill` 与`知识库` 两组展示：
Skill 主体/section 合并为对应 `SKILL.md`，Skill reference 显示所属 Skill 与真实文件名，知识卡显示真实标题；两组都可
独立存在，并完整展示全部去重后的真实来源，不按数量截断。`requiredSkills`、检索候选和失败读取均不构成引用，前端也禁止依据回复正文、工具文案或关键词猜测来源。
历史消息若没有该 provenance，不补造引用。
每个新 assistant 消息同时以其消息 ID 作为 `execution_traces.task_id` 持久一条
`public_chat.reference_provenance` 结构化收据；`/memory/context` 按消息 ID 恢复同一 provenance，因此刷新或
跨浏览器重新加载会话后引用仍可复现，且不把审计元数据塞进回复正文或媒体资产字段。
同一公开聊天 turn 经 `/public/agents/chat` 实时流与画布 SSE 广播形成的两种 UI 投影必须共享 root `publicTurnId`；
Web 在消息入列前把两者归一为同一组 recovered user/assistant message ID，已有的实时富卡优先保留。禁止再用回复正文、
时间戳、资产或 TODO 相似度判断消息身份，否则同一答案会因投影细节差异重复显示，或误合并内容相同的独立回合。

商用级导演信息也沿同一结构化 writer 单路径传递，不建立 Hono 侧质量评分或 prompt 语义闸门。
`shots[]` 除原有 `action/framing/composition/cameraMove/lighting/sound` 外，可由 agents-cli 写入
`visualTask`（本镜唯一可读信息）、`lensIntent`（焦段/透视的叙事用途）、`materialResponse`
（材质、表面和空气介质响应）与 `soundPerspective`（听觉主体、远近层次及收窄/恢复）。
确定性 renderer 先投影置顶的唯一人声轨，再把这些字段完整投影到静默视觉表，保证摄影、光影、材质和声音决定不会在编译时被折叠进
`notes` 后丢失；字段是否适用、如何组织以及真人/动画/产品媒介差异仍全部由
`tapcanvas-video-prompt-writer` 的商用级导演母合同与 `tapcanvas-video-reviewer` 的剧情覆盖、因果、人物状态、时空、
声音必要性和可执行性复盘在同一 agents-cli 写作链内裁决和自修正。最终 artifact 可携带 `creativeReview` 追溯摘要；
Hono 可以保存该证据，但不得据其内容或缺失阻断、回滚、覆盖或丢弃提示词/媒体结果。
商用节奏同样由 writer 从信息变化、动作完成、对白可懂度、表演反应与真实切点反推；没有冻结快切裁决时，
不得把一个长 clip 机械填成连续 1–3 秒镜头，也不得用重复的笔尖、眼神、呼吸或环境插镜虚增镜头数。
当用户要求商用级/可发布母版时，主 agents 还必须从本轮 `enabledVideoModels` 的真实
`resolutionOptions`、参考能力与时长档位显式选择当前 run 的模型和分辨率，写入 BeatSheet meta；
不得继承旧 run/旧节点/前端隐式默认值；只要任一 beat 含结构化 `dialogueScript`，所选模型还必须在
实时目录明确声明 `supportsNativeAudio=true`，不得在目录未提供相应档位或原生音频能力时虚构规格、
静默生成 480p，或用无音频模型继续消费对白合同。
缺少某个可选导演字段不会被 Hono 当作生成失败，已受理或已生成资产也不会因此被拦截、回滚或丢弃。

AI 对话上下文现在还从同一次 fresh runtime catalog 投影 `enabledVideoFinishingModels`。该列表只包含不能作为生成模型下拉项、但可作为明确后期动作执行的当前启用模型，并逐项暴露实时参数 key/type/options/min/max；当前 `volc-enhance-video` 因此不会混入 `enabledVideoModels`，却可由 agents 依据用户商用母版意图显式选择。用户要求商用级/可发布母版、生成模型原生档又低于本轮母版目标时，agents-cli 必须检查并采用当前可执行后期能力；没有合法能力时付费前明确报告，不能静默把低规格源片称作商业母版。BeatSheet 可选 `meta.finishing` 必须完整写出 `kind/modelKey/toolVersion/scene/resolution/fps?`，Hono 只按实时参数做确定性验真并冻结 `finishingContract`，不会补默认档、不会在未声明时自动增强或产生隐藏费用。该合同随 executable StoryPlan 持久化，estimate 同时核算 clips 与唯一后期任务。多段源片的标准编排显式采用 `hard_cut + xfadeSeconds=0 + colorMatch=false`：不跨段重叠画面/音频、不缩短已冻结时间轴，也不把不同剧情光色拉向全片平均值；只有 agents 逐缝提交合法 `transition` 且同时给出正数 `xfadeSeconds` 时才执行 xfade/acrossfade，缺字段、非法转场、时长探测失败或色彩探测失败都显式报错，不再默认 fade、静默跳过调色或改用另一拼接模式。拼接策略作为 `concatPolicy` 写入 `film-{runId}` 源片节点。

商业后期付费提交前会并行 ffprobe canonical 拼接源片与全部成功 clip：源片实测时长必须命中冻结
StoryPlan 的全部 clip 时长求和；每个 clip 必须存在真实视频流、命中自己的冻结时长和生成分辨率档、
具备可读 FPS，并且每个结构化对白 clip 都必须真实存在音轨。任一项不满足时，已有 clip 与源片全部保留，
但不会继续产生增强费用；这避免“其他镜有音轨，所以整片有 audioCodec”掩盖某一镜对白实际丢失。
增强任务写入独立 `film-master-{runId}` 节点并以 `finishing:submission` 持久身份防止重复付费；供应商受理后，
reconcile 按真实 `video_enhance` task kind 与冻结 billing spec 结算，失败不覆盖、回滚或删除源片。
母版资产落地后，服务端再次通过 media-worker 对全部 clip、源片和母版并行 ffprobe，把逐镜及全片的
实际时长、宽高、视频编码、音频编码、帧率与文件大小持久化为 v3 `finishingVerification`；该记录还保存
源片、母版和逐镜 URL 的 SHA-256 身份，资产 URL、冻结逐镜时长、对白音轨需求或源分辨率改变后不得复用旧
“已通过”结论。确定性证据同时核对计划总时长、生成档与母版目标短边、显式 FPS、源片与母版时长/画幅
保持、视频流存在及对白所需源音轨保留。探测暂不可用时只等待新证据，不重复提交增强任务；发现偏差时
clip、源片与母版都继续保留并展示，只把偏差追加到 delivery diagnostics。存在后期合同时，production graph
与 status verifier 同时要求 canonical 源片 URL、母版 URL、逐镜媒体身份、冻结合同身份、计划总时长和
`finishingVerification.satisfied=true` 才能声明商用交付满足；单独的 concat URL、单独的增强 URL 或供应商
`completed` 状态都不再冒充商用母版完成。

完整视频的终态交付还统一携带 `narrativeVerification@1`。服务端从持久 BeatSheet、章节原文、
executable StoryPlan 与 canonical `film-{runId}` 节点重新构造事实，依次核对：交付范围存在、
`sourceCoveragePlan` 覆盖授权原文、`speechLedger` 与全部 beats 的 `dialogueScript` 同序逐字守恒、
每个 Clip 的完整 `speechEvents` 与宿主物化的唯一人声轨只还原这些授权台词、BeatSheet 总时长与冻结
StoryPlan 一致，以及 compose 节点持久化合法的显式 `concatPolicy`。该检查只比较结构化事实，不从
prompt 或原文关键词猜测哪些句子是对白；writer 的 shots 不携带正文或人声引用，宿主只在最终时钟上
编译引用并从冻结台账物化正文。每个成功 clip 还必须持久化 `promptDeliveryContract`：供应商提交边界先用最终
`referenceMediaManifest` 顺序把结构化 `shots[]` 重新编译为权威 prompt，再按最终 URL 去重结果绑定
`@图N/@音频N`；相同音色 URL 被多角色共用时合并到同一个真实 `@音频N`，不存在的音色、游离参考音频
或缺失的结构化 shots 都在供应商请求前显式失败。权威 prompt 与 negative prompt 随后分别冻结
SHA-256，公共 task/new-api 层不得再执行正则删词、固定无 BGM 句追加、负向词底座合并或其它二次改写；
合同缺失只表示非编排手工视频路径，合同一旦出现但无效或 hash 漂移必须原地失败，禁止退回可变路径。
终态 verifier 会从每个成功视频节点重新核对唯一 `prompt` 与 `promptDeliveryContract` 的哈希一致，避免
“authoring 看似正确、供应商实际收到另一份 prompt”。运行占位与所有成功结算路径统一复用同一个
provider-bound prompt projection；供应商同步返回与后台 reconcile 不再形成两套画布投影，避免快速完成任务把
提交前 prompt 覆盖回成功节点而制造合同哈希漂移。Web 视频执行边界直接传递该完整 prompt，不再拼接上游节点
prose、按正文做本地语义过滤、套用本地模板或截断到 2200 字；参考图片和音频只通过独立 manifest 参数传递。
普通画布节点的“预设能力”入口与运行时链路也已经删除：Web 不再加载、选择或项目级持久化节点提示词预设，
也不再通过 `promptPresets/llmPresetPrompt` 给图片或文本执行提示词追加本地前缀。LLM preset 目录仍作为风格参考
图库与后台资产管理的共享数据源，不参与画布节点 prompt 装配。production graph 与 status projection 都复用
同一证据，最终 expected delivery 为
`durable_http_final_video_url_and_verified_narrative_fidelity`，商业后期则再叠加 finishing contract。
历史或异常 run 即使已有真实视频 URL，只要缺少上述证据也只能保留并展示资产、追加明确 diagnostics，
不得继续宣称“整章/商用交付已满足”；验证失败不会删除、覆盖、回滚或重新提交任何已生成媒体。status
会保留 `runSuccess=true` 表达媒体生命周期已经产出资产，但顶层 `success/goalOutcome` 只按同一次
delivery verification 投影，缺证据时固定为 `false/unsatisfied`，避免界面或 agents 把旧 run 结束误读成用户目标满足。

BeatSheet 的逐 clip 事实现在可显式携带 `temporalContext`、`sceneState` 与
`characterStateVersions`。`temporalContext` 使用稳定 `timelineId/stateScope` 声明当前现实、回忆、预知、
平行或主观时间层以及与上一 clip 的进入/继续/返回关系；人物资产状态只允许在同一个 `stateScope` 内前向
继承，回忆中的过去状态不得污染现实状态。`sceneState` 冻结具体室内外空间、时段、光线、空间锚点和
首尾状态；`characterStateVersions` 按 canonical 角色名冻结身体、孕态、伤势、妆造与持有物等逐 clip
可见事实，即使项目没有对应状态卡也必须由 agents 在本轮合同中明确写出。确定性 renderer 把这些 Beat
事实置于镜头表之前交给 writer 和视频模型；Hono/Web 只做结构解析、持久化和展示，不从章节关键词推断
是否怀孕、何时回忆或应该在哪个房间，也不跨时间作用域自动补写创作语义。

持久视觉状态与瞬时动作连续性现已拆成两份通用结构合同。章级
`visualStateTimeline.intervals[]` 以 `characterName/stateScope/stateVersionId/stateKey/startClipIndex/endClipIndex`
声明非重叠生效区间，并用稳定 `visualFacts[{key,value}]` 表达体态、年龄、孕态、伤势、妆造等持续事实；
`anchorPolicy=state_specific` 会确定性投影成一份状态锚需求，同一状态版本只需一张锚图并在完整区间复用。
`prompt_only` 不读取或生成真实资产，只在 Prompt Package 输出 `stateAnchorRequirements` 与
`unboundStateAnchors`；`media_delivery` 才允许资产 DAG 物化真实状态锚。每个 beat 另带
`continuityLedger={inheritsPreviousExit,entry,exit}`，入口/出口的姿态、肢体占用、接触、持物和空间等事实均为
agent-authored 稳定键值；声明继承时，Hono 只比较相邻 scope、key 集与 value 是否逐字相等，不从正文猜“右手”、
“怀孕”或“室内”等语义。writer 与最终 provider prompt 均收到同一账本和状态锚需求，因此已完成动作不能在下一
clip 倒带重演，状态锚缺失也不能静默回退为基准体态。

writer 派发采用“异步提交、结构化轮询、明确终态”的单一路径：`POST /collab/spawn` 返回
`agentId/submissionId` 后，`GET /collab/result/:agentId` 在非终态持续返回当前 submission 的
`status`、`lastProgressAt`、`lastProgressSummary`、运行时长/预算与结果预览；authoring driver 将这些
事实写入 clip artifact 的 `writerObservedStatus/writerLastProgress*`，但绝不把进度文本当作 clip
交付。只有终态的完整 `result` 经过 writer envelope、execution provenance 和执行所需结构合同验真后才会
进入冻结装配。writer artifact v14 只接收单条创作正文，包括非空 `shots`、精确闭合冻结 Clip 的正数最终秒数、完整
`speechEvents`、逐镜 `depictedStoryEventIndices` 与可执行镜头字段；`clipId`、`clipIndex`、`durationSeconds`、
`exitState`、`assetObjectContracts`、`shots[].speechEventIds`、`sourceEventCoverage`、`temporalFrameTrack` 与
`temporalFrameCoverage` 均由宿主投影或编译；
`selfQaNote`、dramatic coverage 和其他创作自检结果不再是运行时 schema 闸门。agents-cli 必须先检查已经
生成的 JSON，再解释 provider finish reason：只要 JSON 完整可执行，即使 provider 报 `length/end_turn/unknown`
也直接接收。每个 Writer 逻辑节点只允许一次完整模型提交；JSON 确实不能执行时记录模型原始提交的位置、长度、
SHA-256、合同和精确失败路径并结束该节点，不向模型返回错误，不启动第二次结构纠正。相同状态快照的
`agent_role` 活动事件在 CollabAgentManager 源头去重，避免 UI 把一次 progress
误显示为多次推进。每个 `clip_writer` 是独立工作项：一个 clip 的结构提交失败时只持久化该 clip 的失败证据，
仍在运行的 sibling 不会被批量取消，已经 ready 的产物保持冻结不动；settled join 只汇总真实结果，不把失败
clip 自动重派给模型。批量关停只保留给用户显式取消或 run 级确定性终止，不再充当内容失败闸门。
authoring 周期恢复队列只认领已有 `pending/running` 持久执行以及可继续推进的 assembly 与 estimate 工作；失败 writer 不进入该队列；
`asset_repair_required` 和旧 coverage failure 这类 `WAITING_EXTERNAL` run 不进入全局扫描，也不由 Production Workflow 自我续排。
`repair_assets` 真实资产回填、幂等 `loop` 重放或显式恢复会按 `runId` 重新驱动，状态一旦回到 `beats_committed/script_approved`
又自动进入可执行队列。对象合同也按结构职责分层：`identity/wardrobe/environment`
无真实图片绑定时继续硬失败；未显式绑定节点或项目资产的 `prop/vfx/palette/composition` 只作为可执行镜头描述保留，
不得在 estimate/start 边界被二次提升为孤立必备图片。
typed writer 的远端 spawn、网络或 provider transport 失败只记录首次物理窗口失败；CAS 让位时不创建 agent，
绑定失败则关闭未绑定 agent。无论候选是否形成，都不创建后续物理代次或内容重派。`writer_repair_pending`、
`writer_replan_required`、自动 clone 和有界修订预算都不再
参与当前 Workflow Agent 路径。历史上 Hono 从冻结 BeatSheet 本地物化 shots/对白坐标并冒充 writer artifact
的 fail-open 路径同样保持删除；服务端不拥有替代 Agent 创作产物的权限。所有失败 clip、ready sibling、
sourceHash、远端结果与拒因原样保留。
当前 writer v14 contract 约束完整 SpeechEvent 的逐字守恒、Unicode `[0,codePointLength)`、独立秒数、说话人、delivery、父事实末端复核、连续性账本与可执行 JSON 枚举，但不把创作评分或最低字数作为完成闸门。writer 不在 shot 上手抄 `dialogue` 正文或人声引用；Hono 只按冻结 `spokenScript.text` 编译可唯一推导的正文与机器索引。任何漏句、重复、越界、说话人冲突或事件时间窗非法都记录精确结构路径并结束该 Writer 节点，不返回 Agent 修订。`shots[].durationSeconds` 是模型首次提交的可执行时钟，必须为正且总和精确闭合冻结 Clip；compiler 不再按相对权重缩放或吸收余差。
writer 首稿前按每条冻结 line 注入 Unicode 码点长度、去标点字数、冻结语速、建议发声秒数与剩余非对白秒数，供 Agent 在唯一提交前设计完整 `speechEvents`、动作和反应镜；这些值只进入创作建议、离线 reviewer 与诊断。writer 必须自行提交每行唯一完整的 SpeechEvent 时间窗，宿主不按 shot 坐标替它拆句或猜时间；宿主只物化冻结正文，并在最终 Shot 时钟闭合后编译逐镜引用。父预算确实容纳不下冻结人声时返回精确合同冲突，禁止删除台词、提高无依据语速或用新的物理运行掩盖。
BeatSheet commit 进入多分支 repair frontier 时，`progressCursor.requiredReadActions` 保持为空：`preflight_repair_continuity` 不读取相邻 Beat，直接按持久化 `continuityClipIndexes` 批量投影；`preflight_patch_header` 与 `preflight_patch_beat` 分别由自己的 exact operation schema 要求 header/beat revision fence。cursor 只公布与当前结构地址相符的 repair actions，不把某一分支的读取前置提升为全部分支的全局门槛，也不会把普通 `clipIndexes` 推断成可自动修的 continuity target；缺少 revision 的实际 patch 仍以精确 JSON path 原地失败，不猜测或默认填充。
每个单 clip writer 任务还会在 output shape 之后、repair evidence 之前原样重放该 clip 的 `sourceSpanText/startKeyframe/endKeyframe/enterStateNote/exitState/timeJumpNote/temporalContext/sceneState/characterStateVersions/continuityLedger/visualStateAnchorRequirements`。这只是把已冻结父事实移到返回前的高注意力位置，不引入 Hono 语义判断：writer 必须在同链四账本中保持事件次序、canonical 动作词、肢体接触与持物归属，并移除没有画内可见物理来源的动作声；Hono 仍只执行协议、类型、时长、枚举和逐字对白等确定性校验，不把这些创作自检变成生产闸门。
共享一键成片工作流把 BeatSheet 设为唯一剧情语义出口后，单 clip writer 只承担冻结事实到可执行 `speechEvents + shots` 的一次性创作。运行时从 for-each Clip 上下文冻结机器身份、总时长、角色、逐字退出态、storyEvents、spokenScript 与对象合同；模型负责镜头相位、完整人声窗口和逐镜时长，节点执行器只负责机器字段投影、覆盖编译与一次严格结构验真。缺失/非正逐镜时长、缺失 shots/visualTask/SpeechEvent 或非法上游上下文都保留首次候选和精确失败证据，不改成 `1`、不缩放、不回灌修订。`selfQaNote/creativeReview/sourceFidelityAudit` 是可选追溯证据，不污染或拦截已经合法的镜头工件。

BeatSheet 的对象输出合同还支持通用的 `arrayItemRequiredStringFields` 与 `arrayItemRequiredNonEmptyStringArrayFields`：它们只验证下游确实无法解码的必需结构，不读取正文、不识别人名，也不决定剧情。`clipId`、`characters`、`speakers` 与逐字 `dialogueScript` 由宿主依据模型已提交的冻结事实唯一编译；`exitState`、故事事件、节奏和参数仍由模型一次提交。缺失可执行结构时在 BeatSheet 节点记录并结束，不建立纠偏链。

持久 Workflow 的 BeatSheet、视觉资产规划与单 Clip writer 原子节点采用统一的渐进知识路径：执行器在首次作者窗口固定授予 `skill_search/Skill/knowledge_search/knowledge_read`，不读取节点级 `workflowRequiredSkills`、知识卡挂载或停用字段。设计资产提示词作者同时获得 `prompt_example_search/prompt_example_read`，并由 `promptExampleRetrievalScope@3` 限定媒体源与候选搜索策略。单 Clip writer 使用 `required_non_blocking`，由 agents-cli runtime 在首次创作推理前尝试一次候选搜索；视觉资产规划等其它任务使用显式 `agent_discretion`。Agent 只读取当前任务需要的精确 Skill section/resource、知识卡或案例正文；目录与候选不批量注入正文，只有成功正文读取进入 provenance。章节来源、当前选择与 `ProjectContext.assetSnapshot` 仍在工作流启动前冻结，业务工具仍受节点显式 allowlist 与认证目录约束。正文读取零条、一条或多条均合法；任何 Skill/知识缺失、弃选、零命中或失败只形成非阻塞诊断，不得终止生产或伪称引用。
肢体账按时刻额外记录每侧手、腕、臂是否正被接触、持物、支撑或限制；已占用的一侧不得同时承担第二条互斥运动轨迹。若相邻 Beat 对动作侧存在冲突，writer 在唯一提交前自行解决；仍存在的冲突只写入 `selfQaNote` 或结构化 diagnostics，不向父级或当前模型返回修订请求，也不静默换手。相邻 clip 已明确由未占用侧承担动作时，准备动作和退出态必须沿用同一侧。该连续性判断仍属于 agents-cli skill 的创作自检，不下沉为 Hono 关键词闸门。
writer 的事实原词账同时覆盖站/坐/躺姿、年龄、孕期、相对时间和数量词，禁止把“孕三月”改成“三个月后”，也禁止用“坐立”等混合词污染冻结站姿。原文心理比喻仅由人物反应、构图和既有光线承载；父 Beat 未明确冻结为现实变化或 VFX 时，不得物理化为降温、结霜、粒子或无来源变色。以上仍由 agents-cli 在创作链内语义自检，Hono 不通过正文关键词决定生成、持久化或交付。
物化后同一 lineId 的正文按镜号直接连接，不允许执行层插入任何分隔符，结果必须与冻结 `dialogueScript.text` 逐 Unicode 字符相等。去标点字符数只用于
计算发声容量，绝不构成删除镜间逗号、句号或其它标点的权限。`motionDynamics` 的每个字段必须使用执行协议精确枚举；
`direction` 不存在 `none`，没有合法方向时 writer 必须省略整个可选对象。创作到执行的唯一 compiler 会在 writer 摄取与
最终装配时执行同一份纯结构校验，记录 `clips[n].shots[m].field` 精确路径；失败只把所属 `clip:n` 收口为
带不可变 rejection evidence 的节点失败，不重置 assembly/estimate 去驱动模型重写，也不启动有界 writer repair。
ready sibling 与真实资产保持冻结；已有 production handoff 证据时更不得重开、回滚或覆盖产物。
若 provider 已把满足 output contract 的完整 JSON 放进任一 tool argument，agents-cli 会按同一纯结构合同抽取
并直接结算该 artifact，不执行多余工具；该规则不读取工具名、文件名、prompt 关键词或内容语义。
单工作项合同不再支持 `itemMatch`、候选筛选或从过完整 sibling 数组中挑选局部产物。单 clip writer 必须一次
提交只属于当前冻结 item 的完整 artifact；数量、身份或结构不成立时记录原始候选并结束当前节点，禁止通过本地
选择、裁剪或合并制造“可用结果”。
单 clip 的供应商时长不属于 writer 创作字段：shots 保留逐镜时间设计，但执行层 `durationSeconds` 始终由
冻结 BeatSheet 的 `durationBudget` 在唯一装配边界回填，并覆盖/剥离 writer 的同名值。这样移除 clip 级
authoring schema 闸门后仍能逐项严格匹配 `clipTopology`，不会因 writer 省略冗余字段形成空转。
纯文本 writer 只允许一次最终结构化提交。形成候选后，无论结构、数量、镜号或确定性字符串预算哪一项失败，
都记录原始候选、哈希与精确拒因并立即失败；不得将失败工件重新认领、恢复、修订、重派或转成等待。
子代理角色的 `timeoutMs` 是连续无真实进展的租约上限，不是从启动时刻起算的固定墙钟：任意真实 tool 事件
或流式文本 delta 都会续期；只有持续没有进展才中止。这样长 JSON 正在生成时不会在结果即将完成前被误杀，
typed writer 的首个物理窗口无论形成候选、返回空结果、suspension、429、maxTurns 或父级预算结束，都立即成功验收或显式失败，不得空悬或重开预算。

writer 的 prompt/skill 合同不声明本地字符上下限，也不再维护 `editableTextCharacters`、`3100/2700`、
`outputContract.stringBudget.maxCharacters` 或固定渲染预算。Hono 不按字数拒收或要求凑字；信息密度、动作因果、
连续性、表演、声音、材质反馈与退出态由 agents-cli 在当前执行链自检，供应商若存在真实协议边界则以实时
供应商响应为证据显式失败。付费边界删除历史 `MAX_VIDEO_PROMPT_CHARACTERS=5000` 预拦截，不截断、不改写、
不把本地假上限伪装成供应商限制；已由该旧闸门失败且 receipt 证明未请求上游的 run 可通过结构化
`resume_pre_submit` 原位恢复。
恢复事务会同时重开画布 `submit_failed` 槽位与对应的 durable `video-result:<clipIndex>` 节点，并通过
依赖闭包使 concat/delivery 回到可调度状态；只恢复画布节点而保留旧 production graph failure 会导致 worker
在供应商 claim 前再次终止，因此不属于有效恢复。未失败的 sibling clip 与已受理供应商证据不受影响。
如果进程在这些写入之间中断，画布槽位可能已经变为空状态、`queued` 或 `submit_retrying`；恢复入口此时以
hash 绑定的 `video-submission:<clipIndex>` receipt 为权威，只接受 `providerRequestAttempted=false`、
`providerAccepted=false` 且由 Hono 提交边界签出的结构化记录。它不解析错误文案，也不因 UI 半恢复状态要求
用户重开任务；receipt 的 run/clip/requestHash 任一不一致都会显式拒绝。
旧版本在视频节点创建前把确定性的本地引用身份失败直接写成 `failed + authoring_done` 时，`status` 会按持久错误
code（不读取错误文案语义）返回唯一 `resume_pre_submit` 动作。该动作仍须 fresh-read 当前画布并证明 run 没有
taskId、真实视频 URL 或上游不确定证据，同时要求冻结 BeatSheet/StoryPlan 的所有引用都能由当前节点机器身份唯一
解析；只修好节点 `roleName/sceneName/propName` 等结构事实而计划引用 ID 未变化，也是合法的当前画布证据更新。
任一证据不满足都原地拒绝，不换 runId、不重提 BeatSheet、不重复 start 或供应商提交。
`status` 返回的 `resume_pre_submit` 恢复身份必须与 operation-scoped schema 一致：动态 schema 强制
`mode + runId`，恢复调用逐字复用 status 的 exact args；禁止把该操作归入只有 `mode` 的泛化分支，导致模型
在 additionalProperties=false 下无法携带 run 身份，或退化成无目标恢复。
`preflight_begin` 的片段数也按交付范围分权威来源：`full_chapter` 直接冻结 agents 根据完整原文规划的
`expectedBeatCount`，不要求或注入 `targetDurationSeconds`；章级总时长只在全部 beats 持久化后由
`durationBudget` 确定性求和。只有用户明确授权 `bounded_duration` 时，才在 begin 阶段从 durable
`userIntentContract.delivery.durationSeconds` 与实时模型时长档只冻结总时长和可执行时长窗口；语义分段数量与边界由 BeatSheet Agent 在该窗口内动态规划，服务端不把最少供应商提交次数冒充为故事结构。
因此完整章节不会再因尚未产生的总时长被挡在 preflight 起点，限时视频仍保留精确时长与供应商硬上限校验。

视频合同没有公开的整章大对象或整章 patch 双轨；公开 `loop` 流程先在 agents-cli 内形成 BeatSheet 章级头与逐 beat 节点，
通过 `preflight_begin -> preflight_patch_header* -> preflight_put_beat -> preflight_commit` 汇编并冻结结构合同（首次 commit 不要求身份卡 nodeId、不派 writer），
随后以同一 run 的最新 preflight 证据调用公开 `loop` 原子建立资产 DAG；DAG 首节点 fresh-read 当前项目与章节资产，能复用的直接绑定，缺失项进入同一 run 的 `asset_repair_required`，补齐后自动继续 writer/estimate/视频执行。
只有冻结计划本身发生变化时，才通过 `preflight_patch_header` 或 `preflight_patch_beat` 修订对应字段并重新 commit；
必须传 `beatSheetRef:"preflight"`，loop 服务端会读取并复用同一份冻结计划，不允许模型重放整章大对象。若服务端
前置复核产生 `assetRepair`，仍由同一 run 在 `repair_assets` 后回到 authoring，不重新提交或猜测身份。
`runId + preflightRevision + preflightFingerprint` 是 loop 的不可变受理身份：首次受理后，同一身份的重放只返回
`video_loop_already_accepted` 与当前 authoring/production 状态，不重写 DAG、不重置 clip artifact、不再 kick writer；
同一 runId 携带不同冻结身份会显式返回冲突并要求使用新 runId。该边界同时在公开路由和数据库事务内执行，事务创建
使用唯一键 `skipDuplicates` 合并并发首投，只有真正创建/提交图的一方可以派发 ready queue，避免相同 loop 双烧 writer
或进一步形成重复供应商提交。
物理窗口恢复可能只改变 parent execution provenance。相同 canonical creative fingerprint 的再次 commit 会复用既有
preflight 记录与 revision；即使部署切换前已经形成不同 revision，`loop` 也按 fingerprint 返回原 run 的幂等回执，
不会重写已受理 DAG。只有 creative fingerprint 真正变化才返回 `video_loop_run_identity_conflict`。
`preflight_begin` 后的第一个 durable header frontier 固定为轻量 `sourceCoveragePlan`：服务端先把任意原文投影成稳定 `sourceUnitCatalog`，agents 只选择每个 clip 的结束 unit 并提交语义清点的 `speechLedger`；Hono 再生成带 normalized offset 的 canonical spans，
`full_chapter` 在任何深层 beat 写作前就确定性满足首尾、顺序和无缺口。后续每个 beat 必须逐字复用对应 span，
不能等三拍或整章创作完成后才在 commit 阶段发现漏掉穿越交代、背景、动机或结局。这项检查只计算原文位置、
clipIndex 与字符串同一性，不解释内容语义、不使用关键词或正则路由；任意输入文本服从同一协议。
`sourceCoveragePlan` 只约束当前 Hono preflight 动作的确定性输入范围，不是逻辑任务终态，也不替代 agents-cli 跨阶段 `SourceLineageV1`。当前动作失败时返回精确结构证据，由同一 agents-cli 任务修订后重新提交；已受理或已生成的媒体结果不受覆盖诊断回滚。
结构区间覆盖不能证明区间内台词已经被完整识别。对于真实章节，agents-cli 的 dramatic adapter 必须在切 beat 前语义建立章级原文发声台账：按来源顺序提交稳定 `lineId/speakerName/text`；动作、行为、神态、环境和画面说明不得进入该台账。Hono 不解释正文语义，只按章节真源顺序定位 agents 选择的 text，并把逐字 canonical text 与 runtime 生成的 `sourceMarker` 持久化到 `sourceCoveragePlan.speechLedger`。全部 beat 完成后，agents-cli 在同链内按顺序回拼 `dialogueScript` 与台账比较：`full_chapter` 必须逐条同序、同说话人、逐字一致且不增不减，偏差由同一 agents-cli 链修订后再提交。来源台账不再重复冻结 `delivery`；画内、画外或旁白是逐 beat 的导演执行选择，以 `dialogueScript.delivery` 为唯一权威，不因同一句原文在闪回、记忆或离屏表达中改变呈现方式而阻断提交。该语义识别责任不下沉为 Hono/Web 正则、关键词或本地语义门禁；Hono 只负责编译与验证原文坐标、字段和结构化守恒，因此任意标点/空白输入及物理运行窗口切换都不会丢失章级对照基准。

章节标题、卷名、目录/分隔/场次标签等文档结构文字默认只属于来源文本结构；是否存在同文角色台词必须由 agents 根据正文发声证据语义判断。上一章退出对白可以进入当前章连续性上下文，但当前章没有逐字复现时不得写入当前章 ledger。Hono 不实现这条语义判断；它只保存 agent 选择并能在当前章节真源中逐字定位的 ledger，然后对两个结构化序列做守恒检查。
新 BeatSheet 必须携带 `meta.deliveryScope`。`full_chapter` 省略 `targetDurationSeconds`，并由来源游标保证从原文首个
实义字符连续覆盖到最后一个实义字符；`bounded_duration` 只有在用户明确指定时长时才携带目标。执行计划的
`clipTopology` 始终从已冻结 beats 的真实数量和逐拍时长投影，不再维护理论最少拓扑或平行证据对象。
commit 物化每拍完整、未截断的 `sourceSpanText` 给单 clip writer，同时下发该跨度的全部 `dialogueScript`。
writer 为每条冻结 line 提交且只提交一个完整 `speechEvents[]` 事件，正文坐标固定使用 Unicode 半开区间，
发声窗口独立于视觉切点；writer shots 不携带正文、说话人、文本坐标或 `speechEventIds`。供应商受理前，
Hono 按 lineId、顺序、说话人、delivery 和字符串逐条精确比较，再于最终 Shot 时钟上编译每镜引用；
缺行、改词、换说话人或新增旁白都会作为可修复的 writer 合同错误回灌同一执行链，不产生付费提交。
最终视频 prompt 的第一个字段是最高优先级 `AUDIO AUTHORITY`，紧接唯一人声轨；每个完整 SpeechEvent 只投影一次，格式为 `Dialogue#N | Time=... | Speaker=... | Delivery=... | Performance=<JSON 字符串> | SpokenText=<JSON 字符串>`。可选 `Performance` 只携带语速、音量、呼吸、停连、重音和潜台词等非正文表演控制；只有 `SpokenText=` 后的 JSON 字符串值允许发声，字段名、引号、转义符、时间、说话人、delivery、performance 与音色绑定都不可朗读。其余提示词明确分成 `VISUAL_ONLY` 与 `SFX_ONLY`：前者只执行画面、动作、摄影、光线和材质，后者只执行非人声环境声、动作声、声源距离、遮挡与混响；两轨即使出现开口动作、引号或完整自然句，也禁止转成旁白、OS 或 VO。唯一人声轨后先交付 logline、时空进入态、按最终 manifest 真实顺序渲染的 `@图N（资产类型:canonical 名）` 参考资产职责与剪辑触发，再完整投影宿主编译的 `temporalFrameTrack` 为“时间窗｜起帧状态与画面｜可见过渡｜承帧状态与画面”的模型执行表，随后才交付逐镜执行表和退出态，保证模型处理第一拍前已拿到空间、资产及逐秒/亚秒状态前提。人声轨中的画内角色同时保留同一最终 manifest 的 `@图N` 与 canonical 名；供应商提交边界把验真的 `@音频N -> canonical 说话人` 音色映射注入同一人声轨的唯一预留地址，音色样本内语句一律禁止朗读。系统不再提供关闭真实原生对白音色输入的环境配置，也不再在 prompt 尾部追加旧版“镜头表引号台词”、强制无 BGM 或“对白吃满整镜”等第二套创作说明。逐镜表台词位只保留宿主编译的人声轨编号和 delivery，不再重复台词正文；非人声声场保留在 `SFX_ONLY` 列。无对白 clip 显式投影 `Dialogue=None`，禁止任何人声。
最终 prompt 的权威分类只保留 `DIALOGUE_ONLY`、`VISUAL_ONLY`、`SFX_ONLY`，不再混入 `NON_SPEECH` 等第四标签。new-api 供应商提交边界现在是纯协议传输层：除验真音色引用的唯一预留地址外，正向 prompt 与负向 prompt 均按 agents/调用方交付值逐字发送；Hono 不再运行正则去污染、画质词剥离、无 BGM 追加或通用反 AI 负向模板合并。空泛词、声画取舍与去 AI 味必须由 agents-cli writer 在同一创作链内修正，避免提交前的本地语义改写损伤原文对白、项目媒介、导演节奏或动作因果。
退出态使用中性的 `【退出态 / EXIT_STATE】` 标签并逐字投影 BeatSheet 冻结的 `clip.exitState`。`open_motion` 的开放矢量、`local_transition` 的局部换势与 `sequence_resolution` 的稳定收束由 BeatSheet 的 `arcContract + exitState` 冻结；writer 只需让 `continuity/shots` 的最后一镜实际达到该终态，并省略根 `exitState`。Hono 不再统一追加“向下一镜交棒、保留残势、不提前稳定落幅”，也不会反向追加定格或稳定落幅，避免确定性 renderer 覆盖冻结导演弧线。
writer 同链自检还要求每段可发声正文只出现一次、且只能存在于 `speechEvents`；`performance` 与 `action` 等控制字段只写表演控制、开口/闭唇、
呼吸、视线、姿态、动作起止与对口型状态，不得复制、引用、转述或用“说出/喊出：『台词』”再次包装正文。
`visualTask`、`action`、`framing`、
`lensIntent`、`composition`、`cameraMove`、`lighting`、`materialResponse`、`performance`、`notes`、`soundPerspective`、`sound`、
`logline`、`continuity`、父级 `exitState` 与 `sourceSpanText` 均为不可朗读控制事实，其中 `soundPerspective/sound`
只承载听觉视点、环境声和动作声。
该核验发生在供应商受理前；一旦媒体任务已受理或产出资产，后处理仍只能追加诊断与修订版本，不能拦截、回滚、覆盖或丢弃结果。
视频比例与分辨率不使用服务端默认值。authoring 只接受当前 BeatSheet meta 或持久化
`userIntentContract.delivery.aspect/resolution` 中的显式事实；两处都存在时必须逐字一致，缺失或冲突均原地失败。
在 authoring 冻结与恢复时，服务端还会从同一次 fresh-read 的当前已启用运行时模型合同中读取 `sizeOptions`、
`resolutionOptions` 与 `supportsNativeAudio`：BeatSheet 的 `meta.aspect/meta.resolution` 必须分别逐字命中真实值；只要任一
`dialogueScript` 非空，模型还必须明确声明 `supportsNativeAudio=true`。能力字段缺失、规格不受支持或对白模型不产原生音频，
都会在供应商 POST 前显式失败；计费表键、旧 run 值和产品默认值都不构成能力证据。选哪一个受支持模型与规格仍由 agents
根据用户交付合同与商用母版目标决定，Hono 只执行结构化实时能力校验，不用本地排序替代语义决策，也不会把不支持的规格
静默改成 480p、改画幅或切换模型。
传给 agents-cli 的 `enabledVideoModels` 也使用同一次 new-api 精确身份匹配后的实时 `videoOptions` 覆盖产品目录静态规格，
并显式暴露画幅、分辨率、时长、`supportsNativeAudio`、参考图/参考音频能力与上限。产品目录中的旧 480p/1080p 记录或
缺失的音频标记不能再主导模型选择；实时能力未声明时以 `undeclared` 呈现，由 agents 在规划阶段换合法候选或显式报告，
Hono 不以静态 meta 兜底。
增强类 runtime 参数同样经过统一 `ModelParamSpec` 归一化：支持真实 `type:number`，带 `options` 但省略 type 的上游枚举只按结构归一为 `enum`；无法形成结构合同的参数不进入 agent 能力摘要。该规则不按模型名或 prompt 做语义判断。
authoring handoff 每次从同一持久合同重建 executable storyPlan，因此部署前已停在 `script_approved/assets_ready` 的 run
也能继续使用用户本轮的真实生成偏好，不会因 meta 投影缺字段反复空转，更不会静默换比例或分辨率。
结构问题由 agents-cli 在同一编译图内修订；Hono 不保存第二份失败 BeatSheet，也不开放平行整章 patch 流程。
完整 BeatSheet schema 同时显式声明了 `storyFactsContext` 与每拍 `storyFactLocks`，独立任务必须提交完整
`task_context` 分支，不能再因 schema 漏字段进入修补死循环。
`storyFactLocks.bindings` 的工具 schema 与共享 v1.2 parser 使用同一组结构化枚举：`visibility` 只能是
`objective/viewpoint_only/hidden`（不存在 `visible`）；可见绑定必须带 `directive`，task context 可见绑定还必须带
`sourceLabel`，hidden 绑定必须有对应 `revealGuard`。模型在生成完整 BeatSheet 并调用 preflight 前即可得到这些字段合同，不再因工具 schema 过宽而反复提交无效对象。

agents-cli 的 `tapcanvas_get_tool_schema` 只负责 catalog 工具的按需取 schema：本轮请求先收到经过
requiredScope 切片的轻量目录，实际取 schema 时由内部 `tapcanvas_tool_schema_get` 回调按当前
project/canvas/book/chapter/node/execution scope 重新计算授权面。多操作工具由 JSON Schema 自身的
`oneOf` 分支与 discriminator 的 `const/enum` 自动识别；同一分支可以共享多个结构相同的 operation：
首次 provider 工具 schema 只包含 `name`，结构上没有 selector；该 name-only 调用只返回轻量 operation 索引，绝不返回整份
多模式 schema。索引落入当前 run 的认证 catalog 后，下一模型轮的 provider schema 才要求 selector，并把 `field` 收紧为 index const、`value` 收紧为 index enum；随后用该精确 `{field,value}` selector 取得单一 operation schema，且 runtime 只允许
执行本 run 已精确加载的 operation。同一模型轮并行加载的多个 selector 会在 run 内单调合并，后完成的
schema 请求不得覆盖先完成请求已经登记的 selector；每个 selector 的精确参数 schema 也与 selector 一起保存在
当前物理 run 的瞬时 catalog 中。未取得 operation index 就提交 selector、selector 不在认证 index、或同一执行链重复读取完全相同 schema 都会在 agents-cli 原地以结构化协议错误失败；不再忽略猜测 selector，也不返回可被模型当作成功进展的缓存复用回执。`tapcanvas_call_tool` 在网络请求前使用该精确 schema 做纯结构校验，错误返回
`catalog_tool_arguments_invalid` 及逐项 JSON path/keyword/message；缺少 required 字段、虚构字段、类型、const、enum、
数组和数值边界都在本地暴露精确差异，不把错误参数送到远程副作用入口，也不靠模型文本、关键词或业务 case 猜测修复。
若当前已加载 operation schema 只使用一个 discriminator field，但 wrapper 的 `args` 没有提交该 selector，
catalog 必须返回 `catalog_operation_selector_missing` 与精确 `$.args.<selectorField>` required issue，要求只重建
缺失 selector 后复用已加载合同；不得把该参数缺失误报为 `catalog_operation_schema_not_loaded`，也不得重新加载静态
schema、猜默认 operation 或改变原逻辑动作。selector 已提交但没有对应精确 operation schema 时，才返回
`catalog_operation_schema_not_loaded`。该分流只比较 schema 声明与 JSON 结构，不解析用户意图或创作正文。
当一次 catalog operation 因纯结构参数不合法被拒绝时，下一模型回合不再继续把
`tapcanvas_call_tool.args` 暴露为开放对象，也不要求模型从已压缩的历史中重新记忆整份 schema。agents-cli
从当前授权 catalog 的 `loadedOperationSchemas` 取回该失败 selector 的精确参数合同，并把它直接投影为
下一回合唯一可见的 typed tool：已激活逻辑工具优先，否则重建原 catalog wrapper，wrapper 的 `args` 使用精确
JSON Schema 且 `name` 收紧为目标工具的 `const`。该回合同时设置 provider `tool_choice=required` 并关闭 web search，
所以模型不能用正文结束、改调无关读取或搜索来绕过仍可修复的同一动作。provider 生成参数与执行入口因此使用同一份
结构真源，成功动作仍统一归一到 catalog chokepoint，不产生 direct/wrapper 双轨。这一修复仅由
真实 `catalog_tool_arguments_invalid + toolName + selector` 触发，不读取用户文本、题材或工作流名称。
结构修复回合会同时保留 validator 的逐项 `path/keyword/message`，但 JSON path 只作为原始嵌套 `args`
内部的位置证据，绝不能成为重试 payload 的字面字段名。投影给 provider 的统一说明要求保留所有已合法 sibling，
只在路径指向的嵌套位置使用精确 operation schema 字段重建对象；因此 `beats[1].field`、`$.patch.field` 等诊断定位
不会再被误写成扁平 key。相同的精确 schema 与 issue 清单同时投影到内部 catalog wrapper 和 progressive loading
后 provider 可见的逻辑工具定义，避免逻辑工具已经激活时只增强 wrapper、模型却看不到修复事实。该约束属于
跨工具的纯结构协议，不解析字段正文或创作语义。
如果结构拒绝发生在当前物理 run 的最后一轮，agents-cli 会在 root suspension 收口前把最小修复游标
`wrapperName/toolName/selector/issues` 写入 PostgreSQL session meta；不持久化完整 schema，也不依赖上一进程的内存 catalog。
可信 continuation 恢复该游标后，先通过本轮已授权 catalog 的 schema endpoint 重新加载完全相同的 selector，再进入上述
单 typed-tool 强制修复回合；schema 未加载成功时游标保持不变并显式失败，不能静默丢失或开放普通工具面。同一逻辑动作
实际尝试后游标即清除，避免已经受理的付费或外部副作用被跨物理窗口重放。
视频 Beat 的状态合同同时区分 `characterStateVersions.<角色>.stateId` 与 `characterStates.<角色>`：前者逐字引用
`visualStateTimeline.interval.stateVersionId`，后者在 `anchorPolicy=state_specific` 时逐字引用同一区间的 `stateKey`。
精确 operation schema 会显式说明二者必须同时提交且不得互换；状态区间的选择仍由 agents 根据真实时间线完成，
Hono 只校验结构化引用一致性。
当 durable tool receipt 已带 `progressCursor.allowedNextActions` 时，catalog operation 还受 ready-frontier
结构围栏约束：schema discovery 与最终 executor 都会把 state-changing operation 的 selector 与当前允许动作做
精确同一性比较；已完成节点、跳阶段节点或尚未 ready 的节点返回 `catalog_operation_not_ready` 和完整 cursor，
不得进入远程副作用入口。cursor 还可声明开放的 `requiredReadActions`：当前物理 run 未先完成这些冻结输入读取时，
即使 mutation 已在 ready frontier，也返回 `catalog_operation_inputs_required`；读取结果 revision 与 cursor 对齐后才开放写动作。
当 durable frontier 在满足 required reads 后只剩一个 ready action 时，agents-cli 会在模型下一回合前用同一授权
schema endpoint 只预取该 operation 的参数合同，再把它投影为原逻辑工具名的 typed tool；该窗口只保留这一可写节点与已经授权的 `sideEffect=none` 事实读取工具，既不重新开放其它 mutation，也允许结构校验失败后 fresh-read 真源继续修复。provider 因而第一次
提交就受到 required/const/enum/additionalProperties 的完整约束，不再先故意撞一次开放 wrapper 后才进入修复。
该预取属于无副作用的协议读取：遇到 API 滚动重启、连接拒绝或瞬态网络中断时，agents-cli 只重试同一个精确
operation；若等待期间耗尽当前 root 物理预算，则写入 `root_physical_execution_budget_exhausted` 续跑检查点，禁止把
基础设施中断投影成用户逻辑任务失败，也禁止改换 operation 或模型。
模型发出的 direct 形态仍会被 runtime 规范化回同一个授权 catalog executor，继续接受 capability、ready frontier、
幂等与远程参数校验；若 frontier 存在多个真实候选，则保留 catalog wrapper 让 agents 做语义选择，不由本地代码选分支。
规范化仅改变本次执行路由；持久 assistant history 保留 provider 实际看见的逻辑工具名，禁止把内部 wrapper 名回灌给下一模型轮造成双序列化形态漂移。
普通 catalog schema 一旦成功加载，也执行同一类单入口切换：下一轮模型工具面保留该精确逻辑工具定义，并从
`tapcanvas_call_tool.name` 枚举移除同名入口；尚未加载的冷工具仍留在 wrapper。该切换只改变 provider-facing schema，
运行时继续把精确调用规范化到同一个授权 catalog executor，避免一个动作同时暴露精确参数与嵌套 wrapper 参数两种
序列化形态，尤其避免长媒体提示词在重复嵌套 JSON 中损坏。
若 ready-frontier 已唯一授权本次 operation，而当前物理 run 尚未缓存它的精确 schema，agents-cli 会在同一次工具
执行内部先读取 operation index，再只加载该 selector 的参数合同并继续执行；selector 必须同时存在于服务端目录和
`allowedNextActions`，否则仍显式拒绝。该机制只消除容器重启/物理窗口切换造成的额外模型 discovery 回合，不缓存
跨 run 能力、不扩大工具面，也不允许模型跳过 durable frontier。
上述 catalog chokepoint 在本地拒绝缺失 operation schema、参数结构错误、ready frontier 越界或缺少 durable input read 时，
必须同时返回 `ToolResult.payload.structuredOutput` 的 `ok=false` 失败 envelope，不能只把 JSON 写进展示文本。agents-cli 因而把
这类调用结算为 failed action，而不是成功副作用；精确参数修复后可以继续同一逻辑动作，也不会被
`unsafe_action_already_succeeded` 误拦截。该协议按结构化失败 envelope 工作，不解析任意工具正文或用户文本。
视频 draft 在仍有缺失 Beat 时要求先执行 `preflight_get_header`，从服务端冻结 header 取得逐字 source span 与 generation contract，
禁止模型从压缩历史或失败摘要猜 marker。只读 operation 仍可用于事实诊断。该围栏完全来自持久 DAG 状态和工具 execution
semantics，不从 prompt、工作流名称或业务关键词推断下一步。
多操作 facade 的 execution semantics 也按精确 JSON Schema 分支声明，而不是把整个工具统一视为 mutation：
`preflight_get_header/preflight_get_beat` 明确返回 `sideEffect=none`，因此它们不会被写操作 ready-frontier 误封。
精确 operation semantics 不只用于 schema discovery 和 executor；Hono 会把每个 discriminator value 的
`selector + execution` 作为轻量安全索引随 cold catalog 常驻传输，但继续延迟完整参数 schema 和描述正文。
agents-cli 的幂等键校验、只读事实预算、状态 epoch、重复成功副作用防重放与并发调度因此在首次执行前就能读取
精确 operation 合同；物理续窗或 durable frontier 自动加载参数 schema 时也不会先按 facade 默认值误判。
facade 默认 execution 只在目录没有精确 operation 安全声明时生效，不能把合法的只读恢复动作误判成整个
facade 的 unsafe mutation。
当真实 `preflight_commit` 失败结果携带服务端签名的 `recovery.allowedRepairModes` 时，agents-cli 只在相同
tool/run 且 commit 尚未成功的窗口内把这些模式合并为临时 repair frontier；新的 revision 继续沿当前 repair graph
推进，真实 commit 成功才
自动关闭该恢复边。Hono 同时把这些 repair actions 写入同一 Redis draft；后续 `preflight_get_header/get_beat/put_beat`
返回的 `progressCursor` 都携带该恢复态，因此物理 run 超时、容器重启或 session continuation 不会退回旧的 commit-only frontier。
同一 cursor 还持久化 validator 原始 `issues`、是否命中 header 以及精确 `clipIndexes`。这里仅解析公开的
`beats[index]` 结构路径，不解释错误文案或剧情语义；恢复窗口只要求读取这些节点类型，禁止重新扫描完整草稿、
技能与工具目录。每次 patch 仍必须携带该节点的 `beatRevision`，真实 commit 成功后才原子清空 repair artifact。
header revision-fenced 替换会继承恢复态（因为复制过来的 beat 仍需逐个校正），只有真实 commit 成功才清空。
这样正常 DAG 仍严格禁止跳阶段，确定性校验失败又能执行 `get -> revision-fenced put/begin -> commit`
闭环，而不需要按章节、题材或错误文案新增 case 分支。
成功的 `preflight_commit` receipt 必须在同一响应中把权威 cursor 从 `preflight_draft` 推进到
`preflight_committed`：revision 切换为真实 `preflightRevision`，已完成单元包含 header、全部 beat 与 commit，
唯一 pending 单元为 `production:loop`，唯一 `allowedNextActions` 为真实公开动作 `loop`。服务端不再返回不存在的
`prepare_assets_then_loop` 伪动作，也不能省略新 cursor 让 agents-cli 继续消费旧 draft frontier；成功 receipt 缺少
preflight revision 或正数 beat count 时必须原地显式失败。该规则只表达 durable mutation 的状态推进，不解释用户文本或创作语义。
agents-cli 选择 durable frontier 时按 `completedUnitIds` 的集合包含关系保持单调：提交后的只读
`get_header/get_beat` receipt 即使排在数组末尾，也不能把已经完成 `preflight:commit` 的 cursor 降回 draft。
同一 video run 的成功 receipt 同样按字段合并，后续只读结果只能补充 `draftRevision`，不能抹掉已经存在的
`preflightRevision/preflightFingerprint/acceptedAsync`。只有新的 run 身份或不可比较的新分支才能成为新的最新前沿；
该规则只使用结构化图证据，不识别工作流文案或业务关键词。
同一逻辑 run 进入独立子图时，服务端必须在 `progressCursor.scopeId` 声明新的图实例身份；例如资产修复使用
`<runId>:asset_repair`。agents-cli 优先采用 cursor 自带的 scope，而只在 cursor 未声明时用 envelope `runId` 作为
图实例 fence。这样资产修复子图从空 `completedUnitIds` 起步不会被预检子图误判成进度回退，同时同一 scope 内的
只读旧 receipt 仍受上述集合单调性保护；这是一条通用 DAG 身份合同，不按业务文案、题材或具体任务分支。
`assetObjectContracts` 在 preflight 负责冻结每个出场对象的身份与状态合同；对象当前没有真实图片锚时，
`referenceImageNodeIds=[]` 是合法的显式事实。它不会伪造或跳过资产：authoring asset DAG 必须在 provider 提交前
生成/绑定真实图片节点，或按确定性资产边界显式失败。这样无角色卡图片的配角仍可进入预检，同时真实媒体提交继续
受前置 URL 与引用预算约束。
BeatSheet validator 的阶段名硬切为 `planning|execution`：经 revision/fingerprint 验真的冻结 preflight 在 `loop`
受理时只按 `planning` 合同建图，允许上述待物化 nodeId；没有冻结证据的散提交以及供应商执行边界仍按
`execution` 合同要求真实节点。禁止在 DAG 创建之前拿最终执行合同拦截待补资产，否则资产修复节点永远没有机会运行。
preflight receipt 的不可变 fingerprint 负责证明调用者引用的是同一冻结记录；`loop` 的创作计划等价性则把
冻结 BeatSheet 与本次恢复后的 BeatSheet 经过同一 canonical projection 再比较。该 projection 明确排除
`agentModel/agentApiStyle/parentExecutionProvenance`、generation contract 与资产运行时字段：父代理跨物理窗口产生新的
executionId/startedAt 不是创作计划变化，不能阻断同一逻辑任务；真实剧情、Beat、filmBible 或生成规格变化仍会产生不同指纹并显式拒绝。
服务端确定性 validator 同样必须在错误信息中声明真实 required 字段与收到的字段集合，供跨物理窗口的
`actionRecoveryFacts` 原样携带。这套约束只读取 schema 结构，不读取 prompt、章节正文或业务关键词。
因此 schema 读取不会扩大工具权限，也不会把全量参数树放进首轮 HTTP body。agents-cli 同时登记本轮已经
直出的工具为 `direct=true`。因此模型即使误问 direct 工具的 schema，也会收到“工具已直接暴露、请
直接调用”的事实提示，而不是 `not found`；这条提示不会把 direct 工具重新包装进
`tapcanvas_call_tool`，也不会开启第二条执行路径。完整成片请求应依次调用 `mode="preflight_begin"`、一次或按需 revision-fenced `mode="preflight_patch_header"`、逐 beat 的 `mode="preflight_put_beat"`、`mode="preflight_commit"` 与 `mode="loop"`；
`loop` 的职责就是建立并启动资产 DAG，不得要求资产 DAG 预先完成；`estimate`
只用于用户明确要求的规划比较，不作为 loop 前置步骤。

`toolSurfaceConfig` 每轮独立声明 `mode=tapcanvas_public|host|local_code`、`hostUi`、
`allowDelegation` 与 `allowsExternalMedia`；即使 direct/catalog 为空，agents-cli 也不得回落到全量 code
工具面。CLI/runtime profile 为 `general` 的普通对话即使未显式声明 surface mode，也使用同一精简本地能力面，并跳过本地仓库/记忆树扫描；只有显式 `code` profile 保留完整 `local_code` 工具面和本地上下文，避免简单对话把冷工具 schema 与大段工作区事实全量送入模型而耗尽上下文预算。public/host 的 `allowDelegation=false` 时，Hono 基于同一结构化事实显式发送
`compactPrelude=true`，从稳定前置说明中移除已隐藏的团队角色与委派说明；显式开启委派时不发送该压缩
标记。general profile 的初始/续回模型请求默认使用 10 秒独立截止；部署可用 `AGENTS_GENERAL_INFERENCE_TIMEOUT_MS` 显式调整到 `5000..900000ms`，实际 deadline 仍与当前 root 物理窗口剩余 wall time 取较小值。这样普通线上对话保持快速默认值，而 8798 等明确需要验证长推理链的部署不会被不可配置的 10 秒上限误挂起；超时仍留下 `initial_inference_timeout` 或 `post_tool_continuation_timeout` 事实并结束当前物理窗口，逻辑任务按失败证据继续，code profile 继续使用长时限。8798 direct eval 不再把 `initial_inference_timeout` 当成不会变化的确定性等待：它和 `provider_stream_interrupted` 都在同一 logical task/session 上以 5/10/20/40/60 秒有界指数退避续跑，防止瞬时供应商故障在数秒内耗尽全部物理窗口；只有余额不足等需要外部账户事实变化的边界停止自动续跑。上游已注入且通过复核的 UserIntentContract 会让 agents-cli 在第一次 provider 推理前移除 `record_user_intent`；运行中合同冻结成功后也进行同一能力面收窄，只有结构化 pending repair 存在时才重新保留该工具，禁止同一 logical task 重走平行意图链。已冻结 `delivery.mode=response` 时还会移除仅用于持久状态阶段的 `record_stage_execution`；状态变更与异步资产模式不受影响。`remoteToolConfig` 只携带 endpoint、认证与执行 scope，空面时显式为 `{}`。Hono 不再重复发送

能力舱管理页继续展示已装配但作者图已经变化的 workflow，并以 `stale=true` 要求用户或管理员重新检查；Agents 工具目录则在暴露 `tapcanvas_equipped_workflow_run` 前，使用与执行入口相同的纯作者图等价比较，过滤版本缺失、源 Flow 缺失或作者图真实变化的附件。目录不得把服务端已知必然返回 409 的 stale attachment 投影为可执行主路径，也不得自动把附件切到新版本。若目录获取后到执行前发生版本竞态，执行入口仍返回 `capability_attachment_stale + terminal:true`：这里只关闭该精确动作，父逻辑任务继续基于刷新后的能力事实重规划。
知识向量预取的 embedding 请求默认使用 3 秒独立截止（可由 `AGENTS_EMBEDDING_TIMEOUT_MS` 调整），检索超时只记录 `retrieval_failed` 诊断，不占用创作推理窗口。
顶层 `tapcanvasProjectId/tapcanvasFlowId/tapcanvasNodeId/tapcanvasApiBaseUrl/tapcanvasAuthorization/
tapcanvasApiKey`，也已删除 agents-cli 不消费的 `knowledgeContext` 及其每章两次 best-effort 读取。
工具桥接请求中的 `parentAgentExecution.provenance` 现在与 agents-cli 的 `execution-provenance.ts`
保持同一份严格 v1 合同：只包含 execution/agent/session/depth/model/apiStyle/requiredSkills/
loadedSkills/startedAt 事实，不再要求或接收已退役的 `knowledge` 注入证据。该对象在工具业务逻辑
之前完成结构校验；合同漂移会原地返回 400 并记录请求事实，不会伪造空知识卡或静默降级。
外部宿主模式固定为 `remoteTools=[flow_patch, ...(hostTools.length ? [host_tool] : [])]`、`remoteToolCatalog=[]`；宿主身份、UI 与委派/外部媒体能力
只走结构化 `toolSurfaceConfig`，其中 `mode="host"` 是唯一宿主模式真源，不要求 agents 从渲染后的 system
文本反推，也不再在 `remoteToolConfig` 重复发送已无消费者的宿主模式或协议版本字段。

外部宿主的 `flow_patch` / `host_tool` 是命令交接协议，不是执行回执。`/public/agents/tools/host-execute` 只按统一
`HostFlowPatchSchema` / `HostToolCallSchema` 验证单个命令，并返回 `deliveryState="emitted_to_host"`、`applied=false`、
`acceptedAsync=false`；agents-cli 只记录 `hostCanvasSubmission.emitted`，不得把 `runNode` 的命令发出误记为
供应商已受理或资产已生成。OpenAI-compatible facade 只转发 schema 合法的 `flow_patch`，有任意宿主
tool call 时终帧 `finish_reason="tool_calls"`，纯文本时才是 `stop`；流式与非流式响应保持同一语义。
facade 不再注入“持久异步执行器已受理”的正文，也不从宿主 manifest 的 output 类型伪造
`accepted_async` artifact。宿主必须串行执行命令并以自己的真实节点终态、task identity 与 HTTP(S) 资产
URL 完成 `expectedDelivery -> deliveryEvidence -> deliveryVerification`；没有宿主执行回执时只能停在
`host_execution_required`，不能投影为用户级完成。runtime trace 将该边界记录为宿主命令交接：它不会要求
服务端再伪造一个 `report_delivery`，同时保持 `satisfiedByAsyncSubmission=false`，避免把协议交接重新包装成
持久异步受理。

这类交接使用正式的 `external_handoff` continuation registration，而不是借用服务端 AI 续跑：只有
agents-cli 的物理出口同时为 `waiting_external / waiting_for_evidence`、continuation ticket 的
`nextTrigger="external_evidence"`，并且同一回合确实向已声明的 host manifest 发出至少一个通过 schema 验证的
成功 `flow_patch` 命令且其中包含 `runNode`，Hono 才把精确 ticket 与命令 ID 集合绑定为
`effectOwner="host_execution"`。该状态不会创建 `agents_async_continuation`、不会发布 continuation job，也不会
把 chat activity 留在伪运行态；OpenAI-compatible 非流式响应按正常 tool-calls 完成，流式响应正常发送 `[DONE]`，
不再返回 202 pending 或追加“进入持久续跑”正文。命令缺失、manifest 不匹配、没有 `runNode`、ticket 身份漂移，
或后台 continuation 再次要求不可见的外部宿主时，仍按 `async_continuation_owner_missing` 显式失败，禁止无主挂起。
宿主执行节点后仍须以真实 task identity、节点终态和 HTTP(S) 资产 URL 完成交付验收；`external_handoff` 只证明
谁拥有下一步执行权，不证明图片、视频或文档已经生成。

Hono 继续拥有协议/schema、认证授权、计费幂等、模型事实继承、真实资产 URL 校验与持久化 continuation；
agents-cli/TaskStore 拥有物理退出与任务事实，Hono 只从 `PhysicalRunExitV1 + terminalAuthority + deliveryVerification`
提交唯一 `logicalTaskState`；较弱的 `runOutcome/requestTerminal/turnVerdict` 只作诊断，不能覆盖该投影。执行交付事实只走
`expectedDelivery -> deliveryEvidence -> deliveryVerification -> logicalTaskState`。未声明结算边界的
`accepted_async` 仍只表示带稳定 `nodeId/taskId/runId` 的提交已受理，verification 保持
`unsatisfied`、请求终态保持 `suspended`，直到真实 HTTP(S) 资产 URL 物化。画布生图是明确的父子任务
例外：`tapcanvas_image_generate_to_canvas` 只在图片节点和供应商 `taskId` 均已持久化后返回
`completionBoundary="submission"`。agents-cli 将这份 persisted-state receipt 验为父对话任务的
`satisfied/succeeded`，不再注册对话 continuation；图片节点自身仍保持 `running -> success|error`，由画布 SSE/
reconcile 独立收取真实资产。该证据只声明“节点已添加且生成已触发”，不声明“图片已生成”；缺少
`nodeId` 或 `taskId/runId`、批量子项存在提交失败，或未携带该显式边界时都不允许完成父任务。

视频工作流失败恢复统一使用原 execution family 的持久节点事实。恢复入口必须接收当前任务已受理的
`sourceExecutionId`，fresh-read 已成功节点、供应商 task identity、真实资产 URL 与未完成 frontier，并只重跑合法未完成节点；
证据不足时显式返回结构化失败，不新建替代 execution、不重写成功工件、不重复付费。

同一恢复入口也覆盖零生产的 collecting legacy 投影：当 `authoring_state=authoring_failed` 且持久错误码为
`asset_coverage_inspection_failed:*` 时，即使 16 个或更多 clip artifact 仍为 pending，也必须按 coverage 根因
返回 `authoring_recovery_required`；writer 数量只是下游节点状态，不能覆盖上游失败节点。`recover_authoring`
唤醒原 run 后，新的 coverage 编译器把带 kind/name 的引用缺口转成 `asset_repair_required`，agents-cli 继续消费
`assetRepair/v3`。这条优先级是通用 DAG 因果规则，不依赖章节、模型、runId 或提示词文本。

`recover_authoring` fresh-read 时若后台 driver 已把同一 run 从失败态推进到 `collecting` 下的非终态
authoring 阶段（例如 `writing_dispatched`、`assembled`、`script_approved` 或 `estimate_ready`），
不得再返回 `authoring_recovery_not_applicable` 并等待 stale sweep；入口应直接接入 canonical 同步 driver，
继续当前 run 到真实生产交棒或结构化失败。该路径不执行恢复 CAS、不改写 BeatSheet，也不创建新的 run。

writer 工件按同一批持久 artifact 的结构状态整体裁决：`ready` 原样复用，已经认领的 `running` 只读取
同一持久执行，尚未派发的 `pending` 可以首次派发；任一 `failed` clip 都是该次 run 的确定性失败，不能因
历史 `repairable`、进程恢复或 sibling 状态重新认领、重派或新增预算。若请求恰好在 writer spawn 后、
artifact 绑定前结束且仍没有模型候选，只能依靠同一持久 spawn 身份完成绑定或显式失败；不得创建第二个 writer。

writer 派发采用“先持久认领、再创建远端 agent”的单向合同：driver 必须以
`pending -> running` CAS 原子认领 `clip:N`，认领失败时禁止调用 `/collab/spawn`；spawn 成功后必须把
真实 `agentId` 绑定回同一工件，绑定失败则立即补偿调用 `/collab/close`，且不得推进
`writing_dispatched`。派发后的完整性检查按 BeatSheet 的全部绝对镜号核对工件，缺行、遗漏索引结果、
非 `running/ready` 状态都属于显式持久化失败，不能通过“查询结果里没看见 failed”伪装成成功。
后台 authoring sweep 的日志和结构化 details 始终携带 `runId/projectId/chapterId` 与匿名化
`ownerScope`；全库 sweep 中其它项目的 run 不得与当前 Web 请求的作用域证据混为一谈。

同一恢复合同也覆盖 authoring 尚未交棒时被 production state 意外归档为 `cancelled` 的旧 run：
authoring driver 必须先留下 `authoring:production-state-conflict` 的 ready artifact，恢复器只接受其中
记录的 protocol authoring 前一态，并以窄 CAS 将 `authoring_done/cancelled/零 clip` 原位恢复到该状态，
再进入原 BeatSheet 的 authoring driver。该路径不从错误文案、章节正文或历史计划推断阶段，也不新建 run、
重画已有图片或重提已受理的视频；`status` 会返回同一个 `recoveryAction="recover_authoring"`，并把
`restoreAuthoringState` 作为诊断事实交给 agents-cli。

AI 对话的上下文装配采用 Pi agent-core 的两级取数边界：每轮请求只携带当前画布的紧凑节点索引
（id、kind、label、productionLayer、status/taskId/hasMedia 等结构元数据），节点 prompt、章节正文、
镜头表和媒体详情必须通过带 `nodeIds/fields` 的画布工具按需读取；Hono 不把整张画布或整章正文放进
对话 system prompt。agents-cli 在调用 LLM 前执行结构化 context transform：远程画布会话默认采用 64,000 token 的
单物理 run 工作集上限（可由 `AGENTS_REMOTE_CONTEXT_BUDGET_TOKENS` 显式调整，并始终受当前模型真实窗口约束），不再把供应商最大窗口当作默认任务预算。每次 provider 调用都会向模型注入独立的真实预算事实：模型最大上下文、按安全比例计算的有效窗口、当前任务工作集、物理 run 累计上限/已用/剩余；例如 `gpt-5.4` 当前目录是 `272,000` 最大上下文、`258,400` 有效窗口，而默认远程任务工作集与物理累计上限分别是 `64,000`、`120,000`，三者不得互相替代。调用前还会按实际 provider projection 保守预留输入与最小输出；剩余物理预算不足时不再发起一个必然越界的模型请求，而是持久化 projected token suspension 后切换续跑窗口。选中的真实画布、run、资产、执行状态、当前有效参数与结构化失败证据按持久 identity/revision 保留，重复 Skill/schema/read 不作为进展。只读准备材料会在后续权威工具事实落地后，按工具协议身份退出 provider 临时窗口；持久 session 与 trace 不删除该证据，必要时 agent 仍可按 identity 重读。章节、画布、Skill section/resource、知识卡正文和 schema 不会彼此覆盖；它不按关键词猜任务，
也不替代 agents 自己决定需要读取哪一类事实。这样稳定 system 前缀可继续命中缓存，任务详情只在真正
需要的工具回合进入上下文。章节 intent 入口同样只把显式 sourceNode 的完整数据与其余节点的结构索引
交给规划链，避免把整张 `flowSnapshot` 的 node.data 重复塞进每次规划请求。对无状态 chat provider，
context transform 的任务窗口会直接作为本次 LLM 输入；只有存在可靠 `previousResponseId` 时才发送增量
消息，不能以 `deltaMessages` 名义绕过任务窗口重新提交 durable 全历史。
LLM adapter 的 provider-history 边界使用有界的结构性投影：当前用户请求、最近的真实画布/run/资产状态、当前有效参数和结构化失败证据优先保留；最新 DAG 游标转换所必需的工具结果保持无损，当前包括按 `(runId,draftRevision)` 区分的 `preflight_get_header` 和按 `(runId,draftRevision,clipIndex)` 区分的 `preflight_get_beat`。一次 revision-fenced mutation 被确定性拒绝时，对应读取仍是 pending fact，不会因“最近工具批次已变成失败 write”而被压缩；只有成功写入新 revision 后才消费该读取。旧的 schema、Skill、检索和工具参数按 tool ID、调用协议与声明字段压缩为可识别的 provider history 记录。它不读取或匹配创作正文来做路由、质量判断或完成判断，也不会改写持久 session/trace。
当该投影仍超过 provider 临时窗口时，第二阶段工作集选择必须基于第一阶段已经压缩的 provider 副本计算大小，并保留成对的 Skill/schema/tool-call 与 tool-result；并行 assistant 工具批次按最终保留的单个 call envelope 计价，不能让批次中的每个 call 都重复承担整个原始 batch 的大小。否则所有成对结果可能被错误排除、工作集压缩成仅剩用户消息，模型下一轮看不到已成功加载的指令和工具事实便会重新请求同一 Skill/schema，形成无产出的空转。运行日志中的 `providerMessageCount`、`providerMessageChars` 和 `providerHistoryCompaction` 用于核对这一事实。
当后续权威工具事实已经成功落地，provider 临时窗口会按协议身份移除已消费的 schema lookup、Skill、knowledge candidate listing 与知识卡正文；这不是基于提示词、章节正文或关键词的判断。持久 session/trace 仍完整保存这些调用和结果，agent 可通过它们的 identity 再读取。真实章节、画布、run、资产、执行和失败事实在持久状态中不会因该投影被删除或改写。
章节会话的 `bookId/chapterId` 是服务端授权 scope，而不是模型可重新解释的文本字段。书籍工具始终以该 scope 绑定的 `bookId` 读取；模型附带的错误节点 ID、显示 ID 或旧书 ID 不会覆盖它。这样 `book_not_found` 会保留为可诊断的工具事实，而不会让同一章节会话漂移到另一份书籍数据。
对 thinking provider，assistant 的 `reasoning_content` 也属于 provider history 的协议事实，会随对应工具调用保留并回传；它不作为用户创作上下文注入，但不能被丢弃，否则下一轮可能被 provider 以历史不完整拒绝。
generic `tapcanvas_call_tool` 会先解析内层 `name/args` 仅用于诊断和结构识别，不会因此触发二次裁剪。
同一执行链若再次请求完全相同、已经成功的无副作用且 `retrySafety=safe` 的静态读取（默认首次成功后即不再重复），agents-cli 会依据内层
逻辑工具名、规范化参数和已成功的 call ID 产生 `duplicate_read_without_state_transition` 结构化回灌，而不是
继续执行读取或把它投影成用户级失败。该回灌进入当前 provider working set，要求 agent 使用既有事实重规划下一步。
章节事实签名将 `chapter/chapterNumber/chapterIndex/chapterNo`、纯数字或完整 `book-…-chN` 的 `chapterId` 统一为同一章；`flow_get(nodeIds:[])` 与省略 `nodeIds` 都表示同一画布摘要。模型不能再通过这些结构等价写法制造“新目标”。
画布、章节、素材与 execution 读取属于实时状态查询，虽然无副作用，但允许在同一状态 epoch 中有限次复查；`resultLookupSupported=true` 只表示该工具可能承担状态查询，不再让它绕过重复读取保险丝。真实成功的画布写入、任务提交或其它状态变更会开启新 epoch，之后可以重新读取同一目标获取新事实；没有状态变更时，参数投影变体与其它只读调用穿插都不能刷新预算。
并行工具批次中，`duplicate_read_without_state_transition` 与 `consecutive_tool_call_limit_reached` 只关闭对应的冗余只读动作；同批其它独立、无副作用的合法读取仍会执行并回传事实，不能再被合成 `parallel_batch_cancelled_after_failure`。任何 mutation、未知语义工具或其它执行失败仍保持 fail-fast，因而该例外不会放大付费提交或写入并发面。
动作级拦截之外还有物理 run 的结构性进展保险丝：连续 3 个模型回合若只有 `blocked` 工具、没有任何成功状态转换，agents-cli 不再把第一次命中直接抛成 HTTP 500，而会关闭已经重复的读取作用域并注入最多 2 次 ephemeral 协议重规划。重规划只能复用已有事实、最近的结构化失败与已加载精确 schema，从空对象重建至多一个尚未关闭的真实动作；任何成功状态转换都会清零该窗口。只有两次有界重规划仍全部落入 blocked 时，当前物理 run 才以 `tool_progress_circuit_exhausted` 的结构化 `repair_required` 结果收口，不伪造用户任务成功，也不再通过异常 throw 丢失浏览器终态。另一个独立的只读准备预算按真实 execution semantics 计数：root 连续 2 个回合只有成功读取、没有 mutation/task-state transition 时，本窗口进入 action-only 工具面，只保留 schema discovery、真实 mutation/付费动作与交付 envelope，并用 ephemeral 事实要求 agent 复用已有上下文行动或收口；任何真实状态变化会开启新 read epoch。后续真实动作若被确定性 schema/协议拒绝，会重新开启一次有界的定向事实修复阶段；非终态动作错误不能单独证明 `mustStop`，必须先耗尽当前安全修复与合法替代动作。上述预算与保险丝都不检查用户措辞、题材、prompt、评分或创作正文，不把逻辑任务直接判失败，也不会关闭安全的真实交付动作。它们防止模型通过改写 `fields/contentMode/query/kind/limit` 或换另一只读工具，把“成功读取”伪装成无限进展。冷目录工具在 `tapcanvas_get_tool_schema` 成功后会于下一模型回合激活其精确 schema；模型可按原工具名结构化调用，但 runtime 仍将调用归一到授权 catalog executor，不绕过权限、参数校验或幂等边界。
公开对话响应投影会将 rich trace 与必需终态字段分层解析：某个可选 diagnostics/runtime 字段不符合前端 schema 时，记录 `rich trace projection degraded` 及精确 issue path，但仍保留已验证的 `outputMode` 和 `requestTerminal`；不得因可选诊断投影降级而破坏 durable continuation 的必需协议字段。

章节视频的说话人音色以画布 `audioType=voice_card` 配音卡为真实资产来源，并由本轮冻结 `VoiceManifest` 唯一寻址。编排器按 `speechEvents[].speakerName -> speakerBindings.name -> VoiceManifest.entries[].speakerName` 精确绑定，每个 clip 将对应音色校准资产按最终 manifest 顺序写入 `referenceAudioUrls`，并只在唯一 AUDIO 区块中生成同序引用；校准试听不是台词。最终供应商边界仍按实时 `supportsAudioOnlyReference` 与图片/视频/audio manifest 做结构化拓扑预检：必需音色不被支持时在 POST 前明确失败，不删除音频、不换模型、不降级。任何请求一旦可能已被供应商受理，都禁止清空音频后重交。
视频 execution 以 `executionFamilyId + runtimeNodeId` 隔离付费副作用。同一执行族的 pending/success receipt 始终只做 reconcile/reuse；无论失败发生在供应商受理前还是已有 `taskId` 后，只要进入终态就不再分配重试 slot。新的供应商提交只能来自新的显式执行族，禁止同族原样重放与重复计费。
它不检查用户正文或提示词；非安全重试工具以及要求幂等键的
写入均不适用，因此不会阻断已受理媒体任务的后续状态查询或安全恢复。
如果模型把目标 payload 放在 wrapper 的 `args` 中却漏掉外层 `name`，agents-cli 只会在本轮授权 catalog/direct 定义中按必填字段做唯一结构匹配；恰好一个目标匹配时补成标准 `{name,args}` 后执行，无法唯一确定时不猜、不执行副作用，并将未执行的原始大参数改为紧凑的结构失败证据，交给同一任务继续修复。这个修复不使用用户文本、关键词或语义路由。
`tapcanvas_book_chapter_get` 的默认 `contentMode=task_context` 只限制读取哪一章，返回该章完整原文，
不会再返回 1,600 字正文预览；`full` 是同样无损的显式完整模式。结构化失败的工具调用仍然作为修复证据，
当前保留的最新参数和失败结果会留在任务窗口，供 agents 在同链修复时逐字复用；被后续同 mode 尝试取代的旧参数段不再重复发送。任务范围选择与内容保真是两件事：
不相关的历史消息不进入当前任务窗口，已经选中的事实不被本地预算器静默改写。
该保证同时下沉到 agents-cli 的通用 provider 投影合同：任何远程事实结果只要以结构字段明确声明
`contentTruncated=false` 且携带字符串 `content`，其最新版本就作为不可有损改写的来源事实优先保留，
不依赖工具名、文本题材或 prompt 关键词。如果这份完整事实本身超过 provider 的真实硬窗口，投影保持原文并让
`targetReached=false` 暴露真实容量失败，禁止把成功的完整读取伪造成“上游只返回了预览”。
若完整任务窗口超过供应商真实上下文/请求体硬上限，系统不偷偷压缩、不自动换模型、不重复付费；只返回带实际
provider 状态和请求大小证据的确定性错误。积分/计费、权限、协议、真实资产 URL 和供应商硬上限仍是允许失败的事实边界。
当服务端返回可恢复的 generation-contract recovery 时，恢复声明同时固定 retryToolName、最终 retryMode、
不可变 runId 与必要的嵌套参数路径；多步骤恢复还显式声明有界 `allowedRepairModes`。结构预检只允许
`preflight_get_beat -> preflight_patch_beat -> preflight_commit`；头部/模型合同恢复使用
`preflight_get_header -> preflight_patch_header`，并采用返回的新 revision。agents-cli 会逐个校验同一模型响应里的所有修复调用，并在最终 `preflight_commit`
真实成功前持续保留同一 recovery identity；中间 get/put 成功不会提前清除恢复状态，也不能借恢复回合调用
status、flow、reconcile、concat 或其它无关工具。这样 revision-fenced 修复图可以执行，同时仍锁住工具、runId
与 draftRevision，不再把合法的异构恢复步骤误判为 `tool_self_repair_contract_violated`。
如果当前修复上下文没有该 target 当前 operation 的精确 schema，只允许按 durable cursor 的 discriminator 读取一次，并保留同一 recovery identity
后在下一回合提交；这不是新的规划或创作闸门。视频编排的
BeatSheet 章级头必须保持 `args.beatSheetHeader.meta.videoModel` 的结构路径，服务端不会读取扁平顶层 `videoModel`。
远程工具的公开参数面进一步用按 mode 的结构约束表达这一事实：新建 `preflight_begin` 省略 `runId`，由服务端分配不可冲突身份；
已有身份不再通过 begin 修订；恢复时使用 `preflight_get_header(runId)` 取得当前 `draftRevision`，再沿 ready
frontier 使用 patch/put/commit。begin 必须携带
`expectedBeatCount` 与只含 `version/storyFactsContext/meta.videoModel/meta.deliveryScope`（以及 agents 已从实时能力明确选择时的可选 `meta.finishing`）的最小 `beatSheetHeader`；服务端注入 UserIntentContract、generationContract 与可选 finishingContract 后返回 `missingHeaderFields/nextHeaderPatchField`，章头未齐备前 `preflight_put_beat` 会原地拒绝。每次 `preflight_put_beat` 只创建一个 clipIndex；修订已有节点前必须
用 `preflight_get_beat` 读取该节点，并在 compact `preflight_patch_beat` 中携带 `replaceBeatRevision` 与 verifier 明确指出的无效 JSON 路径。patch 服务端对对象递归深合并、对数组整体替换，再复用完整节点 schema、来源跨度和 CAS 校验；它不解释也不补写语义。创作元数据 warnings 只进入诊断与 agents-cli
同链自检，不触发 Hono recovery；只有 clipIndex、冻结模型/时长、说话人硬上限、连续模式、引用数量、真实资产、
权限和幂等这类确定性执行合同错误，才按“读取当前节点 → 修正错误路径 → revision-fenced 写回”恢复。只读执行事件查询在 run 尚未创建时返回 `execution_not_found`，这属于
warning 证据而不是用户任务异常，agents-cli 应继续构造 preflight，不得因这个 404 停止成片任务。
compact patch 不重复注入完整 Beat schema，因此共享结构 validator 的枚举错误必须同时返回字段路径与合法值集合；当前 Story Fact 的 `status`、`visibility`、binding/reveal `source` 与 blocked channels 都使用 schema 真源常量生成诊断。这样任意题材的错误值都能依据确定性 issue 原地修正，不要求重新加载 Skill，也不靠 prompt、关键词或章节特判猜枚举。
`preflight_commit` 的确定性 BeatSheet 结构校验失败也返回同一 run/draftRevision-bound recovery，并只附带有界的结构诊断（如
`beatCount`、`firstBeatType`、`firstBeatKeys` 和有界错误列表）；agents-cli 在同一执行链内依据错误路径只 patch 对应节点的顶层字段，
不重复检索知识库/技能、不把失败参数当作下一轮模板，也不把局部 preflight 失败直接投影为用户级终止。结构化恢复工具面保留
本轮已经授权且声明 `sideEffect=none` 的事实读取工具，避免 validator 要求重新读取原文或 durable 节点时出现“上一回合可用、
修复回合突然不在能力面”的协议漂移；写入与付费动作仍只保留 recovery 指定目标和 catalog wrapper。
这类创作元数据缺口在工具 trace 与 Web SSE 中标记为 `severity:"warning"`，但不携带强制 recovery，Web 也不把它显示成“工具失败/异常”。
只有权限、协议、积分/计费幂等、真实资产 URL 和供应商硬上限等确定性边界保留 error 语义。
自愈 `retryKey` 只标识当前结构修复阶段；当 `retryToolName` 与 `immutableArgs`（例如 `runId`）保持不变时，
验证阶段进入模型合同阶段的 key 变化仍在同一逻辑任务内继续，只有工具名或不可变任务身份变化才关闭该动作。
可修复的结构错误只关闭当前错误参数，不关闭用户的成片任务；agents-cli 会在同一 run 内继续 schema 驱动的
有界修复。权限、幂等/计费和供应商硬上限仍是事实边界，不能被“创作无闸门”替代。
视频编译图不会把整章 BeatSheet 或完整章头放进任一 provider 工具参数；provider 副本只保留最小 starter、当前一个 header section、首次创建的当前单 beat 节点、compact patch 或 commit receipt。
修复回合必须依据当前 schema、Skill 和结构化 warning 只提交错误顶层字段。只有服务端已经冻结的 `preflight`/`loop` 计划，才进一步
收敛为执行身份（`runId`、`revision`、
`fingerprint`、`beatSheetRef`、模型/规格与拍数）；服务端已冻结的完整 BeatSheet 不会为了下一轮修复再次传给模型。
这只改变 provider-facing 的临时副本，不改变持久会话、Redis 冻结合同或真实工具证据。
`loop` 使用 `beatSheetRef:"preflight"` 时，Hono 先读取服务端冻结的 BeatSheet，并从其 `meta.videoModel` 恢复
生成合同模型，再进入合同解析；因此 loop 不需要重复携带整份 BeatSheet，也不会把缺少顶层模型字段误报为
生成合同缺失。commit 成功是 authoring DAG 的持久事件：异步 acceptance 返回前会通过 `waitUntil` 立即 kick
同一 run 的一次受锁图推进，使 `beats_committed` 无需等待下一分钟恢复 tick 才派 writer；周期 worker 仍作为漏踢、
进程重启与 writer/provider 新证据的恢复路径。kick 与 tick 共享 run lock 和数据库 CAS，不会双派或重复付费，
也不会在 HTTP 连接内轮询 writer/provider。authoring ready queue 使用独立的短租约
`VIDEO_AUTHORING_DRIVE_STALE_MS`（默认 5 秒），worker 的 durable tick 默认每 5 秒观察一次新 writer 证据；
供应商生产恢复仍使用更长的 `VIDEO_RUN_RECOVERY_STALE_MS`。两种等待不再共用同一 stale 水位，因此缩短
本地 specialist 结果摄取延迟不会放宽付费提交的恢复保护。
后台执行拓扑已硬切为单一 Compose 所有权槽位：开发与生产均只声明
`credit-finalizer-worker`（保留这个历史服务名以原位替换旧容器），其命令唯一指向
`dist/inprocess-worker.js`。旧 `credit-finalizer-worker.mjs` HTTP 回调进 API 的运行脚本不再暴露为
package script，独立 `inprocess-worker` profile 也已从 compose 删除，因此标准启动路径不可能同时创建
两套扫描队列。本地启动显式移除退役 profile 留下的 orphan container；生产以同一服务名
stop-old/start-new，并给在途 job 10 分钟 drain 窗口。worker 在 PostgreSQL 可用且四个 BullMQ consumer
`waitUntilReady` 后才写入健康标记，部署必须等到该标记，不能只凭容器 `running` 宣告接管完成。
计费结算 lane 不再重复调用 video/authoring/orphan scan；这些 DB frontier 只归 video-drive lane。
任一 stage 异常均写入结构化 `failures`、标记当次 BullMQ job 失败并保留最近 100 条证据；
worker 进程本身不因单次 job 失败退出，避免用崩溃重启循环充当重试器。
每次启动还会先删除三条专用周期队列中的历史 repeat metadata，再安装当前唯一 cadence；
清理或安装失败会使健康标记保持缺失，不会在未确认唯一 schedule 时开始消费。
现役周期队列在安装 schedule 前还会按 10,000 条批次清除历史 `completed` 唤醒回执；失败回执继续遵守
`removeOnFail.count=100` 的有界证据合同，不会因成功回执清理而丢失最近失败事实。
硬切遗留的 `tapcanvas-video-run-driver` 与 `tapcanvas-credit-finalizer` 队列时，不再只删除 repeat metadata：
新 worker 启动会先确认精确旧命名空间没有 worker、active、waiting、delayed、paused 或 prioritized job，
随后用 BullMQ `force:false` 原子移除整个旧队列（包括已完成的周期 tick hash）。真实 execution、计费账本、
供应商回执和媒体资产仍保存在 PostgreSQL/对象存储，不以 Redis 周期唤醒 receipt 充当业务证据。
任一旧队列仍有执行态或 worker 时启动显式失败，禁止强删在途工作；这样既阻止旧 5 秒 tick 长期积累成数十万 Redis key，
也避免 RDB/AOF 持久化尖峰拖垮 workflow-runtime owner 的续租。
`start` 的原子 handoff 会把 `last_drive_at` 写为 null，直接发布 production ready receipt；每个正常、非终态且
无错误的 worker cycle 在状态持久化后再次显式释放该租约，让下一次 5 秒 tick 继续提交或回收。若进程在供应商
调用中崩溃，租约不会被释放，仍必须等待较长 recovery stale 窗口；transport error 也保留租约并服从持久
`nextAttemptAt`。ready cadence 与 crash recovery 因而不再共用一个时间阈值。
`video_generation_model_required`。运行时 trace 会记录 `profile/budgetTokens/inputMessageCount/outputMessageCount/`
`supersededToolCallCount/supersededMessageCount/providerInput/providerMessageCount`
以及 provider 实际输入字符数，用于核对实际 provider 输入而不是只看预算估算；不再记录虚假的 provider-history
压缩差异。章节画布即使没有 flowId，也必须以 chapterId 作用域注入这份最小节点索引。
`tapcanvas_book_chapter_get` 默认使用结构化 `contentMode=task_context`，只选择当前章节但返回完整原文和章节元数据；
`contentMode=full` 同样返回完整原文。精准事实仍可使用 `tapcanvas_book_evidence_search`，但不因为预算器而截断已选证据。
这条边界只做字段范围选择，不替 agents 判断本轮是否需要全文。
终态 `report_delivery` 对只读查询使用 `requiresExecutionDelivery=false` 且省略 `deliveryContract`，避免
把无副作用的诊断请求误进入执行型合同或触发额外修复轮次。

工具调用同样遵循 Pi 的 transform/lazy-discovery 思路：请求进入 agents-cli 前先选择 durable session 的当前任务窗口，
再只把当前授权的 direct tools 与 catalog 名称注册表送入 runner；模型真正选择冷工具后才加载该工具 schema，执行完成后
只把当前阶段需要的结构化结果回灌当前任务窗口。远程 surface 的已选 Skill 及其声明依赖首轮只注入无损索引骨架；模型需要正文时通过 `Skill.sectionId` 或明确的 `Skill.resource` 逐字读取完整范围，不把未需要的正文放进当前任务；成功的候选集、知识卡
和同一工具事实在当前执行链按用户请求与 candidate set 复用，不因 agent 改写补充 query 重复向量/文本召回；正向
`knowledge_search` 成功后，`knowledge_catalog` 与 `knowledge_search` 都从当轮模型工具面收起，只保留
`knowledge_read` 消费已返回的 `candidateSetId`。因此模型不能通过改写 query/domain/roleScope/limit 绕过同一物理任务窗口的
重复读取边界；新的独立范围必须由新的任务窗口显式开启，不能在当前物理窗口里靠参数改写伪装。
catalog 只发送当前 requiredScope 已满足的名称、能力标签和授权 scope；完整工具描述与大型参数 schema 按精确工具名延迟读取。
agents-cli 的 schema-loader 与 generic caller 各自需要一个 exact-name enum，因此 Hono 记录切片后的
`catalogNameChars`、单份 `catalogEnumJsonChars` 与两份合计 `duplicatedWrapperEnumChars`；缺失 scope 的名称不进入
任一 enum，不能靠参数补齐或会话历史重新出现。
SkillLoader 只按明确的包边界发现嵌套 Skill：`<package>/skills/<skill>/SKILL.md` 会进入运行时目录，
但不会递归扫描 workspace、eval fixture 或任意静态目录；因此声明式子 Skill（例如 `seedance-sequence`）
可以被按需加载，同时不会扩大常驻 Skill 上下文。
选中的 Skill 所声明的 `requires-skills` 依赖会在同一次 Skill 加载结果中注入结构骨架；模型不需要为同一条声明依赖再发起失败的单独加载调用，具体阶段仍通过 `Skill.sectionId` 精确展开，sectionId 返回完整正文且不做 head/tail 截断。
运行时 `[agents-bridge.tool-surface]` 与 trace 同时记录 `remoteToolPayloadChars`、direct/catalog definition 字符数、
model-visible schema 字符数与 provider 实际输入字符数；agents-cli 另记录
`[agents.context]` 的任务预算、估算 token、provider message chars 和 task scope，用来区分“消息上下文
过大”和“工具面定义过大”两类延迟，避免用扩大缓存或重复发送全历史来掩盖慢调用。上下文 transform 是通用结构变换，
不按视频题材、关键词或 prompt 内容做路由。
每个 agents-cli 物理 run 还返回 `performanceSnapshot/v1`：`timeToFirstTextMs/timeToFirstToolMs`、LLM/工具累计耗时与占比、token/cache、schema discovery 次数、context section token、实际发送工具面字符数、catalog enum 负担和 durable progress revision 会作为同一 trace 的 canonical agent span attributes 持久化。发生候选前物理暂停时，同一快照记录 suspension 与投影预算，这些数值只用于 SLO、容量规划和事故归因。typed-output trace 另记录硬阻塞 inspection 与非阻塞 diagnostics：前者仅覆盖完整 JSON 可解析性、下游必需结构与引用、冻结事实和供应商硬边界；后者覆盖节奏、语义连续性、来源叙事和参数合理性。结构失败不会再启动模型窗口；日志只保存原始候选位置、长度、SHA-256 和必要失败路径，不把候选正文重新注入模型。

agents bridge 的工具失败与 run 级错误同时追加写入宿主持久化的 `project-data/agent-incidents/incidents-YYYY-MM-DD.jsonl`。容器通过 `AGENTS_INCIDENT_DIR=/runtime/workspace/project-data/agent-incidents` 显式绑定该目录，不能依赖 bootstrap 工作目录推导挂载位置；账本写入失败必须在 stderr 显式报告，但不得因此终止用户总体任务。事故账本只提供可检索失败证据，不参与语义路由、创作质量门禁或用户级终态裁决。

装备的共享工作流把媒体写回章节画布时，持久 execution 使用规范身份 `canvasId=chapter:<chapterId>`，而 agent-facing 章节作用域仍使用原始 `<chapterId>`。`tapcanvas_workflow_execution_inspect` 在 owner 与 project 校验不变的前提下对这两个结构身份做等价归一，因此回执指定的 execution family/attempt inspection 可从原调用章节直接读取；不得因共享工作流的模板 `flowId` 不属于调用者而返回伪造的 `execution_not_found`，也不得放宽到跨项目读取。

工作流原子 Agent 的 `workflow_agent_role_timeout` 是物理执行窗口边界，不是用户级失败。新物理窗口由 agents-cli 持久化为带 root ledger 的 `suspended/provider_stream_interrupted`；对于修复部署前已经写成 `failed/workflow_agent_role_timeout` 的 durable turn，Hono 只在精确 user/session/turn、不可变 `request.accepted` 与 recovery checkpoint 同时匹配时重建同任务 continuation。该恢复允许尚无业务副作用的模型规划窗口继续，不创建新业务 run；已有 durable action 时仍沿 checkpoint 证据恢复，禁止按 prompt、章节名或默认 route 猜测。

运行中续做/传输恢复消息经过同一 agents HTTP `/chat` 的 durable queue 早退路径，队列接受会记录
`queueId/sessionId/mode/active`，不会从队列请求再创建第二个模型循环；未携带 `queueMode` 的普通新回合
在异步恢复 session 之前必须先取得 generation-fenced admission reservation，同一 session 同时只允许一个物理执行 owner，旧请求的 `finally` 只能释放自己的精确 reservation，不能删除较新的 owner。服务平滑关闭会先停止新 admission，再以 `provider_stream_interrupted` 结束当前物理传输并等待 reservation 释放，使持久逻辑任务从既有 checkpoint 继续，而不是把关停伪装成用户取消或业务终态；这样既避免纠偏被误判成并行任务，也关闭了两个并发请求同时观察到 idle 后双启动、双扣费的竞态。

章节分镜持久化从 2026-08-04 起只接受完整 `storyboard-director/v1.2` artifact，并直接以该
artifact 的 canonical SHA-256 作为 plan/chunk 身份：对象键递归排序，数组顺序原样保留；
`undefined`、稀疏数组、非有限数字、非 JSON 类型与循环引用均显式失败。Hono 不再要求或解析
`semantic_review` attestation，不再把 review tool call 投影到 delivery evidence、响应 meta、BeatSheet
或 observability，也不让 review 结果参与完成态。新 plan/chunk 只写 `artifactSha256`；旧索引中的
`semanticReview` 最多作为 `unknown` opaque 历史元数据读取，不校验、不参与 identity，也不触发迁移或
数据清理。v1.2 schema、Story Facts ledger 绑定、跨 chunk handoff、prompt trace、真实 tailFrameUrl 与
原子二次校验继续作为确定性事实边界。

`tapcanvas_image_generate_to_canvas` 对带 `sourceRecipeId` 的节点不再在 Hono 内调用故事板 prompt
reviewer，也不再最多追加两轮语言模型改写。agents-cli specialist 已自检后的 prompt 会逐字进入现有
确定性生成合同；Hono 只验证结构、模型选择、引用资产、权限与提交结果。这个硬切不会修改、回滚或
丢弃任何供应商已受理或已经生成的图片资产。显式视频对比能力仍是独立工具，不属于这条默认出图链。

图片节点的画幅字段采用统一的 `node.data.aspect` 合同；图片工具桥接层将该结构化事实映射为供应商
请求的 `extras.aspectRatio`。该映射是确定性字段转换，不从 prompt 推断比例；比例缺失时仍由真实模型
目录/供应商默认规则处理，已生成资产不会在后处理阶段被拦截或回滚。

批量图片节点写入统一走带版本比较与重读的 CAS writer；并发 worker 不再用同一份旧 flow 快照做最后写入，
避免后写 worker 覆盖先写兄弟节点。`tapcanvas_image_reconcile` 在收集 pending task 前也会读取当前
project/chapter canvas，而不是复用请求开始时的旧 row。这样 `image_refs_get` 不会因为暂时看见半批节点
而触发第二批付费生图；已受理任务仍只通过 reconcile/后台 recovery 写回原节点并自动登记素材库。
批量只有在全部子项都成功写入、且至少一项已持久化 `running + nodeId + taskId` 时才返回
`completionBoundary="submission"`；任一子项失败都不会用部分受理回执把父任务误报为完成。

agents-cli 的 remote surface 不扫描本地 persona、workspace 或 memory，也不向模型列出本机 Memory/Novels 路径、
完整 capability grant 或未激活工具名。root 首轮暴露紧凑的 `report_delivery` envelope；终态正文不依赖未知工具结果时，
模型在同一个 provider response 中把它放在全部真实动作之后，常规确定性动作不再固定追加一轮 LLM。若读取/检索结果
决定最终正文，本响应只执行动作，settled 后允许一次必要综合。两种形态都由 runtime 把候选从 action scheduler 隔离，
不计入 action budget/progress，并在真实动作与 verifier 完成后才结算。runtime 的正文 SHA 绑定实际向用户返回的候选正文，
不能改为只验证 `finalResponse` 摘要、却交付另一份未核验正文；report-only 修复也不能覆盖此前已经生成并绑定同一 intent
合同的完整候选正文。工具响应若漏交 envelope，或 envelope 自身违反
确定性协议校验，agents-cli 才把缺口作为结构化、ephemeral 修复事实回灌同一执行链，
复用已成功工具证据补齐报告；只有同链修复路径耗尽后才显式失败，
不会把已经成功写入画布的动作伪装成未执行或要求用户重试。每个 HTTP `/chat` 只调用一次 runner。
同一 durable progress revision 上，连续两个无效 `report_delivery` 候选会临时从下一轮模型工具面隐藏；只有
真实业务动作推进 `progressRevision` 后才重新开放。该保险丝不解析创作文本或关键词，也不终止逻辑任务，
只阻止模型用不同报告参数绕过动作推进并反复空跑。
对于明确的执行、创作或修改请求，agents-cli 还会在 root 内部通过 `record_user_intent` 冻结本轮
`must/forbid/prefer` 与交付范围，计算不可变 `contractHash`，并把该合同沿同步/异步子代理链继承；
子代理不能重写合同。Skill 加载时可把召回候选集、召回来源、候选 rank/score、覆盖/冲突 requirement 与事实引用写入
可检索的 intent-selection trace；重排由 agents 根据当前合同和事实完成，Hono 不计算语义分数。
`UserIntentContract@2.delivery.mediaType` 是媒体终态的唯一权威类型：图片、视频、音频分别使用
`image | video | audio`，非媒体交付必须显式为 `null`；自由文本 `delivery.kind` 只作开放产物标签，Hono 和 runtime
均不得从它推断媒体安全语义。artifact evidence 同样要求显式 `mediaType`（通用非媒体 artifact 为 `null`）；只有与合同
类型完全一致且已经物化为 HTTP(S) URL 的证据才能满足媒体交付，`imageUrl/videoUrl/audioUrl` 不可跨类型引用，通用
`url/assetUrl/downloadUrl` 也不能冒充已确认媒体类型。
执行型 `report_delivery` 必须提交与冻结 `UserIntentContract.contractHash` 一致的 `deliveryVerification@2`，并用 evidence IDs 逐项引用 settled tool result、durable asset 或 persisted state；runtime 不会把“已受理”提升为“已成片”。非执行型正文交付可以省略这两块重复结构，runtime 将冻结合同的 requirement ids 确定性映射到实际最终正文并绑定精确 SHA；该投影不读取正文内容、不用正则/关键词判断质量，也不能用于证明真实执行已经发生。`mustStop=true` 的终止声明仍必须显式指出冲突/未解决条目。
该验证不由 Hono 解析提示词、关键词或技能名称；失败事实只回灌同一 agents-cli 逻辑任务继续修复。
正常完成的交付（包括只读查询）统一使用 `mustStop=false` 与空 `blockingGaps`；只有真实未解决
的 blocker 才能使用 `mustStop=true` 与非空 `blockingGaps`，结构错误会回灌 agents-cli 修复，不得把“已完成、
无剩余动作”伪装成终止缺口。Hono 只保留这类 contract hash/trace 的协议传输与诊断事实，并继续执行权限、schema、计费幂等、
真实资产 URL 和供应商硬边界；用户本轮要求优先于技能方法论、编排默认与模型默认，但不能越过供应商协议硬限制。
对完整视频编排的“动态模型合同缺失”也遵循同一边界：Hono 不再把原始 BeatSheet 保存为对话 patch 草稿，
recovery declaration 只要求 agents-cli 以同一 runId 修正 BeatSheet 编译图：先读取当前 header/beat，再用 revision-fenced `preflight_patch_header` 或 `preflight_patch_beat` 只提交错误顶层字段，然后调用
`preflight_commit`，随后按返回的实时目录事实继续资产 DAG 与 `loop`；不能使用技能示例、旧会话模型名或目录外
猜测。`video_model_not_enabled:*`、runtime contract 缺失、时长档或参考图合同缺失同样回到这条完整
preflight 合同。Hono 仍只验证当前 `enabledVideoModels`、generationContract、权限与计费事实，不会替
agents 选择静态默认模型；修复失败也只关闭该动作，结构化证据继续回灌同一逻辑任务，而不是把可修复的
模型字段缺口投影成用户级 blocker。

视频 clip 的显式 `add_clips{replaceAtIndex}` 还会原子重置该槽位的 durable
`video-submission:<clipIndex>` 意图。若旧供应商任务已经被受理但后来以策略/版权错误终止，旧的
`provider_task_accepted` 记录不能被当作新提交的幂等凭证；Hono 会把它封存为
`previousSubmission`，写入 `explicit_replacement_authorized` 边界，再由同一
`claim -> provider POST -> accepted/uncertain` 路径创建新的提交意图。成功片段、旧 taskId 与失败证据
均保留，只有显式 `replaceAtIndex` 才能打开这条新付费边界；普通 `start`/重试仍会被持久提交意图保护，
不会重复扣费或覆盖旧资产。
authoring 的项目风格事实只服务于需要新增的付费图片资产：只要声明的参考节点已有真实、可持久化的项目图片 URL，且与图片侧 style reference 精确一致，即视为图片资产已就绪；即使节点没有 style fingerprint，也不会误判为缺失并再次生成场景/道具卡。该判断不构成视频提交门禁，也不会把 style reference 图片注入视频模型。

视频提交边界的画布卡身份与 authoring coverage 使用同一结构化真源：角色读取 `roleName + characterProfileVersion`、
场景读取 `sceneName + sceneProfileVersion`，道具读取 `materialIdentity.canonicalName` 或 `propName`；
`label/title` 不用于角色或场景分类。展示文案可以自由变化，不会让已经通过 authoring coverage 的同一节点
被误判为身份冲突；提交前也不得覆盖或改名真实节点。
对“当前画布有什么”这类单一事实读取，`tapcanvas_flow_get` 的无参数摘要是完整路径；agents-cli 收到成功
结果后直接交付，不追加材料库、execution 或章节查询，除非用户明确要求那些独立事实。
`tapcanvas_flow_get` 的节点精读也有明确的上下文边界：传 `nodeIds` 时无论单个还是多个，默认只返回有界的
生命周期/资产事实（状态、任务句柄、真实资产 URL/引用、编排状态等），不会把旧状态节点里的 prompt、镜头表
或 `textResults` 历史重新灌入模型；只有显式 `fields` 才会读取这些语义字段。这样 agents 可以一次取得可执行
身份而不被单个历史节点放大上下文；需要语义详情时仍沿同一 `flow_get(nodeIds, fields)` 路径按需读取，不改变
权限、真实引用或付费合同。

媒体生产不再维护 AI 对话侧的消费确认或 `autoApprove` 双轨。用户明确提出图片、视频或完整成片生成时，
该请求本身授权当前明确范围；内部 estimate 只做核算并在同一 run 直接继续执行。只有任务确实缺少不可推导的
素材、事实或新增授权范围时，才允许使用结构化 `request_user_input` 暂停依赖该事实的动作；建议按钮、普通
选项文本、estimate 和已明确的生成请求都不能形成等待态。

AI 对话本身不在 Hono 侧做余额门槛、预估冻结、消费确认或 delivery verifier 拦截。对话请求直接进入
agents-cli/上游，由上游返回真实执行结果；Hono 只保留权限、协议格式、幂等、真实资产 URL、供应商硬上限
和已受理异步任务的事实记录。`deliveryVerification` 对普通对话只作为诊断证据，不能把模型回合改写成
本地 `failed` 或阻止后续交付；真实供应商拒绝、网络失败和协议错误仍原样返回。

宿主协议严格显式失败：传入但不合法的 `hostCapabilityManifest`、不合法的 `hostCanvasContext`，或没有
manifest 却单独传入 context，均返回 HTTP 400，禁止静默退回普通 public 模式。远程 callback 同时核验 owner、
project 与相关 flow/book/chapter/node/execution/run 归属；跨租户 execution、跨项目 flow、foreign video source/gate run
与 critic run 都按不存在或 scope mismatch 拒绝。

终态只消费 `expectedDelivery -> deliveryEvidence -> deliveryVerification -> requestTerminal`。普通正文、
子代理 completed、`wait` 返回或“曾写画布”单独都不是完成证据。具有稳定 task/run/node identity 的媒体提交可记为
`accepted_async/unsatisfied/suspended`；只有真实 HTTP(S) 资产 URL 物化并满足冻结 requirement 后，才能声明对应资产交付满足。

聊天中断保持单一的公开回合 ID 合同：SSE `X-Trace-ID` 是可展示的 `publicTurnId`，agents-cli
同时保存 `internalTurnId`；`POST /public/agents/chat/interrupt` 会在 Hono 本地 inflight 与
agents-cli 活跃 session 两侧按该 ID 做乐观并发核对。工具完成产生的中间 `tool_settled` checkpoint
采用单写入合并：已有完整会话写入进行时只保留最新待写状态，不让主 agent 串行等待每一次全历史重写；
`user_accepted`、`waiting_for_input`、`suspended`、`terminal` 等边界 checkpoint 仍等待最新快照落库。
因此这是 checkpoint 调度优化，不改变持久消息、终态事实或恢复合同。用户中断只会 abort 当前 agents 回合；
已持久化的视频编排 Run 仍由自身状态机继续推进，前端不会把聊天终态投影为媒体取消。agents-cli 将中断事实持久化为 `chat_turn_user_interrupt`，
并将公开回合状态确定性投影为 `cancelled`；前端再以 durable status 对账收口 live-run，避免把用户中断显示成普通失败，也避免断流、刷新或迟到的旧闭包留下假 `running`。流式 `/chat` 的
SSE consumer `res.close` 只停止事件转发，不再取消 durable agent run；请求层的 `req.aborted` 与显式
`/interrupt` 仍是合法取消信号。这样浏览器刷新、代理断流或事件读取器关闭不会误杀已受理的后台成片任务。
agents-cli 的 provider body reader 同样持续监听该信号：即使上游已返回 HTTP 响应头，只要 JSON/SSE body 仍在等待，都会主动取消 reader 并复抛同一结构化中断原因，不能等上游自然结束后才收口。对话回合进入 `cancelled/failed/unknown` 终态时，前端只收口聊天回合，并继续展示媒体 Run 的真实状态；不得取消、
隐藏或改写媒体 Run。只有用户显式触发“停止视频生产”时，前端才按当前 `projectId + chapterId/flowId` 作用域调用取消接口。
项目视频取消接口 `POST /projects/:id/video-runs/cancel` 未带 body 时取消整个项目，带
`{chapterId}` 或 `{flowId}` 时只取消对应画布作用域。
Hono 侧的 SSE reader 同时监听同一个 request abort signal；中断发生时先取消正在等待的
`reader.read()`，再释放流锁，确保代理回合、桥接请求和前端 live 状态在同一条链上收口，而不是只把
本地 inflight 标成 interrupted 后继续悬挂。该 signal 还会沿 agents-cli remote tool callback 传入
authoring driver：正在等待的 `/collab/spawn`、`/collab/result` 会立即取消，已派出但尚未交付的 writer
会被显式关闭并回到 pending；不会继续烧子代理模型，也不会重复提交供应商已受理的媒体任务。运行中 steering/follow-up 请求还会透传当前已选的
`modelKey`/`modelAlias`，使排队消息与原回合的模型事实保持可追溯；它不会在活动回合中切换模型或
偷偷启动第二条执行链。

trace 记录模型回合、实际工具面、工具状态、结构化失败、异步 identity、delivery evidence、verification 与 terminal reason。
`knowledge_search` 的结构化 `outputJson` 会在 trace 入口提取为受控 `knowledgeEvidence`，保存候选集 ID、实际检索模式、关键词/向量候选统计、索引可用卡片总数、最终返回顺序、分数与各路 rank；
`knowledge_read` 的结构化结果也会保存被选中知识卡的 card ID、标题、领域与来源引用事实。AI 执行脑图将前者展示为“召回候选/融合排序”，
将后者单独展示为“已读取知识卡”，因此候选命中不会被误报为已经引用；诊断持久化只保留这些非正文元数据，用户原始提示和知识正文仍按结构化脱敏策略处理。
diagnostics 用于解释和同链修复，不运行第二个语义裁判模型。`toolSurfaceMetrics` 记录 registered/direct/catalog/model-visible 数量，
以及实际发送的 schema/definition/system 字符数。

认证用户诊断接口 `GET /agents/diagnostics` 是生产观测与独立 8798 质量控制台的唯一线上数据面；管理员入口 `/admin/agents/diagnostics` 复用同一查询，但额外执行管理员权限校验。两条入口都只能按认证 `userId` 返回当前属主的 trace/span 树、耗时、Token、Credits、持久化健康、结构化 evaluator 结果、人工反馈、annotation queue，以及最近的不可变回归样本版本，不能跨用户读取。8798 只通过已保存的 TapCanvas SSO grant 代理 owner-scoped 接口，不直连观测表、不复制运行状态，也不从 prompt 文案推断根因。人工复核写回 `POST /agents/diagnostics/feedback`；只有 trace 已存在完整 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 事实链时，`POST /agents/diagnostics/regression-examples` 才能按 `datasetKey` 原子分配版本并沉淀样本。失败或 `needs_review` evaluator 进入 annotation queue，人工非采纳结论会追加队列事实；创建回归样本后才把对应待复核项标记为已处理。上述评分和诊断只用于观测、复核、离线回归与同链修订，不成为 Hono/Web 的创作运行时质量闸门，也不得回滚已生成资产。

视频创作请求还必须携带 agents-cli root 本轮冻结的 `UserIntentContract`。agents-cli 在启动已装配 Workflow IR 前核对合同存在，
Hono 把同一合同按 `contractHash` 冻结进 execution snapshot；缺失或 hash 不一致会回灌给同一执行链修复，
不会让视频工具带着脱离用户要求的 BeatSheet 进入 writer/供应商。Hono 不解释合同中的语义，也不把关键词
转换成本地路由；它只透传合同和执行证据，clip writer、连续性裁决与最终 agents 自检共同消费用户的
`must/forbid/prefer` 要求。媒体执行请求应在首次 `record_user_intent` 同时冻结语义 `delivery`（kind/output、
用户明确给出的时长/画幅/分辨率/片段数）；模型与 provider 执行事实只由实际工具调用和 generationContract
冻结，避免重复权威。模型语义选择仍由 agents-cli 根据用户合同和实时目录完成；Hono 只核对 canonical key、
generationContract、权限与供应商硬边界。
合同跨工具传输与子 writer 派发前还会执行一次纯结构完整性验证：若某层把 schema 中已知的空数组投影成空对象，Hono 只在将这些路径恢复为 `[]` 后的 canonical SHA-256 与冻结 `contractHash` 完全一致时接受并记录诊断；任何非空内容变化、未知字段形变或 hash 不一致都原地失败。新 `preflight_begin` 会在写入 durable draft 前保存验证后的规范结构，既有冻结记录在 writer 投影时也使用同一验证器，因此不需要重写不可变 BeatSheet，更不会把合同损坏静默解释为新的用户语义。

媒体轮询也遵循同一条事实链：`task_poll` 租约只保护一次供应商状态查询，查询确认视频已生成后立即释放；下载供应商文件、写入对象存储和生成 poster 使用独立的 `taskasset-hosting` 租约。托管较慢时，后续轮询返回结构化的 `hosting: pending` 运行态并等待下一次回收，不把状态查询误报成 409 失败，也不会重新提交已受理的付费任务。只有真实对象存储 URL 写回任务结果和画布节点后，视频才进入 `succeeded`/交付校验。`last_drive_at` 只是短周期 worker lease，不是业务进度。供应商恢复继续由 `VIDEO_RUN_RECOVERY_STALE_MS` 控制；本地 authoring specialist 的 ready queue 另由 5 秒短租约控制。transport 失败使用带 `attempt/firstFailureAt/nextAttemptAt/lastError` 的持久 retry receipt、指数退避和 8 次/30 分钟硬预算。未到 `nextAttemptAt` 不触发外部请求；预算耗尽显式进入失败终态，不再靠刷新驱动时间永久 pending。authoring 进度指纹连续 45 分钟无变化时会 CAS 进入 `authoring_failed`，保留 BeatSheet/writer/artifact 证据供同 run 修复，不再只发告警后保持活跃。

authoring 在派发 clip writer 前会 fresh-read 当前画布，并用 BeatSheet 已冻结的 `assetObjectContracts.kind/name`
把失效的素材记录 ID 重绑定到唯一同身份、且已有真实图片 URL 的画布节点；同一修复同时写回
`referenceImageNodeIds` 与 `videoReferenceNodeIds`，再以 CAS 持久化 BeatSheet，禁止 coverage 看见图片已存在却让
production 继续读取旧 ID。`resume_pre_submit` 先验真当前 failed run 的 durable pre-submit failure receipt，再逐节点
对账同 run 已存在的上游 task identity 与真实视频资产；证据一致时复用同一结构化算法修复 BeatSheet 与带 hash 的
executable `story_plan`，写入 durable repair artifact 后恢复同一 run。当前画布没有唯一身份候选时原地返回
`*_reference_rebinding_unresolved`；不得猜测节点、新建 run、重派 writer 或重复提交付费媒体任务。production
driver 对带 `upstreamRequestAttempted=false` 的本地确定性 4xx 另写
`production:pre_submit_failure` receipt；若某个并行 clip 在供应商提交前失败，恢复入口允许同 run 的其他 clip
已经存在，但会逐节点验真：`success` 必须有真实视频 URL、`running/submitted` 必须有稳定 task identity、未提交
占位不得带 task/资产，失败或状态冲突节点一律拒绝。已成功 clip 的唯一索引会回填 `clipsDone` 并在后续驱动中
按 `(clipRunId, clipIndex)` 幂等复用；只重置已证明 pre-upstream 的失败槽，禁止重提已受理或已成功的付费任务。
任一证据不确定、索引重复或持久进度超过画布证据都不复活 run。

已存在真实 `audioUrl`、但缺少 `audioDurationSec` 的配音卡不再被当作非法空资产，也不会重合成或换音色：
production 在供应商提交前通过 media-worker ffprobe 测量原音频，把实测秒数追加回同一画布节点，再执行模型的
本轮实时 enabledVideoModels 所声明的音频引用边界。该边界与图片数量、合法时长档位一起冻结为同一
`generationContract.referenceAudioPolicy`；固定偏好模型不在实时目录时原地失败，禁止使用
本地 8 秒经验值、换模型或隐式默认值。对没有声明参考音频能力的实时模型，该 policy 明确冻结为 `0~0s`，纯 T2V/
无说话人参考音频任务继续执行；显式必需的真实说话人音频绑定才以 `speaker_reference_audio_unsupported` 在供应商 POST 前失败，可选音色增强则留下结构化 degradation 证据并继续同一视觉/原生音频交付。
参考音频能力与“仅音频参考拓扑”是两份独立事实：Seedance 请求只有在真实图片或 `sourceVideoUrl` 存在时才算具备视觉参考；供其它渠道续写使用的 `prevTaskId` 不是 Seedance 的视觉输入，不能据此保留音频作为唯一媒体参考。实时目录未明确声明支持 audio-only topology 时，可选音色引用在付费提交前移除并保留原生对白/音频生成；必需音色引用则以结构化 pre-upstream 错误停止当前动作，不发送必然被供应商拒绝的请求。Workflow IR 的声音物化节点通过结构化 `workflowVoiceMode=provider_native|reference_manifest` 冻结声音资产路径，生产交接节点再以 `workflowReferenceAudioPolicy=required|optional` 冻结供应商引用要求；当前正式整章 Seedance 工作流从首 Clip 到全部后续 Clip 都显式使用 `provider_native + optional`，不会先调用 seed-audio，也不会在失败后临时降级。快速启动分支由 `video.voice-manifest.empty/v1` 生成可审计的空 VoiceManifest，后续分支由显式 `provider_native` 物化合同生成同构空 VoiceManifest；二者都直接使用模型原生对白音频。供应商桥接层对冻结结果渲染唯一 `VoiceMode=ProviderNativeAudio` 地址，既不伪造 VoiceManifest，也不把 `referenceAudioRequired:false` 二次提升为必需；只有明确选择 `reference_manifest + required` 的工作流才进入真实音色目录、选声 Agent 与试听物化链。
若目录声称支持参考音频却缺硬上限，仍以 `video_model_reference_audio_policy_missing` 显式失败。探测失败显式记为 pre-upstream dependency error；实测越界则以结构化 422 失败，二者都不会
提交视频。真正的 transport retry cycle 会标记 `retryScheduled` 并释放当前 production lease；`nextAttemptAt`
之前的 5 秒 tick 只读 receipt、不触发供应商请求，到点后同一 worker 才继续，避免 15 秒 backoff 被 5 分钟
crash-recovery lease 意外放大。

当前已知成本边界：catalog 的完整定义不进入模型工具 schema，只把 scope 已满足的名称、能力标签、scope 和执行语义作为授权索引发送；
完整 description/schema 仅在精确工具被选择时读取。agents-cli 还会在同一执行链内复用成功的技能/知识候选集；若模型携带的
精确 `skillName` 召回为空，必须移除该名称并以当前原始请求执行一次通用候选召回，不能把模型自造名称或空精确结果当作
“无可用 Skill”的结论。工作流画布只把真实配置挂载和实际读取证据投影到 Skills / 知识库抽象节点，候选不会冒充已读取。
避免重复检索产生额外 LLM/tool 回合；远程 Skill 进一步按 skeleton/section 渐进披露，避免一次把完整方法论正文
带入规划回合。运行时仍记录 catalog 序列化与 provider 输入字符数，便于区分内部网络成本、
工具 schema 成本与真正的 LLM 上下文成本；不能用缓存命中或预算数字替代实际 trace 事实。

画布节点能力由 `apps/hono-api/src/modules/ai/tool-schemas.ts`、公开 flow schema、agents bridge
与 Web `taskNodeSchema` 共同对齐。`storyboardScript` 是分镜脚本文本节点；结构化可编辑的“分镜表”必须使用
`shotTable`，视频理解必须使用独立的 `videoAnalysis` 节点。两者均通过 `taskNode` 创建，并由 Web 已注册的
专用 feature renderer 渲染，不能退化为 `text`。`shotTable` 节点的持久化真值是符合统一协议的
`data.shotTable={version,overview,columns,rows}` 对象；agents bridge 的动态 schema 会完整暴露该结构，公开 flow
写入层也会对本次创建或修改触及的分镜表节点执行确定性结构校验。仅写 `content`、`prompt`、序列化文本或
Markdown 表格会以 `invalid_shot_table_node_data` 显式失败并回到同一 agents-cli 修复链，禁止留下前端无法打开的
半成品节点，也禁止由 Hono/Web 从文本中猜测并补造结构。`report_delivery` 可与真实工具动作同属一个模型响应，但它是
从 action scheduler 隔离的延迟结算候选，不是普通 sequential batch；只有前序动作 settled 且通用交付 verifier
通过后，`finalResponse` 才成为终态正文。若正文依赖未知工具结果，则允许一次必要的后工具综合；过程正文不能越过
verifier 充当完成证据。其
`intentCoverage` 必须携带当前 `record_user_intent` 返回的 `contractHash`，并按 `must/forbid/prefer`
逐项提交 `requirementId/status/evidence`，校验失败只能触发同一 agents-cli 链内修复，不能把已成功的画布
写入伪装成仍在执行或要求用户重新发起。

### 工作流能力作者版本选择

作者图比较只保留可执行合同；React Flow 的 `position/positionAbsolute/selected/dragging/resizing/width/height/measured` 属于展示状态。纯移动、选中、拖拽、测量或缩放节点不会令已装配工作流失效，模板节点数据、DAG 连线、指令、模型与工具合同的真实编辑仍会明确判定为 stale。

能力候选版本由 `flows` 当前数据中的规范化作者图内容寻址，身份为 `capability-version-<sha256>`；候选列表不再从 `flow_versions` 历史中推导“最新”。inspect 以该身份幂等冻结不可变快照，equip 重新计算当前作者图身份并做 CAS，随后 attachment 与执行期始终引用这份冻结快照。历史上误装到执行快照的 attachment 在 stale 校验时只剥离该快照的按次触发 payload 与媒体规格覆盖，同时排除非执行分组节点与带执行身份的 fan-out/成片产物；工作流节点、作者配置、指令、工具、模型和 DAG 连线仍严格比较。新装配不再产生这类历史状态。

### 2026-08 续跑与交付收口升级

- 所有 agent 深度共享同一条大工具结果协议：无论业务状态是 succeeded 还是结构化 failed，工具正文超过默认 32,000 字节时，agents-cli 都把完整内容写入当前 runtime 的不可变 `artifact://sha256/...` 存储，只在会话和下一次 provider 请求中保留约半阈值的头尾预览、哈希、总字节数与显式 `artifact_spilled` 收据；失败动作的 trace/status 仍保持 failed，不会因内容溢出伪装成成功。失败后的 self-repair/replan prompt 也不得从 `structuredOutput` 侧路重放大字符串：超过 12,000 字符时只保留字段目录、有界标量事实、总字符数和同一 artifact 引用，完整证据按需读取。`artifact_read(uri, offsetChars, maxChars)` 在所有受限 agent 工具面中保留，可按范围逐字取回同一内容；它只能读取 runtime 自己签发且通过哈希/长度复验的 artifact，不授予画布、网络、任意文件或 mutation 权限。该硬切避免 workflow attempts、章节真源、诊断账本等 8～20 万字结果重复占用持久会话与模型输入，同时禁止静默截断或把预览误当全文；阈值只允许通过显式 `AGENTS_MAX_TOOL_OUTPUT_CHARS` 配置调整，低于 4,096 的配置会被抬到结构安全下限。
- typed structured-output 不保存或恢复可供模型修改的候选正文。一个逻辑节点只提交一次完整产物；若确定性执行边界不满足，runtime 持久化候选位置、长度、SHA-256、合同与失败路径并结束节点。不存在下一生成窗口、候选绑定、局部对象投影、数组 merge 或字段级 rebase。
- 结构化输出合同只描述完整产物的可执行结构。BeatSheet v20 的唯一首稿收到 caller-signed JSON Schema、合同名、版本、继承模型、完整输出预算和 required Skills；不存在后续完整重生。Hono 只投影由宿主冻结事实唯一决定且下游执行必需的机器字段，不生成对象、剧情或质量判断。语义、节奏、对白容量、来源覆盖与参数合理性进入 diagnostics，由模型在唯一提交前自行做好。

- agents-cli 对 LLM HTTP 失败保留确定性边界分类：HTTP 402、OpenAI 标准 `insufficient_quota|insufficient_credits|insufficient_balance`，以及已知网关的精确余额不足响应统一投影为 `insufficient_balance`，并在 details 中携带同名 terminal boundary；普通 403 仍为 `llm_http_403`，禁止把权限拒绝误报成余额问题。Hono bridge 原样透传该结构化 code，不根据用户 prompt、任务类型或创作正文猜测失败原因。
- 余额边界在 SSE `response.failed` 中即使同时表现为 `terminalState=missing`，也不得降级为 `provider_stream_interrupted`。agents-cli 以 `waiting_for_evidence/provider_balance_required` 结束当前物理窗口；Workflow Agent runner 在首次 HTTP 物理窗口返回 `suspended` 时立即重读同一 durable turn，再发布节点证据。后续低频调度只读取同一 durable turn，不调用 chat resume、不创建 fresh physical attempt，也不推进 `physicalRetryOrdinal`。余额等待只保存精确逻辑 frontier 与不可变输入，不保存结构化候选；余额恢复后仍由同一模型按完整合同生成整份产物。余额等待不进入无进展计数，`/chat/status` 必须直接显示余额不足与恢复条件。
- Web 画布只从 Workflow node receipt 的结构化事实投影外部等待文案：读取 `evidence.continuationReason`、`evidence.requestTerminal.reason` 与 `evidence.deliveryEvidence.recoveryCheckpoint.reasonCode` 中实际存在的值；这些值去空后必须一致且逐字为 `provider_balance_required`，才显示“等待余额恢复”。任一已声明值冲突、协议值未知或结构化证据缺失时继续显示通用等待状态，禁止从历史 `errorMessage/errorCode`、节点标题、用户 prompt 或创作正文猜测等待原因。该展示合同只翻译机器签发的确定性状态，不参与任务路由、完成判定、模型切换或恢复动作。
- typed-output 不存在增量 correction 信封、局部上下文、rebase、merge 或候选 lookup。完整产物在一次 submission 后由同一 verifier 检查；硬失败记录 `structured_output_blocker`，非阻塞问题记录 `structured_output_diagnostics`，两类日志都只保存类型、路径、长度与哈希等必要事实，不保存台词或候选正文。
- BeatSheet 的对白重复、逐字守恒、跨 Beat 落点、delivery 选择及 `sourceBeatLedger.summary` 都属于模型作者职责。除 lineId/ref 是否可解析、必需执行字段是否存在等结构事实外，本地不删除对白、不连接摘要、不移动台词，也不通过原子数组替换做局部修订；相关不一致只进入 diagnostics，产物保持首次提交原值。

- `agents-cli` 的 `replan_required` 现在是版本化任务完成信号和 `LogicalTaskGraphV2` 的正式非终态。物理窗口、工具进展回路或同签名动作预算耗尽时，不能把逻辑任务写成 failed；agents-cli 必须保留失败证据并创建新的有界计划增量。下一窗口只能使用新 envelope/revision，禁止原样重放旧 Todo。Hono 的 `AgentsPhysicalRunExitV1`、continuation ticket、续跑 prompt 和状态投影均保留 `kind=replan` / `resumeTrigger=replan`，因此 budget exhaustion 会进入同一 logical task 的 durable resume 链。
- `repair_required` 与 `replan_required` 仍可用于尚未形成结构化候选的普通工具动作与逻辑任务规划，但不适用于 typed structured-output。typed-output 一旦形成候选，只能成功验收或按 `single_submission_record_and_fail` 记录后结束节点，不投影 repair/replan suspension。其它普通 root 由 `TaskStore -> PhysicalRunExitV1(handoff|replan) -> continuationTicket` 提供续跑身份；Hono bridge 对这类 suspension 只校验非空 reason、稳定 physical run 身份和非负 revision，不按 reason 名称、模型、节点或 prompt 做路由。
- `/chat/status` 与 Workflow Agent 的重启恢复同样不得维护 suspension reason 白名单。agents-cli 对任何带非空 `reasonCode`、当前 `physicalRunId` 与非负 `progressRevision` 的 suspended checkpoint 都投影完整 `recoveryCheckpoint`；当 bridge 重启使持久 `accepted/agent_running/completion_verifying` checkpoint 暂时没有内存 owner 时，状态可投影为 `activeTurn=false + state=unknown + reasonCode=provider_stream_interrupted + recoveryCheckpoint`。Hono 必须接受这份“非活跃但可恢复”的结构事实并交给 Workflow runner 做同 turn CAS 续跑，不能因为它还没被异步 reconciler 改写成 `suspended` 就把节点记为失败。物理代际 fencing 调用 bridge interrupt 时必须显式携带 `provider_stream_interrupted`；agents-cli 将该原因保存为 suspended recovery boundary。若目标持久回合已经处于 `suspended` 或 `waiting_for_input` 且没有 live runtime，system fence 必须返回 `already_inactive` 并保持原 checkpoint，不得对已停止的物理执行重复 transition 或把“无需再中断”误报成 fencing 失败。只有真实用户/执行取消入口才允许使用 `chat_turn_user_interrupt`，系统重启、旧代次退役或 transport 断开不得伪装成用户取消。Hono 仍复验 checkpoint 与 turn reason/物理身份一致，Workflow runner 以“是否存在机器签发的 checkpoint”决定能否重新认领同一逻辑任务。根物理预算仍额外要求专用 usage suspension 逐字段相等，失败态的 orphan recovery 仍受其确定性边界限制；但 `max_turns`、`repair_required`、`replan_required` 及未来新的非终态原因不再因为状态读取层只认识旧枚举而永久停在 waiting。自动队列发布正常时该路径保持幂等；重启、队列丢失或发布竞态时，状态轮询可以从不可变 accepted request 与同一 checkpoint 重建 continuation，不创建新的用户任务，也不重新解释 prompt。
- Workflow 节点的外部等待收据仍可用于 plain-text Agent 与已受理媒体 receipt；typed structured-output 不消费 `retryablePhysicalFailure + physicalFailureReason + physicalRetryOrdinal` 开新窗口。历史 typed 等待证据在恢复入口收口为 `failed/structured_submission_window_closed`，不轮询、不 fencing 新 generation，也不调用模型。
- typed structured-output 已有非空候选且冻结合同验收失败时，节点执行器先于 `suspended`、429 backpressure 和其它 continuation 投影收口为 `failed/structured_output_invalid`：保留原始候选与精确失败路径。候选为空、供应商拒绝、断流、墙钟或 suspension 则收口为 `agentExecutionFailure.phase=before_structured_submission`。两类失败的权威 `requestTerminal` 都固定为 failed，并移除 delivery wait/retry 证据，不登记 external check，也不分配新的模型或物理预算；collection resume 与 execution-family recovery 不得重新进入模型。
- 如果进程丢失发生在 continuation 已经持久化并被领取、但 agents-cli 尚未来得及写出新的 runtime checkpoint 之后，runtime status 可能只剩 `activeTurn=false + unknown/failed`。此时 `/chat/resume` 允许把持久 continuation 本身作为恢复权威，但必须同时满足：请求的 `turnId` 与 execution trace 的 `traceId/logicalTaskId/rootTraceId` 四者逐字相同、根 trace 仍为 `waiting_async`、并且存在同一 user/session/root 的 failed 或超过 claim lease 的 root physical continuation；领取使用 `updated_at + claimToken` CAS。网页只发起这个精确身份的恢复握手，并在握手完成前禁止创建新主回合；它不携带 prompt、runId 或交付合同。任一事实不成立都返回 409，不得新建任务、重放付费动作或要求用户重发相同请求。可信 continuation 恢复后只开放同 family 的 `tapcanvas_workflow_resume`，普通 `tapcanvas_equipped_workflow_run` 仍保持 admin-only，避免恢复窗口误开第二个业务 run。
- Workflow 的本地重启 reconciler 每轮扫描时必须逐 execution 读取当前进程的实时 executor registry，禁止在全表扫描入口复制一份 active execution 快照。`waiting_external -> external_check_started` 可能发生在同一轮扫描期间；旧快照会把刚开始轮询的真实 executor 误判成进程遗失，每 15 秒递增 attempt、fence 掉稍后返回的 Agent 结果。当前单一 recovery owner 在处理每行前重读 live ownership；同时把本轮有界宽限期冻结为 `ownershipStaleBefore`，并声明 `recoveryReason=local_abandonment`。这个扫描结果仍只是建议：`ExecutionDO` 必须在同一条串行生命周期 lane 内、紧邻 attempt 递增前，按每个当前 `running` 节点再次读取 `node_started/node_recovery_started/node_external_check_started/node_heartbeat` 的最新持久所有权事件；只要事件不早于冻结 cutoff，就以 208 拒绝该次陈旧接管，不重建队列、不递增 attempt。真正的进程启动恢复使用独立且显式的 `recoveryReason=process_startup`，因为它发生在监听端口之前，不与新任务并发。这样 scanner 与 DO 之间的 TOCTOU 窗口也被 fence，等待态轮询、长 Agent turn 和真实输出不再互相驱逐。
- 任务控制器是纯函数决策层：只接收结构化 receipt、预算耗尽事实和 envelope revision，输出 `run_now | wait | user_action_required | repair | replan | terminal`。它不读取 prompt、工具名或自然语言，不调用模型，也不写数据库；这份决策可被 agents-cli 单测、Hono 诊断和跨运行时回放复用。
- 公开聊天的 suspended 响应必须先通过 continuation ownership 断言：只有已写入可领取 continuation，或已写入带完整 recovery capsule 的 `agents_continuation_settlement` marker，才允许向调用方投影 suspended。普通诊断、`invalid` 或无执行所有者的“等待”不构成接管；continuation 与 recovery capsule 两次持久化都失败时，当前请求必须显式失败。已被供应商受理但尚未物化的同一 asset task/run 不再被判为 `no_progress`；durable sweep 使用原样不可变的 artifact tuple 在新的 parent stage 继续探测，不重放付费提交。对客户端的 SSE `done` 也已改为 `logical_succeeded | logical_failed | physical_suspended | needs_input`，不再用含混的 `finished` 把物理窗口结束冒充逻辑任务完成。所有 durable public facade（包括 OpenAI-compatible 入口）先经同一 `runPersistedAgentsChatTask` 登记 trace、续跑所有者和 activity 接力，不得绕过 wrapper 直接把 bridge 的物理返回当作业务终态。
- OpenAI-compatible 公开入口把一次外部 HTTP 请求视为一条不可拆分的逻辑回合：agents-cli 的物理窗口、交付复核与 continuation 只属于服务端内部执行，调用方连接必须保持到 `deliveryVerification.status=satisfied`、确定性失败或确需用户输入，不得暴露 HTTP 202、内部续跑提示或把物理预算耗尽冒充最终答复。终态修订按 `expectedDelivery.mode` 选择证据通道：`response` 的新正文就是唯一可接受的新增证据，因此 verifier 返回 `needs_revision` 后必须保留自由文本输出并清空该修订轮次的工具面，禁止强制或诱导无关工具调用；同一无效正文重复达到单个修订窗口上限时，必须在当前逻辑回合重开有界修订窗口，不能生成没有 continuation owner 的 `suspended`。只有统一 root 物理预算边界可以结束当前物理窗口，并由已登记的 durable continuation 续接。`state_change` 与 `async_artifact` 仍须在供应商明确支持 required tool choice 且存在可见工具时要求新的已结算动作证据。该区分只读取冻结交付合同与 verifier 状态，不根据用户正文、模型名称或具体工作流分支。
- 物理 continuation 注册不只继承直接 parent 的资产数组：它还会从同一逻辑任务的 `durableProgressClaims` 提取精确 `taskId`，按当前用户读取已结算 `task_result`，并仅在媒体类型、节点归属与真实 HTTP(S) 资产都通过结构校验时重建 `artifactDependencies + materializedArtifacts`。因此重启或孤儿恢复误选到一个缺资产的旧 parent 分支时，后续窗口仍能从供应商已经完成的任务结果恢复唯一真实产物；该过程不会重新提交生成，也不会让普通画布只读结果冒充新资产。
- 物理续跑的不可变原始目标必须完整写入可信 `taskCapsule`，并与 `requestFacts + executionContract` 一起恢复同一个逻辑任务。普通长材料若已有 durable business frontier，可在续跑消息中只投影 SHA-256 引用以避免重复占用模型上下文；但无独立业务副作用的 direct typed Workflow Agent 必须从 capsule 重新注入完整冻结输入，不能把 64K 以上章节/BeatSheet 静默丢弃后降成普通根对话。当前胶囊统一按 UTF-8 字节执行 2,000,000 bytes 的确定性传输边界，为 8 MB bridge 请求体保留封装余量；真实超限必须返回 `async_continuation_task_goal_too_large`，持久行中存在但不可解析的 capsule 必须使整份 continuation 合同失效，禁止省略 capsule 后继续执行。上一窗口 `executionProvenance.intentSelectionTrace` 中由 agent 明确选中的 Skill 会结构化合并到 continuation 的 `requiredSkills`，下一窗口直接由 agents-cli 验真并预载；仅出现在历史 `loadedSkills`、但没有本任务 selected trace 的 Skill 不会继承。该投影只复用 agent 已做出的技能选择与不可变任务事实，不在 Hono 根据用户文案选择 Skill、路由或创作 SOP；它避免每个物理窗口重复 `skill_search -> Skill`，为同链 BeatSheet、资产规划、提示词和其它大型结构产物保留实际编译预算。
- Workflow `json_array` 端口的 agents-cli 合同统一声明 `requiredArrayField=items + allowedTopLevelFields=[items]`。模型或 provider 即使把 JSON Schema 的 `minItems`、自查备注等结构元数据误放进终态工具参数，agents-cli 也会在原合同验收后确定性投影为仅含 `items` 的传输信封，再由 Hono 解包为顶层数组并执行原 item verifier；禁止让“多了可丢弃的 envelope 元字段”越过 agents-cli 后在 Workflow runner 终结整条用户任务。该投影只删除合同未声明的传输层字段，不补写、不改写任何资产计划项，也不放宽数组非空、精确身份、允许字段或其它结构校验。
- `sourceMode=project_context` 的装配工作流在受理边界自行冻结章节 canonical source、画布、全量可见资产快照与既有选择；根 agents-cli 不得为了重抄这些宿主事实而在启动前串行读取章节/画布/素材。只有当 Agent 确实要对现有素材做语义取舍时，才先读取一次项目素材清单，并必须把已选且 ready 的稳定资产 ID 通过 `triggerPayload.selectedAssetIds` 一次性交给 equipped workflow；禁止读取后丢掉选择。Hono 不按标题、名称或关键词替 Agent 选资产。后续所有 Agent、资产规划与媒体执行读取同一冻结快照；调用后才发现的新素材不能偷偷改写已启动 execution，需要新上下文时必须形成新的独立运行。
- BeatSheet 的 `characters` 与 `assetObjectContracts` 是两类不同事实：前者记录故事参与者，后者只记录当前阶段已经冻结的复用对象与连续性。运行时仍严格验证每个已声明对象的结构、引用职责、身份不变量和相邻状态接力，但不再要求每个 Beat 重复声明所有角色或至少一个场景，也不把这种跨字段创作覆盖率作为提交/运行闸门。缺少的角色、场景和道具视觉计划由下游资产规划 Agent 使用上述冻结 `WorkflowProjectContext` 补齐；它可以复用显式选中的真实项目资产，且不得重复生成已经绑定的对象。
- `WorkflowProjectAssetSnapshot` v3 为每项可见资产冻结 `sourceFacts`：持久化的 `referenceType/roleName/physicalIdentityKey/character-card` 身份字段、来源节点、工作流/供应商任务身份及原始提示词（仅作为来源事实，不由 Hono 解释）。新工作流图片在持久化时必须按资产计划的结构化 `role` 写入 canonical identity：角色图写 `referenceType=character + canonicalName + physicalIdentityKey + character-card/v3`，场景/道具图写各自的 `referenceType + canonicalName`，避免后续快照丢失人物肉身键或把场景图误当角色候选。BeatSheet 唯一首稿会收到全部 `ready + productionEligible` 项目图片的紧凑身份注册表；Agent 根据肉身、空间和来源事实把同一身份的精确 ID 映射到根级 `objectRegistry`，不以展示名或 canonicalName 逐字相等代替语义判断。`selectedAssetIds` 是其中更强的用户显式事实：必须全部消费、精确出现且同一 ID 不得绑定冲突对象，但它不再限制 Agent 只能复用手选资产。v3 对历史工作流生成但没有 `referenceType` 的图片执行可逆的生产候选退役：资产与画布历史原样保留，未被本轮显式选择时仅标记 `productionEligible=false + productionExclusionReason=legacy_untyped_workflow_image`，不得进入新执行的自动候选；显式选择仍保留其 `sourceFacts` 交给 Agent 做身份绑定。被显式选择并冻结进快照的 generation-table 图片可能不在 material/project-node 常规列表中；执行期 Asset Resolver 必须按同一 owner、projectId 和冻结 assetId 从权威 generation 记录重建与受理时相同的只读投影，再继续校验版本与真实 URL，禁止在资产覆盖已经接受 `existingAssetId` 后把它误报成 `workflow_asset_not_found`，也禁止绕过冻结快照扫描其它 generation 资产。该规则只读取资产来源、媒体类型与结构字段，不由 Hono 读取名称、提示词或画面语义作裁决，也不删除/覆盖旧产物。若冻结来源事实不足以建立唯一绑定，模型必须在唯一提交前自行复核；runtime 不得按名称、关键词或 prompt 猜测替代角色，也不得回灌纠偏，最终结构绑定无效则按精确拒因一次失败。ProjectContext 版本按 v3 硬切，新执行不得复用旧版本快照。
- Workflow 视觉资产计划的 `role=kind://canonical-name` 只声明“哪一个 canonical 对象需要哪一份视觉计划”，不声明该对象在具体 Clip 中承担的 `referenceRole`。`referenceRole` 的唯一权威来源是 BeatSheet 的 `assetObjectContracts`，绑定阶段只按精确 `kind + name` 找到同一对象并附加稳定 `assetId`，必须原样保留 BeatSheet 已冻结的 `identity/wardrobe/environment/...` 职责。运行层仍会拒绝未知对象、重复计划、缺失的必需视觉计划和为 `referenceRole=none` 对象创建的付费图片，但不得从资产 kind 推断默认职责后反向否决 Agent 的对象合同。
- BeatSheet v20 的根级 `assetPlans` 可以携带对象创作简报的结构化超集，但只有 `assetObjectContracts` 经 `requiresAuthoringVisualReference` 得到的精确角色集合可以进入付费图片 fan-out。`projectVideoAssetPlansFromBeatSheet` 会先验证全部简报结构与必需角色覆盖，再只物化该冻结 authoring allow-list；道具、VFX、色板或构图如果没有真实 `referenceImageNodeIds/referenceAssetIds`，其简报不会被误当成新的图片依赖。缺少必需人物/场景计划仍原地显式失败，不能靠过滤制造完成态。这样 BeatSheet 创作面与资产展开面共享同一结构权威，不会再出现上游允许计划、下游又以“没有冻结对象”否决同一计划的合同自相矛盾。
- BeatSheet 的真实人声来源只有 `dialogueScript + narrativeAudioPlan.lines`；兼容展示用的 `speakers` 是二者有序去重后的确定性投影，不再作为第二份模型真源。工作流读取 BeatSheet 时仍严格校验对白字段、旁白结构、插入位置以及 `sourceCoveragePlan.speechLedger -> dialogueScript` 的逐字守恒，再从已验收的人声脚本重建 `speakers` 供 Clip writer 和音色绑定使用。旧 checkpoint 中空缺或过时的 `speakers` 因此不会终止资产生产，但运行层也绝不会凭该投影新增、删除或改写任何对白与旁白内容。
- 立即启动供应商的 `tapcanvas.launch-beat-sheet/v1` 与整章 `tapcanvas.beat-sheet/v2` 现在共用同一 BeatSheet 机器验收器、合同名与合同版本；launch 只额外冻结 `beats.length=1`，不再以“只验顶层 JSON 壳”的弱合同先宣布 Agent 成功、再让 `launch-clip-fan-out` 发现 `chapterArc`、来源账本、对白守恒、事件时间轴或对象连续性不合法。两条路径都要求 `chapterArc={storyPromise,protagonistThroughline,primaryPayoff,endingHook}` 四个非空字符串、零基连续 `sourceOrder`、完整 `speechLedger.clipIndex/delivery` 以及逐字重建的 `dialogueScript`。旧式 `openingState/firstClipTurn/handoffState` 只能在 Agent 输出边界显式失败，禁止映射成新字段，因为这种映射需要解释创作语义；空 `narrativeAudioPlan=[]` 与已声明合法对象 kind 到 `referenceRole` 的映射仍属于唯一可确定的机器投影。这样工作流卡片的 Agent 成功、fan-out 可执行和后续供应商提交使用同一份已验收事实。
- 整章 BeatSheet Agent 会从本次冻结 `delivery-contract.generationContract.durationOptions` 注入通用 `arrayItemNumberAllowedValues.beats.durationSeconds` 合同。未显式冻结物理 Clip 数时，Agent 仍自主决定叙事切片数量与每片选择，但每个 `durationSeconds` 必须在首次 typed 提交时命中当前模型目录的真实有限枚举；例如目录为 4–30 秒时，43 秒会记录为供应商硬边界失败并结束该节点，不由宿主连带改写 `storyEvents` 时间轴或来源时长账本。若用户显式冻结总时长并已有 `providerSubmissionTopology`，逐项 exact duration 合同继续作为更强事实同时生效。该约束只验证实时供应商结构边界，不读取剧情语义、质量评分或提示词正文。
- Workflow 输入合同失败必须写入 `workflow.input-contract-rejection/v1`，逐条保存被拒绝的 `targetPortId`、真实 `sourceNodeId/sourceNodeRunId/sourcePortId`、artifact identity 与当前 `workflow.artifact-contract/v1` 指纹；失败输出必须同时声明 `executorCompleted=false`，不能只留自然语言错误后仍被 UI 投影成已完成。统一 resume 参考 n8n 的 dirty-frontier / clean-descendants / sourceData 重建模型，但不照搬其仍为 TODO 的“属性变化自动判脏”：TapCanvas 由上述机器契约自动得到一个或多个 `invalidatedNodeIds`，清除每个前沿及其全部后代的旧输出，再用 `workflowProvenance.inputBindings` 沿精确物理 run 血缘寻找可重写的 `agents.logical-task/v2` 生产者。纯单输入转换可继续沿唯一绑定回溯；多输入映射不明确、协议损坏或来源缺失时禁止猜测，恢复边界保持在失败节点并暴露 unresolved 计数。不得按图距离、节点标题、阶段名称、错误文案、章节、具体数字或 prompt 选择“最近 Agent”，因此并行 launch 分支不会被另一个 BeatSheet 端口失败误伤。`workflow.recovery-frontier/v1` 会随不可变执行快照保存 source execution、失败节点、全部失效前沿、解析模式与 unresolved 数量；成功上游、逐项 checkpoint 和已受理供应商 receipt 仍按原身份复用。
- v61 删除快速首 Clip 分支后，`asset-coverage` 与 `asset-fan-out` 不再声明不存在的上游 `asset-bindings` 必需端口：复用资产只来自受理时冻结的 ProjectContext v3 和显式 `selectedAssetIds`，新生成的 `asset-bindings` 只在资产 fan-out 之后流向生产交接。Web 在创建、升级或生成持久 Flow patch 前统一编译 Workflow IR 拓扑，逐边验证源/目标节点与端口、逐节点验证每个非可选输入已有连线，并以 Kahn 拓扑遍历拒绝循环依赖；因此“画布可保存、装配后才发现必需端口悬空”的图不能再发布。该检查只验证结构事实，不读取 prompt 或创作语义。
- v62 将 BeatSheet 节点硬切到 `tapcanvas.beat-sheet-artifact@17` 并更新整图指纹。该代际要求 Hono caller、已装配 Workflow definition 与运行中的 agents-cli compiler 三者一致：旧定义或旧 bridge 只能显式拒绝，不能继续使用同一合同名执行另一套展开/纠错语义。`assetObjectContracts` 只在 Hono 验真 compact wire 后展开，不再出现在 BeatSheet Agent 的首稿 schema、原子 correction 字段或纠错说明中；`storyEvents[].sourceBeatId` 则在首稿 schema 和节点指令中同时显式要求，避免先产出空值再消耗纠错轮次。
- Workflow Clip Writer 的媒体提示词案例工具由 agents-cli 本地内置，不属于 Hono 远程工具目录。受限执行策略把 `prompt_example_search` 与 `prompt_example_read` 作为同一套本地只读检索协议的两半共同列入允许集合：即使当前画布远程工具面为空，`required_non_blocking` 也允许 runtime 完成一次候选检索尝试，随后由 Agent 选择性精读；禁止只允许搜索却把回执绑定的精确读取误判成未知远程工具。Hono 不把这两个本地工具误判为 `agents_execution_tool_policy_unknown_tool`，也不规定候选数量或正文读取数量。零命中、工具未注册或检索失败只形成 diagnostics 并继续原创，不能成为 Clip Writer 或整条成片任务的终止条件。
- `executionMode=each` 的父节点端口聚合同时读取 Workflow IR 声明的 `workflowAtomicSpec.outputPorts` 与所有成功 itemRun 实际产生的端口键。声明端口即使暂时没有成功项也保留为空 collection；实际端口即使旧 IR 省略了可选的 `outputPorts` 元数据也必须提升为带稳定 itemId/lineage 的 collection。父节点不得出现“itemRun 已成功且持有 `clip-prompts`，父 `ports={}`”的伪成功状态，下游也不得因此把已验收的 Clip Writer 产物误报为 `produced no value for port`。该聚合只复制运行时端口和谱系，不读取或改写提示词语义。
- 图片/视频付费节点的恢复仍以持久 `canvasNodeId + taskId` 回执为唯一事实：运行中、成功、有真实资产 URL、节点暂时不可见或结果不确定时只 reconcile，绝不重新提交。终态失败不论是否带 taskId 都原样保留；失败 collection boundary 同时保留全部成功 sibling 的端口、资产与证据，恢复运行不会让失败 item 重进媒体执行器。该合同同时适用于图片与视频，不按供应商、模型、工作流或具体内容分支。`agent-api-worker` 的 Compose 停止宽限统一为 30 分钟，覆盖当前最长 25 分钟供应商等待；重启时 worker 先停止领取新任务并等待已领取任务完成，禁止沿用 Compose 默认 10 秒强杀把已受理任务制造成 stalled failure。
- 图片/视频供应商提交的 effect identity 以 `executionFamilyId + runtimeNodeId` 为唯一权威，不包含物理 `executionId`；输出画布节点身份同样包含 execution family。因而同一 execution family 的 resume 即使进入新的物理 execution，也只能认领或核对原供应商副作用；新的显式执行族拥有新的节点与 effect identity，历史 taskId、失败证据和已生成资产不会被覆盖。
- 普通 workflow resume 继续使用失败成员的不可变定义快照；只有用户明确授权已持久化的配置修复时，恢复入口才接受 `definitionCutover={mode:"current_flow"}`。服务端先把当前 flow 收敛到原 trigger/stop scope，再逐项验证节点集、边、句柄、node type、executor、executionMode 与端口合同没有变化；任一拓扑或执行身份漂移都会原地拒绝。通过后只采用当前 authored node configuration，并继续冻结原 trigger payload、ProjectContext、source snapshots、delivery scope、Agent identity、成功祖先和供应商收据，同时追加 `workflowDefinitionCutovers` 审计账本。这样在途任务可以接入已批准的通用节点配置修复，而不会重读可变章节、重建 execution family、重复提交已付费媒体或让所有恢复静默漂移到最新版。
- 官渠 Workflow 的媒体资产登记与画布投影现在是同一交付合同：逐镜生成的音色参考样本必须先通过 `registerGeneratedMediaAsset` 登记为项目 `audio` 资产，`voiceBinding` 同时保存同一 `assetId/serverAssetId/ready` 事实；多段拼接或单段直交的最终成片也必须先登记项目 `video` 资产，随后 `master-video` 端口、交付证据与 `film-{executionId}` 画布节点共同携带该 `assetId`。任一项目归属或登记失败都会在媒体已经保留的前提下显式失败，禁止只写 OSS URL 后宣称资产交付完成，也禁止在节点、素材库与交付证据之间制造不同资产身份。
- 服务端明确返回 `retryableInCurrentAgentChain=true` 的失败动作会把原始结构化入参保存为 `actionRecoveryFacts[].retryInput`，并作为可信 continuation 状态传回 agents-cli。该事实不是提示词建议：下一物理窗口把模型工具面收窄为同一个逻辑工具（catalog 工具先按已认证目录恢复精确定义），直到该工具成功或返回新的确定性结构错误；因此模型不能在 BeatSheet/协议字段修复期间转去探索其它写接口、重做规划或创建平行业务 run。工具成功后当前物理 run 立即消费该恢复游标，后续动作重新依据真实执行证据开放。
- 续跑与任务状态会附带只读 `attentionProjection@1`：agents-cli 将它保存在 durable rollout context，`POST /chat/status` 返回；Hono 的 `/public/agents/chat/status` 只做版本/结构校验后透传，Web DTO 与 `liveChatRunStore.reconcileTurnStatus` 同样保留该事实。它只投影 `logicalTaskId`、当前 obligation、`waitingOn` 和 graph/evidence/physical-run source heads，不提供第二套写入 API，也不根据文案猜测进度；因此 Web/运营面板可以显示“现在应执行、等待证据、需要用户输入、修复还是重规划”，而不把单次物理 run 的结束误认为用户任务终态。
- agents-cli 的 architecture eval matrix 已升级为 `agents-architecture-eval/v2`：按文本、持久状态、图片、视频、音频 5 类交付 × 3 档输入规模 × 7 种故障执行 105 个确定性场景。`image|video|audio` 分别冻结权威 `mediaType` 并核对 artifact evidence，禁止用 `mediaType=null` 的泛化资产冒充跨媒体覆盖；`external_evidence_wait` 必须投影 `waiting_external + ContinuationTicketV1(nextTrigger=external_evidence)`，随后从同一 logical task 恢复，验证余额等待、供应商受理和回调等待不会被投影成用户级终态。矩阵同时覆盖 `replan_required`、事件与 outbox 单调、租约 fencing、输出保留和付费副作用幂等。LoopX 的 controller/settlement/projection 思路只作为可回放的结构合同来源；其基于字符串分类或固定新鲜度的语义判断不进入 Hono/agents-cli 运行时。
- Workflow node 的“当前状态投影”与“历史物理尝试诊断”严格分离：重启接管、自动重试或人工修复开始新 attempt 时，上一 attempt 的 `error_message/error_code/failure_stage/finished_at` 完整冻结在 `workflow_node_attempts`；聚合 `workflow_node_runs` 立即清空这些历史错误。后续 `queued -> running -> waiting_external|success` 的每个非失败转换也显式保持错误字段为空，因此前端看到的等待原因来自当前 `outputRefs/externalCheck/continuationReason`，不会把旧的 `workflow_runtime_restarted`、上次工具失败或旧 failure stage 冒充当前故障。该清理只修正读模型，不删除事件、attempt、provider receipt、资产或失败证据。
- 跨运行时回放样例集中在 `packages/schemas/agent-observability/replay-fixtures/`，先冻结 `AgentReplayFixtureV1` 的版本、输入和 expected facts；agents-cli 与 Hono 的状态/settlement 测试必须以同一 fixture 作为协议回归入口，避免各自维护一份“看起来相同”的 projection 样例。
- `/agents/pipeline/runs/:id/execute` 保留资源层路径以避免画布协议断裂，但执行已硬切为一次 agents-cli chat task：Hono 只组装项目、目标、阶段与调用参数等事实，交给 `runAgentsBridgeChatTask`，并把 task 结果作为 pipeline run/资产事实持久化；旧的 Hono storyboard prompt、阶段编排与本地语义验收不再是执行路径。后续交付仍必须通过统一 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 主链，Hono 只做权限、协议、幂等、trace 和事实投影。
- 对话计费以每个物理回合唯一的 `effectId` 作为 reservation task id：`beginChatBilling` 在原子批次事务中冻结 `min(配置目标额, 当前可用积分)`，任意正余额均可执行；成功/失败分别调用 settle/release，真实 new-api quota 可用时按实际消耗结算，查不到时仅按已冻结估算额结算。稳定 session 只作为 conversation id，不再充当跨回合复用的冻结键；没有 session key 的 OpenAI facade 使用唯一 effect 派生隔离 conversation id。重复 reservation task id 显式返回幂等冲突，不能再映射为余额不足。
- 数据库运维收口新增只读断言迁移 `20260820183000_assert_agent_runtime_operational_contract`：部署时验证 `task_statuses`、`(task_id, provider)` 唯一身份和 reconciliation index 均存在；缺失直接失败，避免 worker 在恢复队列降级的数据库上启动。跨端协议版本集中记录在 `AgentProtocolVersionsV1`，当前 settlement/replay/attention 均为 `v1`。
- `request.accepted` 是不可变持久快照：同一 session/turn 通过 durable recovery checkpoint 校验后，即使宿主重启先把 execution trace 投影成终态、尚未来得及追加 suspended result event，续跑器仍可读取该快照重建原请求；普通业务读取继续受 active/recoverable-trace 条件限制。
- 可恢复物理窗口的 trace 投影允许一条严格受限的 `failed -> waiting_async` 纠正边：仅当同一 user/session/turn 的 durable recovery checkpoint 已验真、不可变 `request.accepted` 已恢复、且 `registerPhysicalContinuation` 已原子登记成功后，续跑器才可把宿主先写入的失败投影重开为 `waiting_async`。普通失败、成功、取消或未登记 continuation 的 trace 仍保持终态单调，不能借此复活。这样 agents-cli 的 `suspended/provider_stream_interrupted` 不会再与 Hono 先到达的 `failed` 投影形成 `execution_trace_terminal_conflict`，同时不放宽其它终态冲突保护。
- `sourceMode=project_context` 的来源冻结按作用域唯一决定：不带 `chapterId` 的公开画布聊天使用服务端已持久化的不可变 `request.accepted.prompt`；带 `chapterId` 的公开聊天和其它章节调用都使用 ProjectContext 中的 canonical 章节正文。公开回合的 `publicTurnId` 只负责幂等身份，不能把“一键成片”这类短指令覆盖成章节正文，也不得附带固定五分钟生产开始终止器；是否已进入媒体生产必须由真实供应商受理收据证明，未受理则按当前结构化失败证据在同一逻辑任务继续修复。公开请求已结构化携带的 `assetInputs[].assetId` 是调用方显式选择，equipped workflow 启动边界必须把它们与 Agent 提交的 `selectedAssetIds` 去重合并并冻结到同一 ProjectContext；不读取名称或 prompt 做语义推断，也不允许 Agent 漏抄把显式选择降为空。该分流只读取结构化章节作用域和资产 ID，不建立第二条工作流路径。
- 工作流 direct typed Agent 的 continuation capsule 只保存不可变 goal、request facts、完整 output contract、模型预算与检索上下文；Hono bridge 不再读取、补齐或转发结构化候选 scope，agents-cli `/chat` 也不再有候选恢复模式。每个新物理窗口从同一不可变输入整体生成一份新产物，精确硬失败路径仅作为自检证据，不能成为可写局部目标。
- Workflow typed output 不再支持 `fresh_replan`。用户显式选中的参考图片仍是下游可执行的冻结身份集合；ID 缺失、清单外引用或跨对象身份冲突属于确定性阻塞，图片属于哪个叙事对象等语义映射由 Agent 在唯一完整 BeatSheet 中决定，本地不按名称或 prompt 猜测。
- BeatSheet `storyEvents` 的时间边界、来源时长分配和状态连续性由 Agent 完整提交；本地不等分时间、不重算语义聚合，也不改写事件参数。只有非正区间、悬空引用等会使下游无法执行的结构事实可以阻塞，其余不一致进入 diagnostics。
- `agents-cli` 的 canonical runtime SQLite 继续持久化逻辑 task/goal、后台产物和通用恢复状态，且不得停留在容器 overlay fs；`agents_memory` 只保存会话记忆。typed-output 旧候选表即使仍存在于既有数据库，也没有生产读写调用方，不能影响新物理窗口、模型工具面或终态裁决。
- Collab mailbox 与 agent roster 必须以显式 `threadId`，或 spawn 已绑定为同一协作身份的 `sessionId`，作为运行时消费边界。持久工作流/direct Agent 若没有 thread-local delegation 身份，不得调用 `list(undefined)` 枚举 process-wide roster，也不得读取共享 `root` mailbox 或计算全局未读数；这类 run 的 completion 注入与未结子代理检查直接视为空。管理员显式请求全局 agent 列表仍可使用 manager 的无 scope 读口，但不能被普通 agent-loop 隐式触发。该隔离使历史 `thread_id=NULL` 记录继续原地保留并在其显式管理/迁移路径中暴露真实 schema 错误，同时不会让无关工作流因旧 mailbox 枚举失败而终止；禁止通过跳过坏行、自动标读或清库伪装修复。
- BeatSheet 的 `sourceCoveragePlan.speechLedger` 与 `beats[].dialogueScript` 继续使用显式数组结构；缺少下游必需数组、非法 lineId/ref 或不可解析项属于硬阻塞。对白逐字守恒、重复、跨 Beat 落点与 delivery 合理性由 Agent 自检并作为 diagnostics 观察，本地不物化默认对白、不去重、不移动或合并数组。
- Writer 必须在完整产物中自行提交可执行的正时长 shots。缺失、零或非正值会阻塞供应商执行时，verifier 退回完整产物；本地不再按余量等分、不吸收浮点余差，也不改写模型参数。typed-output 唯一 wire shape 是调用方声明的完整 JSON；字段补丁与 correction 信封已退役。
- AI 链路的 HTTP 调试日志使用统一请求头脱敏合同：浏览器侧 `Authorization/Cookie/X-API-Key` 与服务间 `X-Internal-Token/X-Agent-Token/X-Auth-Token/X-Access-Token/X-Refresh-Token/Proxy-Authorization` 在安全模式下一律只记录协议类型或 `***`，不得因内部回调、ExecutionDO 广播或 continuation 调度而把服务凭据写入 trace。该规则只影响可观测性投影，不改变真实请求、鉴权、工具结果或恢复状态；显式 unsafe 调试开关仍属于人工高风险诊断能力，默认关闭。
