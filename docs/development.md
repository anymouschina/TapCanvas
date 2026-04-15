# TapCanvas 本地开发

## 依赖

- Node.js + pnpm（推荐使用 `corepack`）
- Docker（可选，用于一键启动 web + api）

## 一键启动（Docker）

```bash
docker compose up -d
```

- Web: `http://localhost:5173`
- API: `http://localhost:8788`

也可以用脚本：

```bash
./scripts/dev.sh docker
```

## 本地启动（非 Docker）

```bash
pnpm -w install
pnpm dev:web
pnpm --filter ./apps/hono-api dev
```

或者使用一键脚本（更适合本地最快热更新）：

```bash
./scripts/dev.sh local --install
```

一键启动 Web + API + WebCut：

```bash
./scripts/dev.sh local --install --webcut
```

## 环境变量

- Web（Vite）：参考 `apps/web/.env.example`；启用 GitHub 登录需要在 `apps/web/.env` 或 `apps/web/.env.local` 配置 `VITE_GITHUB_CLIENT_ID`
- API（NestJS/Node）：参考 `apps/hono-api/.env.example`（也可用 `apps/hono-api/.dev.vars`，本地会被自动加载）

提示：使用 `./scripts/dev.sh local` 启动时，如果未配置 `apps/web/.env*` 的 `VITE_GITHUB_CLIENT_ID`，脚本会自动复用 `apps/hono-api` 的 `GITHUB_CLIENT_ID`（优先 `.env`，其次 `.dev.vars`）传给 Web dev server（仅 Client ID，不包含 Secret）。

## 一键部署（Cloudflare）

本仓库的 Web 仍可通过 Cloudflare Wrangler 部署（根目录 `wrangler.*`）。API 已迁移为 NestJS（Node.js），需要通过 Docker/你自己的部署平台部署。

- 注意：Web 的 `vite build` 强制使用 `production` mode，并且会拒绝在 production build 中使用 `localhost/127.0.0.1` 的 `VITE_API_BASE`。部署时请通过 CI 环境变量或本地 `apps/web/.env.production` 提供 `VITE_API_BASE`。

- 本地手动部署：
  - Web：`pnpm deploy`（等同于 `pnpm deploy:web:cf`）
- 自动部署：`git push` 到 `main` 会触发 GitHub Actions（`.github/workflows/cloudflare-deploy.yml`）
  - 需要在仓库 Secrets 配置 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`
