type PublicFlowNodeLike = {
	type?: unknown;
	data?: unknown;
};

type PublicFlowTaskNodeCoreType = "text" | "image" | "video" | "storyboard" | "audio";

type PublicFlowNodeHandles = {
	targets: ReadonlySet<string>;
	sources: ReadonlySet<string>;
};

const PUBLIC_FLOW_TASK_NODE_KIND_TO_CORE: Record<string, PublicFlowTaskNodeCoreType> = {
	text: "text",
	codex: "text",
	noveldoc: "text",
	scriptdoc: "text",
	storyboardscript: "text",
	workflowinput: "text",
	workflowoutput: "text",
	cameraref: "text",
	subtitlealign: "text",
	subflow: "text",

	audio: "audio",
	tts: "audio",
	speech: "audio",

	image: "image",
	imageedit: "image",
	texttoimage: "image",
	text_to_image: "image",
	storyboardimage: "image",
	novelstoryboard: "image",
	storyboardshot: "image",
	imagefission: "image",

	video: "video",
	composevideo: "video",

	storyboard: "storyboard",
	storyboardedit: "storyboard",
	storyboardeditor: "storyboard",
};

const PUBLIC_FLOW_NODE_HANDLES_BY_CORE: Record<
	PublicFlowTaskNodeCoreType,
	PublicFlowNodeHandles
> = {
	text: {
		targets: new Set<string>(),
		sources: new Set<string>(["out-text", "out-text-wide"]),
	},
	image: {
		targets: new Set<string>(["in-image", "in-image-wide"]),
		sources: new Set<string>(["out-image", "out-image-wide"]),
	},
	video: {
		targets: new Set<string>(["in-any", "in-any-wide"]),
		sources: new Set<string>(["out-video", "out-video-wide"]),
	},
	storyboard: {
		targets: new Set<string>(["in-image", "in-image-wide"]),
		sources: new Set<string>(["out-image", "out-image-wide"]),
	},
	audio: {
		targets: new Set<string>(["in-text", "in-text-wide"]),
		sources: new Set<string>(["out-audio", "out-audio-wide"]),
	},
};

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function workflowPorts(
	data: Record<string, unknown>,
	direction: "input" | "output",
): string[] | null {
	const spec = asObject(data.workflowAtomicSpec);
	const value = spec?.[direction === "input" ? "inputPorts" : "outputPorts"]
		?? data[direction === "input" ? "workflowInputPorts" : "workflowOutputPorts"];
	if (!Array.isArray(value)) return null;
	return value.flatMap((port) => (
		typeof port === "string" && port.trim()
			? [port.trim()]
			: []
	));
}

function workflowHandles(data: Record<string, unknown>): PublicFlowNodeHandles | null {
	const inputs = workflowPorts(data, "input");
	const outputs = workflowPorts(data, "output");
	if (!inputs && !outputs) return null;
	return {
		targets: new Set((inputs ?? []).map((port) => `in-workflow:${encodeURIComponent(port)}`)),
		sources: new Set((outputs ?? []).map((port) => `out-workflow:${encodeURIComponent(port)}`)),
	};
}

export function getPublicFlowTaskNodeCoreType(
	kind: string | null | undefined,
): PublicFlowTaskNodeCoreType | null {
	const normalized = typeof kind === "string" ? kind.trim().toLowerCase() : "";
	if (!normalized) return null;
	return PUBLIC_FLOW_TASK_NODE_KIND_TO_CORE[normalized] || null;
}

export function getPublicFlowNodeHandles(
	node: PublicFlowNodeLike | null | undefined,
): PublicFlowNodeHandles | null {
	if (!node || node.type !== "taskNode") return null;
	const data = asObject(node.data);
	if (!data) return null;
	const declaredWorkflowHandles = workflowHandles(data);
	if (declaredWorkflowHandles) return declaredWorkflowHandles;
	const kind = typeof data?.kind === "string" ? data.kind : null;
	if (kind?.trim().toLowerCase() === "codex") {
		return {
			targets: new Set<string>(["in-any", "in-any-wide"]),
			sources: new Set<string>(["out-text", "out-text-wide"]),
		};
	}
	const coreType = getPublicFlowTaskNodeCoreType(kind);
	if (!coreType) return null;
	return PUBLIC_FLOW_NODE_HANDLES_BY_CORE[coreType];
}

export function listPublicFlowNodeHandles(
	node: PublicFlowNodeLike | null | undefined,
	direction: "source" | "target",
): string[] {
	const handles = getPublicFlowNodeHandles(node);
	if (!handles) return [];
	const handleSet = direction === "source" ? handles.sources : handles.targets;
	return Array.from(handleSet.values());
}
