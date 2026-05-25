# New-API 单轨集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 TapCanvas-pro 中所有与 new-api 相关的代码移植到 TapCanvas，使 hono-api 的 AI 渠道控制逻辑统一走 new-api 单轨。

**Architecture:** TapCanvas-pro 已完成从多渠道直调（grsai/comfly/apimart/yunwu）到 new-api 单轨的迁移。本计划将这些变更逐步同步到 TapCanvas：添加 new-api Docker 服务、复制 new-api-models 模块和 billing/new-api-pricing、替换 task.service.ts（12,612 行 → 4,233 行）、为 agents 注册 LLM 代理路由。

**Tech Stack:** TypeScript / Hono / Prisma / Docker Compose / new-api (Go + Bun)

**Reference:** 所有文件变更均以 `/Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api` 为权威参考源。

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新建 | `src/modules/billing/new-api-pricing.ts` | 从 new-api /api/pricing 拉取定价快照 |
| 新建 | `src/modules/new-api-models/new-api-models.service.ts` | 从 new-api /api/models/list 获取模型列表 |
| 新建 | `src/modules/new-api-models/new-api-models.routes.ts` | 注册 /new-api-models 路由 |
| 新建 | `src/modules/agents/agents-llm-proxy.ts` | agents-cli LLM 代理（计费隔离） |
| 新建 | `src/modules/task/task.kling-motion-control.ts` | Kling 运动控制辅助函数 |
| 新建 | `scripts/sync-new-api-channels.mjs` | 启动时同步 new-api 渠道配置 |
| 新建 | `scripts/sync-new-api-catalog.mjs` | 启动时同步 new-api 模型目录 |
| 替换 | `src/modules/task/task.service.ts` | 用 TapCanvas-pro 版本替换（移除旧多渠道逻辑） |
| 修改 | `src/types.ts` | 添加 `NEW_API_INTERNAL_BASE_URL / TOKEN / SQL_DSN` |
| 修改 | `src/modules/billing/billing.service.ts` | 接入 new-api 定价快照 |
| 修改 | `src/modules/agents/agents.routes.ts` | 注册 LLM proxy 路由 |
| 修改 | `src/app.ts` | 注册 newApiModelsRouter |
| 修改 | `package.json` | 添加 `sync:new-api:channels` / `sync:new-api:catalog` 脚本 |
| 修改 | `docker-compose.yml` | 添加 new-api + new-api-patch 服务，更新 agents-bridge 和 api |

---

## Task 1: 复制 billing/new-api-pricing.ts

**Files:**
- Create: `apps/hono-api/src/modules/billing/new-api-pricing.ts`

- [ ] **Step 1: 复制文件**

```bash
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/billing/new-api-pricing.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/billing/new-api-pricing.ts
```

- [ ] **Step 2: 验证文件存在且内容合理**

```bash
head -30 /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/billing/new-api-pricing.ts
```

Expected: 文件显示 `getNewApiPricingSnapshot` 函数签名。

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/modules/billing/new-api-pricing.ts
git commit -m "feat: add billing/new-api-pricing.ts from TapCanvas-pro"
```

---

## Task 2: 新建 new-api-models 模块

**Files:**
- Create: `apps/hono-api/src/modules/new-api-models/new-api-models.service.ts`
- Create: `apps/hono-api/src/modules/new-api-models/new-api-models.routes.ts`

- [ ] **Step 1: 创建目录并复制文件**

```bash
mkdir -p /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/new-api-models
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/new-api-models/new-api-models.service.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/new-api-models/new-api-models.service.ts
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/new-api-models/new-api-models.routes.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/new-api-models/new-api-models.routes.ts
```

- [ ] **Step 2: 验证**

```bash
grep "export" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/new-api-models/new-api-models.service.ts | head -5
grep "export" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/new-api-models/new-api-models.routes.ts | head -5
```

Expected: `export async function listNewApiModels` 和 `export const newApiModelsRouter`

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/modules/new-api-models/
git commit -m "feat: add new-api-models module from TapCanvas-pro"
```

---

## Task 3: 复制 agents-llm-proxy.ts 和 task.kling-motion-control.ts

**Files:**
- Create: `apps/hono-api/src/modules/agents/agents-llm-proxy.ts`
- Create: `apps/hono-api/src/modules/task/task.kling-motion-control.ts`

- [ ] **Step 1: 复制两个文件**

```bash
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/agents/agents-llm-proxy.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/agents/agents-llm-proxy.ts
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/task/task.kling-motion-control.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/task/task.kling-motion-control.ts
```

- [ ] **Step 2: 验证**

```bash
grep "export" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/agents/agents-llm-proxy.ts | head -5
grep "export" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/task/task.kling-motion-control.ts | head -5
```

Expected: `handleAgentsLlmChatCompletions`, `handleAgentsLlmVideoUnderstand`, `isKlingMotionControlModel` 等函数导出。

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/modules/agents/agents-llm-proxy.ts \
         apps/hono-api/src/modules/task/task.kling-motion-control.ts
git commit -m "feat: add agents-llm-proxy and task.kling-motion-control from TapCanvas-pro"
```

---

## Task 4: 替换 task.service.ts

**Files:**
- Modify: `apps/hono-api/src/modules/task/task.service.ts`

TapCanvas-pro 的版本已移除 grsai/comfly/apimart 直调逻辑，所有 AI 调用统一走 new-api。当前 TapCanvas 版本有 12,612 行，pro 版本有 4,233 行。

- [ ] **Step 1: 备份旧文件并替换**

```bash
cp /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/task/task.service.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/task/task.service.ts.bak
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/task/task.service.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/task/task.service.ts
```

- [ ] **Step 2: 验证文件行数符合预期**

```bash
wc -l /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/task/task.service.ts
```

Expected: ~4233 行

- [ ] **Step 3: 尝试 TypeScript 编译以捕获缺失依赖**

```bash
cd /Users/libiqiang/workspace/TapCanvas/apps/hono-api
pnpm build 2>&1 | head -50
```

如果报缺少导入，记录具体错误（后续 Task 会修复）。如果顺利通过则直接 Commit。

- [ ] **Step 4: 删除备份并 Commit**

```bash
rm /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/task/task.service.ts.bak
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/modules/task/task.service.ts
git commit -m "feat: replace task.service.ts with TapCanvas-pro new-api single-track version"
```

---

## Task 5: 更新 types.ts — 添加 NEW_API 环境变量

**Files:**
- Modify: `apps/hono-api/src/types.ts`

需要在 `WorkerEnv` interface 中添加三个可选字段。

- [ ] **Step 1: 定位插入点**

```bash
grep -n "AGENTS_BRIDGE_TOKEN\|TAPCANVAS_API_BASE_URL" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/types.ts
```

Expected: 显示第 57、61 行附近。

- [ ] **Step 2: 在 `AGENTS_BRIDGE_TIMEOUT_MS` 之后添加 NEW_API 字段**

在 `AGENTS_BRIDGE_TIMEOUT_MS?: string;` 这行之后插入：

```typescript
	NEW_API_INTERNAL_BASE_URL?: string;
	NEW_API_INTERNAL_TOKEN?: string;
	NEW_API_SQL_DSN?: string;
```

- [ ] **Step 3: 验证**

```bash
grep "NEW_API" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/types.ts
```

Expected: 三行 `NEW_API_INTERNAL_BASE_URL`, `NEW_API_INTERNAL_TOKEN`, `NEW_API_SQL_DSN`

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/types.ts
git commit -m "feat: add NEW_API env vars to WorkerEnv types"
```

---

## Task 6: 更新 billing.service.ts — 接入 new-api 定价

**Files:**
- Modify: `apps/hono-api/src/modules/billing/billing.service.ts`

从 TapCanvas-pro diff 来看，变更包括：添加两个 import、新增两个辅助函数、修改 `resolveTeamCreditsCostForTask` 内部逻辑（使用 new-api 定价快照作为来源）。直接用 pro 版本替换。

- [ ] **Step 1: 替换文件**

```bash
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/billing/billing.service.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/billing/billing.service.ts
```

- [ ] **Step 2: 验证关键函数存在**

```bash
grep "getNewApiPricingSnapshot\|resolveSyntheticImageSpecCostFromBase\|resolveDirectNewApiCreditsFallback" \
  /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/billing/billing.service.ts
```

Expected: 三个函数名均出现在文件中。

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/modules/billing/billing.service.ts
git commit -m "feat: integrate new-api pricing snapshot into billing.service"
```

---

## Task 7: 更新 agents.routes.ts — 注册 LLM proxy 路由

**Files:**
- Modify: `apps/hono-api/src/modules/agents/agents.routes.ts`

新增对 `/llm/v1/chat/completions` 和 `/llm/v1/video-understand` 的处理。

- [ ] **Step 1: 在 agents.routes.ts 中添加 import**

在文件 import 区块末尾（约第 42 行 import 列表处）添加：

```typescript
import { handleAgentsLlmChatCompletions, handleAgentsLlmVideoUnderstand } from "./agents-llm-proxy";
```

- [ ] **Step 2: 在路由注册区末尾添加两条路由**

在最后一条 `agentsRouter.xxx` 之后追加：

```typescript
// LLM proxy: agents-cli uses this endpoint with the user's API key so that
// each inference call goes through hono-api's credit-deduction layer.
agentsRouter.post("/llm/v1/chat/completions", (c) =>
	handleAgentsLlmChatCompletions(c as any),
);

agentsRouter.post("/llm/v1/video-understand", (c) =>
	handleAgentsLlmVideoUnderstand(c as any),
);
```

或者直接用 pro 版本替换整个文件（最安全）：

```bash
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/src/modules/agents/agents.routes.ts \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/agents/agents.routes.ts
```

- [ ] **Step 3: 验证路由已注册**

```bash
grep "llm/v1\|handleAgentsLlm" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/modules/agents/agents.routes.ts
```

Expected: 两条路由和两个 handler 引用。

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/modules/agents/agents.routes.ts
git commit -m "feat: register LLM proxy routes in agents.routes"
```

---

## Task 8: 更新 app.ts — 注册 new-api-models 路由

**Files:**
- Modify: `apps/hono-api/src/app.ts`

- [ ] **Step 1: 添加 import**

在 app.ts 的 import 区块中加入（参考 pro 版本第 11 行）：

```typescript
import { newApiModelsRouter } from "./modules/new-api-models/new-api-models.routes";
```

- [ ] **Step 2: 注册路由**

在其他路由注册后面（`app.route("/model"` 附近）添加：

```typescript
app.route("/new-api-models", newApiModelsRouter);
```

- [ ] **Step 3: 验证**

```bash
grep "new-api-models\|newApiModelsRouter" /Users/libiqiang/workspace/TapCanvas/apps/hono-api/src/app.ts
```

Expected: 两行：import 和 route 注册。

- [ ] **Step 4: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/src/app.ts
git commit -m "feat: register new-api-models router in app"
```

---

## Task 9: 更新 package.json — 添加 sync 脚本

**Files:**
- Modify: `apps/hono-api/package.json`

- [ ] **Step 1: 在 scripts 中添加两个 sync 命令**

在 `"db:pg:seed-patches"` 之后添加：

```json
"sync:new-api:channels": "node scripts/sync-new-api-channels.mjs",
"sync:new-api:catalog": "node scripts/sync-new-api-catalog.mjs",
```

- [ ] **Step 2: 验证**

```bash
node -e "const p = require('./apps/hono-api/package.json'); console.log(p.scripts['sync:new-api:channels'], p.scripts['sync:new-api:catalog'])"
```

Expected: 两个脚本路径均输出。

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/package.json
git commit -m "feat: add sync:new-api:channels and sync:new-api:catalog scripts"
```

---

## Task 10: 复制 sync 脚本

**Files:**
- Create: `apps/hono-api/scripts/sync-new-api-channels.mjs`
- Create: `apps/hono-api/scripts/sync-new-api-catalog.mjs`

- [ ] **Step 1: 复制两个脚本**

```bash
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/scripts/sync-new-api-channels.mjs \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/scripts/sync-new-api-channels.mjs
cp /Users/libiqiang/workspace/TapCanvas-pro/apps/hono-api/scripts/sync-new-api-catalog.mjs \
   /Users/libiqiang/workspace/TapCanvas/apps/hono-api/scripts/sync-new-api-catalog.mjs
```

- [ ] **Step 2: 验证**

```bash
head -5 /Users/libiqiang/workspace/TapCanvas/apps/hono-api/scripts/sync-new-api-channels.mjs
head -5 /Users/libiqiang/workspace/TapCanvas/apps/hono-api/scripts/sync-new-api-catalog.mjs
```

Expected: 两个文件均以 `#!/usr/bin/env node` 开头。

- [ ] **Step 3: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/scripts/sync-new-api-channels.mjs \
         apps/hono-api/scripts/sync-new-api-catalog.mjs
git commit -m "feat: add sync-new-api-channels and sync-new-api-catalog scripts"
```

---

## Task 11: 更新 docker-compose.yml

**Files:**
- Modify: `apps/hono-api/docker-compose.yml`

这是变更最大的文件，需要：
1. 添加 `new-api` 服务（端口 4455，从 `../new-api` 构建）
2. 添加 `new-api-patch` 服务（负责 new-api DB 迁移）
3. 更新 `agents-bridge.environment.AGENTS_API_BASE_URL` → `http://new-api:4455/v1`
4. 更新 `api.environment` 中添加 NEW_API 相关变量
5. 更新 `api.depends_on` 加入 `new-api` 和 `new-api-patch`
6. 更新 `api.command` 加入 `pnpm sync:new-api:channels && pnpm sync:new-api:catalog`
7. 添加 new-api 所需 volumes：`../new-api/data:/data` 和 `../new-api/logs:/app/logs`

- [ ] **Step 1: 更新 agents-bridge 的 AGENTS_API_BASE_URL**

将：
```yaml
      AGENTS_API_BASE_URL: ${AGENTS_API_BASE_URL:-https://right.codes/codex/v1}
```
替换为：
```yaml
      AGENTS_API_BASE_URL: ${AGENTS_API_BASE_URL:-http://new-api:4455/v1}
```

- [ ] **Step 2: 在 api 的 environment 中添加 NEW_API 变量**

在 `api` 服务的 `environment` 区块中（`AGENTS_BRIDGE_BASE_URL` 之后）添加：

```yaml
      NEW_API_INTERNAL_BASE_URL: ${NEW_API_INTERNAL_BASE_URL:-http://new-api:4455}
      NEW_API_INTERNAL_TOKEN: ${NEW_API_INTERNAL_TOKEN:-}
      NEW_API_SQL_DSN: ${NEW_API_SQL_DSN:-postgresql://${POSTGRES_USER:-tapcanvas}:${POSTGRES_PASSWORD:-tapcanvas}@postgres:5432/${NEW_API_POSTGRES_DB:-tapcanvas_new_api}}
```

- [ ] **Step 3: 更新 api.depends_on**

将：
```yaml
    depends_on:
      agents-bridge:
        condition: service_healthy
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
```
替换为：
```yaml
    depends_on:
      agents-bridge:
        condition: service_healthy
      new-api:
        condition: service_healthy
      new-api-patch:
        condition: service_completed_successfully
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
```

- [ ] **Step 4: 更新 api.command，加入 sync 步骤**

在 `api` 服务的 `command` 字符串中，在 `pnpm build && exec node dist/main.js` 之前插入：

```
&& pnpm sync:new-api:channels && pnpm sync:new-api:catalog
```

即完整 command 末尾部分变为：
```
... && pnpm db:pg:seed-patches && pnpm sync:new-api:channels && pnpm sync:new-api:catalog && pnpm build && exec node dist/main.js
```

- [ ] **Step 5: 添加 new-api 服务**

在 `redis:` 服务之前插入以下 `new-api` 服务定义（参考 TapCanvas-pro docker-compose.yml 中的 `new-api` 服务）：

```yaml
  new-api:
    image: ${NEW_API_IMAGE:-tapcanvas/new-api:local}
    restart: unless-stopped
    build:
      context: ../new-api
      dockerfile: Dockerfile
      args:
        DOCKERHUB_REGISTRY: ${DOCKERHUB_REGISTRY:-docker.io}
        BUN_IMAGE: ${NEW_API_BUN_IMAGE:-docker.m.daocloud.io/oven/bun:1}
        GO_IMAGE: ${NEW_API_GO_IMAGE:-docker.m.daocloud.io/library/golang:1.26.1-alpine}
        RUNTIME_IMAGE: ${NEW_API_RUNTIME_IMAGE:-docker.m.daocloud.io/library/debian:bookworm-slim}
        NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmmirror.com}
        GO_PROXY: ${NEW_API_GO_PROXY:-https://goproxy.cn,direct}
        APT_MIRROR: ${APT_MIRROR:-mirrors.aliyun.com}
        SKIP_WEB_BUILD: ${NEW_API_SKIP_WEB_BUILD:-1}
        HTTP_PROXY: ""
        HTTPS_PROXY: ""
        NO_PROXY: ""
        ALL_PROXY: ""
        http_proxy: ""
        https_proxy: ""
        no_proxy: ""
        all_proxy: ""
    ports:
      - "${NEW_API_PORT:-4455}:4455"
    environment:
      PORT: ${NEW_API_INTERNAL_PORT:-4455}
      SQL_DSN: ${NEW_API_SQL_DSN:-postgresql://${POSTGRES_USER:-tapcanvas}:${POSTGRES_PASSWORD:-tapcanvas}@postgres:5432/${NEW_API_POSTGRES_DB:-tapcanvas_new_api}}
      REDIS_CONN_STRING: ${NEW_API_REDIS_CONN_STRING:-redis://redis:6379}
      TZ: ${NEW_API_TZ:-Asia/Shanghai}
      TAPCANVAS_INTERNAL_TOKEN: ${NEW_API_INTERNAL_TOKEN:-}
      ERROR_LOG_ENABLED: ${NEW_API_ERROR_LOG_ENABLED:-true}
      BATCH_UPDATE_ENABLED: ${NEW_API_BATCH_UPDATE_ENABLED:-true}
      GLOBAL_API_RATE_LIMIT_ENABLE: ${NEW_API_GLOBAL_API_RATE_LIMIT_ENABLE:-false}
      GLOBAL_WEB_RATE_LIMIT_ENABLE: ${NEW_API_GLOBAL_WEB_RATE_LIMIT_ENABLE:-false}
      CRITICAL_RATE_LIMIT_ENABLE: ${NEW_API_CRITICAL_RATE_LIMIT_ENABLE:-false}
      SEARCH_RATE_LIMIT_ENABLE: ${NEW_API_SEARCH_RATE_LIMIT_ENABLE:-false}
      NODE_NAME: ${NEW_API_NODE_NAME:-new-api-node-1}
      WEB_DIST_DIR: ${NEW_API_WEB_DIST_DIR:-/runtime/web/dist}
      RELAY_TIMEOUT: ${NEW_API_RELAY_TIMEOUT:-1200}
      HTTP_PROXY: ""
      HTTPS_PROXY: ""
      NO_PROXY: ""
      ALL_PROXY: ""
      http_proxy: ""
      https_proxy: ""
      no_proxy: ""
      all_proxy: ""
      SESSION_SECRET: ${NEW_API_SESSION_SECRET:-}
      CRYPTO_SECRET: ${NEW_API_CRYPTO_SECRET:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    volumes:
      - ../new-api/data:/data
      - ../new-api/logs:/app/logs
      - ../new-api/web/dist:/runtime/web/dist:ro
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://localhost:4455/api/status | grep -o '\"success\":\\s*true' || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
```

- [ ] **Step 6: 添加 new-api-patch 服务**

在 `new-api:` 服务之后插入：

```yaml
  new-api-patch:
    image: ${DOCKERHUB_REGISTRY:-docker.io}/postgres:16-alpine
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
      new-api:
        condition: service_healthy
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD:-tapcanvas}
      NEW_API_PATCH_ENABLED: ${NEW_API_PATCH_ENABLED:-1}
      NEW_API_PATCH_DB_HOST: postgres
      NEW_API_PATCH_DB_PORT: 5432
      NEW_API_PATCH_DB_NAME: ${NEW_API_POSTGRES_DB:-tapcanvas_new_api}
      NEW_API_PATCH_DB_USER: ${POSTGRES_USER:-tapcanvas}
    command: >-
      sh -lc '
      set -eu;
      if [ "$${NEW_API_PATCH_ENABLED:-1}" != "1" ]; then
        echo "new-api patch disabled";
        exit 0;
      fi;
      echo "ensuring new-api database exists: $${NEW_API_PATCH_DB_NAME}";
      if [ "$(psql \
        -h "$${NEW_API_PATCH_DB_HOST}" \
        -p "$${NEW_API_PATCH_DB_PORT}" \
        -U "$${NEW_API_PATCH_DB_USER}" \
        -d postgres \
        -tAc "SELECT 1 FROM pg_database WHERE datname = '\''$${NEW_API_PATCH_DB_NAME}'\''")" != "1" ]; then
        createdb \
          -h "$${NEW_API_PATCH_DB_HOST}" \
          -p "$${NEW_API_PATCH_DB_PORT}" \
          -U "$${NEW_API_PATCH_DB_USER}" \
          "$${NEW_API_PATCH_DB_NAME}";
      fi;
      psql \
        -h "$${NEW_API_PATCH_DB_HOST}" \
        -p "$${NEW_API_PATCH_DB_PORT}" \
        -U "$${NEW_API_PATCH_DB_USER}" \
        -d "$${NEW_API_PATCH_DB_NAME}" \
        -v ON_ERROR_STOP=1 \
        -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());";
      found_patch=0;
      applied=0;
      skipped=0;
      for patch in $(find /patches -name "*.sql" | sort); do
        found_patch=1;
        rel="$${patch#/patches/}";
        already=$(psql \
          -h "$${NEW_API_PATCH_DB_HOST}" \
          -p "$${NEW_API_PATCH_DB_PORT}" \
          -U "$${NEW_API_PATCH_DB_USER}" \
          -d "$${NEW_API_PATCH_DB_NAME}" \
          -tAc "SELECT COUNT(1) FROM schema_migrations WHERE filename = '\''$${rel}'\''");
        if [ "$${already}" = "1" ]; then
          echo "skip (already applied): $${rel}";
          skipped=$(( skipped + 1 ));
          continue;
        fi;
        echo "applying new-api patch: $${patch}";
        psql \
          -h "$${NEW_API_PATCH_DB_HOST}" \
          -p "$${NEW_API_PATCH_DB_PORT}" \
          -U "$${NEW_API_PATCH_DB_USER}" \
          -d "$${NEW_API_PATCH_DB_NAME}" \
          -v ON_ERROR_STOP=1 \
          -f "$${patch}";
        psql \
          -h "$${NEW_API_PATCH_DB_HOST}" \
          -p "$${NEW_API_PATCH_DB_PORT}" \
          -U "$${NEW_API_PATCH_DB_USER}" \
          -d "$${NEW_API_PATCH_DB_NAME}" \
          -c "INSERT INTO schema_migrations (filename) VALUES ('\''$${rel}'\'') ON CONFLICT DO NOTHING;";
        applied=$(( applied + 1 ));
      done;
      if [ "$${found_patch}" = "0" ]; then
        echo "no new-api patch files found under /patches";
        exit 1;
      fi;
      echo "new-api patches done: applied=$${applied} skipped=$${skipped}";
      '
    volumes:
      - ../new-api/patches:/patches:ro
```

- [ ] **Step 7: 验证 YAML 语法**

```bash
cd /Users/libiqiang/workspace/TapCanvas/apps/hono-api
docker compose config --quiet && echo "YAML OK"
```

Expected: `YAML OK`（或无报错）

- [ ] **Step 8: Commit**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add apps/hono-api/docker-compose.yml
git commit -m "feat: add new-api and new-api-patch services to docker-compose"
```

---

## Task 12: 全量编译验证

- [ ] **Step 1: 安装依赖（如有变化）**

```bash
cd /Users/libiqiang/workspace/TapCanvas/apps/hono-api
pnpm install --no-frozen-lockfile 2>&1 | tail -5
```

- [ ] **Step 2: TypeScript 编译**

```bash
cd /Users/libiqiang/workspace/TapCanvas/apps/hono-api
pnpm build 2>&1
```

Expected: 编译成功，无 TypeScript 错误。如有错误，根据错误信息补充缺失的导入或类型定义。

- [ ] **Step 3: 若编译报找不到模块，按错误逐一修复**

常见问题：
- 某个 import 路径不对 → 检查对应文件是否已复制
- 缺少类型 → 对比 TapCanvas-pro 同名文件检查是否有遗漏的辅助类型
- `billing.service.ts` 中引用了 TapCanvas-pro 独有函数 → 检查 diff 后按需补丁

- [ ] **Step 4: Commit 修复（如有）**

```bash
cd /Users/libiqiang/workspace/TapCanvas
git add -p
git commit -m "fix: resolve TypeScript compilation errors after new-api integration"
```

---

## 验证清单

完成所有 Task 后检查：

- [ ] `docker compose config` 无报错
- [ ] `pnpm build` 零 TypeScript 错误
- [ ] `grep "new-api-models" apps/hono-api/src/app.ts` 有输出
- [ ] `grep "llm/v1/chat/completions" apps/hono-api/src/modules/agents/agents.routes.ts` 有输出
- [ ] `grep "NEW_API_INTERNAL_BASE_URL" apps/hono-api/src/types.ts` 有输出
- [ ] `grep "http://new-api:4455/v1" apps/hono-api/docker-compose.yml` 有输出
- [ ] `grep "sync:new-api" apps/hono-api/package.json` 有两行输出
