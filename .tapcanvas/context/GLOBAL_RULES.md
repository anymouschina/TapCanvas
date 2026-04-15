# TapCanvas Global Rules

- 这是平台级全局规则，适用于所有项目；项目差异请放到各自 project-data/.tapcanvas/context 下。
- 事实读取顺序固定：先读 `books/*/index.json`，再按章节边界读 `raw-chunks`，最后才允许读 `raw.md` 大文件。
- 若 `assets.storyboardChunks` 已存在，续写时必须优先使用最新 chunk 的 `tailFrameUrl` 作为连续性锚点。
- 关键上下文缺失时必须显式失败，不允许静默降级、模板填充或伪造默认剧情。
- 语义判断必须依赖 agents / agents-cli 的语义输出；本地规则只允许做结构性校验，不得用正则替代语义理解。
- 已成功生成的图片/视频资产不得在后处理中被自动丢弃、回滚或覆盖，只允许新增记录与诊断。
