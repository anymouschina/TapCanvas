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

也可以用脚本（可选 LangGraph profile）：

```bash
./scripts/dev.sh docker
./scripts/dev.sh docker --langgraph
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

## 环境变量

- Web（Vite）：参考 `apps/web/.env.example`；启用 GitHub 登录需要在 `apps/web/.env` 或 `apps/web/.env.local` 配置 `VITE_GITHUB_CLIENT_ID`
- API（Wrangler）：参考 `apps/hono-api/wrangler.example.jsonc`
- API 本地开发变量推荐放在 `apps/hono-api/.dev.vars`（Wrangler 会自动读取）。

提示：使用 `./scripts/dev.sh local` 启动时，如果未配置 `apps/web/.env*` 的 `VITE_GITHUB_CLIENT_ID`，脚本会自动复用 `apps/hono-api/.dev.vars` 里的 `GITHUB_CLIENT_ID` 传给 Web dev server（仅 Client ID，不包含 Secret）。
