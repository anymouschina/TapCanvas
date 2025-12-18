# TapCanvas Docker 配置指南

## 概述

根目录提供两套 Docker Compose 配置，用于“一键启动”当前 TapCanvas：

- `docker-compose.yml`：Web + Hono API + LangGraph（默认全启动）
- `docker-compose.minimal.yml`：仅 Web + Hono API（不含 LangGraph / 小T）

> 说明：当前主后端为 `apps/hono-api`（Cloudflare Workers + Hono），本地通过 Wrangler + D1 local（SQLite）运行；不再依赖 PostgreSQL/Redis 作为必需组件。

## 快速开始

### 1) 启动（推荐）

```bash
docker compose up -d
```

> 如果你的 Docker 版本没有 `docker compose` 子命令，请使用：`docker-compose up -d`（其余命令同理）。
>
> 默认已将 Docker Hub 镜像前缀切到 `${DOCKERHUB_REGISTRY:-docker.1ms.run}`，用来缓解拉取 `node/redis/postgres` 等镜像时的网络问题；如需回退官方源可执行：
> `DOCKERHUB_REGISTRY=docker.io docker-compose up -d`

访问：

- Web: `http://localhost:5173`
- API: `http://localhost:8788`（也可由 Web 通过 `/api/*` 反向代理访问）

环境变量注入：

- Compose 会通过根目录 `.env.docker` 向容器注入默认环境变量（如 `VITE_API_BASE=/api`、`NPM_REGISTRY`、`DISABLE_PROXY=1`）。
- 你可以直接修改 `.env.docker`，或在启动时覆盖：`VITE_API_BASE=http://localhost:8788 docker-compose up -d`
- LangGraph 默认关闭（`VITE_LANGGRAPH_ENABLED=0`）；如需使用 Overlay，请先启动 profile 并把 `.env.docker` 里 `VITE_LANGGRAPH_ENABLED=1`。
- GitHub 登录默认关闭（`VITE_GITHUB_CLIENT_ID` 为空）；如需启用，需要同时配置前端 `VITE_GITHUB_CLIENT_ID` 与后端 `apps/hono-api/.dev.vars` 中的 `GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET`。

### 2) 启动最小化（显式指定文件）

```bash
docker compose -f docker-compose.minimal.yml up -d
```

### 3) LangGraph（小T）

`docker-compose.yml` 默认会启动 LangGraph，并将 API 暴露在 `http://localhost:8123`（可通过 `VITE_LANGGRAPH_API_URL` 覆盖）。

## 依赖与缓存

- Web/API 容器启动时会通过 `scripts/docker-dev.sh` 自动执行一次 `pnpm install`（默认仅安装 Web+API 及其依赖），并用简单锁避免并发安装；同时通过 volume 持久化 `node_modules` 与 pnpm store，避免与宿主机的 `node_modules` 发生系统/架构不兼容。
- `apps/hono-api/.wrangler` 会被持久化（用于 D1 local / Miniflare 状态）。
- 默认会在容器内使用 `NPM_REGISTRY=https://registry.npmmirror.com` 来安装 `pnpm` 和依赖；如需自定义可在执行时覆盖：`NPM_REGISTRY=https://registry.npmjs.org docker-compose up -d`
- 如果你本机设置了 `HTTP(S)_PROXY/ALL_PROXY` 且指向 `127.0.0.1`，脚本会自动重写为 `host.docker.internal`（避免容器内连不上宿主机代理）。需要完全禁用代理可加：`DISABLE_PROXY=1 docker-compose up -d`
- `api` 启动前会执行一次 `pnpm --filter cloudflare-workers-openapi db:update:local` 初始化 D1 local（`schema.sql` 使用 `CREATE TABLE IF NOT EXISTS`，可重复执行），避免首次启动出现 `no such table`。

如果你之前跑过旧版 Compose，建议先清理一次旧容器/卷再启动：

```bash
docker-compose down -v
docker-compose up -d
```

## 常用命令

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
docker compose down
```
