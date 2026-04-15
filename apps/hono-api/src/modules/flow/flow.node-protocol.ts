type PublicFlowNodeLike = {
	type?: unknown;
	data?: unknown;
};

type PublicFlowTaskNodeCoreType = "text" | "image" | "video" | "storyboard";

type PublicFlowNodeHandles = {
	targets: ReadonlySet<string>;
	sources: ReadonlySet<string>;
};

const PUBLIC_FLOW_TASK_NODE_KIND_TO_CORE: Record<string, PublicFlowTaskNodeCoreType> = {
	text: "text",
	noveldoc: "text",
	scriptdoc: "text",
	storyboardscript: "text",
	workflowinput: "text",
	workflowoutput: "text",
	cameraref: "text",
	tts: "text",
	subtitlealign: "text",
	subflow: "text",

	image: "image",
	imageedit: "image",
	texttoimage: "image",
	text_to_image: "image",
	storyboardimage: "image",
	novelstoryboard: "image",
	storyboardshot: "image",
	imagefission: "image",
	mosaic: "image",

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
};

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
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
	const kind = typeof data?.kind === "string" ? data.kind : null;
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
