# TapCanvas 本地开发

## 依赖

- Node.js + pnpm（推荐使用 `corepack`）
- Docker（可选；当前不作为默认开发方式推荐）

## 本地启动（推荐）

```bash
pnpm -w install

cd apps/hono-api
npm run dev
```

新开一个终端：

```bash
cd apps/web
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:8788`
- 默认推荐直接在 `apps/hono-api` 与 `apps/web` 目录内开发，热更新路径更直接
- `docker-compose` 暂时只保留为可选方案，不再作为默认入口

或者使用仓库根目录脚本：

```bash
pnpm dev:web
pnpm dev:api
```

## 一键脚本（可选）

更适合希望一次拉起多个服务的场景：

```bash
./scripts/dev.sh docker
./scripts/dev.sh docker --langgraph
```

本地模式（更适合热更新）：

```bash
./scripts/dev.sh local --install
```

一键启动“全部”（web + api + webcut + 沉浸式创作/AI backend），并尽量保持热更新：

```bash
./scripts/dev.sh local --install --all
```

如果你希望本地 dev 也启用「沉浸式创作（小T）」：它依赖 LangGraph 服务。`./scripts/dev.sh` 会优先启动 `apps/ai-fullstack/backend` 的本地 LangGraph dev（可热更新）；如果本地环境不可用则回退到 docker compose profile `langgraph`。

```bash
./scripts/dev.sh local --install --langgraph
```

## Docker（可选，暂不推荐）

如果你需要隔离环境、验证 compose 配置，或临时补齐某些容器化依赖，再使用 Docker：

```bash
docker compose up -d
```

- Web: `http://localhost:5173`
- API: `http://localhost:8788`
- 详细说明见 [Docker 指南](docker.md)

## 环境变量

- Web（Vite）：参考 `apps/web/.env.example`；启用 GitHub 登录需要在 `apps/web/.env` 或 `apps/web/.env.local` 配置 `VITE_GITHUB_CLIENT_ID`
- API（Wrangler）：参考 `apps/hono-api/wrangler.example.jsonc`
- API 本地开发变量推荐放在 `apps/hono-api/.dev.vars`（Wrangler 会自动读取）。

提示：使用 `./scripts/dev.sh local` 启动时，如果未配置 `apps/web/.env*` 的 `VITE_GITHUB_CLIENT_ID`，脚本会自动复用 `apps/hono-api/.dev.vars` 里的 `GITHUB_CLIENT_ID` 传给 Web dev server（仅 Client ID，不包含 Secret）。

## 一键部署（Cloudflare）

本仓库包含两个 Worker（`apps/hono-api`、`apps/ai-fullstack/backend`）以及 Web 部署（根目录 `wrangler.*`）。

- 注意：Web 的 `vite build` 强制使用 `production` mode，并且会拒绝在 production build 中使用 `localhost/127.0.0.1` 的 `VITE_API_BASE`。部署时请通过 CI 环境变量或本地 `apps/web/.env.production` 提供 `VITE_API_BASE`（以及可选的 `VITE_LANGGRAPH_*`）。

- 本地手动部署：
  - 全部：`pnpm deploy`
  - 仅 API：`pnpm deploy:api`
  - 仅 AI Backend：`pnpm deploy:ai-backend`
- 自动部署：`git push` 到 `main` 会触发 GitHub Actions（`.github/workflows/cloudflare-deploy.yml`）
  - 需要在仓库 Secrets 配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`
