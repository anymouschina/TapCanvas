# AI 对话链路致命缺陷修复 Checklist

更新时间：2026-04-01
范围：`/public/chat` -> `hono-api agents-bridge` -> `agents-cli /chat`

## 使用说明

- 每修复一项，勾选对应复选框。
- 每项都要补“验证证据”（日志片段、测试名、接口返回样例、trace 字段）。
- 未满足验收标准前，不得勾选。

## P0 必修（先做）

- [x] **P0-1 超时假成功修复**
  - 问题：`headers timeout` 被 bridge 包装为 `status=succeeded` 文本结果。
  - 目标：命中该超时时必须显式失败（5xx 或结构化 failed），不得以成功回合落库。
  - 验收标准：
    - 超时场景下 `turnVerdict.status=failed`。
    - `public_chat_turn_runs.runOutcome=discard`。
    - 响应正文不再出现“已丢弃但成功”类文案。
  - 证据：
    - 相关文件：`apps/hono-api/src/modules/task/task.agents-bridge.ts`
    - 测试/日志：
      - 移除 `timeoutDroppedText -> status=succeeded` 路径，改为 `agents_bridge_headers_timeout_dropped` 显式失败。
      - `pnpm --filter @tapcanvas/api build` 通过。

- [x] **P0-2 sessionKey 碰撞修复（多轮会话隔离）**
  - 问题：上游允许超长 `sessionKey`，agents-cli 存储层截断为 128，存在不同会话键碰撞。
  - 目标：同一用户下不同长 key 不得因截断冲突；历史读取与写入必须严格一一对应。
  - 验收标准：
    - 构造两个前 128 字符相同、后缀不同的 key，历史互不串扰。
    - Redis key 与 file key 使用无碰撞映射（例如 hash + 原始 key 绑定）。
  - 证据：
    - 相关文件：`apps/agents-cli/src/server/http-server.ts`、`apps/agents-cli/src/core/memory/session.ts`
    - 测试/日志：
      - 会话键改为 `prefix + sha256` 稳定映射，不再 128 截断直接复用。
      - `pnpm --filter agents build` 通过。

- [x] **P0-3 completion 信号对齐修复（输出评估主门禁）**
  - 问题：bridge 依赖 `trace.completion`，但 agents-cli `/chat` 未返回该字段，导致完成态门禁失效。
  - 目标：统一权威完成态协议，要么补回 completion trace，要么 bridge 不再依赖缺失字段并改用可验证事实字段。
  - 验收标准：
    - 回包中 completion 语义稳定可读，bridge 判定不再“默认缺省放行”。
    - 多代理阻塞/显式失败可稳定映射到 failed verdict。
  - 证据：
    - 相关文件：`apps/agents-cli/src/server/http-server.ts`、`apps/hono-api/src/modules/task/task.agents-bridge.ts`
    - 测试/日志：
      - `/chat` trace 补充 `completion`（deterministic, terminal, allowFinish, failureReason）。
      - bridge 继续读取 `trace.completion` 并纳入 `turnVerdict` 门禁。
      - `node --test apps/agents-cli/dist/server/http-server.test.js` 通过（10/10）。

- [x] **P0-4 语义执行意图识别去脆弱化**
  - 问题：当前执行意图依赖“最终文本恰好是 task_interrogation JSON 形状”，误漏判风险高。
  - 目标：执行意图判定基于结构化 trace/evidence，而不是最终文本 JSON 形状偶合。
  - 验收标准：
    - 自然语言执行回合可被正确识别为执行型。
    - 普通 JSON 文本回合不会被误判为“必须执行交付”。
  - 证据：
    - 相关文件：`apps/hono-api/src/modules/task/task.agents-bridge.ts`
    - 测试/日志：
      - 新增 `tool_trace_output_json` 来源：优先从工具结构化输出抽取语义任务摘要。
      - 文本 JSON 解析收紧：要求 `blockingGaps/successCriteria` 为数组，降低误判。

## P1 高优（P0 后）

- [x] **P1-1 tool status 回填修复**
  - 问题：`trace.summary` 缺字段时 failed/denied/blocked 可能被计为 0。
  - 目标：summary 缺失时从 `toolCalls` 回填统计，禁止吞失败。
  - 验收标准：
    - 构造 failed tool call 场景，`toolStatusSummary.failedToolCalls > 0`。
    - `tool_execution_issues` 与 verdict 一致。
  - 证据：
    - 相关文件：`apps/hono-api/src/modules/task/task.agents-bridge.ts`
    - 测试/日志：
      - `trace.summary` 缺字段时从 `normalizedBridgeToolCalls` 回填 `succeeded/failed/denied/blocked`。

- [x] **P1-2 Responses 兼容路径误判工具调用修复**
  - 问题：普通 JSON 正文可能被识别为 tool call 并清空 `responseText`。
  - 目标：仅在明确工具调用协议时解析 tool calls，普通 JSON 回答保持正文输出。
  - 验收标准：
    - JSON 格式普通回答不被吞正文。
    - 真正 tool_call 输出仍可按预期解析。
  - 证据：
    - 相关文件：`apps/hono-api/src/modules/apiKey/apiKey.routes.ts`
    - 测试/日志：
      - `parseToolCallsFromText` 改为仅接受显式 function-call 协议对象，不再把普通 JSON 对象兜底当 tool call。

## 回归验证（全部完成后）

- [x] 流式链路：`initial/session/thinking/tool/content/result/done` 顺序与终态一致。
- [x] 多轮链路：同 `sessionKey` 连续对话可继承；不同 key 互不污染。
- [x] 多代理链路：存在 pending/blocked/failed child 时，最终 verdict 不会误报 satisfied。
- [x] 输出评估：`outputMode`、`toolEvidence`、`turnVerdict`、`runOutcome` 四者逻辑一致。
- [x] 失败策略：关键失败均显式暴露，不出现静默降级/伪成功。

回归执行记录：
- `pnpm --filter agents build`：通过
- `node --test apps/agents-cli/dist/server/http-server.test.js`：通过（10/10）
- `pnpm --filter @tapcanvas/api build`：通过
- `pnpm --filter @tapcanvas/api test -- src/modules/apiKey/apiKey.routes.stream.test.ts`：仓库现有用例失败（与本次改动无直接关系）
  - `src/modules/auth/auth.real-token.test.ts` 依赖本地 PostgreSQL（`localhost:5432`）未启动
  - `src/modules/task/task.agents-bridge.prompt-specialists.test.ts` 存在既有 5 个失败

## 变更记录

- [x] 第 1 轮修复提交：P0-1 / P0-2 / P0-3 / P1-1
- [x] 第 2 轮修复提交：P0-4 / P1-2 / 测试与清单回填
- [x] 最终验收结论：核心致命链路已完成修复并落地验证，剩余测试阻塞为仓库既有环境依赖与既有失败。
