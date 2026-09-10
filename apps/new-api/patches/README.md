# TapCanvas new-api data patch

本目录保留以下常驻、幂等的 PostgreSQL 部署 patch：

- `2026-08-31/001-bootstrap-lluban-channel-and-models.sql`
- `2026-09-02/003-add-heyroute-image-channel.sql`

鲁班初始化 patch 面向空的 new-api PostgreSQL 数据库，一次建立以下完整运行事实：

- `Lluban API` 供应商；
- 由鲁班 `/v1/models`、`/api/models/list`、`/api/pricing` 三个真实接口共同确认的 20 个可执行目录模型：10 个图片、4 个视频、6 个文本/对话模型；
- 唯一的 `lluban-recommended` 共享渠道；
- `default` 分组下的 20 条可执行 ability；
- new-api 结算所需的模型、输出与缓存倍率。

新部署使用产品方明确授权公开分发的免费渠道凭证，因此无需人工粘贴
Key。管理员后续在 new-api 中替换 Key 或修改渠道启停状态后，再次部署
不会覆盖这两个字段。其余鲁班结构性字段继续由该 patch 维护。
上游模型检查保持启用，但自动写入渠道能力关闭；新发现的模型必须先补齐
目录元数据与正价格并更新本 patch，才能成为前端可选模型，避免把仅有名称的
未验证路由伪装成可用模型。

## 自动执行

开发与生产 Compose 使用同一条初始化链：

`new-api-db-init -> new-api-schema-init -> new-api-patch -> new-api`

`new-api-patch` 调用
`apps/hono-api/docker/run-new-api-patches.sh`，递归扫描
`/patches/**/*.sql` 并按路径排序执行。HeyRoute patch 在鲁班模型目录初始化后执行。

## 失败策略

- SQL 使用 PostgreSQL 语义并开启 `ON_ERROR_STOP`；
- schema 不完整、唯一业务键冲突、模型目录不完整或 ability 启停状态与渠道配置不一致时直接失败；
- 未配置凭据的预置渠道必须停用，其 abilities 也必须禁用；禁止伪造可执行模型或在失败时跳过；
- patch 可重复执行，重复执行后的结果必须稳定；
- TapCanvas 前端仅在渠道被禁用、Key 被清空或没有可执行模型时显示强制配置引导。

## HeyRoute 预置图片渠道

同步自 TapCanvas-pro 的 `heyroute-image` 渠道，基地址为 `https://heyroute.ai`，使用 OpenAI Images 协议，复用已有模型与定价目录：

- `gpt-image-2` 原名转发；
- `gemini-3.1-flash-image-preview` 映射为 `gemini-3.1-flash-image`；
- `gemini-3-pro-image-preview` 映射为 `gemini-3-pro-image`。

渠道首次创建时 `key = ''`、`status = 2`，abilities 同步禁用。管理员在渠道列表或编辑窗口点击“申请 API Key”，打开 [HeyRoute 推广注册链接](https://heyroute.ai/r/c/ch_iiq2tvtmrc)，领取注册 $15 额度后填写自己的 Key 并启用渠道。活动条件以 HeyRoute 为准。重复执行保留已有 Key 与启停状态；SQL 不读取环境变量或 Pro 数据库，不包含私人凭据。该文件是现有 Compose PostgreSQL 部署链的数据补丁，不是 new-api 跨数据库 schema migration。

OpenAI 图片响应层同步支持 HeyRoute 返回的 SSE 完成事件，将真实图片结果转换为 Images API JSON；没有图片结果时显式报错。此预置 SQL 只包含 Pro 中实际定义的三款图片模型；对话模型需管理员根据实际账户与模型协议单独配置。
