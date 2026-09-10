# HeyRoute 内置渠道

社区版同步自 TapCanvas-pro 的 2026-09-11 渠道配置。所有新增渠道默认停用，Key 为空；没有复制维护者私人凭据，也没有调用其账户进行生成测试。

在渠道列表或编辑窗口点击「申请 API Key」，打开 [项目推广链接](https://heyroute.ai/r/c/ch_iiq2tvtmrc)，注册后填写自己的 Key 并启用所需渠道。注册福利为 $15 额度，领取条件以服务方页面为准。

| 渠道 | 模型 |
| --- | --- |
| heyroute-claude | claude-sonnet-5、claude-opus-5 |
| heyroute-gpt | gpt-5.6-terra、gpt-5.6-sol |
| heyroute-grok | grok-4.6、grok-4.5、composer-2.5 |
| heyroute-gemini | gemini-3.1-pro、gemini-3-flash-preview、gemini-3.1-flash-lite、gemini-3.5/3.6/3.7/3.8-flash |
| heyroute-cn | kimi-k3 |
| heyroute-image | gpt-image-2、flux-klein-2、grok-imagine-image、gemini-3-pro-image-preview、gemini-3.1-flash-image-preview |
| heyroute-video | grok-video、grok-imagine-video、grok-imagine-1.5-video、minimax-h3、minimax-h3-quantized-768p、minimax-h3-original-768p、minimax-h3-original-1080p、minimax-h3-original-cf-2k、seedance-2.5、seedance-2.0、seedance-2.0-fast |

未纳入 Pro 验证记录中不可用的 gpt-5.6-luna，以及未通过完整调用验证的其他 CN 型号。

## 部署与定价

初始化器自动发现 `patches/2026-09-11/004-expand-heyroute-channels.sql`。升级需使用包含本次适配器和计价字段的 new-api 构建，再运行数据补丁。补丁可重复执行：不改已有 Key、启用状态、其他厂商模型元数据或已有全局基础价；刷新这七个渠道的模型映射、协议和采购定价配置。实际数据库执行遵循部署流程，本次开发验证只使用隔离数据库。

配置按 Pro 最新已确认基准同步：每额度成本 ¥0.25，文本与图片采购成本乘 2，视频乘 1.5；两个 Gemini 图片模型采用明确售价 1K ¥0.20、2K ¥0.30、4K ¥0.40。GPT Image 2、Grok Image、Flux 每张分别 ¥0.125、¥0.125、¥0.375。这些是初始化基准，管理员应根据自己的采购条件调整。

文本按所选渠道的输入、输出、缓存读取与缓存写入单价计费；图片按所选渠道规格和实际返回张数计费；视频按渠道分辨率及实际提交时长计费。公开价格接口额外提供 `channel_text_prices`、`channel_image_prices`、`channel_video_prices`。共享文本和视频报价覆盖所有启用渠道的最高规格报价，图片保留共享报价并提供独立渠道报价。

## 协议边界

- 文本采用现有 OpenAI / Anthropic 协议。GPT 与 Grok 的新增模型目录标记 Responses，Gemini 与 Kimi 标记 Chat Completions。
- 图片沿用 Images API，自动将上游图片 SSE 转成标准 JSON，保留 usage 和其他返回字段；单事件限制 64 MiB，保留无图片时的供应商错误。
- 视频采用 `task.heyroute-video`，使用现有异步任务提交、轮询和结果接口。请求使用社区版已有的 `duration`、`resolution`、`aspect_ratio`、`start_frame` / `end_frame`、参考图片/视频/音频字段；可选参数通过 metadata 传入，显式 false 和 0 不丢失。
- 不支持的时长、分辨率及参考视频裁剪参数显式报错。具体可用规格来自渠道 `video_model_params`。编辑模式因缺少可核验的时长计价合同而拒绝。
- 模型列表仍由动态目录提供，不向前端加入固定候选列表；本次不替换社区版 DeepSeek Harness 智能体实现。

## 验证

运行 `go test ./model ./relay/... ./service`，覆盖协议适配、价格解析、视频规格、SSE 与结算回归。SQL 使用独立 PostgreSQL 验证空库初始化和重复执行，并检查已有凭据、状态及全局价格保留。未使用真实 HeyRoute Key 执行付费请求。
