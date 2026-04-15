# Agents Team Wait Codex Alignment Checklist

目标：把 `apps/agents-cli` 当前的 team auto-wait 行为，向 `apps/codex-main` 的 collab wait 语义对齐，重点解决“子代理实际完成但 wait trace 先记 failed”与“timeout 被误当作失败”。

## 已完成

- [x] `agents_team_runtime_wait` 命中 runtime wait cap 后不再把工具调用记为 `failed`
- [x] wait payload 显式补充 `timedOut` / `stopped` / `stopReason`
- [x] runtime 在停止自动等待前增加一次最终终态重检，优先吃到刚刚完成的 child 结果
- [x] 新增测试覆盖：
  - [x] timeout 回合保持 `status=succeeded`
  - [x] runtime cap 命中前的最终重检可把“迟到完成态”收回为 `completed=true`
- [x] `apps/hono-api/README.md` 同步当前 wait 语义与 trace 行为

## 待做

- [ ] 给 collab manager 增加显式的状态订阅接口，减少对文件快照轮询的依赖
- [x] 给 collab manager 增加显式的状态订阅接口，减少对文件快照轮询的依赖
- [x] 把 `pending-team-agents.ts` 从“轮询 status/submission 快照”进一步收敛到“agent final status authority”
- [x] 评估是否将 `agents_team_runtime_wait` 正式升级为与 `codex-main wait_agent` 同构的独立团队工具，而不是 runtime 内部伪工具
- [x] 给 wait trace 增加 `finalRecheckPerformed` / `finalRecheckRecovered` 结构化字段，便于诊断“本来要 stop，但最终重检救回”
- [x] 检查 `idle_agent status=failed` 在 reviewer 收尾阶段的根因，避免再次拖慢完成态观测
- [x] 为 `/collab/status` 或内部诊断接口增加“final status source”字段，区分 live memory / persisted store / recheck recovered

## 本轮补充

- `CollabAgentManager` 已新增 `subscribeStatus(id, listener)`，并在 `persistAgent()` 后主动通知监听者
- `pending-team-agents.ts` 现在优先走订阅唤醒，只有在 manager 不支持订阅时才回退到 sleep/poll
- pending 判定已不再依赖 submission `running/queued` 作为终态 authority，只把 submission 保留为诊断上下文
- `/collab/status` 已可通过 `status_source` 区分 live / persisted agent 和 submission 状态
- `idle_agent` 失败根因已确认并修复：它原先在活跃 submission 内调用 `markIdle()` 必然命中 busy guard；现在改为记录 idle 意图并在 submission 成功收尾后落到 `idle`
- `agents_team_runtime_wait` 暂保留为 runtime 内部诊断工具，但其语义已与 `codex-main wait_agent` 对齐到“timeout/stopped 不等于 failed，wait 只表达终态摘要”
- 已新增回归测试，覆盖：
  - manager 状态持久化时会通知订阅者
  - pending wait 可被订阅事件快速唤醒，而不是被粗粒度 poll 卡住

## 设计原则

- timeout 不是失败；只有真实 agent error / not found / close failure 才是失败
- wait 的职责是返回终态摘要，不是混入 child 正文内容
- stop auto-wait 是 runtime 策略事件，不应伪装成工具故障
- agent 完成态应由最终状态 authority 决定，submission 只提供诊断上下文

## 对齐参考

- `apps/codex-main/codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
- `apps/codex-main/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `apps/codex-main/codex-rs/core/src/tools/handlers/multi_agents_common.rs`
- `apps/codex-main/codex-rs/app-server-protocol/src/protocol/thread_history.rs`
