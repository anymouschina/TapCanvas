# Agents CLI Skill Autonomy Cutover Checklist

目标：移除 `requiredSkills` 对 `apps/agents-cli` 运行时能力与 skill 选择的硬约束，把“加载哪些 skill 正文、是否启用多代理”交还给主代理自主决策；同时将 `agents-team` 从团队工具门禁降级为纯方法论 skill。

## Phase 1: 团队工具去门禁化

- [x] 删除 team tools 对 `Skill("agents-team")` 的运行时门禁，不再因未开启 teamMode 拒绝 `spawn_agent` / `wait` / mailbox / protocol 等工具。
- [x] 更新团队工具描述与 CLI 注册注释，说明团队工具在 `code` profile 下原生可用，但仍默认单代理优先。
- [x] 保留显式 `agent_type` 与 `allowedSubagentTypes` 约束，避免把“去门禁”退化成“无边界并行”。

## Phase 2: requiredSkills 去硬约束化

- [x] 删除 `AgentRunner` 对 `requiredSkills` 的预加载逻辑，不再自动把 `SKILL.md` 正文塞进消息。
- [x] 删除 “未先加载 requiredSkills 就不允许结束” 的 completion gate。
- [x] 删除 `Skill` 工具对白名单外 skill 的阻断逻辑，不再把 `requiredSkills` 当作本轮可加载 skill 的白名单。
- [x] 保留 available skills 摘要暴露，让主代理继续基于 skill 描述自主选择是否调用 `Skill`。

## Phase 3: 文档与测试同步

- [x] 更新 `apps/agents-cli/README.md`，说明团队工具不再依赖 `agents-team` 开关，`requiredSkills` 不再是运行时强制装配。
- [x] 更新 `apps/hono-api/README.md` 的“AI 对话架构（当前）”章节，说明 bridge 不再依赖 `requiredSkills` 控制 skill 正文加载，主代理自行决定何时调用 `Skill`。
- [x] 更新 `apps/agents-cli` 相关测试，覆盖：
  - [x] team tools 在 `teamMode=false` 时仍可调用
  - [x] `requiredSkills` 不再预加载 skill 正文
  - [x] runtime trace 仍保留显式传入的 `requiredSkills`
  - [x] runtime trace 的 `loadedSkills` 只记录真实加载

## 本次结果

- [x] `agents-team` 现在只是可选协作方法论 skill，不再承担团队工具开关职责。
- [x] `requiredSkills` 退化为“调用方显式附带的上下文偏好/trace 字段”，不再约束 agents-cli 必须预加载或只能加载白名单内 skill。
- [x] `/public/chat -> bridge -> agents-cli` 现在默认暴露 available skills 摘要，由 agents-cli 主代理自己决定是否加载 `tapcanvas-continuity`、`tapcanvas-demo-patterns`、`tapcanvas-workflow-orchestrator` 等 skill 正文。
- [x] 历史残留的 `teamMode` runtime flag 已从 `ToolRuntimeState` 与测试夹具中移除，避免继续制造“还有第二套团队门禁”的假象。
- [x] 历史残留的 `preloadRequiredSkills` request 字段与 `preloadedRequiredSkills` runtime trace 字段已移除，避免继续暴露“可预加载 skill 正文”的假能力。
