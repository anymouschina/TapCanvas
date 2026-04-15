import { z } from "zod";

export const CANVAS_PLAN_TAG_NAME = "tapcanvas_canvas_plan" as const;

const positionSchema = z.object({
	x: z.number(),
	y: z.number(),
});

export const canvasPlanNodeSchema = z.object({
	clientId: z.string().min(1),
	kind: z.string().min(1),
	label: z.string().min(1),
	nodeType: z.string().min(1).optional(),
	position: positionSchema.optional(),
	groupId: z.string().min(1).optional(),
	groupLabel: z.string().min(1).optional(),
	config: z.record(z.string(), z.unknown()).optional(),
});

export const canvasPlanEdgeSchema = z.object({
	sourceClientId: z.string().min(1),
	targetClientId: z.string().min(1),
	sourceHandle: z.string().min(1).optional(),
	targetHandle: z.string().min(1).optional(),
});

export const canvasPlanSchema = z.object({
	action: z.literal("create_canvas_workflow"),
	summary: z.string().optional(),
	reason: z.string().optional(),
	nodes: z.array(canvasPlanNodeSchema).min(1),
	edges: z.array(canvasPlanEdgeSchema).optional(),
});

export type ChatCanvasPlan = z.infer<typeof canvasPlanSchema>;

export const CANVAS_PLAN_PROTOCOL_FORMAT_HINT =
	'{"action":"create_canvas_workflow","summary":"...","reason":"...","nodes":[{"clientId":"n1","kind":"text|image|imageEdit|composeVideo|novelDoc|storyboardScript|storyboardShot|novelStoryboard|...","label":"...","nodeType":"可选，默认同 kind","groupId":"可选","groupLabel":"可选","position":{"x":0,"y":0},"config":{}}],"edges":[{"sourceClientId":"n1","targetClientId":"n2","sourceHandle":"可选","targetHandle":"可选"}]}';

export const CANVAS_PLAN_VISUAL_PROMPT_REQUIRED_HINT =
	'- 对 kind=image|storyboardShot|novelStoryboard 的节点，nodes[].config.prompt 必须始终填写“可直接生成的视觉提示词”，不能省略；label 只允许作为标题，绝不能替代 prompt。若你还要提供与 prompt 等价的结构化 JSON 编辑视图，请统一写到 `nodes[].config.structuredPrompt`，不要再输出 `imagePromptSpecV2`；其 schema 与 v2 图片提示词一致，至少写清 `version=v2`、`shotIntent`、`spatialLayout`、`cameraPlan`、`lightingPlan`，并用 `continuityConstraints` / `negativeConstraints` 固定连续性与禁止漂移项。';

export const CANVAS_PLAN_STORYBOARD_EDITOR_REQUIRED_HINT =
	'- 对 kind=storyboard 的节点，nodes[].config 必须把它视为“分镜编辑图片网格”：应显式提供 `storyboardEditorCells`（可为空图格占位，但字段必须表达网格意图）。`storyboardEditorCells[*].prompt` 是单格镜头提示词，`storyboardEditorCells[*].imageUrl` 才是该格是否已有真实资产的事实依据。禁止把 shot list、章节拆解或长段镜头说明塞进 content/prompt/text 来假装分镜编辑；若当前只有逐镜头文本而没有镜头图，请改用 kind=storyboardScript 或 kind=text。若该分镜板属于章节绑定的执行板，还应同时写入 `productionLayer`、`creationStage`、`approvalStatus` 与 `productionMetadata.authorityBaseFrame`；仅 `status/progress/runToken/lastResult` 这类运行时字段不能代替上述生产协议。';

export const CANVAS_PLAN_VIDEO_PROMPT_REQUIRED_HINT =
	'- 对 kind=composeVideo|video 的节点，nodes[].config.prompt 必须始终填写“可直接执行的视频生产提示词”。执行阶段会在此 prompt 基础上继续拼接画布连入的文本节点内容，因此这里必须写真实生产 prompt，不能只写概述标题，也不要再额外输出 `videoPrompt` 等平行字段。';

export const CANVAS_PLAN_VIDEO_GOVERNANCE_HINT =
	'- 若需要导演视角、经典镜头借鉴、动作边界、物理约束等信息，必须直接写进 `prompt` 本体；不要拆到不会参与模型调用的旁路字段。';

export const CANVAS_PLAN_NOVEL_TRACEABILITY_REQUIRED_HINT =
	'- 只要节点依据小说章节正文生成，尤其是 kind=image|storyboardShot|novelStoryboard|composeVideo|video，nodes[].config 必须显式包含 `sourceBookId` 与 `materialChapter`，并同步写入别名 `bookId` 与 `chapterId`，确保后续选中节点后能够继续重写、续写与追溯章节来源。';
