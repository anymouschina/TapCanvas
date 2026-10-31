# TapCanvas Docker 配置指南

## 概述

根目录提供 `docker-compose.yml` 与统一启动脚本，用于一键启动：

- `web`：镜像内构建的 Vite SPA，由 nginx 提供静态服务与同源反代
- `api`：NestJS（Node.js）服务（复用现有 Hono 路由）
- `postgres` / `redis`：持久化与队列
- `new-api`：鲁班 API 模型网关
- `agents-bridge`：Agents 执行桥
- `media-worker` 与后台 Workers：媒体和异步任务执行

API 只使用 PostgreSQL；SQLite 仅保留为显式迁移工具的来源格式。

## 快速开始

### 0) 一键部署（推荐，面向使用者）

根目录的 `deploy.sh`（macOS / Linux）和 `deploy.ps1` / `deploy.cmd`（Windows）会自动安装缺失的 Docker 环境、获取源码、生成私有配置与默认管理员账号，并拉取预构建镜像 `docker.io/beqlee/tapcanvas-{new-api,agents-bridge,api,web,media-worker}:latest` 后启动；某个镜像拉取失败时只对该服务回退到本地构建。用法见 [README 快速开始](../README.md#快速开始)。

```bash
bash deploy.sh            # 安装并启动
bash deploy.sh info       # 显示访问地址与默认账号
bash deploy.sh update     # 更新源码并重新拉取镜像
```

镜像由维护者通过 `scripts/release-images.sh` 发布：脚本从 `git archive` 导出的已跟踪文件构建 amd64 + arm64 镜像，未跟踪的 `.env`、`secrets/`、`cert/` 等本地文件不会进入公开镜像。

```bash
docker login
./scripts/release-images.sh               # 构建并推送全部镜像（latest + 提交短哈希）
./scripts/release-images.sh api web       # 只发布部分服务
```

`deploy.sh` 把镜像名写入 `apps/hono-api/.env` 的 `TAPCANVAS_*_IMAGE` / `NEW_API_IMAGE`；删除这些行即恢复使用 `tapcanvas/*:local` 本地构建镜像。

### 1) 从源码构建启动（开发者）

```bash
./scripts/dev.sh docker
```

脚本自动识别 `docker compose` 与 `docker-compose`。全新克隆没有 `apps/hono-api/.env` 时，脚本通过 OpenSSL 生成数据库、JWT、内部 Worker、Agents Bridge 和鲁班 API 所需的强随机密钥；值只写入权限为 `600` 的本地 `.env`，不会打印。如果文件已经存在，脚本只追加缺失的启动项，不覆盖任何现有值，因此已有模型供应商与 lluban 配置会保留。

默认从 Docker Hub 拉取基础镜像，并在镜像内按照锁文件安装 Node、Bun 与 Go 依赖。应用镜像会逐个构建，避免 Vite、Bun、Node 和 Go 冷构建同时抢占 Docker 内存。需要切换镜像代理时，在 `.env` 中显式配置对应镜像变量。需要完全忽略构建缓存并重新拉取基础镜像时使用：

```bash
./scripts/dev.sh docker --fresh-build
```

访问：

- Web: `http://localhost:5175`
- API: `http://localhost:8788`（也可由 Web 通过 `/api/*` 反向代理访问）
- 鲁班 API: `http://localhost:4455`

环境变量注入：

- Compose 使用 `apps/hono-api/.env` 做变量插值和容器运行时注入。不要把该文件提交到 Git。
- Web 镜像默认写入同源 `VITE_API_BASE=/api`，无需为本地容器写宿主地址。
- 直接调用 Compose 时必须显式传入同一环境文件。推荐使用启动脚本，它同时避免漏传环境文件和多个大镜像并行冷构建。

## 依赖与缓存

- Web 和鲁班 API 前端在镜像构建阶段完成依赖安装与构建，不读取宿主 `node_modules` 或 `dist`。
- API 与 Agents Bridge 使用独立命名卷缓存容器内依赖；首次启动严格按各自锁文件安装，锁文件与清单不一致会显式失败。
- 所有构建上下文都排除 `.env*`、宿主依赖目录和运行数据，避免密钥进入 Docker 构建器或宿主状态污染镜像。
- Compose 显式清空容器内的宿主代理变量，避免 `127.0.0.1` 代理地址在容器中指向错误目标。

清除数据卷会删除数据库与运行数据，必须先确认确实不再需要。普通重建不应使用 `down -v`；使用 `./scripts/dev.sh docker --fresh-build` 即可在保留数据的前提下做无缓存镜像构建。

## 常用命令

```bash
docker-compose --env-file apps/hono-api/.env ps
docker-compose --env-file apps/hono-api/.env logs -f api
docker-compose --env-file apps/hono-api/.env logs -f web
./scripts/dev.sh docker-down
```
