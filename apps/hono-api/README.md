# TapCanvas API（NestJS + Node.js）

本 API 运行在 NestJS（Express）服务器上，并将现有的 Hono + OpenAPI 路由挂载到同一个 HTTP 服务中。这样可以在标准 Node.js 运行时里继续复用当前的 route / auth / task 逻辑。

## 开发

```bash
cp .env.example .env
pnpm prisma:generate
pnpm dev
```

- 默认地址：`http://localhost:8788`
- 可复制的中文说明文档（Markdown）：`GET /`
- OpenAPI 3.1 schema：`GET /openapi.json`

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
- `db:pg:seed-patches` 会扫描仓库根 `sql/patch/*.sql`，只允许执行 `INSERT ... ON CONFLICT DO NOTHING` 这类“缺数据时填入、已有数据不覆盖”的 seed patch；不允许 `UPDATE/DELETE/TRUNCATE/DROP/ALTER/CREATE`。

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
DATABASE_URL_DOCKER=postgresql://tapcanvas:tapcanvas@postgres:5432/tapcanvas?schema=public
```

内置服务：

1. `postgres`（持久卷：`hono_api_postgres`）
2. `redis`
3. `agents-bridge`
4. `api`

版本对齐：

- Compose 中 Postgres 版本是 `16`
- API 镜像安装了 `pg_dump 16`（`postgresql-client-16`），避免备份时出现版本不匹配

每次 `api` 启动时，部署链路为：

```bash
pnpm db:pg:backup && pnpm prisma:generate && pnpm db:pg:schema && pnpm db:pg:seed-patches && pnpm build && node dist/main.js
```

`pnpm db:pg:backup` 会在 `/app/backups` 生成一个新的 `predeploy-*.dump`，并按 `PG_BACKUP_KEEP_LATEST` 执行保留策略；当前 compose 默认值为 `1`，也就是只保留最新 1 份备份。

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

## Agents bridge（可选）

旧 `POST /public/chat` / `/public/response` / `/public/responses` / `/public/v1/responses` / `/public/local/chat` 已删除；当前唯一聊天入口为 `POST /public/agents/chat`。

启动本地 Agents HTTP 服务：

```bash
pnpm --filter agents dev -- serve --port 8799
```

默认会尊重 `apps/agents-cli/agents.config.json` 或 `AGENTS_STREAM` 中的流式配置；只有在你明确传 `--no-stream` 时，才会强制关闭上游 LLM 流式请求。

也可以通过 Docker Compose 一起启动 API 和 Agents bridge：

```bash
docker-compose up --build
```

Docker Compose 内置的 `agents-bridge` 现在同样默认尊重 `apps/agents-cli/agents.config.json` / `~/.agents/agents.config.json` / `AGENTS_STREAM`；compose 不再额外追加 `--no-stream`。

本目录下 compose 的默认约定：

- `agents-bridge` 服务监听 `8799`
- `api` 使用 `AGENTS_BRIDGE_BASE_URL=http://agents-bridge:8799`
- `AGENTS_BRIDGE_AUTOSTART=0`（避免重复拉起 bridge 进程）

Redis 也可以通过 `credit-worker` profile 一并启动：

```bash
docker-compose --profile credit-worker up --build
```

如果要使用 Redis 支撑手机验证码 / worker，请设置：

- `REDIS_URL=redis://redis:6379`（compose 网络内）
- `REDIS_URL=redis://127.0.0.1:6379`（宿主机本地运行）

然后配置 API 环境变量：

- `AGENTS_BRIDGE_BASE_URL=http://127.0.0.1:8799`
- 可选：`AGENTS_BRIDGE_TOKEN=...`（如果你以 `agents serve --token ...` 启动）
- 可选：`AGENTS_BRIDGE_TIMEOUT_MS=600000`（当 agent 会生成多资产时可适当调大）
- 可选：`AGENTS_SKILLS_DIR=skills`（使用仓库内置 skills，包括 `tapcanvas*`）

## AI 对话架构（当前）

本节描述当前真实运行中的 AI 对话链路。当前版本已经收敛为“前端收集上下文、后端注入作用域与协议、agents 自主决策、skills 承载方法论”的结构；当前唯一聊天入口为 `POST /public/agents/chat`；旧 `/public/chat` 系列文本入口与 `/storyboard/*`、`/agents/storyboard/workflow/*` 生产链已删除。

范围说明：

- 下方流程图描述的是可观察控制流、路由决策、上下文装配、工具约束和响应分支。
- 不公开模型私有思维链（chain-of-thought）；这里只记录系统决策和可验证的运行时分支。

### 端到端请求路径

1. 前端 `apps/web/src/ui/chat/AiChatDialog.tsx` 维护稳定 `sessionKey`；项目对话会显式传入线程级 `sessionKey`，格式为“项目/flow 作用域 + 独立 conversation seed + lane/skill”，例如 `project:${projectId}:flow:${flowId}:conversation:${conversationSeed}:lane:${lane}:skill:${skillId}`。这保证了同一项目下既能按 `project:${projectId}` 前缀归类会话，又能在用户点击“新对话”后硬切到一个全新的后端 session，不再把旧历史会话继续带入。非项目对话才退回本地持久化 base key。考虑到这类结构化 key 在真实项目里可能自然超过 120 字符，`/public/agents/chat` 与 `/memory/context` 当前允许最多 `10_000` 字符；后端只做 `trim + lowercase + 非 [a-z0-9:_-] 字符剔除`，不再把合法 key 截断到 120。首屏/刷新恢复时调用 `POST /memory/context` 拉取 `recentConversation`；web 聊天请求现在统一直接调用 `POST /public/agents/chat`。其余上下文透传规则保持不变：前端默认透传真实事实，包括当前 project/flow、显式选中节点、显式参考图、显式复刻目标图、`selectedReference.storyboardSelectionContext`，以及当前节点的统一 `selectedReference.anchorBindings`（角色/场景/道具/分镜/剧情/资产都走这一套语义锚点定义）。`roleName/roleCardId` 仍可作为派生字段透传给 bridge，但后端归一化时会优先把 `anchorBindings` 视为主语义来源。前端现在不再把本地聊天历史重新拼回 `prompt`，而是固定依赖 `sessionKey + memory/context` 交给 agents-cli 自己管理会话；同时也不再把 skill 正文内容透传给后端，只保留显式 skill 标识。前端现在不再向用户暴露 `auto` 开关，也不再通过 `forceAssetGeneration` 之类前端布尔量去决定“这轮是否应该生产/执行”；聊天请求固定以 `mode=auto` 进入统一 agents 通道，是否真正落画布、生成资产或仅返回答案，全部交给 `agents-cli` 基于语义、上下文证据与 completion/delivery verifier 自行判断。补充（2026-04-04）：工作台显式按钮动作现在还会额外透传 `chatContext.workspaceAction`，仅用于声明“这是章节剧本生成 / 章节资产补齐 / 片段视频生成中的哪一种显式 UI 动作”，它不参与本地语义路由，只用于 bridge 端交付验收合同选择。对 `workspaceAction=chapter_asset_generation`，bridge 诊断会把“缺角色卡/缺状态锚点/缺三视图/缺 scene_prop”视为本轮待修复缺口，而不是直接作为高危失败 flag 报出。显式复刻路径仍由独立目标图 `replicateTargetImage` 承担 `target` 角色；当前选中图片节点若其主锚点是角色，会以 `role=character` 透传；若主锚点是场景/道具，则分别以 `role=scene` / `role=prop` 透传；其余镜头/剧情/上下文锚点则统一走 `role=context`，并携带锚点说明。这里的 `auto` 只代表统一的 agents 执行通道，不允许 web 本地按 route、lane 或上下文组合注入固定创作场景语义；这些业务语义必须由 agents 自主语义判断触发。历史回放节点也使用同一协议；当历史记录只能提供泛化参考图时，会以 `reference` kind 原样传递，而不会本地臆测成 `scene_prop` 或 `spell_fx`。
2. `POST /public/agents/chat` 是当前唯一的 agents 聊天入口。它不再经过旧的 `runPublicTask -> vendor 选择` 自动回退链，但入口内部会复用 `runAgentsBridgeChatTask` 这一条标准 bridge 后处理链来完成五件事：1）鉴权与作用域隔离；2）归一化 Responses 风格输入、`displayPrompt`、`assetInputs`、`generationContract` 与 `sessionKey`；3）注入当前授权画布 remote tools 与 `canvasCapabilityManifest`；4）把请求发给 `apps/agents-cli` 的 `/chat`；5）对最终结果做结构化回包、trace/verdict 标准化、execution trace 写入与会话持久化。补充（2026-04-15）：project-scoped `bookId/chapterId` 解析现在与资产路由统一复用 `modules/asset/project-data-root.ts` 的共享 project-data 根路径定位，不再在 agents bridge 内维护独立 repo root 推导副本；因此 `/public/agents/chat`、`/assets/books/*` 与 agents tool bridge 会从同一真实项目目录读取 `index.json`、章节 metadata 与 storyboard chunks。补充（2026-04-04）：这条入口不再对 `referenceImages` / `assetInputs` 施加固定 12 张上限；前端输入、路由归一化与 bridge 注入阶段都会保留全部去重后的参考图与命名资产，由后续 `referenceImageSlots` / 拼图板策略按真实执行场景消费，而不是在入口层先截断。补充（2026-04-02）：`POST /public/agents/chat` 仍不在 bridge 层做 `@引用ID` / `@角色名` 自动解析、chapter-grounded 团队执行判定、planOnly/forceAssetGeneration 行为围栏、diagnostics-based 语义补丁或本地 prompt specialist 分流；这些语义决策默认全部上收给 `agents-cli`。
3. 新入口不会把 agents 上游响应原样瘦透传给前端；它会在 bridge 后处理阶段重建标准 `AgentsChatResponse`，把 `text/assets` 与 `agentDecision/trace` 一并返回，保证前端、memory context 与 diagnostics 使用的是同一份结构化终态事实。
4. `hono-api` 在该链路中的职责当前收敛为：1）用户/项目/flow/node/资产访问隔离；2）事实型上下文透传；3）画布工具与协议 manifest 注入；4）最终 `outputMode / expectedDelivery / deliveryEvidence / deliveryVerification / turnVerdict / diagnosticFlags / canvasMutation / todo trace` 汇总；5）`public_chat_sessions` / `public_chat_messages` / `public_chat_turn_runs` 持久化。bridge 现在不再把 persona/skill/context/chapter-preproduction 这类后端合成 system prompt 常驻注入给 `agents-cli`；除调用方显式提供的 `systemPrompt` 外，后端默认只传事实字段、诊断上下文、remote tools 与 capability manifest。`storyboard` 分镜编辑器仍然在 agents-facing manifest 中保持隐藏；agents 侧只保留通用图像/脚本/视频能力，不直接感知或操作 `storyboardEditorCells`。sandbox、工具权限与是否读取本地资源，统一由 `agents-cli` 自身运行时与 tool policy 决定。
5. `agents-cli` 加载 persona 与 workspace context，进入 agent loop，自主完成意图识别、取证、技能加载、子代理拆分与结果汇总；当前 bridge 自动拉起的进程已改为 `AGENTS_PROFILE=code`。补充（2026-04-03）：`agents-cli` 当前内部 runtime 已按 `session-engine -> context-pipeline -> capability-resolver -> capability-plane -> policy-engine -> finish-policy -> agent-loop` 拆层，bridge 只消费其结构化输出事实，不依赖主 loop 私有实现。`context-pipeline` 的上下文装配现已进一步切为独立 `context-source-providers`，persona/workspace/memory/runtime/request-scope 等来源各自独立出片段和预算；bridge 看到的 `contextDiagnostics` 也因此稳定成为“来源级事实”，不再依赖单文件拼接顺序猜测。`capability-plane` 也已切为 provider registry 形式，默认 provider 仍是 `local / remote / mcp`，但后续扩展不需要再回 `resolveCapabilityPlane()` 主体追加条件分支；团队子代理现在还能通过 agent definition 的 `capabilityProviderBundle` 显式限制自己只看某些 provider 面，例如只看本地工具、不接远程工具。bridge 继续只消费最终 `capabilitySnapshot`，不感知 provider 内部注册细节。`/chat` 流式协议现在分两层：兼容层继续保留命名 SSE 事件 `content`（正文增量）、`tool`（真实工具事件，含 `phase=started|completed` 与最终 `status`）、`result`（最终完整响应）、`error`、`done`；v2 过程层新增 `thread.started`、`turn.started`、`item.started`、`item.updated`、`item.completed`、`turn.completed`，供前端按 turn/item 粒度重建真实执行过程。`TodoWrite` 若被 `agents-cli` 主动调用，仍会额外发 `todo_list` 事件供聊天面板实时显示当前 checklist；同时，最终 trace 除了 `todoList` 快照外，还会新增 `todoEvents[]`，把每一次 `TodoWrite` 的结构化结果、相对时间与 duration 作为独立 trace item 保留下来，供 AI 工作台按时间线回放 checklist 演进。`tool` 事件对前端只暴露经脱敏/裁剪后的输入摘要与输出预览，不再把整段工具原始输出直接下发。`/chat` 最终 trace 现在除了 `toolCalls/turns/output/summary` 之外，还会附带 `runtime` 快照：至少记录当前 `profile`、runtime 已注册工具、已注册团队工具、`requiredSkills`、`loadedSkills`、`allowedSubagentTypes`、`requireAgentsTeamExecution`，以及新增的 `contextDiagnostics`、`capabilitySnapshot`、`policySummary`。bridge 当前会进一步把三类 runtime 事实提升为可检索诊断：1）上下文来源发生 budget truncation；2）policy engine 产生 `requires_approval`；3）policy engine 产生显式 deny。它们既会进入 `diagnosticFlags`，也会进入 execution trace 的 `requestContext` 摘要，便于上层直接解释“为什么这轮没执行/没完成”，而不是只看到笼统 blocked/failed。其余行为保持不变：其中 `loadedSkills` 才表示本次会话内真实加载过的 skills，只有运行中显式 `Skill` 调用或历史里已存在的 `<skill-loaded ...>` 记录才会进入该清单，`requiredSkills` 不再被误记成“已加载清单”。若上游提供结构化输出约束，`/chat` 会把该约束转成额外 system prompt 片段注入当前运行；当 bridge 已提供 `assetInputs` 时，runtime 也会把这些权威命名资产显式列给 `agents-cli`，允许它在最终执行 prompt 中直接使用 `@assetRefId / @名称` 语义，但禁止自造新的 `@xx`，且不能与 `referenceImageSlots` 的图位职责冲突。对于“添加空白文本节点”这类确定性写画布请求，`canvasCapabilityManifest` 与远程工具 schema 会直接提供 `tapcanvas_flow_patch` 的真实协议示例，例如空白文本节点必须是 `type='taskNode'` 且 `data.kind='text'`，不能臆造 `textNode`；`createEdges` 也必须遵守真实 handle 矩阵。补充（2026-04-02）：当 `tapcanvas_flow_patch.createNodes` 涉及分组（创建 `groupNode` 或给节点设置 `parentId`）时，bridge 现在会把“组节点前置、子节点顺序即最终视觉顺序”的约束直接暴露给 agents；后端落库前也会对受影响组执行 parent-first 重排、组内紧凑排列与 group fit，保证 direct canvas write 与前端 canvas plan 的建组后整理行为一致。bridge 负责注入事实型协议、作用域约束和 planning directive；真正的执行前 planning gate 在 `agents-cli` 内完成。只要本轮被标记为执行型任务，side-effectful tool 在看到足够的 `TodoWrite` checklist 之前就会被直接 `blocked`，skill 也不能替代 planning。`turnVerdict` 仍是 bridge 侧诊断元数据，但它只基于 agents 已产出的真实 trace、工具证据与交付结果做验收，不再承担行为编排职责。若调用方显式传入 `localResourcePaths`，bridge 会原样透传为远程本地资源根，不再限定只能落在 `project-data/`；未显式传入时，远程会话仍可凭 `privilegedLocalAccess=true` 使用本地 shell/fs 工具；若命中三态策略里的 `requires_approval`，runtime 会把它保留为结构化 policy 事实与 blocked tool evidence，而不是被桥接层改写成新的本地语义补丁。若本轮存在 `referenceImageSlots`，`agents-cli` 会同时拿到图位/资产清单与执行约束：参考资产 `<= 2` 时，主代理给三方视觉模型写最终执行 prompt 必须明确使用“图1/图2”；参考资产 `> 2` 时，前端执行层会先把它们合成为一张带右下角资产 id/名字标记的拼图参考板，这时 prompt 应按资产 id / 名称引用，而不是继续长串枚举“图1/图2/图3/图4”。若本轮存在 `enabledModelCatalogSummary`，`agents-cli` 也会同时拿到“当前真实可用的 image/video 模型清单”，其中视频模型会显式看到 `defaultDurationSeconds`、可选 `durationOptions` 与计算后的 `maxDurationSeconds`，图片模型则可看到已声明的 `defaultAspectRatio`、`aspectRatioOptions`、`defaultImageSize`、`imageSizeOptions`、`resolutionOptions` 与参考图支持能力；这份摘要属于事实性上下文，而不是固定 SOP。对“等待 team 子代理终态后再重试”的协调性 `blocked` 工具，bridge 会继续保留原始 `blockedToolCalls` 计数与 trace，但不会仅因这类 runtime 协调阻塞就追加 `tool_execution_issues` 或把 `turnVerdict` 下调为 `partial`；只有 failed、denied，或非协调性的 blocked，才算执行异常。
   补充（2026-03-31）：每次 `/chat` 请求若来自 TapCanvas bridge，还会同时收到 `canvasCapabilityManifest`；它会以结构化方式列出 local canvas tools、remote tools、node specs 与 graph patch protocols。runtime trace 里会同步记录 `canvasCapabilities` 摘要（manifest version、tool names、node kinds），便于直接诊断“本轮 agents 实际知道哪些画布能力”。
   补充（2026-03-30）：上面这段运行时说明里凡涉及“AUTO 默认注入 `agents-team`”或“chapter-grounded 默认要求团队执行”的旧描述都已失效。当前实现是：AUTO 只提高取证和完成态标准，不默认要求团队执行；`requireAgentsTeamExecution=true` 只来自调用方显式请求。chapter-grounded 作用域仍会进入 diagnostics 与视觉治理校验，但不再自动把执行责任强塞给 team runtime。
7. 对业务相关的 TapCanvas 工具，能力收口仍在 `hono-api`：bridge 会按当前 project/flow 作用域构造远程工具定义，并通过 `/public/agents/tools/execute` 供 `agents-cli` 回调执行；同一轮还会把这些 remote tools 与 `apps/hono-api/src/modules/ai/tool-schemas.ts` 中的 node specs / local canvas tools / protocol hints 收束成 `canvasCapabilityManifest` 一并下发。补充（2026-03-31）：`flow.public.schemas.ts` 与 `tapcanvas_flow_patch` 远程 schema 已把 `data.referenceImages` / `data.assetInputs` 显式提升为正式节点字段，不再只是 passthrough 杂项；对应 node spec 也明确要求 chapter-grounded 可视节点在已有权威参考时必须持久化这些字段或显式连边，否则本轮会被 diagnostics 标成 `chapter_grounded_reference_binding_missing` / `chapter_grounded_character_binding_missing`。补充（2026-04-02）：画布节点现在新增正式语义字段 `data.anchorBindings`，用于统一表达角色/场景/道具/分镜/剧情/资产锚点；web 端的节点引用聚合与 flow auto-wire 会把 `anchorBindings[].imageUrl` 视为正式参考图来源，因此当运行时已解析出角色卡或场景锚点引用时，画布自动连线可以把目标节点真实接回上游锚点节点，而不是只留下隐式 URL。补充（2026-04-02）：`tapcanvas_flow_patch` 的 remote tool description 现在只保留节点协议、字段契约、handle matrix、reference persistence 与 chapter-grounded metadata 这类硬约束；“多镜头 stills 优先”“先基底帧再视频”之类创作方法论不再常驻在 `hono-api` tool description，统一下沉给 `agents-cli` skills / specialists。补充（2026-04-01）：虽然 `storyboard` 仍是 web/flow 协议中的真实节点类型，但 agents-facing remote tool schema 与 manifest 默认不再暴露它；分镜编辑器只允许由画布本地逻辑读写，agents 若要产出分镜相关结果，应继续使用 `storyboardScript`、`storyboardImage`、`image`、`video` 等通用节点能力。补充（2026-04-03）：`tapcanvas_flow_patch` 现已正式支持 `deleteNodeIds` 与 `deleteEdgeIds`；删节点会级联删除关联边，tool stats 与 `canvasMutation` 也会同步回传删除事实，避免“工具成功但实际是 no-op”的假阳性。当前已接入的远程工具分三层：
   - project 级：`tapcanvas_project_flows_list` / `tapcanvas_project_context_get` / `tapcanvas_books_list` / `tapcanvas_book_index_get` / `tapcanvas_book_chapter_get` / `tapcanvas_book_storyboard_plan_upsert` / `tapcanvas_storyboard_continuity_get` / `tapcanvas_pipeline_runs_list` / `tapcanvas_pipeline_run_get`
   - project+flow 聚合级：`tapcanvas_storyboard_source_bundle_get` / `tapcanvas_node_context_bundle_get` / `tapcanvas_video_review_bundle_get`
   - flow / execution 级：`tapcanvas_executions_list` / `tapcanvas_execution_get` / `tapcanvas_execution_node_runs_get` / `tapcanvas_execution_events_list`
   - flow 读写级：`tapcanvas_flow_get` / `tapcanvas_flow_patch`
   `agents-cli` 本身不内置 TapCanvas 业务逻辑，只负责消费上游注入的远程工具定义并把调用结果回传给模型。`tapcanvas_storyboard_continuity_get` 当前复用了 `agents.service` 内已经在小说分镜工作流中使用的 continuity 解析逻辑，返回上一组 `tailFrameUrl`、章节 chunk 历史、角色卡/场景参考匹配结果与 continuity 约束；不是 bridge 内临时拼装的假 bundle。`tapcanvas_book_storyboard_plan_upsert` 则是章节剧本的显式持久化入口：当 agents 判断“当前章节剧本已完成”时，必须调用它把 `storyboardPlans / shotPrompts / storyboardStructured` 写回当前 book index，工作台后续刷新才会看到真实章节片段；只返回文本说明不再算完成。`tapcanvas_storyboard_source_bundle_get` 也已经落到真实实现：它复用现有 project workspace context、章节正文解析和当前 flow graph，返回 `projectContext`、`chapterContext`、`flowSummary` 以及 `diagnostics.progress/recentShots`，用于 single_video / storyboard 类请求先定位当前章节与画布进度。`tapcanvas_node_context_bundle_get` 现也有真实后端实现：它基于当前 `flowId + nodeId` 返回节点原始数据、上下游邻接节点、最近 execution/node runs/event，以及项目级 execution traces / storyboard diagnostics，不再只是 prompt 中的占位名字。`tapcanvas_video_review_bundle_get` 则建立在 node context 之上，只对真实视频节点开放，返回执行 `prompt`、可选的 `storyBeatPlan`、`videoUrl/videoResults` 和完整 node context，供视频复盘或修镜头场景直接取证。`tapcanvas_flow_get` / `tapcanvas_flow_patch` 仍以真实前端协议为准：`createNodes` 仅支持 `taskNode` / `groupNode`，空白文本节点必须创建为 `type='taskNode'` 且 `data.kind='text'`；`kind=storyboard` 仍然表示前端“分镜编辑”图片网格，但这部分语义现在只保留在 web/flow 协议与服务端校验中，不再向 agents-facing schema 公开。补充（2026-04-01）：web 端现在会在创建或更新 `kind=storyboard` 节点时，基于 `storyboardEditorCells[*].prompt` 自动派生并持久化 `storyboardScript` 与 `storyboardShotPrompts`，保证分镜编辑器数据能继续被后续续写、迁移与视频承接逻辑读取；`status/progress/runToken/httpStatus/lastResult/modelVendor` 这类运行时遥测只可用于诊断，不得替代分镜板配置或被当作“已可执行”的唯一证据。若同一轮 `createEdges` 需要引用本轮新建节点，这些 `createNodes` 必须先显式带稳定 `id`，边也只能使用这些 `id`，不能拿 `label` 充当 `source/target`。带 `parentId` 的新子节点，其 `position` 必须表示相对父组坐标；服务端在落图时也会把明显的绝对坐标归一化，避免出现“视觉上掉出组外、但拖组仍跟着移动”的伪分组状态。图片节点的执行字段仍是 `prompt`；若节点还要附带与之等价的结构化 JSON 视图，应统一写到 `structuredPrompt`，web 在落板和执行前会通过同一份共享 schema compiler 把它编译回 `prompt`，同时拒绝非法 JSON。视频节点的唯一执行字段现已统一为 `prompt`：它必须承载真实生产提示词，前端执行阶段会在此基础上继续拼接连入文本节点内容；若需要导演意图、经典镜头借鉴、动作边界或物理约束，必须直接写进 `prompt` 本体，不再拆到不会参与生成的平行字段。`createEdges` 现已按真实画布协议显式建模，至少要求 `source/target`，并支持 `sourceHandle/targetHandle` 来表达“角色卡图片口 -> 目标节点参考口”这类连接，但这些 handle 必须是前端真实 id，且要遵守节点类型矩阵：文本类节点只允许 `out-text / out-text-wide` 且没有 target handle，图片类与 storyboard 只允许 `in-image / in-image-wide`、`out-image / out-image-wide`，视频类只允许 `in-any / in-any-wide`、`out-video / out-video-wide`；服务端会校验并拒绝 `reference`、`out-any`（文本节点）、`in-any`（storyboard）等不存在或错位的句柄。`appendNodeArrays` 只允许追加到“既有节点的 `data[key]` 数组字段”，不能指向 flow 根对象，而且 item 形状固定为 `{ id, key, items }`，其中 `items` 必填；若目标是整体替换 `storyboardEditorCells`，应使用 `patchNodeData.data.storyboardEditorCells`，而不是发送缺失 `items` 的 append 请求。对“把参考图/角色卡接到节点上”这类请求，agent 应优先用 `createEdges` 体现真实画布关系，而不是只 patch 一个隐式引用字段。`tapcanvas_flow_patch.createNodes` 同时按前端真实节点协议做服务端校验；像 `textNode` 这类未实现类型会直接返回 400，而不是写入无效节点；若同批 `createEdges` 引用了不存在的节点且本轮有未显式 id 的新节点，服务端错误也会显式提示“不能用 label 代替 id”。bridge 在回合诊断阶段也会额外检查：若 agent 试图把 `kind=storyboard` 当成纯文本容器来写入 `content/prompt/text` 且没有 `storyboardEditorCells`，会写入 `storyboard_editor_text_only_misuse` 诊断并把 `turnVerdict` 下调为 `partial`。`/public/agents/chat` 默认不再把“立即生成并落画布”的 bridge 级生成工具注入给 agents；AI 对话模式下的标准路径是：agent 用 `tapcanvas_flow_patch` 或合法 canvas plan 落可执行节点，随后由 web 端优先自动执行新建或本轮 patch 后仍可执行的静态产物节点（当前 agents-facing 默认是 `image` / `imageEdit` / `storyboardImage`；本地 storyboard editor 继续由画布侧处理）；`video` / `composeVideo` 默认保持待执行补充节点，除非用户后续显式触发。
8. `POST /public/agents/chat` 会消费上游命名 SSE：一方面把 `content` / `tool` / `todo_list` 以及 `thread.started`、`turn.started`、`item.*`、`turn.completed` 这类生命周期事实事件透传给前端实时运行态，另一方面不会直接把上游 `result/done` 原样转发；路由会等 `runAgentsBridgeChatTask` 完成 bridge 标准化后，再统一写出最终 `result` 与 `done`，确保前端拿到的终态永远带有 bridge 汇总后的 `agentDecision/trace`。bridge 不再把工具语义折叠进 trace 文案；当前仍保持“协议层先解 SSE 帧、业务层再解析 JSON event.data”的两阶段处理。补充（2026-04-02）：bridge 现在只会在 SSE 帧本身非法或关键事件结构不合法时返回 `agents_bridge_stream_invalid_event`；若上游 `agents-cli /chat` 主动发送 `event:error`，bridge 会保留原始 `message/code/details` 向下游透传，不再把一切上游失败误标成“流事件解析失败”。`/public/agents/chat` 的 SSE `error` 事件也会原样携带这批 `code/details`，便于前端实时日志与失败提示直接展示具体原因。若失败来自上游 LLM HTTP/fetch，`agents-cli` 现在还会在 `details.requestSummary` 中附带最后一次真实 LLM 请求摘要，例如 `apiStyle/model/systemChars/approxPayloadChars`、user/assistant/tool history 的字符占比、最大 tool 输出块大小与超过 16k 的 tool message 数量，用于直接判断“是请求上下文太重拖慢了生成”还是“网关/供应商本身超时”。当前 bridge 还会把调用方 HTTP 断连透传成上游 `AbortSignal`：等待队列、到 `agents-cli /chat` 的 fetch、以及 SSE body 读取都会随前端断开而中止，不再在后端继续悬挂会话。
9. bridge 的 diagnostics 现在仅做 trace 记录与回传，不再对 agents 输出做基于正文措辞、prompt 内容或语义推断的 422 门禁。
10. `POST /public/agents/chat` SSE 现统一为单主通道事件协议：`initial`、`session`、`thinking`、`tool`、`todo_list`、`content`、`result`、`error`、`done`，以及透传自 agents bridge 的生命周期事件 `thread.started`、`turn.started`、`item.started`、`item.updated`、`item.completed`、`turn.completed`。其中 `thinking` 仅是补充性状态文案，`tool` 与 `todo_list` 是真实执行事实，`content` 是正文增量；`result` 是唯一可信的完整响应，且现在由 route 基于 `TaskResultDto -> AgentsChatResponse` 的标准化转换统一生成，负责 `<tapcanvas_canvas_plan>` 解析、assistant assets 落盘、session/ledger 持久化，以及结合 `tapcanvas_flow_patch` 等工具证据识别“已直接写画布”的执行结果；`done` 只表示流结束原因，不替代 `result` 的可信地位。web 端继续使用共享的 SSE 协议解析器，先按 `event/data/id/retry` 解帧，再按事件名解析 `data` JSON。若本轮返回合法 canvas plan，前端会先落板，再自动执行其中新建的图片节点；若本轮 `result` / trace 已明确显示后端通过 `tapcanvas_flow_patch` 成功写入画布，前端会 reload 当前 flow。当前 trace 还会额外回传结构化 `canvasMutation` 摘要（`createdNodeIds / patchedNodeIds / executableNodeIds`）以及 `todoList` 快照，供 web 在 reload 后不仅自动执行新增图片节点，也能对“本轮 patch 到待执行态、但仍无 taskId/结果”的既有图片节点补发一次真实本地 `runNode`，并实时展示 checklist 状态。补充（2026-04-04）：对 `workspaceAction=chapter_asset_generation`，只要本轮已把可执行的 preproduction / anchors 图片节点真实写入画布，并保留 prompt、referenceImages / assetInputs 或上游边绑定，这就算一次合法的“写画布后交给宿主 auto-run”交付；bridge 与 web 不再要求 agents 必须在同一 SSE 回合内同步拿到最终 `imageUrl` 才算成功 handoff。AI 工作台不会再仅依赖落库后的历史诊断轮询；前端现在会把这批 SSE 生命周期、tool、todo 与正文预览直接写入实时运行态 store，在“AI 诊断”页即时展示当前是否仍在运行及对应日志。当前前端在组件卸载时会显式中断流式请求；若浏览器主动 abort / 页面离开 / SSE 连接断开，`/public/agents/chat` 不再继续写 `result` 或持久化本轮 assistant turn。补充（2026-04-02）：API autostart agents bridge 时不再强制 `--no-stream` 或 `AGENTS_STREAM=false`，因此 upstream LLM 请求是否流式，默认由 `apps/agents-cli/agents.config.json` / `~/.agents/agents.config.json` / `AGENTS_STREAM` 决定；只有手动传 `--no-stream` 时才会关闭。`POST /public/agents/chat` 在 Node runtime 下也会为 upstream fetch 显式设置 undici dispatcher 超时，并把 upstream `connect timeout`、`body timeout` 与流中断统一对齐到配置值后再转换成可观察的 SSE `error` + `done`，而不是让连接无事件终止后由前端长期停留在“等待中”；同时 web 端若收到 `done` 但没有 `result`，会把该回合显式标记为失败，而不是继续把聊天卡片留在 pending。前端不会因为这类回合再次把同一批 assistant assets 本地重复插图，也不会自动执行新建视频节点。
11. 补充（2026-04-02）：公共 agents chat 的执行前规划约束现在按 `codex-main` 的方向上移为框架级 gate，而不是依赖“命中某个 skill 后模型自己想不想列计划”。bridge 会基于真实作用域事实注入 `diagnosticContext.planningRequired / planningMinimumSteps / planningReason`：例如 chapter-grounded / 章节创作默认至少 `4` 步 checklist，节点修复或带 referenceImages / assetInputs / selectedReference 的 scoped canvas execution 默认至少 `3` 步。`agents-cli` 现在会在任何 side-effectful tool 真正执行前读取最近一次成功的 `TodoWrite` 结果；若 checklist 缺失或步骤数不足，会直接把该工具调用记为 `blocked`，而不是先执行再在 completion 阶段补判失败。completion gate 仍继续以 `TodoWrite` 为唯一 checklist 证据，并负责拦截“checklist 仍未完成”的收口。
12. `tool-events` 不再承担聊天主语义链路；聊天回合的工具信息只来自 `POST /public/agents/chat` 主流。独立 `tool-events` 通道仅允许保留给非聊天执行面或内部调试，不允许与聊天主链路双轨并存。
13. `POST /public/agents/chat` 在回合完成后调用 `persistUserConversationTurn(...)`，把 user/assistant 消息与 assistant assets 写入 `public_chat_sessions` / `public_chat_messages`；中途 `thinking/tool/content` 事件不会被当作持久化 assistant 正文。若前端传了 `displayPrompt`，持久化 user turn 时优先使用它，而不是把合成出来的隐式 `prompt` 直接写入历史。API 对最终响应做 `outputMode` 分类、生成结构化 `turnVerdict`（`satisfied | partial | failed`）、写 execution trace，并在同一事务语义下追加一条 `public_chat_turn_runs` ledger：记录 `requestId`、`projectId`、`bookId`、`chapterId`、`label`、`workflowKey`、`runOutcome`（`promote | hold | discard`）、`agentDecision`、`toolStatusSummary`、`diagnosticFlags`、`canvasPlan`、`assetCount`、`canvasWrite`、`runMs` 与 user/assistant message id，用于后续按 workflow 对比 agents chat 回合质量、筛选可提升结果和保留失败诊断。这里的 `toolEvidence.generatedAssets / wroteCanvas / read*` 现在都只基于成功状态的工具调用计算，不再把“调用过但失败”的执行尝试误记成事实证据。补充（2026-04-02）：bridge 的 `outputMode` 分类现在会把“已成功执行 `tapcanvas_flow_patch` 并直接写画布”视为真实非文本交付证据，不再把 `wroteCanvas=true` 的回合误判成 `text_only`。同时，bridge 新增了与 `codex-main` 对齐的通用交付复核：先基于 `semanticTaskSummary + scope + selected context + workspaceAction` 推导本轮 `expectedDelivery`，再把真实 `assets / wroteCanvas / flow_patch` 最终节点状态、`storyboardEditorCells.imageUrl`、authority base frame 状态，以及 `tapcanvas_book_storyboard_plan_upsert` 是否成功调用等归一化为 `deliveryEvidence`，最后用 `deliveryVerification` 决定是否真的满足用户要的产物类型。这里的 `expectedDelivery` 不再允许通过本地关键词/正则扫描 task 文本来猜“这是单基底帧还是多镜头分镜”；若 agents 想显式覆盖默认交付形态，必须在结构化语义摘要里提供 `deliveryContract`。同一轮里，bridge 也不再通过本地正则从用户 prompt 提取 `chapterId`；章节作用域现在只接受显式请求字段或已选 reference/context 事实。补充（2026-04-04）：当工作台显式触发“生成章节剧本”时，bridge 会把本轮默认交付合同切到 `chapter_storyboard_plan_persistence`，要求至少有一次成功的 `tapcanvas_book_storyboard_plan_upsert` 事实证据；仅返回章节文本说明、但没有把 `storyboardPlans / shotPrompts / storyboardStructured` 写回 book index，不再算成功完成。这类 metadata-only 章节剧本回合不会再被角色卡/状态锚点/三视图/scene_prop 等 chapter-grounded 视觉门禁误伤；只有期望交付本身属于图片/分镜静帧/视频时，这些视觉前置约束才会进入 hard-fail。章节级定格动画 / 分镜只是其中一个实例: 如果最终只落成“单张基底帧 + 视频占位”，而没有多镜头静帧节点或带真实 `imageUrl` 的 `storyboardEditorCells`，即使写画布成功也不会判成 `satisfied`。对于 `chapter_asset_preproduction`，delivery verifier 现在把可复用的 `productionLayer=preproduction` 与 `productionLayer=anchors` 图片节点都视为有效 preproduction 证据；若 authority base frame / shot anchor lock 节点已真实写入画布，不会再因为“本轮尚未回流 imageUrl”而被误判成未交付。对于 chapter-grounded 锁资产业务链，reference-binding 诊断也不再只认“旧选中的 authority 节点”这一种来源；若同一轮 patch 里已把旧错误 authority 降级为 `rejected`，并新建了带 `productionMetadata.authorityBaseFrame.status` 的 authority 基底帧节点，再由它通过真实 edges 承接下游 stills/video，可视为合法的 in-batch authority handoff，不会在 runtime auto-run 之前被误报成“缺少参考绑定持久化”。bridge 注入运行时参考事实时也不再用 `【参考图】` / `【资产输入】` 这些自然语言标题做 `includes` 判重；当前统一把机器注入的参考上下文包在内部 `<tapcanvas_runtime_reference_context>` 哨兵块中，确保用户正文即使出现相同标题，也不会吞掉真实 referenceImages / assetInputs 事实。补充（2026-04-04）：章节 storyboard metadata 现在新增只读工具 `tapcanvas_book_storyboard_plan_get`；代理要判断某章是否已有落盘 `shotPrompts / storyboardStructured` 时，必须先走这条读工具，禁止再拿 `tapcanvas_book_storyboard_plan_upsert` 做空写/探测式存在性检查。写入 `execution_traces` 时，bridge 现在只保留 assistant 文本预览、裁剪后的工具调用摘要与压缩版 response trace，不再把整段 assistant 正文、原始 tool payload 和完整上游 trace 原样复制进 `meta_json/tool_calls_json`，以降低长会话在 api 容器内的瞬时内存峰值。`turnVerdict` 仍是诊断元数据，但 web chat 现会在最终 assistant 消息上显式展示 `partial/failed` badge、可读 verdict summary，以及 `diagnosticFlags` 明细；同时不会再把“有可用结果但伴随结构缺口”的回合简单 toast 成一次普通聊天失败。`GET /admin/agents/diagnostics` 现也会把这批 ledger 以 `publicChatRuns` 一并返回，并支持按 `projectId / bookId / chapterId / label / workflowKey / turnVerdict / runOutcome` 过滤 agents chat 回合，供管理端直接查看结构化回合结果，而不必再从 execution trace 正文里反向推断。
14. 补充（2026-04-01）：对话链路新增一组“显式失败 + 可验证完成态”修复。主聊天入口命中 `agents_bridge_headers_timeout_non_retriable` 且 `dropOnHeadersTimeout=true` 时，不再回写伪成功文本，而是直接返回 `agents_bridge_headers_timeout_dropped`（504）显式失败；语义执行意图识别会优先读取 `trace.toolCalls[*].outputJson` 的结构化任务摘要，文本 JSON 仅在满足严格形状（包含数组型 `blockingGaps` 与 `successCriteria`）时才参与判定；`toolStatusSummary` 在 `trace.summary` 缺字段时会从标准化 `toolCalls` 状态回填，避免把 `failed/denied/blocked` 吞成 0；`agents-cli /chat` 最终 trace 现在稳定回传 `completion`（`source/terminal/allowFinish/failureReason/...`）供 bridge 做完成态门禁；agents-cli 会话键从“截断字符串”改为“前缀 + sha256 摘要”稳定映射（HTTP 会话与本地 memory 同步），避免长 key 碰撞串话；Responses 兼容解析仅接受显式 function-call 协议对象，不再把普通 JSON 正文误吞成工具调用。
15. 补充（2026-04-02）：`agents-cli /chat` 的 deterministic completion gate 不再只是“请求结束后给 bridge 一条诊断”。当某轮没有继续 tool call 且 completion 判定 `allowFinish=false` 时，runtime 会在同一 HTTP 请求内把 `failureReason`、`rationale`、`missingCriteria`、`requiredActions` 与 planning 状态组装成内部 `<runtime_completion_self_check>` 提示，再次回灌给主代理继续修正；该提示按 `ephemeral` user message 注入，只参与本次自修复，不会写回 JSONL 或 Redis 会话历史。最终 `trace.completion` 现在可能附带 `retryCount` 与 `recoveredAfterRetry`，用于说明这次完成态是否经过 runtime 自修复。bridge 仍只消费最终 completion/delivery 事实做验收与展示，禁止在 `hono-api` 或前端继续追加 case-specific prompt/regex 补丁替 agents 完成这次纠偏。补充（2026-04-04）：对 `workspaceAction=chapter_asset_generation`，bridge 现在会把章节缺失的角色卡/状态锚点/三视图/scene_prop 缺口结构化写入 `diagnosticContext`；`agents-cli` completion gate 会把它们视为“当前回合必须先完成的 preproduction 修复任务”，若主代理直接宣称“章节资产已完成”但 trace 中仍没有足量前置资产落到画布或生成工具成功证据，就会在同一请求里自动回灌一轮更高优先级的修复指令，要求先补资产再继续当前章节生产。这里的“前置资产”既包括 `productionLayer=preproduction` 的图片节点，也包括用于角色卡/三视图/scene_prop 的可复用 `productionLayer=anchors` 图片节点；completion gate 不再把这类明确的锁资产业务链节点误判成“仍未补资产”。补充（2026-04-04）：self-check 连续重试预算现在只会在 blocked 状态的关键证据真实前进时重置，例如 checklist 从缺失变成已建立、前置资产写回计数增加；如果代理只是反复重读 `flow/books/pipeline runs` 或做无效探测而没有改变 blocked 状态，runtime 会更快结束并保留失败事实，避免单次 `/public/agents/chat` 长时间卡在重复取证循环。

补充约束：

- 前端执行 `<tapcanvas_canvas_plan>` 前，会先对章节追溯元数据做结构性补全与校验。只要节点是依据小说章节生成的 `image|storyboardShot|novelStoryboard|composeVideo|video`，节点 `config` 必须能落出 `sourceBookId`、`materialChapter`，并同步补齐别名 `bookId`、`chapterId`。
- 若章节关联节点只带了半截元数据（例如只有 `sourceBookId` 没有 `materialChapter`），前端会直接拒绝执行该 canvas plan，而不是继续创建“不可续写”的脏节点。
- 前端 canvas plan 执行层现在只保留结构性校验，不再用 report-language regex、对白 `includes`、上游文案匹配或本地 prompt 改写来判断“提示词是否像最终成品”。对白保留、镜头语言与报告腔修正等语义工作统一回到 `agents-cli` / specialists。
- 对 chapter-grounded 的图片/视频提示词，`image_prompt_specialist` / `video_prompt_specialist` / `pacing_reviewer` 的方法论、触发条件与最小输出契约现在统一沉在 `apps/agents-cli/skills/tapcanvas-prompt-specialists`；bridge 不再注入该 skill 的摘要提示，也不再把 skill 正文拼进 system prompt，相关知识只通过 `requiredSkills` 元数据或 `agents-cli` 运行时按需 `Skill` 加载进入链路。`image_prompt_specialist` 对 chapter-grounded 图片结果现默认要求返回 `imagePrompt`，若还要附带结构化 JSON 视图，则统一返回 `structuredPrompt`。
- 对最终视频提示词与 `composeVideo|video` 节点，bridge 现在只检查“是否真的提供了可执行 `prompt`”。这组检查只面向最终 text payload 与 canvas plan 视频节点，不会把中间 `video_prompt_specialist` trace 当成终态产物来误报。若最终输出仍停留在 `videoPrompt` 或其他不会参与模型调用的平行字段，而没有真实 `prompt`，会写入 `video_prompt_core_fields_missing` 诊断并把 `turnVerdict` 下调为 `partial`。仅 `status=error` 的待确认/占位视频节点会跳过这组治理检查，避免把显式失败占位误报成“提示词不合格”。
- 补充（2026-04-01）：chapter-grounded 图片提示词治理新增“角色年龄/状态连续性”硬约束。bridge 在自动注入角色卡锚点时，会把 `ageDescription/stateDescription/stateKey` 一并写入 `assetInputs.note` 与 prompt 的 `【角色年龄与状态连续性约束】`。若章节角色缺少年龄/状态元数据，会写入 `chapter_grounded_character_state_missing` 并按失败处理；若 `structuredPrompt(imagePromptSpecV2)` 在存在锚点输入时缺失 `referenceBindings` / `identityConstraints` / `environmentObjects`，或在存在角色状态证据时缺失 `continuityConstraints`，会分别触发 `image_prompt_spec_v2_reference_bindings_missing`、`image_prompt_spec_v2_identity_constraints_missing`、`image_prompt_spec_v2_environment_objects_missing`、`image_prompt_spec_v2_character_continuity_missing`，并按失败处理，禁止“上一章重伤、下一章无因痊愈”这类跳变被静默放行。
- 补充（2026-04-02）：chapter-grounded 视觉锚点治理进一步收紧为“可复用资产必须先存在”。对本章会重复出现的角色，bridge 现在要求对应书籍 `roleCards` 已存在真实 `threeViewImageUrl`，只有普通角色图不再算满足连续性锚点；缺失时会写入 `chapter_grounded_character_three_view_missing` 并按失败处理。对章节元数据里已经显式暴露的稳定场景/关键道具，bridge 现在也要求书籍 `assets.visualRefs` 里存在可执行参考图；缺失时会写入 `chapter_grounded_scene_prop_reference_missing` 并按失败处理。运行时注入到下游节点的 `assetInputs` 会保留 `role=character|scene|prop` 语义，而节点自身的语义锚点定义现统一收口到 `anchorBindings`；`roleName/roleCardId/referenceView` 与 `visualRefName/visualRefCategory` 仅可作为派生辅助字段，禁止再用 taskId 充当绑定标识。
- 补充（2026-04-03）：chapter-grounded 漫剧/分镜创作的默认策略现在进一步收紧为“能抽尽抽，先铺垫资产”。只要章节元数据里已抽出可复用角色、场景或关键道具，而对应 `roleCards` / `assets.visualRefs(scene_prop)` 仍缺失，bridge 会把本轮 `expectedDelivery` 强制切到 `chapter_asset_preproduction`，要求先落可执行的预生产资产节点，禁止跳过资产铺垫直接把章节分镜/视频判成已完成。这里不会靠 prompt 关键词猜“什么算核心道具”；判断仍只基于已抽取的章节实体与已持久化的书籍资产事实。
- 补充（2026-04-08）：章节 `props` 元数据已升级为结构化语义对象，不再只是 `{name, description}`。解析阶段现在要求 agents 为每个道具显式输出 `narrativeImportance / visualNeed / functionTags / reusableAssetPreferred / independentlyFramable`。bridge 在 `workspaceAction=chapter_asset_generation` 的前置资产门禁中，只会把 `visualNeed=must_render` 或 `reusableAssetPreferred=true` 的道具视为“需要独立 scene_prop 参考资产”的缺口；`shared_scene_only` / `mention_only` 的环境杂物只会保留在章节语义里，不会再被硬拉成独立预生产任务。本地代码只消费这些结构化字段，不再用关键词、正则或个案名单判定“锅碗瓢盆是否要出图”。
- 补充（2026-04-03）：chapter-grounded 请求的运行时视觉锚点现在不再只依赖用户手动传图或已选 authority 节点。bridge 会把书籍 `assets.styleBible.referenceImages` 也并入章节连续性注入，作为 `role=style` 的正式参考资产；因此即便当前轮只是在补场景/道具前置资产，只要书里已有风格板，生成节点也必须显式持久化这些风格参考（`data.referenceImages` / `data.assetInputs` 或真实上游连边），否则会触发 `chapter_grounded_reference_binding_missing`，不能再让“提示词里口头说保持同画风”蒙混过关。
- 补充（2026-04-03）：书籍索引的连续性资产现在分成三层事实：`assets.roleCards`、`assets.visualRefs`、`assets.semanticAssets`。其中角色卡会正式保留 `stateKey/ageDescription/stateLabel/healthStatus/injuryStatus`，并把 `stateKey` 纳入章节去重键；所有已生成且已有真实 URL 的 `roleCards` / `visualRefs` / `semanticAssets` 都会默认写成 `confirmationMode=auto` + `confirmedAt/confirmedBy`，人工确认仅作为后续更正覆盖，不再要求“先手动确认才能被 agents-cli 用上”。`agents.service` 的章节分镜工作流与 web `remoteRunner` 的普通节点生成链路都会同步写入 `semanticAssets`，把章节/shot/anchorBindings/stateDescription/prompt/production meta 持久化到 book index；项目上下文 `STORY_STATE.md` 也会额外暴露“最新角色状态”和“最近语义资产”摘要，供 agents-cli 在下一章自动检索连续性证据，而不是依赖本地关键词兜底。bridge 的 chapter-grounded 连续性注入现在也会把 `semanticAssets` 当作正式候选：若上一章已有已确认的角色状态图、场景图或关键道具图，下一章会优先按“本章命中 > 历史最近状态 > 无章节范围的全局资产”这一通用顺序复用，而不是只认同章精确匹配的 `roleCards/visualRefs`。
- 补充（2026-04-02）：`@角色名-状态` / `@角色名:状态` 这类显式 mention 绑定现在只做归一化后的确定性匹配，不再在 `hono-api` 里用 substring/includes 做模糊状态同义匹配；若用户写的是未持久化的状态键，bridge 会保留原 prompt，但不会擅自绑到“看起来接近”的角色卡。
- `turnVerdict.reasons` 现在只保留稳定的终态主因；一旦回合已进入 `failed`，像 schema 细节、诊断聚合这类展开信息只继续保留在 `diagnosticFlags`，不再把 `diagnostic_flags_present` 之类的元原因混进失败主因数组。
- 流式解析失败策略：若 agents bridge 上游 SSE payload 非法，后端会返回显式的 `agents_bridge_stream_invalid_event` / `agents_bridge_stream_failed`，并记录 payload 预览用于诊断；不会再把底层 JSON 解析报错直接显示为对话正文。

### 端到端流程图

```mermaid
flowchart TD
    A[Web 收集真实上下文] --> B[POST /public/agents/chat]
    B --> C[public-agents-chat 组装最小 bridge 请求]
    C --> D[注入最小 system prompt 与 canvas capability manifest]
    D --> E[POST agents-cli /chat]
    E --> F[agents-cli: intent -> evidence -> skills -> subagents -> report]
    F --> G[后端校验 outputMode / turnVerdict / trace / diagnostics]
    G --> H[前端执行合法 canvas plan 或展示结果]
```

### 运行时组件

- 前端聊天 UI：
  `apps/web/src/ui/chat/AiChatDialog.tsx`
- 公共聊天 / API 任务分发：
  `apps/hono-api/src/modules/apiKey/apiKey.routes.ts`
- Agents 专用聊天入口：
  `apps/hono-api/src/modules/task/public-agents-chat.ts`
- Agents bridge 工具与下游能力注入：
  `apps/hono-api/src/modules/task/task.agents-bridge.ts`
- 公共聊天 system/persona prompt 组装：
  `apps/hono-api/src/modules/task/chat-system-prompt.ts`
  `apps/hono-api/src/modules/task/chat-persona-prompt.ts`
  `apps/hono-api/src/modules/task/chat-base-system.ts`
  `apps/hono-api/src/modules/task/chat-response-policy.ts`
  `apps/hono-api/src/modules/task/chat-context-fragment.ts`
- Agent loop 与 workspace context：
  `apps/agents-cli/src/core/agent-loop.ts`
  `apps/agents-cli/src/core/session/session-engine.ts`
  `apps/agents-cli/src/core/context-pipeline.ts`
  `apps/agents-cli/src/core/capability-resolver.ts`
  `apps/agents-cli/src/core/finish-policy.ts`
  `apps/agents-cli/src/core/workspace-context/assembler.ts`

### 运行时知识源

当前运行时只允许两类知识源：

- `skills/`
- 实时代码、工具返回、项目元数据

以下目录不再作为 runtime knowledge source：

- `docs/`
- `assets/`
- `ai-metadata/`

它们仍可作为仓库中的文档或构建期资产存在，但不应成为 agent 运行时默认读取依据。

### System prompt 组装顺序

后端当前 prompt 装配分为“薄 system + 事实片段”两层：

1. 调用方显式传入的 caller instructions
2. 公共助手基础 system：
   - 助手身份
   - 事实优先 / 显式失败
   - 协议级硬约束
3. Persona 文件：
   - `apps/agents-cli/IDENTITY.md`
   - `apps/agents-cli/SOUL.md`
4. 当前轮事实片段与能力清单：
   - `canvasNodeId` 相关节点指代
   - `planOnly` / `forceAssetGeneration`
   - reference slots / selected node / selected reference
   - `canvasCapabilityManifest`
   - `canvasCapabilityManifest`

另外，bridge 现在会把一份轻量 `promptPipeline` 摘要同时写入请求侧 `diagnosticContext` 与回合结果 `raw.meta` / execution trace：显式区分 `precheck -> prerequisite generation -> prompt generation` 三个阶段，以及“本轮预检查时自动注入了多少角色卡/尾帧/参考图、generation gate 是否允许直接生成”。这样排查 trace 时，不需要再靠人肉读完整 toolCalls 去猜“到底有没有做角色卡/连续性预检查”。
   - 当前启用的 image/video 模型事实摘要（若可用）
5. project-scoped 本地文本访问边界
6. 其余完成态与业务方法论交由 `agents-cli` runtime / verifier / skills

说明：

- `hono-api` 不再根据本地关键词、prompt 模板或 route 枚举决定“本轮是否必须返回 canvas plan”。
- 是否返回 `<tapcanvas_canvas_plan>`、是否只读回答、是否继续取证或拆子代理，全部交给 `agents-cli` 基于真实上下文自主判断。
- 业务方法论、创作套路、specialist 使用方式与连续性策略应以 runtime skills 为唯一来源；`hono-api` system 只保留身份、事实、协议、trace 与失败策略，不再注入 runtime skill 摘要，也不再注入 bridge-side memory prompt；`planOnly`、`forceAssetGeneration`、AUTO 成功标准等执行建议也不再由 bridge 长 prompt 主导。
- 后端只在响应返回后做协议校验与诊断：如果 agent 自己返回了 canvas plan，就校验 schema；如果没有返回，就按普通文本/资产结果处理。

### `chatContext` 的角色

`chatContext` 只承载前端已确认事实，例如：

- `selectedReference`
- `selectedNodeTextPreview`
- `selectedNodeKind`
- `enabledModelCatalogSummary`

这些字段只做事实透传，不在前端或 bridge 中承担语义决策。是否继续生成、是否先规划、是否需要 specialist，交由 `agents-cli` 自主判断。

补充说明：

- `enabledModelCatalogSummary` 只承载 bridge 本轮实时读取到的模型目录事实：哪些 image/video 模型当前可用、各自定价、已声明的 `useCases`，以及 `meta.imageOptions` / `meta.videoOptions` 中的规格。当前会显式透传图片模型的默认比例、默认尺寸、`imageSizeOptions`、`resolutionOptions`，以及视频模型的默认时长、默认分辨率、`durationOptions`、`resolutionOptions`、`sizeOptions`、`orientationOptions`。若该摘要缺失或标记为 unavailable，agent 必须如实承认“不知道当前启用模型规格”，不能凭记忆补全。
- 当前策略是：由 `apps/agents-cli/skills/tapcanvas-workflow-orchestrator` 与 `apps/agents-cli/skills/tapcanvas-continuity` 提供单视频/续写的业务方法论；bridge 只透传事实锚点与本地资源范围。
- 即使当前请求不是 `single_video`，只要用户明确要求“结合当前项目/当前小说/已上传文本/章节正文/角色素材”进行分析或创作，agent 也必须先实际调用相关 project/book/material/flow tools 取证；未取证前不得声称“拿不到项目数据”“没有权限读取”，也不得直接要求用户先粘贴正文。
- 对显式、确定性的画布改动请求（例如添加空文本节点、重命名节点、连接节点、更新少量已知字段），对应方法论已沉到 `skills/`，agents 在作用域充分时应优先直接调用 `tapcanvas_flow_patch`，而不是回“请手动添加”或默认只给 canvas plan。若用户明确要求“把角色卡/参考图接到某个节点上”，应优先使用 `createEdges` 建立真实画布连线；只有在连线语义不适用时，才退回到仅 patch 节点内的 `referenceImages`。
- 当用户明确要求把图片、海报、封面、插画、效果图等视觉成品放入当前画布时，以及 `kind=text` 节点允许空内容占位这类业务规则，也统一沉在 runtime skills，不再由 bridge 常驻 prompt 重复维护。
- `tapcanvas_flow_patch` 与 `tapcanvas_flow_get` 在当前 scoped 会话下都可直接复用 bridge 注入的 `tapcanvasFlowId`；不再要求 agents 额外显式传一次 flowId，也不再对 flowId 做本地白名单卡口。
- diagnostics 仍会记录结构性风险，但 bridge 不再把这些 flags 升级成聊天入口的语义性 422 拦截。
- 同时，bridge 不再因为“暂时缺少视觉锚点”就从 `allowedTools` 里移除生成类工具；是否先补关键帧、先出静帧还是直接尝试生成，由 agents 基于证据自主决定。
- 同时，`planOnly=true` 对 `vendor=agents` 已不再是“移除执行工具、强制只回 canvas plan”的本地硬限制；它只作为偏好透传。是否直接调用 `tapcanvas_flow_patch` 写画布、是否继续生成资产，交由 agents-cli 基于证据自主决定。
- 当调用方显式传 `forceAssetGeneration=true` 时，bridge 会把它作为事实型执行约束写入 system prompt：只要任务目标属于图片/视频/角色卡/分镜图/生成型画布节点，agents 应优先尝试真实生成或直接落地生成节点；若因证据、权限或工具条件不足而无法产出，必须显式失败并说明缺口，不能只停留在提示词建议或抽象方案。

当前 `selectedReference` 还会补充少量结构性链路事实，例如：

- `hasUpstreamTextEvidence`
- `hasDownstreamComposeVideo`

这两项只描述“当前选中节点在画布里的已存在上下游关系”，不描述语义质量。bridge 仅用它们避免把一个已经位于 `正文依据 -> 静态帧 -> composeVideo` 链路中的场景静帧，误判成普通参考图。

`selectedNodeTextPreview` 则是前端从当前选中节点里裁剪出来的一段文本预览（例如 text/content/textResults 的首个有效摘要）。它只用于帮助 agent 在第一轮先看到“这个节点大致在说什么”，以便决定是否继续读取完整 node/project 证据；它不是正文真值源，不能替代后续取证。

### Skills 装配

`/public/agents/chat` 当前采用“后端只传事实与硬约束，skills 在 agents-cli 侧按需加载”的装配方式：

1. 前端继续只发送事实型 `chatContext`，例如 `selectedReference`、`selectedNodeTextPreview`、`selectedNodeKind`。
2. `hono-api` 不再在 agents chat system prompt 中注入 runtime skill hints。普通问答或泛任务完全依赖 `agents-cli` 自身 bootstrap、available skills 摘要以及按需 `Skill` 加载。
3. 当前默认规则：
   - 默认不下发任何 skill，保持单代理最小链路。
   - chapter-grounded 的 `project + flow + book + chapter` 只作为事实作用域透传与 diagnostics 上下文，不再自动附加 team skill。
   - 若调用方显式传入 `requiredSkills`、`allowedSubagentTypes` 或 `requireAgentsTeamExecution=true`，bridge 只透传这些显式要求；但 skill 正文是否真正加载，仍由 `agents-cli` 主代理自行决定。AUTO 本身不再额外附加 `agents-team`。
4. 完整业务方法论仍以 `agents-cli` runtime skills 为唯一来源；`hono-api` 不再在常驻 system prompt 中维护 skill 平行版本，也不再直接拼接完整 skill 文本。真正是否拆子代理、先读哪个工具、是否直接生成，仍由主代理基于证据决定。
5. `agents-cli` 的 `code` profile 现在原生暴露团队工具；`agents-team` 已降级为可选协作方法论 skill，不再承担团队工具开关职责。bridge 不会再用 `requiredSkills` 驱动 skill 正文预加载或 team 工具开关。
6. 章节分镜的运行时入口统一为 `/public/agents/chat -> agents bridge -> skills`；后端不再保留平行 storyboard REST/workflow 生产路由。
7. 章节分镜续写（`/agents/pipeline/runs/:id/execute` 且携带 `progress`）目前已切到 MVP prompt：后端只要求最小 JSON 契约与固定续写边界，不再在 prompt 中注入冗长 schema 示例、shot_design 顶层模板、角色卡/QC/风格计划等扩展约束；同时续写模式下带给模型的小说正文摘录窗口也已缩短，按本次 `progress.groupSize` 生成对应 chunk；若上游没有证据，后端默认值仍是 `25`。
8. 旧短视频规则已做条件化：`5` 镜以内的小短片模式仍保留“少而强镜头 / 3-5 秒 / mini-arc”校验；章节分镜续写只要本次 `expectedCount > 5` 就不再套用这些限制，避免 prompt 要求与后处理校验互相打架。
9. 章节分镜技能已收敛为单镜头主技能：后端默认透传 `requiredSkills=["tapcanvas-storyboard-expert"]` 给章节分镜执行链路。该 skill 只负责“单个镜头生产”，不承担多镜头全局编排；跨镜头一致性（角色/场景/道具/光照/尾帧承接）必须由历史上下文注入完成，当前历史档案根目录为 `project-data/`（包含 book index、storyboardChunks、tailFrameUrl 等连续性证据）。
10. 参考图策略改为“建议优先”而非“强门禁”：首镜允许无参考图启动；非首镜通常应带上一帧或其他参考图以提升一致性，但缺失时只记录 advisory 诊断，不再直接阻断分镜生成。
11. 章节视觉交付验收新增硬约束：bridge 不再把“写了画布”直接当成交付完成，而是统一走 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 复核。若回合只落了 `storyboardEditorCells[*].prompt`（无 `imageUrl`）且未生成真实资产，或只创建角色卡/单张基底帧/视频占位这类不匹配主交付物的结构，都会被判为未完成视觉交付。
12. 补充（2026-04-03）：当 chapter-grounded 连续性注入已能抽出缺失的复用资产时，bridge 会先要求 `chapter_asset_preproduction` 交付，再允许进入 `chapter_multishot_stills` / `video_followup`。也就是说，“完成某章漫剧创作”不再允许在缺角色卡、缺状态/三视图、缺场景/关键道具 `scene_prop` 的情况下直接跳到分镜或视频；必须先补齐预生产资产节点，哪怕这一轮最终只完成资产铺垫，也要如实把回合标记为 preproduction，而不是冒充整章已完成。

这意味着：

- 快捷操作项只是触发器，不应再把“先锁关键帧、再修 1-2 次、再进 composeVideo”之类 SOP 写死在前端。
- continuity 是通过 `skills/` 中的方法论 + 实时工具读取共同保证的，不是通过前端 prompt 文案保证的。

### 子代理与 skills

当前运行时仍支持以下 specialist：

- `image_prompt_specialist`
- `video_prompt_specialist`
- `pacing_reviewer`

但这些只是当前已实现且可被 agent 自主调用的角色类型，不再由 `hono-api` 预设固定白名单或编排顺序。主代理可以基于证据按需调用。真正的方法论已经迁入 `skills/`，例如：

- `apps/agents-cli/skills/tapcanvas-public-chat`
- `apps/agents-cli/skills/tapcanvas-workflow-orchestrator`
- `apps/agents-cli/skills/tapcanvas-video-prompting`
- `apps/agents-cli/skills/tapcanvas-prompt-specialists`
- `apps/agents-cli/skills/tapcanvas-continuity`

`Task` 仍会对 specialist 返回做最小 JSON 结构校验，防止 malformed 结果直接进入最终响应。

其中 `image_prompt_specialist` 的当前契约已经明确为“最终可执行的长图片提示词”，不应退化成一句摘要。对章节分镜图/关键帧，主代理应期望它在 `imagePrompt` 正文里直接折叠：时间与光线、空间拓扑、前中后景、主体数量与左右前后关系、关键道具与机械位置、机位/景别/焦段感、情绪边界与禁止项；复杂场景默认允许使用更长的 prompt，而不是为了“简洁”丢失事实密度。

### 输出模式

后端仍在执行后把响应分类为 4 种 `outputMode`：

- `text_only`
- `plan_only`
- `plan_with_assets`
- `direct_assets`

并保留这些硬约束：

- 没有合法 `<tapcanvas_canvas_plan>` 时，不得声称“已返回画布计划”或“已可落地到画布”
- 若没有 `tapcanvas_flow_patch` 等真实写入证据时，不得声称“已直接写入画布”
- 即使已有 `tapcanvas_flow_patch` 成功证据，也只能声称“已写入当前 flow / 已提交画布修改”，不能进一步推断“你现在应该能看到 / 画布里已经显示”
- 没有工具证据时，不得声称“已读取/已确认”项目事实
- 后端不再根据 prompt 关键词、回复措辞或资产 URL 自动补写 `<tapcanvas_canvas_plan>`

此外，bridge 会生成一个纯结构化的 `turnVerdict`：

- `satisfied`：本轮至少交付了可用结果，且没有结构性失败或工具执行异常
- `partial`：本轮有可用结果，但伴随工具失败、拒绝、非协调性阻塞、`todo_checklist_incomplete`（执行型回合 checklist 未完成）或其他 diagnostics
- `failed`：本轮存在无效 canvas plan、`forceAssetGeneration` 未满足、或“既无结果也无执行落点”等结构性失败

对视频提示词治理，当前只保留以下结构 flag（命中时通常对应 `partial`）：

- `video_prompt_core_fields_missing`

### 工具与本地资源策略

`runAgentsBridgeChatTask(...)` 当前在协议层保持高权限，但宿主源码写权限已由 Docker 物理收口：

- public 请求不再下发 `allowedTools` 白名单；即使同时传入 `requiredSkills`，也不会再把请求降成 `allowedTools=[]` 的无工具模式，工具选择完全交给 `agents-cli`
- bridge 自动启动的 `agents-cli` 使用 `AGENTS_PROFILE=code`
- public 远程会话默认开启 `privilegedLocalAccess`，可直接使用本地 shell / fs 工具；但 Docker Compose 只把 `/runtime/workspace`、`/app/project-data` 与运行期依赖目录暴露为可写路径
- public 请求不再禁止 `requiredSkills`、`localResourcePaths`、`forceLocalResourceViaBash`
- 当 agents chat 缺少节点/图片执行上下文、又能在当前项目下唯一锁定一本书时，bridge 会自动把该书目录注入 `localResourcePaths` 并开启 `forceLocalResourceViaBash`；此时强制要求 agents 先在该目录内用 `bash` 读取 `index.json` 和正文证据，再回答章节内容问题
- 当前本地书稿强制取证只基于已确认的项目/书籍事实作用域，不再依赖前端透传的结构化创作模式信号；视觉参考只作为附加约束，不能替代项目正文证据
- `tapcanvas_storyboard_source_bundle_get` 的 `diagnostics` 现在会额外返回 `chapterContextResolution`，显式说明 `chapterContext` 的解析结果；若为空，会给出结构化失败原因（如 `candidate_books_not_found`、`chapter_meta_missing`、`book_raw_missing`），避免再把“空 bundle”误当成“项目里没有小说可读”
- bridge 不再下发 `resourceWhitelist.restrictRepoKnowledgeRead`
- TapCanvas 业务工具不再假定直接注册在 `agents-cli` 本体里；当前由 `hono-api` 以远程工具定义 + `/public/agents/tools/execute` 的形式下发，`agents-cli` 只做代理执行
- 画布/书籍/素材级工具都不再受本地 `flowIds/projectIds` 白名单限制；`tapcanvasFlowId` / `tapcanvasProjectId` 只承担默认作用域注入，是否允许读取当前 flow、book、material 由真实用户鉴权、project 作用域与上游接口共同决定

### Trace / diagnostics

每次 agents-bridge chat 都会写 execution trace，记录：

- request context
- tool evidence
- response turns
- output mode
- turn verdict
- canvas plan diagnostics
- diagnostic flags

这些 diagnostics 现在主要用于 trace 与排查，不再承担基于正文语义或正则匹配的响应拦截职责。

补充说明：

- `toolStatusSummary.blockedToolCalls` 始终保留 trace 原始 blocked 次数，方便定位“模型在等待 team agent 期间又排了多少后续工具”。
- 若 blocked 的原因是 runtime 明确返回“已有 team 子代理尚未结束，需等待终态后下一轮重发”，bridge 会把它识别为协调性 blocked：保留计数，但不单独触发 `tool_execution_issues`，也不因此把 `turnVerdict` 从 `satisfied` 降成 `partial`。
- 补充（2026-04-04）：`Execution planning required before ...` / `当前回合要求 checklist-first` 这类 planning gate blocked 也按“非执行异常”处理；它们只说明本轮先补执行清单，再继续取证，不会再记成 `actionableBlocked`。
- 若某个 team child 已被 `close_agent` 成功关闭，runtime 现在会把它视为终态；即使持久化状态里暂时还残留 `pending_tasks`、`active_submission_id` 或旧 `running` submission 摘要，也不会继续把它当成待完成 child 自动轮询，避免显式关闭后仍被卡住。
- 只有 failed、denied，或非协调/非 planning gate 的 blocked，才会进入执行异常统计并触发 `tool_execution_issues`。

其中 `request context` 现在除了参考图数量，还会记录 `referenceImageSlots` 摘要（例如 `图1 | 李长安 | role=角色参考`），用于直接诊断“agents 本轮是否拿到了正确的图位协议”。

当前 `canvas plan diagnostics` 已明确区分两类失败：

- `invalid_canvas_plan_json`
  说明 `<tapcanvas_canvas_plan>` 标签内文本连 `JSON.parse(...)` 都无法通过
- `invalid_canvas_plan_schema`
  说明 JSON 文本本身可解析，但不符合后端固定 schema
  例如 `action` 不合法、`nodes` 为空、节点缺少 `clientId/kind/label` 等
- `invalid_canvas_plan_tag_name`
  说明模型输出了近似但错误的标签名
  例如 `<tcanvas_canvas_plan>`，而不是规定的 `<tapcanvas_canvas_plan>`

trace 中会同时记录：

- `errorCode`
- `errorDetail`
- `schemaIssues[]`
- `detectedTagName`

因此当响应被标记为“含有 tapcanvas_canvas_plan 但没有合法 plan”时，排查时不应再笼统理解为“模型返回了坏 JSON”；必须先看是 JSON 解析失败，还是 schema 校验失败。

### Docker 下 persona 正确性的注意事项

在 `apps/hono-api/docker-compose.yml` 下运行时：

- `agents-bridge` 的工作目录是 `/runtime/workspace`
- 宿主机 `apps/agents-cli` 与仓库级 `skills/` 以只读方式挂载到 `/opt/tapcanvas-src/...`
- 启动时会把 `apps/agents-cli`、`packages/` 中供运行时使用的共享 schema 模块复制到 `/runtime/bootstrap` 后再构建运行；这些副本可丢弃，但不会反向修改宿主源码
- agent 运行时可写目录被收敛到 `/runtime/workspace/.agents`、`/runtime/workspace/skills`、`/runtime/workspace/project-data`，以及 `/app/project-data` 这个同一份项目数据的兼容挂载点
- 不再把 `docs/`、`assets/`、`ai-metadata/` 挂进 `agents-bridge` 容器作为默认运行时知识源
- `api` 运行目录是 `/app`
- `api` 与同类 worker 会把 `${TAPCANVAS_SHARED_ROOT:-../..}/packages` 额外挂载到容器内 `/packages`（只读）；默认适配 monorepo 下的 `apps/hono-api`，扁平部署则改为 `TAPCANVAS_SHARED_ROOT=..`。这是因为 `hono-api` 源码里的共享 schema 相对导入在容器内会解析到 `/packages/...`；缺少该挂载时，运行期会报共享 schema 模块无法解析。
- 两个服务都必须能看到：
  - `/opt/tapcanvas-src/apps/agents-cli/IDENTITY.md`
  - `/opt/tapcanvas-src/apps/agents-cli/SOUL.md`

`/runtime` 生命周期说明：

- `/runtime/bootstrap` 是 `tmpfs`，只存启动时复制出的 `agents-cli` 运行副本、临时构建产物与容器内 `node_modules` 挂载点；容器停止后这层文件系统会消失，下次启动重新复制
- `/runtime/workspace/.agents` 是持久卷，用于 agents memory / runtime state
- `/runtime/workspace/skills` 是持久卷，用于运行期新增或演化出的 skills
- `/runtime/workspace/project-data` 绑定宿主机 `project-data/`，用于项目事实与产物持久化
- 除上述挂载点外，不应把任何关键数据写入 `/runtime/workspace` 的其他路径

如果回答从具体 persona 退回成泛化助手，优先检查容器中这两个文件是否真实可读。

### Pipeline runs API（新增）

- `GET /agents/pipeline/runs?projectId=<id>&limit=30`
- `POST /agents/pipeline/runs`
- `GET /agents/pipeline/runs/:id`
- `PATCH /agents/pipeline/runs/:id/status`
- `POST /agents/pipeline/runs/:id/execute`

## Credits finalizer（自托管 / Redis 队列）

如果你在自有服务器上运行 API，可能需要一个后台循环，即使客户端停止轮询也能完成任务结算。

- 内部接口：`POST /internal/credit-finalizer/run`（需要 `INTERNAL_WORKER_TOKEN`）
- Worker 进程：`pnpm credit-finalizer:worker`

## Prompt evolution 定时任务（自托管 / Redis 队列）

- 内部接口：`POST /internal/prompt-evolution/run`（需要 `INTERNAL_WORKER_TOKEN`）
- 管理端接口（dashboard 按钮）：`POST /stats/prompt-evolution/run`
- Worker 进程：`pnpm prompt-evolution:worker`

常用环境变量：

- `PROMPT_EVOLUTION_CRON`（默认：`0 0 * * *`）
- `PROMPT_EVOLUTION_TZ`（默认：`America/Los_Angeles`）
- `PROMPT_EVOLUTION_SINCE_HOURS`（默认：`24`）
- `PROMPT_EVOLUTION_MIN_SAMPLES`（默认：`30`）
- `PROMPT_EVOLUTION_DRY_RUN`（默认：`0`）

## Commerce 冒烟测试（product / order / wechat-pay）

启动 API（`pnpm dev`）后，执行：

```bash
pnpm smoke:commerce
```

说明：

- 该测试会验证 `guest -> create product -> create order -> cancel order -> stock rollback` 这一条链路。
- 如果没有配置 WeChat 相关环境变量，测试会期望 `/wechat-pay/native/create` 返回明确的缺失环境变量错误。
