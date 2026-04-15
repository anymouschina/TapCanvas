# Agents-CLI Completion Self-Repair 与 Codex-Main 对齐清单

## 目标

把 `apps/agents-cli` 的 completion gate 从“事后诊断”切到“主链自修复”：

- runtime 发现本轮尚不能结束时，不直接把问题下沉给 bridge 或前端补丁
- 失败事实必须在同一请求内回灌给主代理继续修正
- 纠偏信息只服务于本次运行，不污染持久化会话历史

## 根因复盘

- [x] 旧实现里，`apps/agents-cli/src/server/http-server.ts` 已能算出 deterministic completion trace
- [x] 但这份 trace 只在 `runner.run()` 结束后作为诊断返回，没有继续驱动本轮 agent 自修复
- [x] 结果是 bridge 只能看到“这轮不满足”，却无法让 `agents-cli` 在同一请求里自己补救
- [x] 这会诱导后续修复滑向 bridge 侧 case patch、关键词拦截或 prompt 补丁，违背 `codex-main` 的主链执行原则

## 本轮落地

- [x] `/chat` 在 completion gate 阻断时，会在同一 HTTP 请求内继续重跑，而不是直接结束
- [x] 自修复 steer 只使用 runtime 已确认的事实：`failureReason`、`rationale`、`missingCriteria`、`requiredActions`、planning 状态
- [x] 自修复 steer 通过内部 `<runtime_completion_self_check>` prompt 回灌给主代理，不新增 bridge 侧个案路由
- [x] `AgentRunner.run` 支持 `ephemeralUserPrompt`，允许本轮临时提示对模型可见但不进入持久化历史
- [x] JSONL session 与 Redis session 持久化都过滤 `ephemeral` message，避免内部纠偏污染用户历史
- [x] completion trace 新增 `retryCount` 与 `recoveredAfterRetry`，保留可诊断的 runtime 自修复结果
- [x] 自修复预算拆成两层：连续 blocked finish 预算 + 单请求总重试上限，避免无限循环
- [x] 补充回归测试，覆盖“阻断后同请求恢复”与“内部 steer 不持久化”两条主路径
- [x] bridge 不再从用户 prompt 本地正则提取 `chapterId`；章节作用域只接受显式 request/context 事实
- [x] bridge 的参考图/资产输入注入改为内部 `<tapcanvas_runtime_reference_context>` 哨兵块，不再因 prompt 正文出现 `【参考图】` / `【资产输入】` 标题而误判“已注入”
- [x] web 端 canvas plan 执行层不再用 prompt 正文 / 对白文本做 regex 或 `includes` 语义拦截，也不再本地自动改写视频 prompt 补对白

## 文档与规范同步

- [x] 更新 `apps/agents-cli/README.md`，说明 completion self-check 的同请求自修复、ephemeral 持久化策略与重试预算
- [x] 更新 `apps/hono-api/README.md` 的“AI 对话架构（当前）”，说明 bridge 现在消费的是最终 completion 结果，而不是事后去补 case patch
- [x] 更新仓库根 `AGENTS.md`，把“agents-cli 内部自修复、禁止 bridge/front-end 个案补丁兜底”固化为强制规则
- [x] 本清单落到 `apps/task/`，作为后续评审与回归的固定检查项
- [x] 继续收口 bridge 侧交付判定：`expectedDelivery` 改为只吃结构化 `deliveryContract` 与真实 scope/context，不再靠本地关键词扫描 task 文本猜“单基底帧/多镜头”
- [x] 继续收口 bridge 侧作用域与参考注入：不再从 prompt 猜章节，不再用自然语言标题做参考块判重

## 验收标准

- [x] 执行型请求若第一次 completion gate 被挡住，但后续补齐 checklist/工具动作，最终可在同一请求内恢复为完成态
- [x] 内部 `<runtime_completion_self_check>` 提示不会出现在用户可续写的持久化 session 历史中
- [x] `trace.completion` 能明确表达这次完成是否经过 runtime 自修复
- [x] `hono-api` / `apps/web` 不再需要新增针对单个工作流的 completion 补丁来“救” agents 输出
