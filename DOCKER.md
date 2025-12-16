# TapCanvas Docker

完整 Docker 文档已迁移至：`docs/docker.md`

本文件仅补充本次更新重点：「沉浸式创作（小T）」与旧版「AI 助手」的变化说明。

## 沉浸式创作（小T）怎么用

沉浸式创作是一个“在画布里对话 → 自动创建/连接节点 → 直接生成图/视频”的入口（替代旧版 AI 助手）。

1) 启动服务

- 仅 Web + API：
  - `docker compose up -d`
- 需要使用「沉浸式创作（小T）」：额外启动 `langgraph` profile
  - `docker compose --profile langgraph up -d`

2) 配置前端环境变量（如需）

确保 `apps/web/.env` 中包含（示例见 `apps/web/.env.example`）：

- `VITE_API_BASE="http://localhost:8788"`
- `VITE_LANGGRAPH_API_URL="https://ai.beqlee.icu"`（Docker langgraph profile 默认）

3) 打开入口并开始创作

- 打开 `http://localhost:5173`
- 左侧悬浮栏点击「沉浸式创作（小T）」图标
- 选择一个内置流程（角色创建 / 直接生图 / 衍生品）或输入一句话需求，点“发送”
- 系统会在画布内自动创建节点并运行；需要查看步骤时展开「执行过程」即可追溯每一步

## 旧版 AI 助手（已废弃）

旧版“AI 助手”入口已废弃，推荐统一使用「沉浸式创作（小T）」在画布内完成需求 → 生成 → 迭代的闭环。
