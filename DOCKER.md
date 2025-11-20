# TapCanvas Docker 配置指南

## 概述

本项目提供了两种 Docker Compose 配置来支持 TapCanvas 的运行：

1. **docker-compose.yml** - 完整版配置（包含所有可选服务）
2. **docker-compose.minimal.yml** - 最小化配置（仅包含必需服务）

## 服务说明

### 必需服务

- **PostgreSQL (pgvector)**: 主数据库，带向量扩展支持
- **Redis**: 用于 Bull 队列和缓存

### 可选服务

- **Adminer**: 数据库管理界面 (端口 8080)
- **Redis Commander**: Redis 管理界面 (端口 8081)

## 快速开始

### 1. 最小化配置（推荐开发使用）

```bash
# 启动基础服务
docker-compose -f docker-compose.minimal.yml up -d

# 查看服务状态
docker-compose -f docker-compose.minimal.yml ps

# 停止服务
docker-compose -f docker-compose.minimal.yml down
```

### 2. 完整配置（生产环境或完整功能）

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 停止服务
docker-compose down
```

## 环境配置

1. 复制环境配置文件：
```bash
cp .env.docker .env
```

2. 根据需要修改 `.env` 文件中的配置项，特别是：
   - API 密钥
   - 数据库连接字符串
   - 应用相关配置

## 服务访问

启动服务后，可以通过以下地址访问各个服务：

- **主应用**: http://localhost:3001 (API)
- **前端应用**: http://localhost:5173 (Web)
- **Adminer**: http://localhost:8080 (数据库管理)
- **Redis Commander**: http://localhost:8081 (Redis 管理)

## 数据库初始化

首次启动后，需要运行数据库迁移：

```bash
# 进入 API 目录
cd apps/api

# 生成 Prisma 客户端
pnpm prisma:generate

# 运行数据库迁移
pnpm prisma:migrate
```

## 开发工作流

1. 启动 Docker 服务：
```bash
docker-compose -f docker-compose.minimal.yml up -d
```

2. 启动应用服务：
```bash
# API 服务
pnpm dev:api

# Web 服务
pnpm dev:web
```

## 故障排除

### 数据库连接问题

确保 PostgreSQL 容器正常运行：
```bash
docker-compose -f docker-compose.minimal.yml logs db
```

### Redis 连接问题

检查 Redis 容器状态：
```bash
docker-compose -f docker-compose.minimal.yml logs redis
```

### 端口冲突

如果遇到端口冲突，可以修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "5433:5432"  # 将 PostgreSQL 映射到 5433 端口
```

## 生产部署注意事项

1. **安全性**：
   - 修改默认密码
   - 使用强密钥
   - 启用 HTTPS

2. **性能优化**：
   - 配置适当的资源限制
   - 使用持久化存储
   - 配置日志轮转

3. **备份**：
   - 定期备份数据库
   - 备份 Redis 数据（如需要）
   - 备份应用配置

## 扩展服务

如需添加额外服务，可以：

1. 修改 `docker-compose.yml`
2. 添加新的服务定义
3. 更新网络配置
4. 重启服务

更多详细信息请参考各服务的官方文档。