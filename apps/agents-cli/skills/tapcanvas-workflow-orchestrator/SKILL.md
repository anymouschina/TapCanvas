---
name: tapcanvas-workflow-orchestrator
description: 基于真实项目状态、节点上下文与章节证据，为 TapCanvas 生成下一步画布编排决策；不依赖 docs、assets 或 ai-metadata。
---

# TapCanvas Workflow Orchestrator

## 何时使用

- 用户要在 TapCanvas 中规划多步创作流程，而不是单次问答
- 用户要把结果落到画布，或要求返回可执行的 `<tapcanvas_canvas_plan>`
- 用户要求续写当前镜头、修复当前节点、围绕选中节点继续推进

## 输入证据

- 当前用户请求
- 当前项目/flow/node 的实时工具结果
- 章节正文、章节索引、连续性、素材、节点 bundle 等实时数据
- 已显式提供的 referenceImages、assetInputs、selectedReference、continuationAnchor

禁止把以下内容当成运行时知识源：

- `docs/`
- `assets/`
- `ai-metadata/`

这些目录可以存在于仓库中，但不属于本 skill 的运行时证据。

## 执行原则

- 先取证，再决策；不要猜项目状态
- 主代理自行意图识别，不使用本地固定 route
- 本 skill 提供方法，不接管全局流程
- 对小说项目的 `single_video` 或 chapter-grounded 创作，优先结合 project/book/chapter/node/continuity/source bundle 证据定位最相关章节正文、场景锚点与续写边界；不要等待用户手动补齐所有 checkpoint
- 若已知 `bookId`/`chapterId` 或可唯一锁定一本书，优先继续读取书籍索引、章节正文与 continuity 证据，再决定生成、规划或回写
- 若要判断某章是否已经有真实落盘的 `storyboardPlans / shotPrompts / storyboardStructured`，先调用 `tapcanvas_book_storyboard_plan_get`；禁止拿 `tapcanvas_book_storyboard_plan_upsert` 发送空 payload、探测 payload 或“试写看看”来判断是否存在
- 若任务需要图片/视频最终提示词，可按需调用 specialist；是否调用、调用顺序如何安排，由主代理决定
- 若用户目标是布局调整，只做结构调整，不改内容语义字段
- 若用户目标是显式、确定性的画布改动，且当前 flow 作用域与目标节点足够明确，优先直接调用 `tapcanvas_flow_patch`
- 若通过 `tapcanvas_flow_patch` 写入的是可执行图片/分镜/视频节点，默认把这视为“已把待执行节点交给宿主工作台”；TapCanvas 会在响应返回后基于 `executableNodeIds` 自动执行这些节点。不要因为当前 agent trace 里还没有最终 `imageUrl` / `videoUrl` 就把合法 handoff 误判成失败
- `tapcanvas_flow_patch` 现支持 `deleteNodeIds` / `deleteEdgeIds`。删除错误节点时直接传真实 id，不要假装用 `patchNodeData` 把节点“清空”；删节点会自动清理相关边
- 若同一轮 `tapcanvas_flow_patch` 既要 `createNodes` 又要 `createEdges`，所有会被边引用的新节点都必须先有稳定 `id`；不要把 `label` 当成 `source/target`
- 若 `tapcanvas_flow_patch.createNodes` 涉及分组（创建 `groupNode` 或对子节点设置 `parentId`），必须先写组节点，再按你要的最终视觉顺序依次列出组内子节点；后端会按该顺序做 parent-first 重排并对组内执行紧凑排列
- 若目标是“镜头拆解/分镜脚本/shot list/beat list”且当前还没有镜头图，不要创建 `kind=storyboard` 节点；这类文本上游应落到 `kind=storyboardScript` 或 `kind=text`
- `kind=storyboard` 只用于分镜编辑图片网格；除非你显式提供 `storyboardEditorCells`，或用户明确要一个空白分镜板占位，否则把文本塞进 `storyboard` 视为错误建模
- 若用户明确要求“优化当前图片节点/当前图像节点/这个图片节点”的提示词，且当前选中节点是 `kind=image` / `imageEdit`，优先把它视为“改写既有节点配置”而不是“新建另一条生成链”
- 做图片节点提示词优化前，先读取 `tapcanvas_node_context_bundle_get`，确认当前节点的 `prompt/systemPrompt/negativePrompt`、结果图、参考图、上下游和 diagnostics；若节点已有结果图但提示词缺失，可把结果图当作取证输入，再决定是否需要 specialist
- 对既有图片节点的提示词改写，优先使用 `tapcanvas_flow_patch.patchNodeData` 回写原节点；若要覆盖已有 `prompt/systemPrompt/negativePrompt`，必须显式传 `allowOverwrite=true`
- 除非用户明确要求改模型、比例、样张数或分叉新版本，否则图片节点提示词优化默认保留原有 `imageModel/aspect/sampleCount` 等执行参数，只改与提示词直接相关的字段
- 若目标是添加 `kind=text` 节点，允许创建空内容占位节点；不要因为缺少 `prompt` / `text` 而阻止写入
- 若目标是添加空白文本节点，优先用 `tapcanvas_flow_patch.createNodes`；最小可用 payload：`{"createNodes":[{"type":"taskNode","position":{"x":0,"y":0},"data":{"kind":"text","label":"空白文本","nodeWidth":380,"nodeHeight":360}}]}`。空占位时可省略 `prompt` / `text` / `textResults`
- 只有在需要批量规划、多节点布局、前端补位执行或当前写入证据不足时，才退回输出合法 `<tapcanvas_canvas_plan>`
- 若证据不足，显式报错；不要编造、不要静默降级

## 输出契约

- 若目标是问答：输出基于证据的自然语言答案
- 若目标是画布规划：输出合法 `<tapcanvas_canvas_plan>`
- 若 `<tapcanvas_canvas_plan>` 中包含 `kind=composeVideo|video` 节点，必须在 `nodes[].config` 中写入可执行 `prompt`；`prompt` 必须是最终生产提示词本体，运行时会继续拼接连入文本节点内容，不要再额外输出平行的 `videoPrompt`。若还想保留拍点拆解，可选写 `storyBeatPlan`，但它不参与实际生成调用
- 只要任一画面/视频节点基于小说章节正文生成，必须在节点 `config` 中显式写入 `sourceBookId`、`materialChapter`，并同步补齐 `bookId`、`chapterId`
- 若目标是确定性画布执行：优先直接写入画布，并如实说明已执行结果
- 若目标是章节资产补齐，而本轮已把可执行 preproduction / anchors 节点写入画布：如实说明“已写入待执行节点，等待工作台自动执行”，不要虚构已出图，也不要把这类宿主侧 auto-run handoff 说成失败
- 若目标是生成：可以生成资产，但仍需通过画布计划回填节点
- 若无法继续：清楚列出缺失证据与阻塞原因
