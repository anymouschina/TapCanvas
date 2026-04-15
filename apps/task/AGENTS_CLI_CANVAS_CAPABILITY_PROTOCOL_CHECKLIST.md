# Agents CLI Canvas Capability Protocol Checklist

目标：把 TapCanvas 画布真实接口、节点能力、flow patch 协议与 bridge 远程工具，统一收束成结构化协议并注入 `agents-cli`，避免它继续只靠零散 prompt/description 猜画布能力。

## 文档与实现清单

- [x] `apps/hono-api/src/modules/ai/tool-schemas.ts`
  - [x] 新增结构化 `canvasCapabilityManifest` 构建能力
  - [x] 把 local canvas tools、node specs、flow patch 协议摘要整理为可注入合同
- [x] `apps/hono-api/src/modules/task/task.agents-bridge.ts`
  - [x] 在 `/public/chat -> agents-cli` 请求里注入 `canvasCapabilityManifest`
  - [x] 保持 remote tools 与 manifest 同步
- [x] `apps/agents-cli/src/server/http-server.ts`
  - [x] 解析 `canvasCapabilityManifest`
  - [x] 将 manifest 注入 runtime meta 与 system prompt
  - [x] 在 trace.runtime 中回传 `canvasCapabilities` 摘要
- [x] `apps/hono-api/src/modules/task/task.agents-bridge.prompt-specialists.test.ts`
  - [x] 覆盖 bridge request 中的 manifest 注入与 tool 同步关系
- [x] `apps/agents-cli/src/server/http-server.test.ts`
  - [x] 覆盖 manifest 注入到 system prompt / runtime meta / trace
- [x] `apps/agents-cli/skills/tapcanvas/SKILL.md`
  - [x] 说明运行时以 `canvasCapabilityManifest` 为画布能力 source of truth
- [x] `apps/hono-api/README.md`
  - [x] 更新 “AI 对话架构（当前）” 中的 manifest 注入、trace 与职责说明
- [x] `apps/task/AGENTS_CLI_CANVAS_CAPABILITY_PROTOCOL_CHECKLIST.md`
  - [x] 本任务 checklist 已创建并完成勾选

## 验收

- [x] bridge 到 agents-cli 的请求现在显式携带结构化画布能力合同，而不只是 `remoteTools`
- [x] agents-cli 能在 system prompt、runtime meta、trace 中看到同一份画布能力摘要
- [x] README 与 TapCanvas skill 已同步说明新协议
