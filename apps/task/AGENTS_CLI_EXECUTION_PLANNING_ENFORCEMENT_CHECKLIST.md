# Agents-CLI 执行前规划约束清单

## 目标

解决 `agents-cli` 在执行型任务里“规划过短”或“根本没有规划就直接实现/宣称完成”的问题，并把验收状态沉淀为可勾选 checklist。

## 问题定义

- [x] 已确认当前缺口 1：`hono-api` 只会拦截“已有 checklist 但未完成”，不会拦截“完全没建立 checklist”
- [x] 已确认当前缺口 2：`agents-cli /chat` 的 deterministic completion trace 不校验规划是否存在、是否过短
- [x] 已确认当前缺口 3：当前 trace 缺少结构化 planning summary，bridge 无法稳定区分“无规划 / 规划过短 / 规划合格”

## 本轮实现项

- [x] 在 `apps/task/` 新增本专项 checklist 文件
- [x] `agents-cli /chat` trace 新增结构化 `planning` 摘要
- [x] `agents-cli` completion gate 对“执行型任务缺规划 / 规划过短 / checklist 未完成”显式阻断完成态
- [x] `hono-api` bridge 向 `agents-cli` 注入本轮是否要求执行前规划的事实性约束
- [x] `hono-api` bridge 透传 `planning` trace，并把缺规划/短规划纳入 verdict 诊断
- [x] 更新 `apps/hono-api/README.md` 的“AI 对话架构（当前）”章节
- [x] 为 `agents-cli` 与 `hono-api` 增加针对本问题的回归测试

## 验收标准

- [x] 执行型公共聊天回合若完全没有 checklist，不能得到 `completion.allowFinish=true`
- [x] 执行型公共聊天回合若 checklist 只有 1 项，不能得到“规划充分”的完成态
- [x] 执行型公共聊天回合若 checklist 仍有 `pending/in_progress`，不能得到完成态
- [x] bridge 最终 `meta` 可区分 `planning_missing`、`planning_too_short`、`planning_incomplete`
- [x] 最终 checklist 已按真实落地状态全部回填
