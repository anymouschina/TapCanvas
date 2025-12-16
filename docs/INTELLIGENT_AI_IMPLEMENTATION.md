# 🧠 TapCanvas AI / 工具契约与扩展指南（当前架构）

本文档描述 TapCanvas 当前（`apps/web` + `apps/hono-api`）的 AI 相关模块、工具契约与扩展方式，用于避免文档与实现脱节。

## 项目模块一览

- `apps/web`：前端画布（Vite + React + Mantine + React Flow）
- `apps/hono-api`：后端 API（Cloudflare Workers + Hono + Wrangler dev，本地 D1/SQLite）
- `packages/schemas`：共享 schema / zod（如有）

## AI 工具契约（最重要）

后端给 LLM 暴露的“工具列表/参数说明/节点能力文档”集中维护在：

- `apps/hono-api/src/modules/ai/tool-schemas.ts`

约束原则：

- `canvasToolSchemas` 里声明的 tool，前端必须有真实可调用能力（不要写“规划中的能力”）。
- 当你新增/修改前端画布 AI 能力（新 node kind、新 tool name、参数变化、执行语义变化）时，必须同步更新该文件中的 tool schema 与 `canvasNodeSpecs`（以及必要的 SYSTEM_PROMPT/常量）。

## LangGraph（可选）

前端存在 LangGraph Chat Overlay（流式对话 + tool result）相关逻辑；后端只存储「project → threadId」映射。

- Web 端 API base：`apps/web/src/api/server.ts`（默认 `VITE_API_BASE`）
- Hono API 路由：`apps/hono-api/src/modules/ai/ai.routes.ts`（`/ai/langgraph/...`）

如需完整启动 LangGraph assistant，可用根目录 `docker-compose.yml` 的 `langgraph` profile（详见 `docs/docker.md`）。

## 新增一个“可被 AI 调用”的画布能力（建议流程）

1. 前端实现：在画布侧增加对应 handler（确保能在 UI 上复现/验证）。
2. 后端同步：在 `apps/hono-api/src/modules/ai/tool-schemas.ts` 增加/修改 tool schema（名称、参数、描述、返回约定）。
3. 校验与联调：确保前端工具执行结果能回传并被 UI 正确消费（错误也要可读）。
4. 文档更新：如新增 node kind/模型能力，同步更新 `canvasNodeSpecs` 与相关提示词策略说明。

