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

## 本地启动（非 Docker）

```bash
pnpm -w install
pnpm dev:web
pnpm --filter ./apps/hono-api dev
```

## 环境变量

- Web（Vite）：参考 `apps/web/.env.example`
- API（Wrangler）：参考 `apps/hono-api/wrangler.example.jsonc`

