# TapCanvas Docker 配置指南

## 概述

根目录提供两套 Docker Compose 配置，用于“一键启动”当前 TapCanvas：

- `docker-compose.yml`：Web + Hono API，并内置可选 LangGraph profile
- `docker-compose.minimal.yml`：仅 Web + Hono API（不含 LangGraph）

> 说明：当前主后端为 `apps/hono-api`（Cloudflare Workers + Hono），本地通过 Wrangler + D1 local（SQLite）运行；不再依赖 PostgreSQL/Redis 作为必需组件。

## 快速开始

### 1) 启动（推荐）

```bash
docker compose up -d
```

> 如果你的 Docker 版本没有 `docker compose` 子命令，请使用：`docker-compose up -d`（其余命令同理）。

访问：

- Web: `http://localhost:5173`
- API: `http://localhost:8788`

### 2) 启动最小化（显式指定文件）

```bash
docker compose -f docker-compose.minimal.yml up -d
```

### 3) 启动 LangGraph（可选）

LangGraph Chat Overlay 相关能力需要额外启动 `langgraph` profile：

```bash
docker compose --profile langgraph up -d
```

默认会把 LangGraph API 暴露在 `https://ai.beqlee.icu`（对应 `apps/web/.env.example` 的 `VITE_LANGGRAPH_API_URL`）。

## 依赖与缓存

- Compose 内部会在 `deps` 服务里执行 `pnpm -w install`（并通过 volume 持久化 `node_modules` 与 pnpm store），避免与宿主机的 `node_modules` 发生系统/架构不兼容。
- `apps/hono-api/.wrangler` 会被持久化（用于 D1 local / Miniflare 状态）。

## 常用命令

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
docker compose down
```
