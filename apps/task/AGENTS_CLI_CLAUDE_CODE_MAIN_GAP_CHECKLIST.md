# Agents-CLI 与 Claude-Code-Main 差距分析 Checklist

## 目标

先真实理解 `apps/claude-code-main` 的现有能力清单，再对照 `apps/agents-cli` 当前实现，找出真正值得吸收的运行时能力、当前缺失点与建议优化顺序。

本清单只关注 `agent runtime / session / context / tools / memory / bridge` 等核心执行能力，不把订阅、增长、营销、桌面 upsell 等纯产品壳能力误算为 `agents-cli` 必须补齐的缺口。

## 范围

- `apps/claude-code-main`
- `apps/agents-cli`
- 仅做实现层面对照，不做历史兼容设计
- 结论以当前仓库代码为准，不基于外部资料猜测

## Claude-Code-Main 能力清单（已核对）

### 1. 入口与产品壳

- [x] `claude-code-main` 入口不是薄 CLI，而是完整启动编排层  
  证据：`apps/claude-code-main/src/main.tsx`
- [x] 启动前已做多项预取/初始化：startup profiling、keychain prefetch、MDM read、bootstrap data、settings、plugins、MCP、telemetry  
  证据：`apps/claude-code-main/src/main.tsx`
- [x] 功能切换大量依赖 feature gates，而不是所有能力永远挂主路径  
  证据：`apps/claude-code-main/src/main.tsx`、`apps/claude-code-main/src/tools.ts`

### 2. 查询循环与恢复能力

- [x] `query.ts` 是显式的多轮状态机，不是一次性 LLM 调用包装  
  证据：`apps/claude-code-main/src/query.ts`
- [x] 已具备 autocompact / microcompact / snip / context collapse 等上下文压缩能力  
  证据：`apps/claude-code-main/src/query.ts`
- [x] 已具备 `prompt-too-long` 与 `max_output_tokens` 的恢复路径  
  证据：`apps/claude-code-main/src/query.ts`
- [x] 已具备 streaming tool execution，而不是只能等整轮工具跑完  
  证据：`apps/claude-code-main/src/query.ts`
- [x] 已具备 turn transition / stop hook / token budget / tool summary 等运行时治理信息  
  证据：`apps/claude-code-main/src/query.ts`

### 3. 会话引擎抽象

- [x] `QueryEngine` 已把 conversation lifecycle 与单次 query loop 分层  
  证据：`apps/claude-code-main/src/QueryEngine.ts`
- [x] `QueryEngine` 会持有消息、usage、权限拒绝、文件缓存、session 状态，而不只是转发 prompt  
  证据：`apps/claude-code-main/src/QueryEngine.ts`

### 4. 上下文装配

- [x] `getSystemContext()` 已提供 git 状态、分支、recent commits、cache breaker 等系统事实  
  证据：`apps/claude-code-main/src/context.ts`
- [x] `getUserContext()` 已提供 `CLAUDE.md` / memory files / currentDate 等用户上下文  
  证据：`apps/claude-code-main/src/context.ts`
- [x] 上下文读取已做缓存与限长，而不是每轮无控制重读  
  证据：`apps/claude-code-main/src/context.ts`

### 5. 工具体系

- [x] 工具不是平铺注册，而是 base tools + gated tools + REPL-only tools + team/worktree/plan/task tools 的分层装配  
  证据：`apps/claude-code-main/src/tools.ts`
- [x] 已有浏览、搜索、MCP、LSP、workflow、team、plan、task 等平台级工具面  
  证据：`apps/claude-code-main/src/tools.ts`

### 6. 记忆与后处理

- [x] 已有独立的 durable memory extraction 机制，而不是只把 transcript 原样落盘  
  证据：`apps/claude-code-main/src/services/extractMemories/extractMemories.ts`
- [x] memory extraction 使用权限受限的 forked agent，避免主代理与记忆提炼逻辑耦合  
  证据：`apps/claude-code-main/src/services/extractMemories/extractMemories.ts`
- [x] 已有 team memory sync，支持 per-repo 共享记忆、delta upload、checksum、冲突重试  
  证据：`apps/claude-code-main/src/services/teamMemorySync/index.ts`

### 7. 运行时辅助层

- [x] 已有工具批次摘要能力，可把完成的工具调用压成简短标签  
  证据：`apps/claude-code-main/src/services/toolUseSummary/toolUseSummaryGenerator.ts`
- [x] 已有 remote bridge / env-less bridge，会话可被外部远程接管  
  证据：`apps/claude-code-main/src/bridge/remoteBridgeCore.ts`
- [x] 已有 tips / plugin installation / remote managed settings / policy limits 等产品化控制层  
  证据：`apps/claude-code-main/src/services/tips/tipRegistry.ts`、`apps/claude-code-main/src/services/plugins/PluginInstallationManager.ts`

## Agents-CLI 当前对照（已核对）

### 1. 已具备的核心优势

- [x] 已有 `AgentRunner` 主循环，并拆出 `session-engine / context-pipeline / capability-resolver / finish-policy` 等基础分层  
  证据：`apps/agents-cli/src/core/agent-loop.ts`、`apps/agents-cli/src/core/session/session-engine.ts`、`apps/agents-cli/src/core/context-pipeline.ts`、`apps/agents-cli/src/core/finish-policy.ts`
- [x] 已有 `Capability Plane`，支持 local / remote / mcp provider 聚合  
  证据：`apps/agents-cli/src/core/capability-plane.ts`
- [x] 已有 `Policy Engine`，能做 `allow / deny / requires_approval` 三态裁决  
  证据：`apps/agents-cli/src/core/policy-engine.ts`
- [x] 已有 layered memory，而不是只有单一 notes 文件  
  证据：`apps/agents-cli/src/core/memory/layered.ts`
- [x] 已有 team runtime：spawn agent、mailbox、protocol、workspace import、private workspace  
  证据：`apps/agents-cli/README.md`、`apps/agents-cli/src/core/collab/manager.ts`
- [x] 已有 background task manager 与 terminal session manager  
  证据：`apps/agents-cli/src/core/background/manager.ts`、`apps/agents-cli/src/core/terminal/session-manager.ts`
- [x] 已有 HTTP server，可供外部进程调用  
  证据：`apps/agents-cli/src/server/http-server.ts`
- [x] 已有 tool trace / request diagnostics / completion self-check 相关收口  
  证据：`apps/agents-cli/src/core/tool-call-trace.ts`、`apps/agents-cli/src/server/http-server.ts`

### 2. 当前仍弱于 Claude-Code-Main 的点

- [x] `agents-cli` 仍缺少 query-loop 级别的上下文压缩与恢复状态机  
  现状：有 context budget，但没有 `autocompact / reactive compact / prompt-too-long recovery / max_output_tokens recovery` 对等能力  
  证据：`apps/agents-cli/src/core/context-pipeline.ts`、`apps/agents-cli/src/core/agent-loop.ts`
- [x] `agents-cli` 仍没有真正的 conversation engine / turn engine 双层抽象  
  现状：`session-engine` 仍偏轻量，主协调复杂度仍集中在 `agent-loop.ts`  
  证据：`apps/agents-cli/src/core/session/session-engine.ts`、`apps/agents-cli/src/core/agent-loop.ts`
- [x] `agents-cli` 仍缺工具批次摘要层  
  现状：有详细 trace，但没有为模型/UI/bridge 生成简短“工具完成了什么”的摘要  
  证据：`apps/agents-cli/src/core/tool-call-trace.ts`
- [x] `agents-cli` 的 memory 更偏结构化汇总，缺少 transcript 提炼型后处理代理  
  现状：`syncLayeredMemory()` 会写 rollup/candidate/summary，但没有受限 extractor agent  
  证据：`apps/agents-cli/src/core/memory/layered.ts`
- [x] `agents-cli` 的系统上下文快照仍偏薄  
  现状：有 workspace/context sources，但缺 git 状态、recent commits、日期等稳定系统事实层  
  证据：`apps/agents-cli/src/core/context-source-providers.ts`
- [x] `agents-cli` 只有 HTTP server，还没有 bridge 级长连接远程控制面  
  现状：HTTP 入口能请求，但不等于 remote session bridge  
  证据：`apps/agents-cli/src/server/http-server.ts`
- [x] `agents-cli` 扩展体系仍以 skills + built-in tools 为主，缺插件级安装/刷新/隔离模型  
  现状：未看到与 `claude-code-main` 对等的 plugin runtime  
  证据：`apps/agents-cli/src/cli/index.ts`、`apps/agents-cli/src/core/tools/registry.ts`

### 3. 当前强于 Claude-Code-Main 或更适合保留的点

- [x] `agents-cli` 的 team runtime 更明确地支持 private workspace + handoff import  
  证据：`apps/agents-cli/README.md`、`apps/agents-cli/src/core/collab/manager.ts`
- [x] `agents-cli` 已把 capability grant / policy engine / provider plane 拆得更直接，结构更适合继续演进  
  证据：`apps/agents-cli/src/core/capability-plane.ts`、`apps/agents-cli/src/core/policy-engine.ts`
- [x] `agents-cli` 的 layered memory 产物更显式，便于本地项目内追踪  
  证据：`apps/agents-cli/src/core/memory/layered.ts`
- [x] `agents-cli` 当前架构体量更小，适合做硬切换而不是背兼容包袱  
  证据：实现规模对比 `apps/claude-code-main/src` 与 `apps/agents-cli/src/core`

## 不应照搬的部分

- [x] 不应把 `claude-code-main` 的 analytics / GrowthBook / referral / quota / upsell 体系照搬进 `agents-cli`
- [x] 不应把海量 CLI 命令、桌面集成、设置页、tips 系统当作 `agents-cli` 核心能力缺口
- [x] 不应复制其 feature gate 膨胀模式，导致 `agents-cli` 再次长成巨型多分支主路径
- [x] 不应为了“功能数量对齐”而牺牲 `agents-cli` 现有的清晰分层与私有工作区协作优势

## 建议吸收的高优先级优化项

### P0

- [x] 已给 `agents-cli` 增加 turn-level compaction / recovery state machine  
  结果：新增 `src/core/message-compaction.ts`，在每轮模型调用前做 message compaction，并在疑似上下文过长错误时触发 recovery retry
- [x] 已把 `agent-loop` 继续拆成 conversation engine + turn engine  
  结果：新增 `src/core/turn-engine.ts` 承接单轮模型调用与 compaction/recovery，`AgentRunner.run()` 继续保留 conversation orchestration

### P1

- [x] 已增加 tool batch summary  
  结果：新增 `src/core/tool-batch-summary.ts`，并将摘要注入 runtime meta / prompt fragment / HTTP trace
- [x] 已增加 transcript-based memory extraction pass  
  结果：新增 `src/core/memory/extractor.ts`，在根代理完成后提炼 run insights 并写入 layered memory rollup
- [x] 已增加稳定 system/user context snapshot  
  结果：新增 `src/core/system-snapshot.ts`，并把 `currentDate / gitBranch / gitStatus / recentCommits` 接入 context pipeline

### P2

- [x] 已评估 long-lived remote session bridge  
  结论：当前阶段不直接照搬 `claude-code-main` 的 bridge；保留 `HTTP server + structured runtime trace` 作为主路径，待真实桌面/长连接需求出现后再单独立项
- [x] 已评估 plugin/runtime extension 机制  
  结论：当前阶段继续以 `skills + capability providers + remote/mcp tools` 为主，不引入 marketplace/plugin runtime，以避免平台壳复杂度反向吞没执行内核

## 建议实现顺序

- [x] Phase 1：实现 compaction / recovery state machine
- [x] Phase 2：拆分 conversation engine / turn engine
- [x] Phase 3：实现 tool batch summary
- [x] Phase 4：实现 memory extractor pass
- [x] Phase 5：补 system snapshot context provider
- [x] Phase 6：完成 bridge / plugin 评估并给出 deferred 结论

## 本轮结论（已完成）

- [x] 已完成 `apps/claude-code-main` 真实模块与执行链理解
- [x] 已完成 `apps/agents-cli` 当前架构能力对照
- [x] 已区分“应吸收的 runtime 能力”与“无需照搬的产品壳能力”
- [x] 已给出 `P0 / P1 / P2` 优先级清单
- [x] 已将 checklist 落到 `apps/task/`

## 当前完成状态

- [x] 调研与差距识别已完成
- [x] `claude-code-main` 能力清单已形成
- [x] `agents-cli` 对照结论已形成
- [x] 优先级与建议顺序已形成
- [x] `P0 / P1 / P2` 中的执行内核项已完成本轮落地；`bridge / plugin` 已完成评估并明确 deferred 结论

## 本轮实际落地

- [x] 新增 `apps/agents-cli/src/core/message-compaction.ts`
- [x] 新增 `apps/agents-cli/src/core/turn-engine.ts`
- [x] 新增 `apps/agents-cli/src/core/tool-batch-summary.ts`
- [x] 新增 `apps/agents-cli/src/core/system-snapshot.ts`
- [x] 新增 `apps/agents-cli/src/core/memory/extractor.ts`
- [x] 更新 `context-pipeline / agent-loop / finish-policy / layered memory / http-server trace`
- [x] 增加针对性测试覆盖 compaction、tool batch summary、system snapshot context 与 layered memory 持久化链路

## 验收标准

- [x] 本轮新增改造都已映射回本清单中的具体缺口项
- [x] 本轮优化围绕 runtime 能力增强完成，没有引入产品壳膨胀
- [x] `P0/P1` 项已落代码并同步更新 checklist 状态与产出说明
