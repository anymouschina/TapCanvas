# Public Chat Rediagnosis 2026-03-30

## 结论

当前链路相比上一版已经有实质收敛：

- 已移除 bridge-side memory prompt 常驻注入
- 已移除 runtime skill hints 常驻注入
- AUTO 不再默认附加 `agents-team`

但主耦合点仍未完全解除，主要残留在：

1. 入口层仍做语义路由
2. bridge 仍做 chapter-grounded 的执行决策
3. bridge system prompt 仍然过重
4. `/chat` 流式协议仍然过于聚合，缺 item 级过程语义

---

## P0

### P0-1 入口层仍在决定执行模式

文件：

- `apps/hono-api/src/modules/apiKey/apiKey.routes.ts`

问题：

- `resolvePublicChatAutoModeBehavior()` 仍根据本地规则，把 `mode=auto` 决定为 `chat` 或 `agents_auto`
- 判断依据仍是：
  - `hasStructuredPublicChatExecutionContext`
  - `shouldRequireChapterGroundedAgentsTeam`

风险：

- “本轮是不是重执行链”仍是后端本地语义结论，不是 agent 基于事实自主判断
- 后续继续加业务场景时，这里会再次膨胀成 route 分流中心

建议：

- 入口只透传事实标签，不直接产出 `agents_auto` 这类执行模式结论
- 若必须保留兼容字段，也应把它改为“弱提示”，不能作为主要控制开关

验收：

- `/public/chat` 入口不再根据业务语义切换执行路径

### P0-2 bridge 仍在强推 team/skill/子代理角色

文件：

- `apps/hono-api/src/modules/task/public-chat-workflow.ts`
- `apps/hono-api/src/modules/task/task.agents-bridge.ts`

问题：

- 仍由 bridge 计算：
  - `deriveChapterGroundedRequiredSkills`
  - `shouldRequireChapterGroundedAgentsTeam`
  - `allowedSubagentTypes`
  - `requireAgentsTeamExecution`

风险：

- chapter-grounded 的“怎么执行”仍由业务层决定
- agent 只是在吃 bridge 的执行套餐，不是真正基于事实上下文自主编排

建议：

- `public-chat-workflow.ts` 只保留事实 scope 检测
- `requiredSkills/allowedSubagentTypes/requireAgentsTeamExecution` 改成：
  - 调用方显式要求时才透传
  - 否则交给 `agents-cli` 基于 scope 自决

验收：

- bridge 不再默认为 chapter-grounded 自动下发 team execution 套餐

### P0-3 bridge prompt 仍承担大量业务方法论

文件：

- `apps/hono-api/src/modules/task/task.agents-bridge.ts`

问题：

- 仍保留：
  - `planOnlyGuardPrompt`
  - `forceAssetGenerationGuardPrompt`
  - `chapterGroundedStoryboardGuardPrompt`
  - `finalOutputProtocolPrompt`

风险：

- `hono-api` 继续承担“如何做”和“怎么收尾”的方法论
- 这些规则未来会和 skills / verifier / tool contract 再次出现漂移

建议：

- 继续削减 bridge prompt，只保留：
  - 协议格式
  - 鉴权/边界
  - 事实性上下文
  - 明确失败策略
- 把 chapter-grounded 方法论、计划偏好、输出行为策略继续下沉到：
  - `apps/agents-cli` completion/verifier
  - `skills/`
  - tool contract

验收：

- `finalSystemPrompt` 显著缩短
- 业务 SOP 不再主要存在于 bridge prompt

---

## P1

### P1-1 `/chat` 流式协议仍然过于聚合

文件：

- `apps/agents-cli/src/server/http-server.ts`

问题：

- 当前仍只有：
  - `content`
  - `tool`
  - `result`
  - `error`
  - `done`

风险：

- 前端无法重建接近 `codex-main` 的 turn/item 过程
- 难以区分：
  - agent 决策出的动作意图
  - 业务工具已执行动作
  - 前端本地已应用动作

建议：

- 为 `/chat` 增加 v2 事件：
  - `turn.started`
  - `item.started`
  - `item.updated`
  - `item.completed`
  - `turn.completed`
- 现有 SSE 聚合事件保留兼容层

验收：

- 前端能按 item 粒度渲染过程，而不只是读 summary

### P1-2 结构化 contract 仍主要通过自然语言 prompt 传递

文件：

- `apps/agents-cli/src/server/http-server.ts`

问题：

- `StructuredOutputPreference`
- `ResourceWhitelist`
- `AgentsTeamExecutionRequirement`

仍然主要通过 system 文本传给模型

风险：

- contract 可执行性弱
- 后续 prompt 改动容易影响协议执行稳定性

建议：

- 能进 runtime state / tool policy / schema 的，尽量不要只写成 prompt
- prompt 只做补充说明，不做 primary enforcement

验收：

- 关键约束在代码/协议层可检验，不只在 prompt 中存在

### P1-3 prompt precheck 体系要防止重新膨胀

文件：

- `apps/hono-api/src/modules/task/task.agents-bridge.ts`

问题：

- `mentionRoleInjection`
- `chapterContinuityInjection`
- `promptPipelinePrecheck`

当前仍合理，但已经接近“业务前置规划器”

风险：

- 它们可能继续从“补事实”演化成“替 agent 做执行前判断”

建议：

- 严格限定它们只产事实，不产动作结论
- 不要在这些模块里继续新增“因此必须做 X / 禁止做 Y”的推导逻辑

验收：

- precheck 输出只描述事实状态，不描述执行结论

---

## P2

### P2-1 README 仍有实现与目标态混写

文件：

- `apps/hono-api/README.md`

问题：

- 文档虽然更新了，但很多段落仍混有旧实现说明、当前实现说明和目标态原则

风险：

- 后续继续清理代码后，文档再次漂移

建议：

- 把 README 的 AI 对话架构拆成：
  - 当前真实链路
  - 当前明确保留的业务边界
  - 禁止事项
- 避免在实现文档里混入过多“理想设计”

### P2-2 `requiredSkills` 机制仍偏强

文件：

- `apps/agents-cli/src/core/agent-loop.ts`
- `apps/agents-cli/src/server/http-server.ts`

问题：

- required skills 仍会触发预加载、技能限制、completion 前强制校验

风险：

- 若 bridge 继续大量传 `requiredSkills`，agent 自主性会持续被压缩

建议：

- 把 `requiredSkills` 继续收敛为例外机制
- 默认依赖 agent 自主 `Skill` 调用

---

## 推荐下一步

1. 先处理 P0-1 和 P0-2
2. 再处理 P0-3
3. 然后补 P1-1 的 item 级事件

## 对应代码定位

- `apps/hono-api/src/modules/apiKey/apiKey.routes.ts:297`
- `apps/hono-api/src/modules/task/public-chat-workflow.ts:66`
- `apps/hono-api/src/modules/task/task.agents-bridge.ts:4888`
- `apps/hono-api/src/modules/task/task.agents-bridge.ts:5060`
- `apps/agents-cli/src/server/http-server.ts:175`
- `apps/agents-cli/src/server/http-server.ts:211`
- `apps/agents-cli/src/core/agent-loop.ts:418`
