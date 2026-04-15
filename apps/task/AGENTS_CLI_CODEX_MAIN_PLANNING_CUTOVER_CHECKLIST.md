# Agents-CLI 执行规划与 Codex-Main 对齐清单

## 目标

把 `apps/agents-cli` 的执行前 checklist 约束收敛到与 `apps/codex-main` 同一原则：

- skill 命中不等于已经完成 planning
- 复杂执行任务必须先有结构化 checklist
- 没有 checklist 或 checklist 未完成时，不能收敛为完成态

## 本轮范围

- [x] 把本次专项 checklist 整理到 `apps/task/`
- [x] 明确当前结论：`codex-main` 依赖框架级 plan tool，不是 skill 本身负责 planning
- [x] bridge 为公共 agents chat 的执行型请求注入 `planningRequired`
- [x] bridge 为 chapter-grounded / 章节创作类请求注入更高的 `planningMinimumSteps`
- [x] `agents-cli` system prompt 明确声明“Skill 不替代 planning”
- [x] `agents-cli` HTTP system prompt 在 `planningRequired=true` 时追加执行前 checklist 约束
- [x] `tapcanvas_flow_patch` agents-facing 协议补充 chapter-grounded `productionMetadata` 完整示例，避免半合法 patch
- [x] bridge 引入通用 `expectedDelivery -> deliveryEvidence -> deliveryVerification` 结果复核链路
- [x] 把章节定格动画“单基底帧 + 视频占位”的失败判定从 case-specific diagnostic 改为通用 verifier
- [x] 更新 `apps/hono-api/README.md`

## 本轮落地结论

- [x] 当前公共 chat 若是 project-scoped 且带有章节、节点、参考图、assetInputs、selectedReference 或 chapter-grounded 作用域，将被标记为执行型规划任务
- [x] chapter-grounded / 章节创作默认要求不少于 `4` 个 checklist 步骤
- [x] scoped canvas execution 默认要求不少于 `3` 个 checklist 步骤
- [x] skill 加载之后若直接跳过 `TodoWrite`，completion gate 仍会阻断完成态
- [x] bridge 不再把 `wroteCanvas=true` 当作“产物类型正确”的充分条件；最终完成态还要通过 delivery verifier
- [x] chapter-grounded 定格动画若只落单张基底帧或视频占位，不会再被判成 `satisfied`

## 验收标准

- [ ] 第三章节定格动画这类请求，SSE 日志里应先出现 `todo_list`，再出现真实执行工具
- [ ] 没有 checklist 的执行型 agents chat 回合，不得显示“已完成”
- [ ] `tapcanvas_flow_patch` 产出的 chapter-grounded 节点不再因缺失 `productionMetadata.chapterGrounded=true` 而 400
- [x] 章节定格动画若只写入“单基底帧 + 视频占位”，`turnVerdict` 应失败且失败原因来自 `deliveryVerification`，而不是 chapter-specific diagnostic patch
