---
name: cognitive-memory
description: Agents-CLI 认知记忆系统。用于管理长期记忆（core/episodic/semantic/procedural/vault）、可检索回忆、归档遗忘、以及多代理写入治理。
---

# cognitive-memory

目标：让 agents-cli 在任务中具备“可管理、可检索、可归档、可续跑”的长期记忆能力，而不是仅依赖会话上下文。

## 适用场景

在以下场景优先加载本技能：

- 用户明确要求“记住/别忘了/以后按这个做”。
- 任务跨多轮、跨会话，且需要稳定复用历史结论。
- 多代理协作，需要共享读、受控写。
- 需要把阶段结果写入本地记忆索引并支持“继续”。

## 工具契约（agents-cli）

本技能默认使用这些工具：

- `memory_save({ content, tags?, store?, source?, importance? })`
- `memory_search({ query, limit?, store?, includeArchived? })`
- `memory_forget({ id? | query? })`
- `memory_reflect({ query?, limit?, minDecayScore?, requestedTokens?, extraTokens?, penaltyTokens?, extraReason?, penaltyReason? })`
- `memory_reflect_commit({ reflectionId, decision, approvedTokens, reason })`
- 必要时配合 `read_file` / `write_file` 写入结构化索引文件。

## 记忆分层规则

- `core`: 始终高优先级的长期约束与偏好。
- `episodic`: 本次执行过程中的阶段事实、异常、修复记录。
- `semantic`: 实体/关系/业务知识（例如角色关系、术语、领域映射）。
- `procedural`: 可复用流程、模板、操作策略。
- `vault`: 用户明确指定“永久保留、不要自动淡化”的关键记忆。

## 写入规范

每次写入 `memory_save` 时必须满足：

1. `content` 为可复用事实，不写空话。
2. `tags` 至少包含任务域和对象（例如 `book-metadata`, `novel:xxx`）。
3. `source` 记录来源技能或流程（例如 `agents-team-book-metadata`）。
4. `importance` 按 0~1 给出，核心约束建议 >= 0.8。

## 检索规范

1. 回答前先 `memory_search`（至少 1 次）验证历史记忆。
2. 查询词必须包含主体 + 任务域（如 `my-book metadata characterGraph`）。
3. 命中冲突时，先返回冲突点，再请求用户确认，不允许私自覆盖。

## 遗忘规范

仅在以下条件允许 `memory_forget`：

- 用户明确要求遗忘。
- 记忆被证实错误且已保留替代版本。

遗忘是归档，不是物理删除；必须在回复中说明归档对象。

## 反思审批流程（工具化）

1. 调用 `memory_reflect` 生成待审批反思草案（会写入 `meta/pending-reflection.json|md`）。
2. 将 `reflectionId` 与 token 申请摘要展示给用户，等待明确批准/减少/拒绝。
3. 用户决策后调用 `memory_reflect_commit`：
- `approved` / `reduced`: 写入 `meta/reflections/*`、`meta/reflection-log.md`、`meta/rewards/*`、`meta/reward-log.md`。
- `rejected`: 仅记录奖励决策到 rewards/reward-log，不生成正式 reflection。
4. 未经用户审批，禁止直接落盘正式反思结果。

## 多代理治理

- 所有子代理可以读记忆。
- 只有主代理可以执行最终写入；子代理只产出候选内容。
- 主代理在写入前必须做去重、冲突检查和来源标注。

## 与本地文件索引协同

对长流程任务，除 `memory_*` 外，还应写入 `.agents/memory/.../index.json`：

- `progress`：当前阶段与下一个动作。
- `artifacts`：关键产物路径。
- `updatedAt`：最后更新时间。

当用户说“继续”时：

1. 先读 `index.json` 和 `progress`。
2. 再做 `memory_search` 交叉校验。
3. 状态一致才继续执行；不一致直接报错并说明差异。
