/**
 * AI tool contracts + canvas node capability specs.
 *
 * NOTE: This file is intentionally a lightweight, implementation-aligned
 * source of truth for model/node capabilities (kept in sync with apps/web).
 */

export type CanvasNodeKind =
	| "text"
	| "imageEdit"
	| "novelDoc"
	| "scriptDoc"
	| "storyboardScript"
	| "image"
	| "cameraRef"
	| "workflowInput"
	| "workflowOutput"
	| "storyboardImage"
	| "imageFission"
	| "mosaic"
	| "video"
	| "composeVideo"
	| "storyboard"
	| "audio"
	| "subtitle";

export type CanvasCapabilityToolSchema = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

export type CanvasCapabilityNodeSpec = {
	label: string;
	purpose: string;
	output?: Record<string, string>;
	fields?: Record<string, string>;
	input?: Record<string, string>;
	recommendedModels?: string[];
	models?: Record<string, unknown>;
};

export type CanvasCapabilityManifest = {
	version: string;
	summary: string;
	localCanvasTools: CanvasCapabilityToolSchema[];
	remoteTools: CanvasCapabilityToolSchema[];
	nodeSpecs: Record<string, CanvasCapabilityNodeSpec>;
	protocols: {
		flowPatch: {
			supportedMutationOperations: readonly string[];
			supportedCreateNodeTypes: readonly string[];
			supportedTaskNodeKinds: readonly CanvasNodeKind[];
			groupedWriteLayout: readonly string[];
			handleMatrix: {
				textLikeSources: readonly string[];
				imageLikeTargets: readonly string[];
				imageLikeSources: readonly string[];
				videoLikeTargets: readonly string[];
				videoLikeSources: readonly string[];
			};
			storyboard: {
				editorCellFactField: string;
				editorCellPromptField: string;
				runtimeTelemetryFields: readonly string[];
			};
			chapterGroundedVisualContract: readonly string[];
		};
		executionModel: {
			canvasWritesVia: readonly string[];
			assetGenerationFlow: readonly string[];
		};
	};
};

/**
 * Tool schemas.
 * These contracts describe the real frontend-executable canvas operations
 * exposed to AI chat / agent flows.
 */
export const canvasToolSchemas = [
	{
		name: "reflowLayout",
		description:
			"重排当前画布布局。可用于整理整个画布、只整理顶层分组，或只整理某个组的组内内容；应在节点/组创建、连线调整后显式调用，避免重叠。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				scope: {
					type: "string",
					enum: ["canvas", "topLevelGroups", "group"],
					description:
						"布局作用范围。canvas=重排整个画布并顺带整理顶层组；topLevelGroups=只整理顶层 groupNode；group=只整理指定 group 的内部节点。",
				},
				targetGroupId: {
					type: "string",
					description: "当 scope=group 时必填，表示要重排的 groupNode id。",
				},
				focusNodeId: {
					type: "string",
					description: "可选。scope=canvas 时在重排结束后聚焦选中该节点。",
				},
			},
			required: ["scope"],
		},
	},
] as const;

const FLOW_PATCH_SUPPORTED_CREATE_NODE_TYPES = ["taskNode", "groupNode"] as const;
const FLOW_PATCH_SUPPORTED_TASK_NODE_KINDS = [
	"text",
	"imageEdit",
	"novelDoc",
	"scriptDoc",
	"storyboardScript",
	"image",
	"cameraRef",
	"workflowInput",
	"workflowOutput",
	"storyboardImage",
	"imageFission",
	"mosaic",
	"video",
	"composeVideo",
	"storyboard",
	"audio",
	"subtitle",
] as const satisfies readonly CanvasNodeKind[];

const FLOW_PATCH_RUNTIME_TELEMETRY_FIELDS = [
	"status",
	"progress",
	"runToken",
	"httpStatus",
	"lastResult",
	"imageModel",
	"videoModel",
	"modelVendor",
] as const;

/**
 * Node kind + model capability specs.
 * Keep this aligned with the frontend model lists / runner constraints.
 */
export const canvasNodeSpecs = {
	text: {
		label: "文本",
		purpose: "统一文本节点，承载通用 prompt_refine/chat 结果，可作为脚本与文案中间层；允许创建空文本节点作为占位或后续补写锚点。",
		output: {
			textResults: "Array<{ text: string }>",
		},
		fields: {
			prompt: "string (optional; empty text node allowed)",
			systemPrompt: "string (optional)",
			modelSelect: "string (chat/prompt_refine models)",
		},
	},
	novelDoc: {
		label: "小说文档",
		purpose: "承载项目内小说/章节原文，作为剧本与分镜脚本生成的上游文本资产节点。",
		output: {
			textResults: "Array<{ text: string }>",
		},
		fields: {
			prompt: "string (novel content or chapter excerpt)",
			systemPrompt: "string (optional)",
			modelSelect: "string (chat/prompt_refine models)",
		},
	},
	scriptDoc: {
		label: "剧本文档",
		purpose: "承载结构化剧本文本，可由小说提炼生成，也可手工改写后供分镜脚本/视频节点引用。",
		output: {
			textResults: "Array<{ text: string }>",
		},
		fields: {
			prompt: "string (script content)",
			systemPrompt: "string (optional)",
			modelSelect: "string (chat/prompt_refine models)",
		},
	},
	storyboardScript: {
		label: "分镜脚本",
		purpose:
			"承载镜头级文本分解（Shot 列表、镜头语言与时长描述），作为分镜图与视频节点的文本上游。若当前还没有镜头图，只应使用 storyboardScript/text 承载逐镜头文本，不应误用 storyboard 图片网格节点。",
		output: {
			textResults: "Array<{ text: string }>",
		},
		fields: {
			prompt: "string (shot-by-shot storyboard script)",
			systemPrompt: "string (optional)",
			modelSelect: "string (chat/prompt_refine models)",
		},
	},
	cameraRef: {
		label: "机位参考",
		purpose: "输出可直接拼接到图像节点 Prompt 的英文镜头参数提示词，用于生成不同机位/镜头设置的图像。",
		output: {
			prompt: "string (English prompt snippet)",
		},
		fields: {
			azimuthDeg: "number (0-360)",
			elevationDeg: "number (-45..45)",
			shot: "enum (closeUp/mediumCloseUp/mediumShot/mediumFull/fullShot/wideShot)",
			composition: "enum (none/thirds/center/diagonal/leadingLines/framing)",
			focalMm: "number (18-200)",
			aperture: "number (f-stop)",
			shutterDenominator: "number (e.g. 125 -> 1/125)",
			iso: "number (e.g. 100)",
			masterMode: "boolean (Wes Anderson preset)",
			filmMode: "boolean (Kodak Portra 400 preset)",
			includeStoryboardSheet: "boolean (append 4-panel grid instruction)",
			extraPrompt: "string (optional, appended)",
		},
	},
	workflowInput: {
		label: "工作流输入",
		purpose: "作为工作流的可选入参锚点节点；可承载默认 prompt 或在外部执行时注入参数。",
		fields: {
			prompt: "string (optional default input payload)",
		},
		output: {
			any: "通过 out-any 向下游传递输入上下文",
		},
	},
	workflowOutput: {
		label: "工作流输出",
		purpose: "作为工作流最终产物的显式出口节点。执行前必须至少存在一个该节点。",
		fields: {},
		input: {
			any: "通过 in-any 接收上游结果",
		},
	},
	video: {
		label: "图生/文生视频",
		purpose: "视频执行节点。`prompt` 是唯一真实执行的视频生产提示词，运行时会在此基础上继续拼接画布连入的文本节点内容。若需要导演视角、经典镜头借鉴、动作边界或物理约束，必须直接写进 `prompt`。若上游是长镜头脚本，应优先把逐镜头文本拆成多个 text/storyboardScript/scriptDoc 节点后再连接到 composeVideo/video。",
		recommendedModels: ["veo3.1-pro", "veo3.1-fast"],
		models: {
			"veo3.1-pro": {
				label: "Veo 3.1 Pro",
				vendor: "veo",
				supports: {
					aspectRatio: ["16:9", "9:16"],
					durationSeconds: [5],
					hd: false,
				},
				input: {
					prompt: "string (required executable production prompt)",
					storyBeatPlan: "Array<string | { summary: string; rhythm?: string; durationSec?: number; motionIntensity?: string; continuity?: string; cameraMotion?: string }> (required human-readable beat list)",
					upstreamTextNodes: "recommended: multiple text/storyboardScript/scriptDoc nodes, one per shot or beat segment",
					images: "string[] (url/base64)",
				},
			},
			"veo3.1-fast": {
				label: "Veo 3.1 Fast",
				vendor: "veo",
				supports: {
					aspectRatio: ["16:9", "9:16"],
					durationSeconds: [5],
					hd: false,
				},
				input: {
					prompt: "string (required executable production prompt)",
					storyBeatPlan: "Array<string | { summary: string; rhythm?: string; durationSec?: number; motionIntensity?: string; continuity?: string; cameraMotion?: string }> (required human-readable beat list)",
					upstreamTextNodes: "recommended: multiple text/storyboardScript/scriptDoc nodes, one per shot or beat segment",
					images: "string[] (url/base64)",
				},
			},
		},
	},
	image: {
		label: "图像",
		purpose:
			"统一图像生成节点；支持文生图与图生图，输出候选图与主图。若本轮已确认角色卡/权威基底帧/场景锚点，必须把 referenceImages 或 assetInputs 连同角色职责一起持久化到节点数据，不能只在 prompt 文案里口头提到。提示词应尽量具体，包含用途/上下文、主体数量、空间关系、镜头、光线、材质与情绪；复杂画面可分步描述，并优先用正向语义定义目标场景而不是简单堆负面词。需要高精度控制时，可直接使用英文或中英混合镜头语言。",
		recommendedModels: [
			"gemini-3.1-flash-image-preview",
			"gemini-3-pro-image-preview",
			"gemini-2.5-flash-image",
		],
		output: {
			imageResults: "Array<{ url: string; title?: string }>",
			imageUrl: "string (primary)",
		},
		fields: {
			prompt: "string",
			structuredPrompt:
				"optional ImagePromptSpecV2 JSON view of the same executable prompt. For chapter-grounded generation, prefer filling referenceBindings + identityConstraints instead of leaving reference reuse implicit.",
			systemPrompt: "string (optional)",
			anchorBindings:
				"Array<{ kind: 'character'|'scene'|'prop'|'shot'|'story'|'asset'|'context'|'authority_base_frame'; label?: string; refId?: string; entityId?: string; imageUrl?: string; sourceBookId?: string; referenceView?: 'three_view'|'role_card'; category?: string }> (canonical semantic anchor definition shared across characters, scenes, props, story beats and assets)",
			referenceImages:
				"string[] (optional but mandatory when this node must directly reuse request-carried reference images and no canvas edge carries them)",
			assetInputs:
				"Array<{ url: string; role?: string; assetId?: string; assetRefId?: string; name?: string; note?: string }> (optional but preferred when role semantics such as character/context/target must survive execution)",
			imageCameraControl:
				"optional { enabled?: boolean; presetId?: 'front'|'left'|'right'|'back'|'left45'|'right45'|'topDown'|'lowAngle'; azimuthDeg?: number; elevationDeg?: number; distance?: number }. When enabled, runtime will append a 3D-camera-style viewpoint instruction to the final prompt.",
			imageLightingRig:
				"optional { main?: { enabled?: boolean; presetId?: 'left'|'top'|'right'|'topLeft'|'front'|'topRight'|'bottom'|'back'; azimuthDeg?: number; elevationDeg?: number; intensity?: number; colorHex?: string }; fill?: same-shape }. When enabled, runtime will append main/fill lighting instructions to the final prompt.",
			imageModel: "string",
			aspect: "string (e.g. 16:9 / 9:16 / 1:1)",
			imageSize: "string (e.g. 2K/4K)",
			sampleCount: "number",
			reversePrompt: "string (optional)",
		},
		models: {
			"gemini-3.1-flash-image-preview": {
				label: "Gemini 3.1 Flash Image Preview",
				recommendedFor:
					"默认首选；兼顾质量、成本、延迟与指令理解，适合作为通用图片生成基线。",
				strengths: {
					characterConsistency:
						"单一工作流内可维持约 4 个角色相似度，并维持约 10 个物体细节保真。",
					execution:
						"适合章节关键帧、角色/场景锚点、剧情图、需要稳定复用参考图绑定的场景。",
				},
			},
			"gemini-3-pro-image-preview": {
				label: "Gemini 3 Pro Image Preview",
				recommendedFor:
					"专业资产制作、复杂构图、高保真素材、复杂指令和更高分辨率输出。",
				strengths: {
					referenceInputs: "支持 5 张高保真参考图，总输入最多 14 张。",
					output: "支持更高分辨率输出，适合专业资源生产。",
				},
			},
			"gemini-2.5-flash-image": {
				label: "Gemini 2.5 Flash Image",
				recommendedFor:
					"速度或批量优先的低延迟任务；不应作为默认首选。",
				strengths: {
					referenceInputs: "最多支持 3 张输入图。",
					output: "适合快速草图、批量初稿、低成本高频生成。",
				},
			},
		},
	},
	imageEdit: {
		label: "图片编辑",
		purpose:
			"统一图像编辑节点；以入图为基础做风格/构图/细节编辑，功能以可选能力启用。若编辑任务依赖明确角色或道具身份，必须保留原始 referenceImages / assetInputs / 绑定语义，避免编辑后漂移成默认人物或默认物体。",
		recommendedModels: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"],
		output: {
			imageResults: "Array<{ url: string; title?: string }>",
			imageUrl: "string (primary)",
		},
		fields: {
			prompt: "string",
			systemPrompt: "string (optional)",
			anchorBindings:
				"Same canonical anchorBindings contract as image nodes. Editing nodes must preserve identity/context anchors here when they depend on character / scene / prop continuity.",
			referenceImages:
				"string[] (recommended when editing should use the current image as the primary base frame; runtime treats non-empty referenceImages as image_edit execution)",
			assetInputs:
				"Array<{ url: string; role?: string; assetId?: string; assetRefId?: string; name?: string; note?: string }> (optional; preserve semantic roles for character / scene / target / continuity references)",
			imageCameraControl:
				"optional camera control object with the same contract as image nodes. Use it when the edit should change viewpoint via prompt injection instead of freeform prompt prose only.",
			imageLightingRig:
				"optional lighting rig object with the same contract as image nodes. Use it when the edit should relight the reference with explicit main/fill light directions.",
			imageModel: "string",
			aspect: "string (optional)",
			imageSize: "string (optional)",
			sampleCount: "number (optional)",
		},
	},
	storyboard: {
		label: "分镜编辑",
		purpose:
			"手工分镜编辑节点。用于把多张镜头图按固定网格排布、定点替换、拖出单格图片，并在需要时合成为一张总览图继续供下游视频/图像节点引用。它不是镜头脚本文本容器；若只有逐镜头文本而没有图片，应使用 storyboardScript/text 节点。若节点已带 chapter-grounded 的 productionMetadata + authorityBaseFrame，并且 storyboardEditorCells 内已有真实 imageUrl，则应把它视为执行型分镜板，而不是普通占位网格。若分镜板继承已有角色/场景锚点，也必须把 referenceImages 或 assetInputs 显式落到节点数据或通过真实连边表达，不能依赖默认角色。",
		output: {
			imageResults: "Array<{ url: string; title?: string }> (optional; composed sheet)",
			imageUrl: "string (optional primary composed sheet)",
			storyboardEditorCells:
				"Array<{ id: string; imageUrl: string | null; label?: string; prompt?: string; sourceKind?: string; sourceNodeId?: string; sourceIndex?: number; shotNo?: number }>",
		},
		fields: {
			storyboardEditorGrid: "enum (2x2 / 3x2 / 3x3 / 5x5)",
			storyboardEditorAspect: "enum (1:1 / 4:3 / 16:9 / 9:16)",
			storyboardEditorEditMode: "boolean",
			storyboardEditorCollapsed: "boolean",
			productionLayer: "enum (evidence / constraints / anchors / expansion / execution / results)",
			creationStage:
				"enum (source_understanding / constraint_definition / world_anchor_lock / character_anchor_lock / shot_anchor_lock / single_variable_expansion / approved_keyframe_selection / video_plan / video_execution / result_persistence)",
			approvalStatus: "enum (needs_confirmation / approved / rejected)",
			productionMetadata:
				"{ chapterGrounded: true; lockedAnchors: { character: string[]; scene: string[]; shot: string[]; continuity: string[]; missing: string[] }; authorityBaseFrame: { status: 'planned' | 'confirmed'; source: string; reason: string; nodeId: string | null } }",
			anchorBindings:
				"Canonical semantic anchor array shared with image/imageEdit nodes. Persist character / scene / prop / shot / story anchors here instead of inventing new flat binding fields.",
			referenceImages:
				"string[] (persist real inherited reference image URLs when no upstream edge carries them)",
			assetInputs:
				"Array<{ url: string; role?: string; assetId?: string; assetRefId?: string; name?: string; note?: string }> (persist role-aware bindings, especially character/context anchors)",
			storyboardEditorCells:
				"Array<{ id: string; imageUrl: string | null; label?: string; prompt?: string; sourceKind?: string; sourceNodeId?: string; sourceIndex?: number; shotNo?: number }>. cell.prompt 表示单格镜头执行提示词，不是整个 storyboard 节点的文本正文；cell.imageUrl 才是该格是否已有真实资产的事实依据。",
			runtimeTelemetry:
				"Optional runtime-only fields such as status / progress / runToken / lastResult / modelVendor may exist on persisted nodes. Agents may read them for diagnostics, but must not treat them as prompt/config substitutes.",
		},
	},
} as const satisfies Record<string, unknown>;

export function buildCanvasCapabilityManifest(input?: {
	remoteTools?: readonly CanvasCapabilityToolSchema[];
	hideStoryboardEditor?: boolean;
}): CanvasCapabilityManifest {
	const hideStoryboardEditor = input?.hideStoryboardEditor === true;
	const supportedTaskNodeKinds = hideStoryboardEditor
		? FLOW_PATCH_SUPPORTED_TASK_NODE_KINDS.filter((kind) => kind !== "storyboard")
		: FLOW_PATCH_SUPPORTED_TASK_NODE_KINDS;
	const nodeSpecs = hideStoryboardEditor
		? Object.fromEntries(
				Object.entries(canvasNodeSpecs).filter(([kind]) => kind !== "storyboard"),
			)
		: canvasNodeSpecs;
	return {
		version: "2026-04-03",
		summary:
			"TapCanvas canvas capability manifest. Use this as the source of truth for real canvas interfaces, node kinds, flow patch constraints, and bridge-exposed remote tools. Do not invent node kinds, handles, or write paths outside this manifest.",
		localCanvasTools: canvasToolSchemas.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		})),
		remoteTools: (input?.remoteTools || []).map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		})),
		nodeSpecs: nodeSpecs as Record<string, CanvasCapabilityNodeSpec>,
		protocols: {
			flowPatch: {
				supportedMutationOperations: [
					"deleteNodeIds",
					"deleteEdgeIds",
					"createNodes",
					"createEdges",
					"patchNodeData",
					"appendNodeArrays",
				],
				supportedCreateNodeTypes: FLOW_PATCH_SUPPORTED_CREATE_NODE_TYPES,
				supportedTaskNodeKinds,
				groupedWriteLayout: [
					"When createNodes writes grouped nodes (groupNode containers or child nodes with parentId), persisted flow data is normalized parent-first before save.",
					"Each affected group is compacted after write, and grouped child node order follows the final node list order. Put grouped children in the exact visual sequence you want preserved.",
					"deleteNodeIds removes existing nodes by id and cascades connected edge removal; deleteEdgeIds removes only the listed edges.",
				],
				handleMatrix: {
					textLikeSources: ["out-text", "out-text-wide"],
					imageLikeTargets: ["in-image", "in-image-wide"],
					imageLikeSources: ["out-image", "out-image-wide"],
					videoLikeTargets: ["in-any", "in-any-wide"],
					videoLikeSources: ["out-video", "out-video-wide"],
				},
				...(hideStoryboardEditor
					? {}
					: {
							storyboard: {
								editorCellFactField: "storyboardEditorCells[*].imageUrl",
								editorCellPromptField: "storyboardEditorCells[*].prompt",
								runtimeTelemetryFields: FLOW_PATCH_RUNTIME_TELEMETRY_FIELDS,
							},
						}),
				chapterGroundedVisualContract: [
					`${hideStoryboardEditor ? "image/imageEdit/storyboardImage/video/composeVideo" : "image/storyboard/video/composeVideo"} nodes in the same patch batch must carry productionLayer, creationStage, approvalStatus, and productionMetadata.`,
					"productionMetadata must include lockedAnchors and authorityBaseFrame.",
					"When the request already carries confirmed character / scene / authority-base references, every created visual node must also persist those bindings via referenceImages, assetInputs, or explicit createEdges from the authority node. Prompt wording alone is not sufficient.",
					"If a node is character-bound, persist at least one character role binding instead of silently falling back to a generic/default person description.",
					"When authorityBaseFrame.status is planned, materialized execution must stop at a base-frame stage instead of directly generating video outputs.",
					"For chapter-level stop-motion or storyboard creation, the primary deliverable must be multiple shot-level stills (image/imageEdit/storyboardImage or storyboard cells with real imageUrl), not a single base frame plus a video placeholder.",
				],
			},
			executionModel: {
				canvasWritesVia: ["tapcanvas_flow_patch"],
				assetGenerationFlow: [
					"Agents should create or patch runnable canvas nodes via tapcanvas_flow_patch.",
					`The web app executes runnable ${hideStoryboardEditor ? "image/imageEdit/storyboardImage" : "image/storyboard"} nodes after canvas write succeeds.`,
					"Video and composeVideo nodes are usually follow-up executable nodes, not the only deliverable.",
				],
			},
		},
	};
}
