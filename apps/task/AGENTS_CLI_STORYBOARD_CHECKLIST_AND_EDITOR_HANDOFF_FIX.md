# Agents-CLI Checklist 与 Storyboard 承接修复清单

## 目标

修复两类实际问题，并要求先分析后落地：

1. `agents-cli` 在章节创作这类多步执行任务里，没有稳定产出可见 checklist。
2. AI 生成的 `storyboard` 节点只有 `storyboardEditorCells[*].prompt`，但缺少下游继续使用所需的 `storyboardScript / storyboardShotPrompts`，导致“分镜编辑可看，但后续承接差”。

## 事实核对

- [x] `TodoWrite` / `todo_list` / `trace.todoList` 基础设施已经存在，问题不在传输链路缺失。
- [x] `apps/web` 已能显示 checklist；问题在于模型没有被稳定约束为“多步执行任务先写 checklist”。
- [x] `storyboard` 编辑器本身可直接执行 `storyboardEditorCells[*].prompt`。
- [x] 下游多个链路仍依赖 `storyboardScript / storyboardShotPrompts`。
- [x] 当前 `storyboard` 节点归一化没有把 cells 派生为上述字段。

## 修复步骤

- [x] 在 `hono-api` 公共聊天系统约束中补充规则：多步执行型任务先 `TodoWrite`，并持续更新 checklist。
- [x] 在 runtime skill hints 中补充同样的执行纪律，保持 bridge 提示与运行时约束一致。
- [x] 在前端新增统一 storyboard 归一化 helper：从 `storyboardEditorCells` 派生 `storyboardScript / storyboardShotPrompts / prompt`。
- [x] 把该 helper 接入 `CanvasService.createNode` / store `addNode` / `updateNodeData` / `setNodeStatus` / 画布吸附写入路径，避免同类数据多处失配。
- [x] 补单元测试覆盖 checklist 提示词注入与 storyboard 派生逻辑。
- [x] 同步 `apps/hono-api/README.md` 的 AI 对话架构说明。

## 验收标准

- [ ] 章节分镜类执行任务在 trace/UI 中能看到 checklist，而不是只看到自然语言“已完成”。
- [ ] AI 创建的 `kind=storyboard` 节点在只有 cells prompt 的情况下，也会自动补齐 `storyboardScript / storyboardShotPrompts`。
- [ ] 分镜编辑后的节点可继续被后续视频/续写/迁移逻辑读取，不再只停留在 UI 展示层。
