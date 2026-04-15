# Agents-CLI 与 Codex-Main Checklist 对齐清单

## 目标

把 `apps/agents-cli` 的规划能力与 `apps/codex-main` 的 checklist/todo 体验对齐，形成“可规划、可追踪、可验收”的统一执行闭环，而不是只靠自然语言描述“已完成”。

## 能力基线（已核对）

- [x] `agents-cli` 默认系统引导已要求 `plan -> act -> report`  
  证据：`apps/agents-cli/src/core/config.ts`、`apps/agents-cli/src/core/agent-loop.ts`
- [x] 已有轻量 checklist 工具 `TodoWrite`，并明确为短期清单  
  证据：`apps/agents-cli/src/core/tools/todo.ts`
- [x] 已有持久化任务图 `task_create/task_update/task_get/task_list/task_claim`  
  证据：`apps/agents-cli/src/core/tools/tasks.ts`
- [x] `TodoManager` 已内置“同一时刻最多一个 in_progress”约束  
  证据：`apps/agents-cli/src/core/planner/todo.ts`
- [x] 已有多代理编排主路径 `orchestrator + spawn_agent + mailbox_* + protocol_*`  
  证据：`apps/agents-cli/README.md`、`apps/agents-cli/src/core/subagent/types.ts`
- [x] `agents-cli` HTTP 流式通道已支持 item 级事件（started/updated/completed）  
  证据：`apps/agents-cli/src/server/http-server.ts`
- [x] `codex-main` 已把 `todo_list` 作为 thread item 一等公民并支持流式更新  
  证据：`apps/codex-main/sdk/typescript/src/items.ts`、`apps/codex-main/sdk/typescript/samples/basic_streaming.ts`

## 对齐缺口（待完成）

- [x] `agents-cli /chat` 新增 `todo_list` 专用事件（而不只把 TodoWrite 结果混在普通 tool 输出里）
- [x] `agents-cli` trace/runtime 增加结构化 checklist 快照（`items[]` + 当前 `in_progress` + 完成率）
- [x] `hono-api` bridge 透传并保留 checklist 结构，不降级成纯文本摘要
- [x] `apps/web` 聊天面板新增 checklist 可视化区（实时显示 pending/in_progress/completed）
- [x] 多步任务完成门禁增加 checklist 对齐校验：未完成关键项不得判定 `verdict=satisfied`
- [ ] 增加端到端回归测试：章节分镜场景必须看到 checklist 进度与最终完成态一致

## 本轮落地（已完成）

- [x] 已创建本清单文件到 `apps/task/`
- [x] 已完成 `agents-cli` 与 `codex-main` 的 checklist 能力差异盘点
- [x] 已给出可执行的对齐项（可直接作为后续开发待办）
- [x] 章节分镜验收门禁已收紧：仅创建角色卡/图片计划节点，不再抵消 `storyboardEditorCells` 无 `imageUrl` 的交付失败判定（防止“计划落板即满意”误判）
- [x] `agents-cli /chat` 已输出结构化 `todo_list` 事件与 `trace.todoList` 快照（可供 bridge/UI 对齐 codex-main checklist 体验）
- [x] `hono-api` 已识别并透传 `todo_list` 流事件，且把 `trace.todoList` 写入 bridge `meta`
- [x] `hono-api` verdict 已接入 checklist 门禁：执行型回合若 checklist 未完成，至少降级为 `partial`
- [x] `apps/web` 已支持消费 `todo_list` 流事件，并优先渲染结构化 checklist（兼容旧 Todo 文本块）

## 验收标准（对齐完成时）

- [ ] 同一任务在 `agents-cli`、bridge trace、web UI 三处看到一致的 checklist 状态
- [ ] 多步生成任务若只落计划节点、未交付真实资产，不能显示“已完成”
- [ ] 任意一次“重试/续跑”都能复用上轮 checklist 状态并继续推进
