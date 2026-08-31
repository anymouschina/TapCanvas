# TapCanvas new-api data patch

本目录只保留一个常驻、幂等的部署 patch：

- `2026-08-31/001-bootstrap-lluban-channel-and-models.sql`

它面向空的 new-api PostgreSQL 数据库，一次建立以下完整运行事实：

- `Lluban API` 供应商；
- 由鲁班 `/v1/models`、`/api/models/list`、`/api/pricing` 三个真实接口共同确认的 20 个可执行目录模型：10 个图片、4 个视频、6 个文本/对话模型；
- 唯一的 `lluban-recommended` 共享渠道；
- `default` 分组下的 20 条可执行 ability；
- new-api 结算所需的模型、输出与缓存倍率。

新部署使用产品方明确授权公开分发的免费渠道凭证，因此无需人工粘贴
Key。管理员后续在 new-api 中替换 Key 或修改渠道启停状态后，再次部署
不会覆盖这两个字段。其余结构性字段继续由 patch 收敛到当前单渠道合同。
上游模型检查保持启用，但自动写入渠道能力关闭；新发现的模型必须先补齐
目录元数据与正价格并更新本 patch，才能成为前端可选模型，避免把仅有名称的
未验证路由伪装成可用模型。

## 自动执行

开发与生产 Compose 使用同一条初始化链：

`new-api-db-init -> new-api-schema-init -> new-api-patch -> new-api`

`new-api-patch` 调用
`apps/hono-api/docker/run-new-api-patches.sh`，递归扫描
`/patches/**/*.sql` 并按路径排序执行。当前扫描结果必须恰好只有上述一个
SQL 文件。

## 失败策略

- SQL 使用 PostgreSQL 语义并开启 `ON_ERROR_STOP`；
- schema 不完整、唯一业务键冲突、模型目录不完整或 ability 未启用时直接失败；
- 禁止创建占位渠道、伪造模型或在失败时跳过；
- patch 可重复执行，重复执行后的结果必须稳定；
- TapCanvas 前端仅在渠道被禁用、Key 被清空或没有可执行模型时显示强制配置引导。
