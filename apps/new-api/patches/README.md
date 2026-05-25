# neoSparkMart Data Patches

这个目录用于存放 TapCanvas 自己维护的 `new-api` 生产数据 patch。

作用范围：

- 仅补数据
- 仅按 PostgreSQL 语义编写
- 必须幂等执行
- 不允许建表、删表、删数据、清库或结构迁移

为什么单独放这里：

- `apps/new-api/bin/migration_*.sql` 更接近上游历史迁移，不适合作为 TapCanvas 的长期生产补数据入口
- TapCanvas 这次需要的是“代码更新后，线上可手动执行的一组数据 patch”，而不是把补数据逻辑混进通用 migration

执行顺序：

按 `find /patches -name "*.sql" | sort` 的字典序依次执行，即目录名（日期）→ 文件名（序号）升序。

当前顺序：

1. `2026-04-18/001-seed-vendors-models.sql`
2. `2026-04-18/002-seed-pricing-options.sql`
3. `2026-04-18/003-seed-channels-abilities.sql`
4. `2026-04-20/001-add-gemini-31-pro-preview-gpt-54.sql`

Compose 自动执行：

- `apps/hono-api/docker-compose.yml` 包含一次性 `new-api-patch` service
- 默认会在 `docker-compose up --build` 时递归扫描 `/patches/**/*.sql` 并按路径排序执行
- 全部 patch 成功后，`new-api` 才会启动
- 如需临时关闭，设置 `NEW_API_PATCH_ENABLED=0`

执行原则：

- 只能使用业务键做 upsert，不允许依赖本地自增 id
- 发现无法安全判定的冲突时，应显式失败并人工处理
- 允许重复执行，重复执行后结果必须稳定
- 不允许写入与本次模型真源切换无关的数据

前端 API 配置说明：

- `apps/new-api/web` 通过 `VITE_REACT_APP_SERVER_URL` 配置后端 API 地址
- 同域部署时可以为空，前端会直接请求相对路径 `/api/*`
- 分域部署时必须在构建时显式注入 `VITE_REACT_APP_SERVER_URL=https://<new-api-domain>`
