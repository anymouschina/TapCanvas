# Agents-CLI 架构重塑 Checklist

## 目标

基于对 `apps/claude-code-main` 与 `apps/agents-cli` 的真实实现比对，推动 `apps/agents-cli` 从“带 team/memory 的单次 run agent”重塑为更稳定的执行内核：

- 会话级 `Session Engine`，而不是把一次运行全部塞进单个 `AgentRunner.run()`
- 可预算、可诊断的 `Context Pipeline`，而不是静态拼接上下文文本
- 统一的 `Capability Plane` 与 `Policy Engine`，而不是只做工具白名单判断
- 保留并强化现有 team runtime / private workspace / handoff import 优势
- 为后续 `MCP`、agent definitions、TapCanvas 业务桥接预留稳定扩展面

## 本轮事实基线（已核对）

- [x] `claude-code-main` 已具备明显的平台化分层：CLI 装配层、QueryEngine、Tool runtime、skills、MCP、permission model、sub-agent / worktree 等能力
- [x] `claude-code-main` 的 `QueryEngine` 已把一次对话视为持久 session，并持有消息、权限拒绝、文件缓存、usage 等运行时状态
- [x] `claude-code-main` 的 `ToolUseContext` 不是薄工具上下文，而是完整 runtime surface，包含权限、MCP 资源、UI 回调、消息流与任务态
- [x] `agents-cli` 当前已有可用的协作基础：team agents、mailbox/protocol、private workspace、handoff import、layered memory、HTTP bridge
- [x] `agents-cli` 当前 `AgentRunner.run()` 仍然过重，混合了上下文装配、capability grant、prompt 拼装、LLM 调用、tool batching、completion 与 memory 同步
- [x] `agents-cli` 当前 `tool-policy` 仍偏薄，只覆盖 capability grant 白名单与少量远程会话特判，缺少真正的三态策略层
- [x] `agents-cli` 当前 `workspace-context` 更像静态文档拼接器，还不是支持预算/来源/诊断的上下文管线
- [x] `agents-cli` 当前子代理体系仍以静态角色表为主，缺少磁盘可加载的 agent definitions

## 重塑结论（已收敛）

- [x] 不应整体移植 `claude-code-main`，而应吸收其“运行时分层”和“能力挂载”思路
- [x] 不应复制 `claude-code-main` 的 feature-flag 膨胀与重 CLI 入口复杂度
- [x] `agents-cli` 的 team runtime、private workspace、HTTP bridge、TapCanvas 业务契约应继续保留，作为重塑后的核心优势
- [x] 最适合 `agents-cli` 的目标形态是：
  - `Session Engine`
  - `Context Pipeline`
  - `Capability Plane`
  - `Policy Engine`
  - `Agent Runtime Plane`
  - `Extension Plane`

## 目标架构切面

### 1. Session Engine

- [x] 新增 `src/core/session/`，把“一个 session 的运行时状态”从 `AgentRunner` 中拆出来
- [x] 会话状态至少托管：`messages`、`tool trace`、`completion trace`、`usage`、`permission denials`、`abort state`
- [x] CLI、HTTP、subagent 都走同一会话内核，避免并行维护多套 run 主路径
- [x] completion self-repair、pending team wait、memory sync 已收口为 session / finish / completion 相关标准阶段，不再完全散落在旧主路径

### 2. Context Pipeline

- [x] 已新增 `context-pipeline` 作为 `AgentRunner` 的上下文装配入口，但当前仍是单一 orchestration 层，尚未完成 provider-based pipeline cutover
- [x] 上下文来源至少拆分为：persona、workspace rules、memory、runtime diagnostics、generation contract、canvas capability、request scope
- [x] 每个来源都必须有独立预算，不允许无上限拼接
- [x] 输出 context diagnostics，能说明“注入了哪些来源、每类来源占了多少字符/预算”
- [x] TapCanvas 项目上下文、章节资产、storyboard continuity 等事实型输入已统一进入 runtime context pipeline / meta，而不是继续只靠 bridge 零散拼接

### 3. Capability Plane

- [x] 已拆出 `capability-resolver`，统一收口 capability grant / workspace roots / run envelope 的基础构造
- [x] 把本地 tools、remote tools、skills、未来 MCP tools 统一抽象成 capability providers
- [x] 能力注册与过滤必须收口到统一层，不再由 `registry + remoteTools + skill prompt` 分散拼装
- [x] 允许能力按 profile / request scope / agent type / capability grant 动态裁剪
- [x] 为未来的 capability diagnostics 预留结构化输出，能解释“模型本轮实际看到了什么能力”

### 4. Policy Engine

- [x] 用三态策略引擎替换当前的 `tool-policy` 二值判断：`allow / deny / requires_approval`
- [x] 策略来源至少分为：system/project/user/request/runtime grant
- [x] 支持 tool 级、path 级、command 级判断，而不是只看 tool name
- [x] 为远程会话、subagent、private workspace、shared workspace 提供不同默认策略
- [x] 引入 denial tracking，避免同类被拒操作反复重试
- [x] 所有写入/执行型高风险动作都必须由 policy engine 给出可追踪的明确裁决依据

### 5. Agent Runtime Plane

- [x] 保留现有 team runtime 的 mailbox / protocol / workspace handoff 能力
- [x] 把 private workspace / staged repo import 提升为一等 execution mode，而不是 collab manager 内部细节
- [x] 增加标准 `executionMode` / `isolationMode` 抽象，为后续 `fork_context`、`private_workspace`、`git_worktree` 留出口
- [x] orchestrator / worker / reviewer / research 等角色继续存在，但职责配置已转移到 agent definitions，而不是长期写死在代码中

### 6. Extension Plane

- [x] 拆分 `Skill` 与 `Agent Definition`：skill 负责知识/方法论，agent definition 负责角色/工具/模型/执行模式
- [x] 引入磁盘可加载的 agent definitions，支持 model policy、tool allowlist、execution mode、skill bundle
- [x] 为未来 MCP/provider 化接入预留统一 provider 接口
- [x] hooks 继续保留，并按 runtime hook / bridge 消费边界完成收敛，避免再次耦合

## 分阶段迁移顺序

### Phase 1: 拆 `AgentRunner`

- [x] 拆出 `session-engine`
- [x] 拆出 `context-pipeline`
- [x] 拆出 `capability-resolver`
- [x] 拆出 `finish-policy`
- [x] 外部 CLI / HTTP 接口保持兼容，不在此阶段改协议
- [x] `completion-gate` / completion trace 已通过 session/completion/runtime trace 形成独立 runtime plane，不再完全内嵌旧主路径

### Phase 2: 升级 Policy Engine

- [x] 将 `tool-policy` 升级为多来源三态策略引擎
- [x] 为 HTTP bridge 暴露 `requires_approval` 结果，而不是只能 allow/deny
- [x] 把 path/command 规则纳入统一判定

### Phase 3: Agent Definitions Cutover

- [x] 用磁盘可加载 definitions 替代静态角色大表
- [x] 让 `subagent/types` 退化为默认 definitions 或 schema，而不是唯一事实源
- [x] 每个 definition 支持独立 model policy / tools / execution mode / skill bundle

### Phase 4: Context Budget / Compression

- [x] 增加 tool result budget
- [x] 增加 workspace context budget
- [x] 增加 memory excerpt budget
- [x] 增加 trace budget
- [x] 已通过 session rollup / memory summary / context budget 注入形成会话级 compaction 机制

### Phase 5: Provider / MCP 扩展

- [x] 把 remote tools 继续抽象成 provider
- [x] 已接入 MCP provider 输入面，避免继续为外部能力堆专用分支
- [x] 保持 `apps/hono-api` 只传事实型上下文与硬约束，不侵入 agent 语义决策

## Hono-API Bridge 上层影响

### A. 职责边界收敛

- [x] 继续保持 `apps/hono-api` bridge 的核心职责为：鉴权、租户/项目/flow 作用域隔离、事实型上下文透传、远程工具注入、trace/verdict 持久化
- [x] 禁止 bridge 因 `agents-cli` 重构而重新长出本地语义路由、固定 workflow、prompt specialist 分流或 case-specific completion patch
- [x] `expectedDelivery -> deliveryEvidence -> deliveryVerification -> turnVerdict` 仍由 bridge 汇总，但输入事实已标准化增强，避免继续从自然语言和局部 trace 猜语义
- [x] bridge 只消费 `agents-cli` 暴露出的结构化 runtime 事实，不再依赖主 loop 内部实现细节或隐式 prompt 文案

### B. 协议面与请求/响应影响

- [x] `/public/agents/chat` 传给 `agents-cli` 的 runtime 上下文已转向结构化 context sources / capability descriptors / policy inputs
- [x] bridge 已为新 `Session Engine` 提供稳定的 session 级输入输出契约，而不是默认把一次 HTTP 请求等同于一次完整 run
- [x] bridge trace 已适配新的 runtime diagnostics：能记录 context sources、capability snapshot、policy decisions 摘要
- [x] bridge 继续保留对 `todo_list`、completion trace、delivery verification 的消费能力，且不自己推导缺失 planning/completion 事实
- [x] `requires_approval` 已以结构化阻塞事实透传，而不是只能压成 failed/denied 文本

### C. Remote Tool / Canvas Capability 影响

- [x] 远程工具定义继续由 bridge 生成，并已升级为 capability provider 输入
- [x] `canvasCapabilityManifest` 继续由 bridge 汇总下发，并进入稳定的结构化 capability/context 输入
- [x] generation contract、assetInputs、referenceImageSlots、localResourcePaths 等事实型输入已进入统一 request context
- [x] bridge 继续保持“协议与作用域事实来源”的地位，不承担 agent definitions、skills、tool policy 的编排责任

### D. 迁移时序要求

- [x] 在 `agents-cli` Phase 1 完成前，bridge 未引入新的语义补丁层，只做兼容输入承接
- [x] `agents-cli` 引入 `context-pipeline` 与 `capability-resolver` 后，bridge extras 已映射到新结构，避免双轨长期并存
- [x] `agents-cli` 引入 `Policy Engine` 后，bridge 已对接 `requires_approval` / policy decision 摘要
- [x] bridge 协议改动已同步更新 `apps/hono-api/README.md`

## 约束与红线

- [x] 禁止把“claude-code-main 有这个功能”直接翻译成 `agents-cli` 的新硬编码分支
- [x] 禁止用本地 route、关键词、正则补丁替代 runtime 分层改造
- [x] 禁止把 TapCanvas 业务语义重新硬编码进 `agents-cli` 基础 runtime
- [x] 禁止在重塑过程中引入 `docs/`、`assets/`、`ai-metadata/` 作为运行时知识源
- [x] 禁止新增 `any` 或 `as any`

## 本轮产出

- [x] 已完成 `apps/claude-code-main` 与 `apps/agents-cli` 的结构对照
- [x] 已识别 `agents-cli` 当前最值得保留的优势与最需要补齐的短板
- [x] 已明确“吸收分层思想，不照搬整套实现”的重塑策略
- [x] 已把本次专项 checklist 落到 `apps/task/`

## 验收标准

- [x] `AgentRunner.run()` 已不再直接承担 capability grant 构造、workspace/memory 上下文装配、run finalization/memory sync 的全部职责
- [x] `AgentRunner.run()` 已瘦到以 session/context/capability/policy/runtime 协调为主，不再承担所有运行时职责
- [x] 新 runtime 能清楚回答：本轮注入了哪些上下文、暴露了哪些能力、因何允许/拒绝某个动作
- [x] team runtime、private workspace、handoff import 在重构后仍保持可用，不发生能力退化
- [x] `apps/hono-api` 与 `apps/web` 无需新增本地语义补丁来弥补 `agents-cli` 基础 runtime 缺口
- [x] bridge 仍能稳定汇总 `trace / verdict / delivery verification / todo trace`，但不再承担语义决策或个案补丁修复职责
- [x] 后续接入新 provider / MCP / agent definition 时，不需要再回到主 loop 里堆条件分支

## 本轮已完成实现（2026-04-03）

- [x] 新增 `src/core/session/session-engine.ts`，托管当前 message stack、runtime meta、tool runtime state 与基础 system 拼装
- [x] 新增 `src/core/context-pipeline.ts`，统一构造 workspace context、memory root、runtime meta 与 run hook context
- [x] 新增 `src/core/capability-resolver.ts`，收口 capability grant / run envelope / resource roots 的基础解析
- [x] 新增 `src/core/finish-policy.ts`，收口 run 完结后的 hook 上报与 root memory sync
- [x] `apps/agents-cli/src/server/http-server.ts` 修复 SSE write-after-end 路径，避免流式错误分支在响应已关闭后继续写入
- [x] `spawn_agent -> collab manager -> child runner.run()` 已打通定义驱动的子代理运行时契约：父级有效模型/requiredSkills 可继承，definition 的 `skillBundle` / `modelPolicy` / `capabilityProviderBundle` 会落到实际 child run，而不再只是静态配置
- [x] 子代理运行时记录与持久化已补齐 `skillBundle` / 当前模型等事实，`status/list` 可直接观测 child contract，避免上层继续从隐式 prompt 或零散 trace 猜测
- [x] 根代理人格已从“泛系统提示 + 工程角色外溢”收口为统一 root persona：默认是通用型助手与编排器，`AGENTS_PROFILE=code` 仅表示执行增强，不再等价于“默认就是 coding agent”
- [x] `code` / `worker` 角色 prompt 已降为实现专用人格，不再代表整个 `agents-cli` 的默认 soul；相关 README / 示例配置已同步更新
