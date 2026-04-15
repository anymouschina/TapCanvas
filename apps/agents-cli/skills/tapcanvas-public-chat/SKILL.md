---
name: tapcanvas-public-chat
description: 定义 TapCanvas agents chat 运行时协作原则：web 收集上下文，hono-api 注入硬约束，agents 自主决策，skills 提供方法论。此 skill 只负责协作原则，不负责直接调用 TapCanvas `/public/*` API；凡是实际发请求，统一改用 `tapcanvas-api`。
---

# TapCanvas Public Chat

注意：
- 本 skill 不是 API 调用器。
- 凡是要实际请求 TapCanvas `/public/*` 接口，统一使用 `tapcanvas-api`。
- 不要在这里重新定义 `apiKey`、`apiBaseUrl`、endpoint 映射或请求脚本。

## 何时使用

- 用户在 `/public/chat` 或 Web 对话助手里发起多步创作请求
- 任务需要同时理解前端上下文、后端硬约束与 agents 自主编排边界

## 输入证据

- 用户请求与会话上下文
- `chatContext` 中的显式事实
- 项目/flow/node/book/material 等工具结果

## 执行原则

- `web` 只负责收集真实上下文并执行合法 plan
- `hono-api` 只负责权限、协议、事实性、失败策略与审计
- `agents-cli` 主代理负责意图识别、取证规划、技能加载、子代理拆分与结果汇总
- 后端 system prompt 只承载身份、事实 briefing、协议与失败约束；业务方法论以本 skill 及同组 runtime skills 为准
- 对显式、确定性的画布改动请求（如添加空文本节点、重命名节点、连接节点、更新少量已知字段），若当前 `project/flow` 作用域与目标足够明确，优先直接调用 `tapcanvas_flow_patch` 执行，不要退化成让用户手动操作
- `tapcanvas_flow_patch` 现支持 `deleteNodeIds` 与 `deleteEdgeIds`。删节点时必须传真实 node id，且会级联删除关联边；只想断开连线时优先用 `deleteEdgeIds`
- 若同一轮 `tapcanvas_flow_patch` 同时包含 `createNodes` 与 `createEdges`，凡是会被边引用的新节点都必须先写显式稳定 `id`；`label` 绝不是 node id
- 若 `tapcanvas_flow_patch.createNodes` 会写入分组结构（创建 `groupNode`，或给节点写 `parentId`），要把组节点放在子节点前面，并把组内子节点按你期望的最终视觉顺序依次写入；运行时会按该顺序做 parent-first 重排与组内紧凑排列
- `kind=storyboard` 是前端“分镜编辑”图片网格，不是镜头脚本容器；若本轮只有逐镜头文本、beat list 或章节拆解而没有镜头图，应创建 `kind=storyboardScript` 或 `kind=text` 节点，而不是把长段文字塞进 `storyboard` 的 `content/prompt/text`
- 只有在你明确提供 `storyboardEditorCells`，或用户明确要求“空白分镜板/空网格占位”时，才创建 `kind=storyboard`；否则默认视为节点类型选择错误
- 若当前明确选中了 `kind=image` / `imageEdit` 节点，且用户目标是“完善/优化/改写当前图片节点提示词”，先读取 `tapcanvas_node_context_bundle_get` 获取节点现有 `prompt/systemPrompt/negativePrompt`、结果图、上下游与 diagnostics，再决定改写范围；不要只根据选中态猜字段
- 对“优化当前图片节点提示词”这类针对既有节点的确定性修改，优先直接回写当前节点，而不是默认新建平行节点；只有用户明确要求分叉、保留旧版或另起一版时，才创建新节点
- 回写既有图片节点提示词时，优先用 `tapcanvas_flow_patch.patchNodeData`，并显式传 `allowOverwrite=true`，避免因为已有 `prompt/systemPrompt/negativePrompt` 被 409 拦下
- `kind=text` 的节点允许为空内容占位；若用户明确要求“空文本节点/空白文本节点”，不要把 `prompt` / `text` 当成必填项
- 对“添加空白文本节点”这类确定性写入，优先使用 `tapcanvas_flow_patch.createNodes`；最小可用示例：`{"createNodes":[{"type":"taskNode","position":{"x":0,"y":0},"data":{"kind":"text","label":"空白文本","nodeWidth":380,"nodeHeight":360}}]}`。空占位时可省略 `prompt` / `text` / `textResults`
- 对 chapter-grounded 的 `image` / `storyboard` / `composeVideo` / `video` 写入，必须在同一轮 patch 内同步提交 `data.productionMetadata`；禁止先落节点、下一轮再补 metadata
- SOP、创作方法论、提示词方法、连续性方法都属于 skill，而不是常驻 system prompt
- 事实判断必须来自实时工具结果，不得来自 docs/assets/ai-metadata
- 若本轮没有真实执行、没有真实生成、也没有返回合法 `<tapcanvas_canvas_plan>`，不得写成“已落地”“已完成”

## 输出契约

- 直接回答时，不暴露内部控制字段
- 返回画布结果时，要么成功调用 `tapcanvas_flow_patch` 等工具直接写入，要么输出合法 `<tapcanvas_canvas_plan>`
- 证据不足时，明确指出缺失项与下一步需要读取的实时数据
