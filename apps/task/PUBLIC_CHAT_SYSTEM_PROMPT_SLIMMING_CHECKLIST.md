# Public Chat System Prompt Slimming Checklist

目标：把 `apps/hono-api/src/modules/task` 的 public chat prompt 组装从“超重 system prompt”收敛为“薄 system + facts fragment + runtime skills + verifier gates”。

## Phase 1: 分层切口

- [x] 新增基础系统提示模块，只保留身份、事实优先、显式失败、协议边界。
- [x] 新增事实片段模块，把当前轮 `project/chapter/reference/model catalog/selection` 从 system prose 中拆出。
- [x] 让 `buildPublicChatSystemPrompt()` 改为组装 `persona + runtime skill + base system + context fragment`。
- [x] 同步更新 `apps/hono-api/README.md` 的 “AI 对话架构（当前）” 和 system prompt 组装说明。
- [x] 调整 `chat-system-prompt.test.ts`，改为验证分层结构而不是要求 system 长驻方法论文案。

## Phase 2: 继续减重

- [x] 停止把 runtime skill 全文直接拼进 system prompt，改成 skill 摘要 + agents-cli 按需加载提示。
- [x] 把 chapter-grounded / prompt specialist 方法论从 `hono-api` 常驻 system prompt 迁回 `apps/agents-cli` skills。
- [x] 把 `AUTO` / chapter-grounded / visual reference 等硬约束从 system prompt 迁到 verifier / tool contract。
- [x] 为 “precheck -> prerequisite generation -> prompt generation” 建显式 gate 和 trace 字段。

## Phase 3: 清理历史耦合

- [x] 删除 `chat-persona-prompt.ts` 中残留的产品策略和执行 SOP 长文案。
- [x] 把 “如何回答身份/进度/状态” 这类话术从 system prompt 移到更轻的 response policy。
- [x] 让 `task.agents-bridge.prompt-specialists.test.ts` 改为基于行为和证据验证，而不是断言大段 system 文本。

## 本次已完成

- [x] 新增 `chat-runtime-skills.ts`，把 runtime skill 选择逻辑从 persona 文件里拆出。
- [x] runtime skill 注入从 `SKILL.md` 正文改为 summary hints，system prompt 不再拼接完整 skill 文本。
- [x] 保留原有 skill 触发条件，但把“完整方法论”明确下沉为 agents 运行时按需加载，而不是后端常驻注入。
- [x] 更新 `chat-system-prompt.test.ts` 与 `task.agents-bridge.prompt-specialists.test.ts`，改为验证 summary/hint 而非全文。
- [x] 更新 `apps/hono-api/README.md`，同步反映当前 prompt 组装与 runtime skill 装配方式。
- [x] 在 agents bridge 的 `diagnosticContext`、`raw.meta` 与 execution trace 中新增 `promptPipeline`，显式记录 precheck / prerequisite generation / prompt generation 阶段状态与预检查快照。
- [x] 新增 `chat-response-policy.ts`，把身份/进度/状态回答边界从 base system 中拆成独立轻量策略。
- [x] `buildPublicChatSystemPrompt()` 现按 `persona -> explicit skill -> runtime skill hints -> base system -> response policy -> context fragment` 组装。
