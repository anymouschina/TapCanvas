export const CANVAS_PLAN_TAG_NAME = "tapcanvas_canvas_plan" as const;

export type CanvasPlanPosition = {
	x: number;
	y: number;
};

export type ChatCanvasPlanNode = {
	clientId: string;
	kind: string;
	label: string;
	nodeType?: string;
	position?: CanvasPlanPosition;
	groupId?: string;
	groupLabel?: string;
	config?: Record<string, unknown>;
};

export type ChatCanvasPlanEdge = {
	sourceClientId: string;
	targetClientId: string;
	sourceHandle?: string;
	targetHandle?: string;
};

export type ChatCanvasPlan = {
	action: "create_canvas_workflow";
	summary?: string;
	reason?: string;
	nodes: ChatCanvasPlanNode[];
	edges?: ChatCanvasPlanEdge[];
};

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseFailure = { success: false; error: { message: string } };
type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

type SafeParseSchema<T> = {
	safeParse(input: unknown): SafeParseResult<T>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function normalizeRequiredString(
	value: unknown,
	fieldName: string,
): string | SafeParseFailure {
	if (typeof value !== "string" || value.length < 1) {
		return { success: false, error: { message: `${fieldName} must be a non-empty string` } };
	}
	return value;
}

function normalizeOptionalString(value: unknown): string | undefined | SafeParseFailure {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		return { success: false, error: { message: "optional field must be a string" } };
	}
	return value;
}

function normalizePosition(input: unknown): CanvasPlanPosition | undefined | SafeParseFailure {
	if (input === undefined) return undefined;
	const record = asRecord(input);
	if (!record) return { success: false, error: { message: "position must be an object" } };
	const x = record.x;
	const y = record.y;
	if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) {
		return { success: false, error: { message: "position.x and position.y must be numbers" } };
	}
	return { x, y };
}

function normalizeConfig(input: unknown): SafeParseResult<Record<string, unknown> | undefined> {
	if (input === undefined) return { success: true, data: undefined };
	const record = asRecord(input);
	if (!record) return { success: false, error: { message: "config must be an object" } };
	return { success: true, data: record };
}

function normalizeCanvasPlanNode(input: unknown): SafeParseResult<ChatCanvasPlanNode> {
	const record = asRecord(input);
	if (!record) return { success: false, error: { message: "node must be an object" } };

	const clientId = normalizeRequiredString(record.clientId, "clientId");
	if (typeof clientId !== "string") return clientId;
	const kind = normalizeRequiredString(record.kind, "kind");
	if (typeof kind !== "string") return kind;
	const label = normalizeRequiredString(record.label, "label");
	if (typeof label !== "string") return label;

	const nodeType = normalizeOptionalString(record.nodeType);
	if (nodeType && typeof nodeType !== "string") return nodeType;
	const position = normalizePosition(record.position);
	if (position && !("x" in position)) return position;
	const groupId = normalizeOptionalString(record.groupId);
	if (groupId && typeof groupId !== "string") return groupId;
	const groupLabel = normalizeOptionalString(record.groupLabel);
	if (groupLabel && typeof groupLabel !== "string") return groupLabel;
	const configResult = normalizeConfig(record.config);
	if (!configResult.success) return configResult;
	const config = configResult.data;

	return {
		success: true,
		data: {
			clientId,
			kind,
			label,
			...(nodeType ? { nodeType } : null),
			...(position ? { position } : null),
			...(groupId ? { groupId } : null),
			...(groupLabel ? { groupLabel } : null),
			...(config ? { config } : null),
		},
	};
}

function normalizeCanvasPlanEdge(input: unknown): SafeParseResult<ChatCanvasPlanEdge> {
	const record = asRecord(input);
	if (!record) return { success: false, error: { message: "edge must be an object" } };

	const sourceClientId = normalizeRequiredString(record.sourceClientId, "sourceClientId");
	if (typeof sourceClientId !== "string") return sourceClientId;
	const targetClientId = normalizeRequiredString(record.targetClientId, "targetClientId");
	if (typeof targetClientId !== "string") return targetClientId;
	const sourceHandle = normalizeOptionalString(record.sourceHandle);
	if (sourceHandle && typeof sourceHandle !== "string") return sourceHandle;
	const targetHandle = normalizeOptionalString(record.targetHandle);
	if (targetHandle && typeof targetHandle !== "string") return targetHandle;

	return {
		success: true,
		data: {
			sourceClientId,
			targetClientId,
			...(sourceHandle ? { sourceHandle } : null),
			...(targetHandle ? { targetHandle } : null),
		},
	};
}

export const canvasPlanNodeSchema: SafeParseSchema<ChatCanvasPlanNode> = {
	safeParse: normalizeCanvasPlanNode,
};

export const canvasPlanEdgeSchema: SafeParseSchema<ChatCanvasPlanEdge> = {
	safeParse: normalizeCanvasPlanEdge,
};

export const canvasPlanSchema: SafeParseSchema<ChatCanvasPlan> = {
	safeParse(input: unknown): SafeParseResult<ChatCanvasPlan> {
		const record = asRecord(input);
		if (!record) return { success: false, error: { message: "canvas plan must be an object" } };

		if (record.action !== "create_canvas_workflow") {
			return { success: false, error: { message: "action must be create_canvas_workflow" } };
		}

		const summary = normalizeOptionalString(record.summary);
		if (summary && typeof summary !== "string") return summary;
		const reason = normalizeOptionalString(record.reason);
		if (reason && typeof reason !== "string") return reason;
		if (!Array.isArray(record.nodes) || record.nodes.length < 1) {
			return { success: false, error: { message: "nodes must be a non-empty array" } };
		}

		const nodes: ChatCanvasPlanNode[] = [];
		for (const node of record.nodes) {
			const parsedNode = normalizeCanvasPlanNode(node);
			if (!parsedNode.success) return parsedNode;
			nodes.push(parsedNode.data);
		}

		let edges: ChatCanvasPlanEdge[] | undefined;
		if (record.edges !== undefined) {
			if (!Array.isArray(record.edges)) {
				return { success: false, error: { message: "edges must be an array when present" } };
			}
			edges = [];
			for (const edge of record.edges) {
				const parsedEdge = normalizeCanvasPlanEdge(edge);
				if (!parsedEdge.success) return parsedEdge;
				edges.push(parsedEdge.data);
			}
		}

		return {
			success: true,
			data: {
				action: "create_canvas_workflow",
				...(summary ? { summary } : null),
				...(reason ? { reason } : null),
				nodes,
				...(edges ? { edges } : null),
			},
		};
	},
};

export const CANVAS_PLAN_PROTOCOL_FORMAT_HINT =
	'{"action":"create_canvas_workflow","summary":"...","reason":"...","nodes":[{"clientId":"n1","kind":"text|image|imageEdit|composeVideo|novelDoc|storyboardScript|storyboardShot|novelStoryboard|...","label":"...","nodeType":"可选，默认同 kind","groupId":"可选","groupLabel":"可选","position":{"x":0,"y":0},"config":{}}],"edges":[{"sourceClientId":"n1","targetClientId":"n2","sourceHandle":"可选","targetHandle":"可选"}]}';

export const CANVAS_PLAN_VISUAL_PROMPT_REQUIRED_HINT =
	'- 对 kind=image|storyboardShot|novelStoryboard 的节点，nodes[].config.prompt 必须始终填写“可直接生成的视觉提示词”，不能省略；label 只允许作为标题，绝不能替代 prompt。若你还要提供与 prompt 等价的结构化 JSON 编辑视图，请统一写到 `nodes[].config.structuredPrompt`，不要再输出 `imagePromptSpecV2`；其 schema 与 v2 图片提示词一致，至少写清 `version=v2`、`shotIntent`、`spatialLayout`、`cameraPlan`、`lightingPlan`，并用 `continuityConstraints` / `negativeConstraints` 固定连续性与禁止漂移项。';

export const CANVAS_PLAN_STORYBOARD_EDITOR_REQUIRED_HINT =
	'- 对 kind=storyboard 的节点，nodes[].config 必须把它视为“分镜编辑图片网格”：应显式提供 `storyboardEditorCells`（可为空图格占位，但字段必须表达网格意图）。`storyboardEditorCells[*].prompt` 是单格镜头提示词，`storyboardEditorCells[*].imageUrl` 才是该格是否已有真实资产的事实依据。禁止把 shot list、章节拆解或长段镜头说明塞进 content/prompt/text 来假装分镜编辑；若用户要求结构化分镜表/shot table，必须改用 kind=shotTable；只有用户明确要求纯文本逐镜分镜脚本时才使用 kind=storyboardScript 或 kind=text。若该分镜板属于章节绑定的执行板，还应同时写入 `productionLayer`、`creationStage`、`approvalStatus` 与 `productionMetadata.authorityBaseFrame`；仅 `status/progress/runToken/lastResult` 这类运行时字段不能代替上述生产协议。';

export const CANVAS_PLAN_VIDEO_PROMPT_REQUIRED_HINT =
	'- 对 kind=composeVideo|video 的节点，nodes[].config.prompt 必须始终填写“可直接执行的视频生产提示词”。执行阶段会在此 prompt 基础上继续拼接画布连入的文本节点内容，因此这里必须写真实生产 prompt，不能只写概述标题，也不要再额外输出 `videoPrompt` 等平行字段。';

export const CANVAS_PLAN_VIDEO_GOVERNANCE_HINT =
	'- 若需要导演视角、经典镜头借鉴、动作边界、物理约束等信息，必须直接写进 `prompt` 本体；不要拆到不会参与模型调用的旁路字段。';

export const CANVAS_PLAN_NOVEL_TRACEABILITY_REQUIRED_HINT =
	'- 只要节点依据小说章节正文生成，尤其是 kind=image|storyboardShot|novelStoryboard|composeVideo|video，nodes[].config 必须显式包含 `sourceBookId` 与 `materialChapter`，并同步写入别名 `bookId` 与 `chapterId`，确保后续选中节点后能够继续重写、续写与追溯章节来源。';
