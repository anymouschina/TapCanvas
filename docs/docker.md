# TapCanvas Docker 配置指南

## 概述

根目录提供 `docker-compose.yml`，用于一键启动：

- `web`：Vite dev server
- `api`：NestJS（Node.js）服务（复用现有 Hono 路由）

API 本地默认使用 SQLite（`TAPCANVAS_DB_PATH`，默认 `.data/tapcanvas.sqlite`）。

## 快速开始

### 1) 启动（推荐）

```bash
docker compose up -d
```

> 如果你的 Docker 版本没有 `docker compose` 子命令，请使用：`docker-compose up -d`（其余命令同理）。
>
> 默认使用 `${DOCKERHUB_REGISTRY:-docker.io}` 拉取 `node/redis/postgres` 等 Docker Hub 镜像；如需切换到你自己的镜像代理，可在启动时覆盖，例如：
> `DOCKERHUB_REGISTRY=<your-mirror> docker-compose up -d`

访问：

- Web: `http://localhost:5173`
- API: `http://localhost:8788`（也可由 Web 通过 `/api/*` 反向代理访问）

环境变量注入：

- Compose 会通过根目录 `.env.docker` 向容器注入默认环境变量（如 `VITE_API_BASE=/api`、`NPM_REGISTRY`、`DISABLE_PROXY=1`）。
- 你可以直接修改 `.env.docker`，或在启动时覆盖：`VITE_API_BASE=http://localhost:8788 docker-compose up -d`

## 依赖与缓存

- Web/API 容器启动时会通过 `scripts/docker-dev.sh` 自动执行一次 `pnpm install`（默认仅安装 Web+API 及其依赖），并用简单锁避免并发安装；同时通过 volume 持久化 `node_modules` 与 pnpm store，避免与宿主机的 `node_modules` 发生系统/架构不兼容。
- 默认会在容器内使用 `NPM_REGISTRY=https://registry.npmmirror.com` 来安装 `pnpm` 和依赖；如需自定义可在执行时覆盖：`NPM_REGISTRY=https://registry.npmjs.org docker-compose up -d`
- 如果你本机设置了 `HTTP(S)_PROXY/ALL_PROXY` 且指向 `127.0.0.1`，脚本会自动重写为 `host.docker.internal`（避免容器内连不上宿主机代理）。需要完全禁用代理可加：`DISABLE_PROXY=1 docker-compose up -d`

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
