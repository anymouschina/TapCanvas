# Agents Team Runtime Wait Latency Cap Checklist

目标：收紧父代理对 team 子代理的自动等待策略，避免 trace 因单个子代理长时间未终态而被固定 30s 轮询拖到数分钟。

## 1. 自动等待总时长上限

- [x] 为 `agents-cli` runtime wait 增加独立于 child soft budget 的总等待时长上限
- [x] 默认总等待时长上限显著低于当前 child 运行 budget，优先快速收口而不是陪跑到 over-budget
- [x] 上限通过环境变量暴露，保持可调

## 2. 诊断与 trace

- [x] `agents_team_runtime_wait` trace 显式记录总等待上限
- [x] 触发上限时给出明确 stop reason，说明是 runtime latency cap 命中，而不是继续模糊归因为 child 自身超预算
- [x] 最终 retry message 保持“必须显式处理阻塞/失败事实”的硬约束

## 3. 回归测试

- [x] 补“未 over-budget 但已命中 runtime 总等待上限时停止自动等待”的测试
- [x] 保证已有 over-budget 停止等待测试继续通过

## 4. 文档同步

- [x] 更新 `apps/agents-cli/README.md`，说明 runtime team wait 的总时长上限策略
- [x] 更新 `apps/hono-api/README.md` 的 AI 对话架构章节，说明 bridge 看到的 wait failure 现在也可能来自 runtime latency cap

## 5. 验证

- [x] 运行 `apps/agents-cli` 相关单测
- [x] 运行 `agents-cli` 构建

## 验证记录

- [x] `pnpm --filter agents build`
- [x] `node --test apps/agents-cli/dist/core/completion/pending-team-agents.test.js`
- [x] `node --test apps/agents-cli/dist/core/agent-loop.test.js`

## 收口结论

- 父代理自动等待现在有独立总时长上限 `AGENTS_PENDING_TEAM_WAIT_MAX_TOTAL_MS`，默认 `90000ms`，不再默认陪子代理一直等到它自己的 soft budget 结束。
- `agents_team_runtime_wait` 会把 `maxTotalWaitMs` 写入 trace/消息；命中上限时会以明确的 runtime latency cap 失败收口，而不是继续模糊归因为 child 超预算。
- 这次改动直接针对 trace 的长尾等待问题，没有引入本地语义兜底，也没有放宽失败策略。
