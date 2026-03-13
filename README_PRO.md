# TapCanvas API（NestJS + Node.js）

本 API 运行在 NestJS（Express）服务器上，并将现有的 Hono + OpenAPI 路由挂载到同一个 HTTP 服务中。这样可以在标准 Node.js 运行时里继续复用当前的 route / auth / task 逻辑。

## 开发

```bash

cp.env.example.env

pnpmprisma:generate

pnpmdev

```

- 默认地址：`http://localhost:8788`
- 可复制的中文说明文档（Markdown）：`GET /`
- OpenAPI 3.1 schema：`GET /openapi.json`

## 数据库（Prisma + Postgres）

当前 Node 运行时通过 `DATABASE_URL` 强制要求使用 Postgres。

```bash

# 1) 生成 Prisma Client

pnpmprisma:generate


# 2) 根据 schema.sql 创建 / 更新 Postgres 表结构

pnpmdb:pg:schema


# 3) 可选：把本地 sqlite 数据迁移到 Postgres

pnpmdb:migrate:sqlite-to-pg

```

说明：

-`db:migrate:sqlite-to-pg` 在导入前会先清空目标 Postgres 表。

- 权威 schema 来源仍然是 `apps/hono-api/schema.sql`。

-`db:pg:schema` 内置安全门：会阻止破坏性 SQL（`DROP/TRUNCATE/DELETE/ALTER ... DROP COLUMN`），只允许增量 schema 变更（`CREATE TABLE/INDEX IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN`）。

### Docker 自动部署时的数据库更新

`apps/hono-api/docker-compose.yml` 当前会让 `api` 服务在启动时执行这条链路：

```bash

pnpmprisma:generate && pnpmdb:pg:schema && pnpmbuild && nodedist/main.js

```

这意味着每次容器启动都会：

1. 重新生成 Prisma Client
2. 自动应用安全的增量 schema 更新
3. 如果检测到破坏性 schema 语句则立即失败并拒绝启动

### 一条命令部署 / 启动（带 Postgres）

在 `apps/hono-api` 目录下执行：

```bash

docker-composeup--build-d

```

如果你的 `.env` 里仍然使用宿主机本地 DSN（`localhost:5432`），可以继续保留给宿主机工具使用，但容器内 DSN 需要单独配置：

```bash

DATABASE_URL_DOCKER=postgresql://tapcanvas:tapcanvas@postgres:5432/tapcanvas?schema=public

```

内置服务：

1.`postgres`（持久卷：`hono_api_postgres`）

2.`redis`

3.`agents-bridge`

4.`api`

版本对齐：

- Compose 中 Postgres 版本是 `16`
- API 镜像安装了 `pg_dump 16`（`postgresql-client-16`），避免备份时出现版本不匹配

每次 `api` 启动时，部署链路为：

```bash

pnpmdb:pg:backup && pnpmprisma:generate && pnpmdb:pg:schema && pnpmbuild && nodedist/main.js

```

如果备份或 schema 安全检查失败，容器启动会被阻止。

## Agents bridge（可选）

公共聊天接口（`POST /public/chat`）支持 `vendor=agents`；当启用时，`vendor=auto` 也会优先尝试 `agents`。

启动本地 Agents HTTP 服务：

```bash

pnpm--filteragentsdev--serve--port8799--no-stream

```

也可以通过 Docker Compose 一起启动 API 和 Agents bridge：

```bash

docker-composeup--build

```

本目录下 compose 的默认约定：

-`agents-bridge` 服务监听 `8799`

-`api` 使用 `AGENTS_BRIDGE_BASE_URL=http://agents-bridge:8799`

-`AGENTS_BRIDGE_AUTOSTART=0`（避免重复拉起 bridge 进程）

Redis 也可以通过 `credit-worker` profile 一并启动：

```bash

docker-compose--profilecredit-workerup--build

```

如果要使用 Redis 支撑手机验证码 / worker，请设置：

-`REDIS_URL=redis://redis:6379`（compose 网络内）

-`REDIS_URL=redis://127.0.0.1:6379`（宿主机本地运行）

然后配置 API 环境变量：

-`AGENTS_BRIDGE_BASE_URL=http://127.0.0.1:8799`

- 可选：`AGENTS_BRIDGE_TOKEN=...`（如果你以 `agents serve --token ...` 启动）
- 可选：`AGENTS_BRIDGE_TIMEOUT_MS=600000`（当 agent 会生成多资产时可适当调大）
- 可选：`AGENTS_SKILLS_DIR=skills`（使用仓库内置 skills，包括 `tapcanvas*`）

## AI 对话架构（当前）

本节描述 TapCanvas 当前真实使用的 AI 对话链路，覆盖 `apps/hono-api`、`apps/agents-cli`、`apps/web` 三部分的实际实现，不是理想化设计图。

范围说明：

- 下方流程图描述的是可观察控制流、路由决策、上下文装配、工具约束和响应分支。
- 不公开模型私有思维链（chain-of-thought）；这里只记录系统决策和可验证的运行时分支。

### 端到端请求路径

1. 前端通过 `apps/web` 中的 `runPublicTask(...)` 发起聊天请求。
2. API 入口 `POST /public/chat` 在 `apps/hono-api/src/modules/apiKey/apiKey.routes.ts` 中做请求归一化。

3.`runPublicTask(...)` 负责解析 vendor 路由。

4. 如果 `vendor=agents`，或者 `vendor=auto` 最终命中 `agents`，则进入 `runAgentsBridgeChatTask(...)`。

5.`runAgentsBridgeChatTask(...)` 负责组装最终 prompt、system prompt、工具白名单、本地资源策略、memory context 和 trace 元数据。

6. API 将请求转发给 `apps/agents-cli` 提供的 `/chat` HTTP 服务。

7.`agents-cli` 构建 workspace context、persona directives、可选 workflow knowledge hint，然后进入 agent loop。

8. API 对响应做 `outputMode` 分类，写 execution trace，并把清洗后的结果返回前端。

### 端到端流程图

```mermaid

flowchart TD

    A[用户在 Web 聊天框输入] --> B[apps/web runPublicTask]

    B --> C[POST /public/chat]

    C --> D[apiKey.routes 归一化请求]

    D --> E[runPublicTask 解析 vendor]

    E -->|vendor=agents 或 auto命中agents| F[runAgentsBridgeChatTask]

    E -->|其他 vendor| Z[其他厂商任务链路]


    F --> G[归一化 extras: chatContext projectId flowId nodeId planOnly]

    G --> H[组装 final prompt]

    H --> I[组装 system prompt]

    I --> J[工具约束 + 本地资源策略 + memory context]

    J --> K[POST agents-cli /chat]


    K --> L[agents-cli 解析 workspace context]

    L --> M[加载 Persona Context: IDENTITY.md + SOUL.md]

    L --> N[加载 Workspace Context: AGENTS.md / PROJECT.md / RULES.md / .tapcanvas/context]

    M --> O[构建 persona directives]

    N --> P[可选 workflow-knowledge 选择]

    O --> Q[agent loop: plan -> tools -> report]

    P --> Q


    Q --> R[agent 返回 text / tool trace / assets]

    R --> S[api 分类 outputMode]

    S --> T[text_only]

    S --> U[plan_only]

    S --> V[plan_with_assets]

    S --> W[direct_assets]


    T --> X[写 execution trace 并返回响应]

    U --> X

    V --> X

    W --> X

```

### 运行时组件

- 前端聊天 UI：

`apps/web/src/ui/chat/AiChatDialog.tsx`

- 公共聊天 / API 任务分发：

`apps/hono-api/src/modules/apiKey/apiKey.routes.ts`

- Agents bridge 编排入口：

`apps/hono-api/src/modules/task/task.agents-bridge.ts`

- 公共聊天 system/persona prompt 组装：

`apps/hono-api/src/modules/task/chat-system-prompt.ts`

`apps/hono-api/src/modules/task/chat-persona-prompt.ts`

- Agent loop 与 workspace context：

`apps/agents-cli/src/core/agent-loop.ts`

`apps/agents-cli/src/core/workspace-context/assembler.ts`

`apps/agents-cli/src/core/workspace-context/persona.ts`

### System prompt 组装顺序

后端 system prompt 当前按以下顺序叠加：

1.`/public/chat` 调用侧传入的 caller/system instructions

2. Public chat assistant prompt
3. Persona 文件：

`apps/agents-cli/IDENTITY.md`

`apps/agents-cli/SOUL.md`

4. 当存在 canvas 上下文时注入 Canvas workflow prompt
5. 当存在 `canvasNodeId` 时注入 selected-node guidance
6. Generation gate / plan-only / repo-knowledge / layout-only guards
7. project-scoped 本地文本访问的 local resource guard
8. Memory context summary
9. Final output protocol

当前关键行为：

- Persona 不是可有可无的附加项。只要运行时能读到 `IDENTITY.md` 和 `SOUL.md`，它们就会被注入 assistant system prompt，并进入 `agents-cli` 的 workspace context。
- 在 Docker 里，`api` 和 `agents-bridge` 两个服务都必须能看见 `/workspace/apps/agents-cli/IDENTITY.md` 和 `/workspace/apps/agents-cli/SOUL.md`。
- 当前代码已经显式搜索 `/workspace/apps/agents-cli`，避免容器运行时丢失 persona。

### Workspace context 与 persona 加载

`agents-cli` 当前使用两层相关但不同语义的上下文：

-`Workspace Context`

  项目/工作区事实，例如 `AGENTS.md`、`PROJECT.md`、`RULES.md`、`.tapcanvas/context/*.md`、repo knowledge 根目录、project-scoped resources。

-`Persona Context`

`IDENTITY.md` 与 `SOUL.md`。

当前规则：

- Persona 文件会优先于 project context 预算加载，因此 project context 不会把 `SOUL.md` 挤掉。
- Prompt 渲染会显式区分 `Persona Context` 和 `Workspace Context`。

-`buildPersonaPromptFragment(...)` 会注入持续生效的人格指令，例如：

`IDENTITY.md 定义你是谁；SOUL.md 定义你如何判断、如何行动。`

- 即使 `AGENTS_WORKSPACE_ROOT=/workspace`，`agents-cli` 现在也会额外检查当前工作目录，因此进程运行在 `/workspace/apps/agents-cli` 时仍能加载 persona。

### 当前分支模型

当前普通用户聊天不使用一个单独的本地硬编码 route switch。后端是在执行后再把结果分类为 4 种 `outputMode`：

-`text_only`

  纯文本回答，没有 canvas plan，也没有生成资产。

-`plan_only`

  返回了合法 `<tapcanvas_canvas_plan>`，但没有生成任何资产。

-`plan_with_assets`

  返回了合法 canvas plan，并且节点 config 里带有生成后的资产 URL。

-`direct_assets`

  直接产出了资产，但没有返回 canvas plan payload。

当前分类逻辑在 `task.agents-bridge.ts`。

### 分支流程图

```mermaid

flowchart TD

    A[用户消息] --> B{是否走 agents bridge?}

    B -->|否| Z[非 agents vendor 链路]

    B -->|是| C[runAgentsBridgeChatTask]


    C --> D{是否 public request?}

    D -->|是| E[应用 public tool whitelist]

    D -->|否| F[走更宽的内部链路]


    E --> G{planOnly=true?}

    G -->|是| H[移除 generation tools]

    G -->|否| I[保留正常 public tool set]


    H --> J{是否启用 project-scoped 本地文本访问?}

    I --> J

    J -->|是| K[注入 project-data 读取规则]

    J -->|否| L[仅 repo knowledge]


    K --> M[调用 agents-cli]

    L --> M

    F --> M


    M --> N{agent 实际返回了什么?}

    N -->|只有纯文本| O[text_only]

    N -->|只有合法 canvas plan| P[plan_only]

    N -->|合法 canvas plan + asset urls| Q[plan_with_assets]

    N -->|只有 assets| R[direct_assets]


    O --> S[trace: canvas plan not applicable]

    P --> T[trace: plan parsed]

    Q --> U[trace: plan parsed + assets]

    R --> V[trace: direct asset path]

```

### 回答控制流程图

```mermaid

flowchart TD

    A[Agent 准备最终回答] --> B{用户是否在问身份 / 能力 / 协作方式?}

    B -->|是| C[直接回答]

    C --> D[不要暴露 plan_only / outputMode / allowedTools / canvas protocol]


    B -->|否| E{是否有已验证的项目/工具证据?}

    E -->|否| F[明确说明证据缺口]

    E -->|是| G{是否返回了合法 canvas plan?}


    G -->|否| H[纯文本回答或 direct assets]

    G -->|是| I[可以描述可执行的 canvas plan]


    H --> J[未实际创建节点/资产时不得声称已创建]

    I --> K[不得宣称超出已验证结果的执行状态]

```

### 实际请求分支

当前 public AI chat 实际上主要落在以下几类路径：

1. 纯助手问答

   例子：“你是谁”“你能做什么”

   预期结果：`text_only`

   预期行为：直接回答，不暴露 `plan_only`、`allowedTools`、canvas protocol tags 等内部控制字段。
2. 基于项目事实的分析

   例子：“分析这个项目里有哪些书籍素材”

   预期结果：通常是 `text_only`

   预期行为：可能先读取 project/book/material 工具，再只基于已验证事实回答。
3. 画布规划

   例子：“给这一章规划 TapCanvas 画布节点”

   预期结果：`plan_only`

   预期行为：返回合法 `<tapcanvas_canvas_plan>`；如果没有实际生成资产，不得把规划说成已执行。
4. 规划并生成

   例子：“先生成关键帧并把节点放到画布”

   预期结果：`plan_with_assets`

   预期行为：先生成资产，再返回合法 canvas plan，并把资产 URL 回填到 node config。
5. 直接出资产

   例子：不返回 canvas plan、只直接产出资产的生成调用

   预期结果：`direct_assets`

### 工具约束与本地资源策略

`runAgentsBridgeChatTask(...)` 会动态约束可用工具：

- Public 请求会收到受限工具白名单。

-`planOnly=true` 时会移除 draw/video/upload/vision 等 generation tools。

- 如果请求带 JWT 身份并绑定 `canvasProjectId`，后端可能自动开启 project-scoped 本地文本访问。
- project-scoped 本地访问会注入严格的 `project-data` 读取规则，要求：

  先解析 `bookId`

  再读取 `books/<bookId>/index.json`

  再按章节边界读取 chunks

  最后才允许读取大文件 `raw.md`

这套策略是故意收紧的，用来防止 assistant 编造项目事实。

### Workflow knowledge 分支

在主 agent 调用前，`agents-cli` 可能先跑一轮轻量 workflow-knowledge selection。

- 这一轮只做 metadata 匹配。
- 它不直接回答用户问题。
- 如果命中 pack，agent 会收到 hint，后续再按需渐进读取相关 knowledge。

某些 strict/internal routing case 会跳过这一分支，但标准 public chat 路径里它是开启的。

### Trace / diagnostics 模型

每次 agents-bridge chat 都会写 execution trace，内容包括：

- request context
- tool evidence
- response turns
- output mode
- canvas plan diagnostics
- diagnostic flags

当前 trace 关键行为：

-`text_only` 回答会把 canvas-plan diagnostics 标成 `not_applicable_text_only`，而不是误判成 malformed plan failure。

- 前端 diagnostics 会把它渲染成信息状态，而不是 `invalid`。
- “声称已给出画布计划，但没有合法 plan” 这类 flag 只应该用于真实误报，不应该误伤普通能力描述。

### 当前回答约束

当前 prompt policy 明确要求：

- 用户问身份 / 能力 / 协作方式时，应该直接回答

-`plan_only`、`outputMode`、`allowedTools`、`<tapcanvas_canvas_plan>` 这类内部控制字段，不应主动回显给用户，除非用户明确询问内部机制

- 项目进度、节点状态、生成结果，只有在当前轮工具已确认时才能陈述

### Docker 下 persona 正确性的注意事项

对于 `apps/hono-api/docker-compose.yml` 下的 compose 运行：

-`agents-bridge` 运行时：

`working_dir: /workspace/apps/agents-cli`

`AGENTS_WORKSPACE_ROOT: /workspace`

-`api` 运行在 `/app`

- 两个服务都必须仍然能解析到以下 persona 文件：

`/workspace/apps/agents-cli/IDENTITY.md`

`/workspace/apps/agents-cli/SOUL.md`

如果聊天回答从 `我是小T，TapCanvas 的原生 AI 搭档，角色是 AI canvas orchestrator`

退回成泛化的 `AI 创作助手`，第一优先检查项就是：运行中的容器里是否真的能看到这两个文件。

### Pipeline runs API（新增）

-`GET /agents/pipeline/runs?projectId=<id>&limit=30`

-`POST /agents/pipeline/runs`

-`GET /agents/pipeline/runs/:id`

-`PATCH /agents/pipeline/runs/:id/status`

-`POST /agents/pipeline/runs/:id/execute`

## Credits finalizer（自托管 / Redis 队列）

如果你在自有服务器上运行 API，可能需要一个后台循环，即使客户端停止轮询也能完成任务结算。

- 内部接口：`POST /internal/credit-finalizer/run`（需要 `INTERNAL_WORKER_TOKEN`）
- Worker 进程：`pnpm credit-finalizer:worker`

## Prompt evolution 定时任务（自托管 / Redis 队列）

- 内部接口：`POST /internal/prompt-evolution/run`（需要 `INTERNAL_WORKER_TOKEN`）
- 管理端接口（dashboard 按钮）：`POST /stats/prompt-evolution/run`
- Worker 进程：`pnpm prompt-evolution:worker`

常用环境变量：

-`PROMPT_EVOLUTION_CRON`（默认：`0 0 * * *`）

-`PROMPT_EVOLUTION_TZ`（默认：`America/Los_Angeles`）

-`PROMPT_EVOLUTION_SINCE_HOURS`（默认：`24`）

-`PROMPT_EVOLUTION_MIN_SAMPLES`（默认：`30`）

-`PROMPT_EVOLUTION_DRY_RUN`（默认：`0`）

## Commerce 冒烟测试（product / order / wechat-pay）

启动 API（`pnpm dev`）后，执行：

```bash

pnpmsmoke:commerce

```

说明：

- 该测试会验证 `guest -> create product -> create order -> cancel order -> stock rollback` 这一条链路。
- 如果没有配置 WeChat 相关环境变量，测试会期望 `/wechat-pay/native/create` 返回明确的缺失环境变量错误。
