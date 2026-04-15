# Agents CLI Runtime Rebuild Design

**Date:** 2026-04-09

## Goal

把 `apps/agents-cli` 从“入口脚本拼装一切”的状态，重塑成一个可被 CLI、TUI、HTTP 共同消费的助手 runtime，为后续更强的交互产品层打底。

## Problems

- `src/cli/index.ts` 同时承担配置加载、runtime 装配、session 定位、TUI 逻辑与 HTTP 启动，职责过载。
- TUI/CLI/HTTP 共用的是同一个 runner，但没有共用一个明确的 runtime contract。
- profile、skills discovery、session store 这些稳定能力散落在入口层，导致后续扩展 surface 时容易复制逻辑。
- 入口层继续膨胀会直接阻碍后续 TUI 产品化。

## Chosen Approach

采用 `runtime + surfaces + core` 的三层结构：

- `core`：保留 agent 执行内核，不做 UI 和入口逻辑。
- `runtime`：形成 `AssistantRuntime` 门面，统一暴露 runner、tool context、session history 与 shutdown 行为。
- `surfaces`：CLI/TUI/HTTP 只做接入和展示。

## Phase 1 Scope

- 新增 `src/runtime/runtime.ts`，固化 `AssistantRuntime` 契约。
- 新增 `src/runtime/profile.ts`、`src/runtime/session.ts`、`src/runtime/skills.ts`。
- 新增 `src/surfaces/cli/io.ts` 与 `src/surfaces/tui/repl-session.ts`。
- 让 `src/cli/index.ts` 改为调用 runtime / surfaces，而不是自己做系统装配。
- 更新 `apps/agents-cli/README.md` 的 Runtime 架构说明。

## Non-Goals

- 本轮不重写 `AgentRunner`。
- 本轮不引入新的 UI 框架或全屏 TUI overlay 系统。
- 本轮不新增新的业务工具或 prompt specialist。

## Validation

- TypeScript 编译通过。
- 新增 runtime/session 测试覆盖 `AssistantRuntime` 与 session store 契约。
- CLI / TUI / HTTP 继续共用同一个 runtime 输出的 runner 和 tool context。
