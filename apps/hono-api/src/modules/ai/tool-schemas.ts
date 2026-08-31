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
	| "video"
	| "composeVideo"
	| "storyboard"
	| "videoAnalysis"
	| "shotTable"
	| "audio"
	| "subtitle";

export type CanvasCapabilityToolSchema = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execution?: ToolExecutionSemantics;
};

export type ToolExecutionSemantics = {
	sideEffect: "none" | "local_mutation" | "external_mutation" | "paid_generation";
	retrySafety: "safe" | "idempotency_key_required" | "unsafe";
	executionMode: "parallel_safe" | "sequential" | "exclusive";
	idempotencyKeyField: string | null;
	resultLookupSupported: boolean;
};

export const characterIdentityBoardSpecToolSchema = {
	type: "object",
	description:
		"characterAssetRole='identity_anchor' 时使用的纯结构角色身份板合同：正面脸、3/4 脸、正面全身、背面全身四个信息区。协议只验证跨视图一致性、参考职责隔离、中性参考背景、无文字/品牌等可执行结构；体型、媒介、镜头与生活痕迹必须由 agents-cli 的 tapcanvas-character-card 根据角色事实和项目画风决定，禁止协议层默认九头身、真人写实或固定焦段。",
	properties: {
		layout: { type: "string", enum: ["identity_board_four_view"] },
		faceViews: {
			type: "array",
			minItems: 2,
			maxItems: 2,
			uniqueItems: true,
			items: { type: "string", enum: ["front", "three_quarter"] },
			description: "Exactly front then three_quarter face views.",
		},
		fullBodyViews: {
			type: "array",
			minItems: 2,
			maxItems: 2,
			uniqueItems: true,
			items: { type: "string", enum: ["front", "back"] },
			description: "Exactly front then back; render front on the lower left and back on the lower right.",
		},
		crossViewConsistency: { type: "boolean", enum: [true] },
		referenceRoleIsolation: { type: "boolean", enum: [true] },
		neutralReferenceBackground: { type: "boolean", enum: [true] },
		readableTextVisible: { type: "boolean", enum: [false] },
		brandingVisible: { type: "boolean", enum: [false] },
		neutralBaseState: { type: "boolean", enum: [true] },
		canonicalNameVisible: { type: "boolean", enum: [false] },
		ipSafeOriginal: { type: "boolean", enum: [true] },
	},
	required: [
		"layout",
		"faceViews",
		"fullBodyViews",
		"crossViewConsistency",
		"referenceRoleIsolation",
		"neutralReferenceBackground",
		"readableTextVisible",
		"brandingVisible",
		"neutralBaseState",
		"canonicalNameVisible",
		"ipSafeOriginal",
	],
	additionalProperties: false,
} as const;

export const propIdentityBoardSpecToolSchema = {
	type: "object",
	description:
		"prop-card/v1 identity anchor 的纯结构多视图合同。视图由 agents-cli tapcanvas-prop-card 根据真实几何和交互歧义选择；协议层不强制三格、X 光、固定画幅、文字标签、棚拍光或精确尺寸。",
	properties: {
		version: { type: "string", enum: ["prop-board/v1"] },
		viewRoles: {
			type: "array",
			minItems: 1,
			uniqueItems: true,
			items: {
				type: "string",
				enum: [
					"hero",
					"front",
					"side",
					"back",
					"top",
					"underside",
					"interaction_detail",
					"mechanism_detail",
					"material_detail",
				],
			},
		},
		crossViewConsistency: { type: "boolean", enum: [true] },
		referenceRoleIsolation: { type: "boolean", enum: [true] },
		neutralReferenceBackground: { type: "boolean", enum: [true] },
		scaleReferenceMode: {
			type: "string",
			enum: ["source_dimensions", "relative_scale_reference", "source_unspecified"],
		},
		readableTextVisible: { type: "boolean", enum: [false] },
		brandingVisible: { type: "boolean", enum: [false] },
		neutralBaseState: { type: "boolean", enum: [true] },
	},
	required: [
		"version",
		"viewRoles",
		"crossViewConsistency",
		"referenceRoleIsolation",
		"neutralReferenceBackground",
		"scaleReferenceMode",
		"readableTextVisible",
		"brandingVisible",
		"neutralBaseState",
	],
	additionalProperties: false,
} as const;

export const propFunctionSpecToolSchema = {
	type: "object",
	description:
		"prop-function/v1 的结构化可交互物理合同。agents-cli tapcanvas-prop-card 负责从来源事实与显式设计判断编译方向、交互、受力、可动部件、材质响应和连续性；协议层不从道具名称猜能力或内部机构。",
	properties: {
		version: { type: "string", enum: ["prop-function/v1"] },
		physicalEnvelope: { type: "string" },
		orientationAnchors: { type: "array", items: { type: "string" } },
		interactionAnchors: { type: "array", items: { type: "string" } },
		supportAndForcePaths: { type: "array", items: { type: "string" } },
		movingParts: { type: "array", items: { type: "string" } },
		materialBehaviors: { type: "array", items: { type: "string" } },
		continuityLocks: { type: "array", items: { type: "string" } },
	},
	required: [
		"version",
		"physicalEnvelope",
		"orientationAnchors",
		"interactionAnchors",
		"supportAndForcePaths",
		"movingParts",
		"materialBehaviors",
		"continuityLocks",
	],
	additionalProperties: false,
} as const;

export const sceneLightingSpecToolSchema = {
	type: "object",
	description:
		"scene-card/v1 的纯结构灯光合同。只持久化 agents-cli tapcanvas-scene-card 已完成的物理灯光设计；协议层不根据情绪关键词选择光型，不提供固定电影感、平光、雾气、色温或媒介默认。",
	properties: {
		version: { type: "string", enum: ["scene-lighting/v1"] },
		narrativeIntent: { type: "string" },
		keySource: { type: "string" },
		direction: { type: "string" },
		colorTemperature: { type: "string" },
		lightQuality: { type: "string" },
		shadowBehavior: { type: "string" },
		atmosphereInteraction: { type: "string" },
		reflectiveBehavior: { type: "string" },
		practicalSources: { type: "array", items: { type: "string" } },
		continuityLocks: { type: "array", items: { type: "string" } },
		transition: {
			type: "object",
			properties: {
				trigger: { type: "string" },
				change: { type: "string" },
				invariants: { type: "array", items: { type: "string" } },
			},
			required: ["trigger", "change", "invariants"],
			additionalProperties: false,
		},
	},
	required: [
		"version",
		"narrativeIntent",
		"keySource",
		"direction",
		"colorTemperature",
		"lightQuality",
		"shadowBehavior",
		"atmosphereInteraction",
		"reflectiveBehavior",
		"practicalSources",
		"continuityLocks",
	],
	additionalProperties: false,
} as const;

export type CanvasCapabilityNodePreset = {
	description?: string;
	dataDefaults: Record<string, unknown>;
};

export type CanvasCapabilityNodeSpec = {
	label: string;
	purpose: string;
	output?: Record<string, string>;
	fields?: Record<string, string>;
	input?: Record<string, string>;
	recommendedModels?: string[];
	models?: Record<string, unknown>;
	presets?: Record<string, CanvasCapabilityNodePreset>;
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
		name: "createGroup",
		description:
			"把一批已有节点打成一个 groupNode 容器。用于「整理画布」时按语义对节点分组：先用 getNodes 读取所有节点，按语义分类（如剧本、故事板、参考图等），再对每组调用 createGroup，最后调用 reflowLayout 排列各组位置。不能用于跨组移动（已有 parentId 的子节点不可再打组）。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				nodeIds: {
					type: "array",
					items: { type: "string" },
					description: "要打入同一组的节点 id 列表，必须是顶层节点（无 parentId）。",
				},
				name: {
					type: "string",
					description: "组名称，可选。",
				},
				groupLabel: {
					type: "string",
					description: "语义标签，如「角色资产」「场景资产」「分镜面板」，存入 groupNode.data.groupLabel",
				},
				groupOrder: {
					type: "number",
					description: "面板排序权重（升序），存入 groupNode.data.groupOrder",
				},
				groupSemantic: {
					type: "string",
					enum: ["roles", "scenes", "storyboard", "scripts", "videos", "mixed"],
					description: "语义类型，存入 groupNode.data.groupSemantic",
				},
			},
			required: ["nodeIds"],
		},
	},
	{
		name: "reflowLayout",
		description:
			"重排当前画布布局。只做节点位置重排，绝对不创建新节点、不创建新分组、不删除节点。" +
			"scope 选择规则：" +
			"• sortedColumn（首选）：用户说「整理画布」「排列节点」「可读性」时，直接调用此 scope，按 kind 顺序垂直单列排布所有顶层节点，无需先读节点、无需创建分组，1步完成；" +
			"• canvas：按 DAG 连线做树形重排（仅适合节点之间有大量连线的情况，否则效果差）；" +
			"• topLevelGroups：只整理顶层 groupNode 的位置；" +
			"• group：整理指定 groupNode 内部节点（需提供 targetGroupId）。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				scope: {
					type: "string",
					enum: ["sortedColumn", "canvas", "topLevelGroups", "group"],
					description:
						"sortedColumn=按 kind 单列排布（整理画布首选）；canvas=DAG 树形重排；topLevelGroups=只排顶层组；group=排指定组内部。",
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
	{
		name: "add_node",
		description:
			"在当前章节画布上种一个新节点。通常用于 agent 规划产物：添加 draftByAgent=true 的占位节点。必须使用稳定 ID（约定格式 agent-<intent>-<batchUlid>-<role>），同批 tool call 共享同一 batchUlid。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				id: {
					type: "string",
					description: "节点稳定 ID。格式：agent-<intent>-<batchUlid>-<role>",
				},
				kind: {
					type: "string",
					description:
						"CanvasNodeKind，见 canvasNodeSpecs。Phase 1 常用 text/storyboardImage/image/novelDoc。",
				},
				preset: {
					type: "string",
					description:
						"可选的 preset ID，对应 canvasNodeSpecs[kind].presets 的 key；前端据此补全默认 data。",
				},
				position: {
					type: "object",
					additionalProperties: false,
					required: ["x", "y"],
					properties: {
						x: { type: "number" },
						y: { type: "number" },
					},
				},
				data: {
					type: "object",
					description:
						"kind-specific 覆盖字段，会合并到 preset dataDefaults 之上。",
					additionalProperties: true,
				},
			},
			required: ["id", "kind", "position"],
		},
	},
	{
		name: "connect_edge",
		description:
			"在两个节点间建连线。source/target 必须是当前画布上已存在或本批 add_node 即将种下的节点 ID。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				source: { type: "string" },
				target: { type: "string" },
				sourceHandle: { type: "string" },
				targetHandle: { type: "string" },
			},
			required: ["source", "target"],
		},
	},
	{
		name: "set_param",
		description:
			"修改已有节点的 data 字段。locked=true 或 readOnly=true 的节点拒绝写入。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				nodeId: { type: "string" },
				patch: {
					type: "object",
					description: "合并到节点 data 上的字段集合。",
					additionalProperties: true,
				},
			},
			required: ["nodeId", "patch"],
		},
	},
	{
		name: "link_existing_asset",
		description:
			"把画布上已存在的资产节点作为某节点的输入引用（不新建节点，只加连线）。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				targetNodeId: { type: "string" },
				existingNodeId: { type: "string" },
				role: {
					type: "string",
					description:
						"引用角色，例如 ref / lastFrame / roleCard。（firstFrame 首帧已停用：故事板/关键帧一律作 referenceImages 剧情参考，不再当字面首帧。）",
				},
			},
			required: ["targetNodeId", "existingNodeId", "role"],
		},
	},
	{
		name: "active_workflow",
		description:
			"切换当前项目的工作流模式，影响后续 AI agent 加载的技能和行为策略。切换后立即生效。" +
			"当用户表达想做「故事短片」「快速生图」「角色创建」等明确意图时，主动调用此工具切换到对应工作流。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				workflow: {
					type: "string",
					enum: [
						"free_canvas",
						"story_film",
						"character_creation",
						"scene_creation",
						"ip_creation",
						"quick_image",
						"quick_video",
						"music_video",
					],
					description:
						"目标工作流：free_canvas=自由画布, story_film=故事短片, character_creation=角色创建, " +
						"scene_creation=场景创建, ip_creation=衍生品/IP, quick_image=快速生图, " +
						"quick_video=快速生视频, music_video=音乐短片",
				},
				reason: {
					type: "string",
					description: "切换原因（可选，用于日志）",
				},
			},
			required: ["workflow"],
		},
	},
	{
		name: "finalize",
		description:
			"agent 流结束标记，触发前端 batchBuffer 原子 commit、章节 flow 保存、以及可选的聚焦节点。每次 agent 调用必须恰好发一次 finalize 结尾。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				focusNodeId: { type: "string" },
				summary: { type: "string" },
			},
			required: [],
		},
	},
	{
		name: "add_director_console",
		description:
			"在当前章节画布上种一个导演台节点（directorConsole）。导演台是一个真 3D 摄影棚：在空 3D 空间里摆放骨骼人体素体（角色，支持 56 种姿势预设：坐/跪/打斗/交流/情绪等，及逐关节微调）与机位，调机位位置/注视目标/FOV，从机位 POV 截图作为 AI 出图的空间/构图参考，截图可「发送到画布」生成参考图节点。场景搭建为节点内全屏 3D 编辑器中的交互操作，本工具仅负责创建空导演台节点；如需程序化摆场景+姿势+直接出参考图，用 tapcanvas_capture_director_scene。必须使用稳定 ID 以确保重试幂等；若同 id 节点已存在则直接返回，不重复创建。",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				id: {
					type: "string",
					description: "节点稳定 ID（agent contract：确定性 id，重试幂等）。格式：agent-<intent>-<batchUlid>-director",
				},
				position: {
					type: "object",
					additionalProperties: false,
					required: ["x", "y"],
					properties: {
						x: { type: "number" },
						y: { type: "number" },
					},
				},
			},
			required: ["id"],
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
	"video",
	"composeVideo",
	"storyboard",
	"videoAnalysis",
	"shotTable",
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
		presets: {
			"chapter-info": {
				description:
					"章节种子节点：固定于每章画布的只读锚点，承载章节标题与原文；locked=true，readOnly=true；不可删除、不可编辑。",
				dataDefaults: {
					locked: true,
					readOnly: true,
					prompt: "",
					chapterTitle: "",
					chapterText: "",
				},
			},
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
			"仅承载用户明确要求的纯文本分镜脚本（Shot 列表、镜头语言与时长描述），作为分镜图与视频节点的文本上游。它不是结构化分镜表；用户说“分镜表”“shot table”或需要可编辑镜号/时间/景别/运镜字段时，必须创建 kind=shotTable。",
		output: {
			textResults: "Array<{ text: string }>",
		},
		fields: {
			prompt: "string (shot-by-shot storyboard script)",
			systemPrompt: "string (optional)",
			modelSelect: "string (chat/prompt_refine models)",
		},
	},
	videoAnalysis: {
		label: "视频分析",
		purpose:
			"对已存在的真实视频资产执行视频理解与镜头拆解，输出结构化分析文本；它不是普通文本节点，也不是视频生成节点。必须通过真实视频输入连边或 sourceVideoUrl 执行。",
		output: {
			textResults: "Array<{ text: string }>",
		},
		fields: {
			sourceVideoUrl: "string (optional; real video URL when no upstream video edge is available)",
			sourceVideoNodeId: "string (optional; upstream video taskNode id)",
			videoAnalysisResult: "object (runtime result; do not fabricate)",
		},
	},
	shotTable: {
		label: "分镜表",
		purpose:
			"结构化分镜表节点，承载可编辑的镜号、时间、景别、机位、运镜、主体、动作、场景、光线与构图等镜头表字段。凡用户要求“分镜表”或“shot table”，唯一合法节点类型是 kind=shotTable；不得用 storyboardScript 替代。",
		output: {
			textResults: "Array<{ text: string }>",
			shotTable: "ShotTable",
		},
		fields: {
			shotTable:
				"required ShotTable object: { version: 1, overview: Record<string,string>, columns: Array<{key,label,scope:'shot'|'timeline'}>, rows: Array<{id,shotId,values:Record<string,string>}> }",
			prompt: "string (optional source text for initial table generation)",
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
		recommendedModels: [],
		modelSelection: "用户或当前任务显式指定优先；否则使用用户账号生成偏好中的 videoModel。把对应 enabledVideoModels 项的精确 modelKey 写入 videoModel，并逐字验证分辨率与画幅；任一值不在实时目录时显式失败，禁止自动换模型或规格。",
		fields: {
			prompt: "string (required — executable video production prompt)",
			videoModel: "string. COPY the exact enabledVideoModels modelKey selected by the current task or the account generation preference; do not invent a literal. Must match an enabledVideoModels[*].modelKey or alias. NOTE: if the group node has data.videoModel pinned, that explicit pin wins — keep them consistent.",
			durationSeconds: "number (per-clip duration in seconds; MUST be one of the selected model's durationOptions from enabledVideoModels context. DEFAULT to that model's maxDuration (longest supported clip) to get the most footage per generation, unless the user/plan explicitly asks for a shorter clip. ALWAYS set explicitly when user specifies duration)",
			videoResolution: "string (e.g. '480p' / '720p' / '1080p'; MUST be one of the model's resolutionOptions values; ALWAYS set when user specifies resolution)",
			orientation: "string ('landscape' / 'portrait'; use model's orientationOptions; set when user specifies orientation or aspect implies a direction)",
			aspect: "string (e.g. '16:9' / '9:16' / '1:1'; set when user specifies aspect ratio)",
			referenceImages: "string[] (optional; real ordered image URLs with structured subject / scene / prop / style / storyboard roles. Do not guess or write image numbers in prompt text: after URL cleanup and frame resolution, runtime builds the final referenceMediaManifest, appends the authoritative @图N mapping, and sends media in that exact order).",
			lastFrameUrl: "string (optional; explicit last-frame target URL. Runtime preserves it as a distinct last_frame role in the final media manifest; an orchestrated first frame, when present, is likewise resolved separately rather than flattened into referenceImages).",
			sourceVideoUrl: "string (optional; previous shot's finished video URL — unified video-to-video continuation input; new-api routes per channel: seedance uses it as content reference_video so motion carries over)",
			sourcePrevTaskId: "string (optional; previous shot's upstream task id = that video node's data.taskId; pixverse uses it as extend_from_task_id for native extend continuation)",
			videoReferType:
				"string (optional; kling-v3-omni ONLY — how sourceVideoUrl is used: 'feature' = 动作迁移/motion transfer (extract the reference video's motion/camera/style and apply it to the NEW subject given by referenceImages — use for dance moves, action choreography, camera-move replication onto a different character); 'base' = restyle/continue the source footage itself (default when omitted). When using 'feature', ALWAYS also provide the new subject image via referenceImages, and describe the subject in prompt)",
			keepOriginalSound:
				"string 'yes'|'no' (optional; kling-v3-omni with sourceVideoUrl — keep the reference video's audio track in the output; default 'no'. Useful for motion transfer of dance/music videos where the original BGM should carry over)",
			negativePrompt: "string (optional)",
			masterBoardNodeId: "string (optional; 大故事板模式：本 clip 所属母板节点的 id，由 buildMasterStoryboardSplitNodes 写入，追溯来源母图用)",
		},
		// NOTE: per-model capabilities (durationOptions / maxDuration / resolutions / aspectRatio)
		// are NOT hardcoded here — they are the single source of truth in the `enabledVideoModels`
		// context, derived live from new-api `params_def`. A static table here drifted out of sync
		// (e.g. claimed pixverse-v6 maxed at 8s when it supports up to 15s) and contradicted the
		// dynamic briefing. Always read durations/resolutions/aspect from enabledVideoModels[*].
	},
	image: {
		label: "图像",
		purpose:
			"统一图像生成节点；支持文生图与图生图，输出候选图与主图。若本轮已确认角色卡/权威基底帧/场景锚点，必须把 referenceImages 或 assetInputs 连同角色职责一起持久化到节点数据，不能只在 prompt 文案里口头提到。提示词应尽量具体，包含用途/上下文、主体数量、空间关系、镜头、光线、材质与情绪；复杂画面可分步描述，并优先用正向语义定义目标场景而不是简单堆负面词。需要高精度控制时，可直接使用英文或中英混合镜头语言。",
		recommendedModels: [],
		modelSelection:
			"用户或当前任务显式指定优先；否则使用用户账号生成偏好中的 imageModel/imageSize。将对应 enabledImageModels 项的精确 modelKey 写入 imageModel。目录缺失、无精确匹配项或规格不受支持时显式失败，禁止自动改选目录中的其他模型。",
		output: {
			imageResults: "Array<{ url: string; title?: string }>",
			imageUrl: "string (primary)",
		},
		fields: {
			prompt: "string",
			approvalStatus:
				"enum (needs_confirmation / approved / rejected). Any newly generated image is persisted as needs_confirmation regardless of an agent-supplied approved value; only reuse of an already approved real asset may preserve approved without generation.",
			structuredPrompt:
				"optional ImagePromptSpecV2 JSON view of the same executable prompt. For chapter-grounded generation, prefer filling referenceBindings + identityConstraints instead of leaving reference reuse implicit.",
			characterAssetRole:
				"'identity_anchor' | 'state_variant' (optional; 角色参考节点的资产职责。基础身份板用 identity_anchor；明确外观状态变化的派生卡用 state_variant，并同时提供 stateKey/stateDescription。语义由 agents-cli skill 决定，协议层只持久化。)",
			characterProfileVersion:
				"string (optional; 当前角色资产包结构版本；新角色卡统一为 character-card/v3)",
			identityBoardSpec:
				"object (characterAssetRole='identity_anchor' 时使用的 identity-board/v3 结构合同：正面脸、3/4 脸、正面全身、背面全身，锁定跨视图一致性、参考图职责隔离、中性参考背景、无文字与无品牌。体型、媒介、镜头与生活痕迹由 tapcanvas-character-card 从角色事实和项目画风编译；协议层不提供九头身、真人写实、固定焦段或随机瑕疵默认。)",
			identityAnchors:
				"string[] (optional; 3-6 个画面可验证、跨镜必须稳定的身份事实，例如骨相、发型剪影、体型、核心配饰、基准服装结构或身份道具。禁止抽象评价。)",
			prohibitedDrift:
				"string[] (optional; 仅基于正文/既有角色事实的禁止偏移项，不得凭空补设定。)",
			propAssetRole:
				"'identity_anchor' | 'state_variant' (optional; canonical 道具基态或从精确素材版本派生的状态卡；语义由 tapcanvas-prop-card 决定。)",
			propProfileVersion:
				"string (optional; 新道具卡唯一结构版本 prop-card/v1)",
			propBoardSpec:
				"object (prop-board/v1；按物体几何与交互歧义选择非空视图职责集合，不强制固定面板数、X 光、画幅或文字标签。)",
			propAnchors:
				"string[] (optional; 可见且跨镜稳定的轮廓、比例、部件、材质、标记与功能接口。)",
			prohibitedPropDrift:
				"string[] (optional; 仅基于已确认道具事实的不可偏移项。)",
			propFunctionSpec:
				"object (prop-function/v1；方向锚、交互锚、受力路径、可动部件、材质响应与连续性锁。)",
			sceneAssetRole:
				"'space_anchor' | 'lighting_variant' | 'state_variant' (optional; 场景参考节点的资产职责。语义只由 agents-cli tapcanvas-scene-card 决定。)",
			sceneProfileVersion:
				"string (optional; 新场景卡唯一结构版本 scene-card/v1)",
			sceneAnchors:
				"string[] (optional; 可见且可验证的空间身份事实，如拓扑、尺度、入口、固定地标、主材质与长期使用痕迹。)",
			prohibitedSceneDrift:
				"string[] (optional; 仅基于当前场景事实的不可偏移项，不得用模板禁词代替空间设计。)",
			sceneLightingSpec:
				"object (scene-lighting/v1；物理光源、方向、色温关系、光质、阴影、介质、材质反射、实用灯、连续性与可选变化合同。由 tapcanvas-scene-card 编译，协议层不做情绪到光型映射。)",
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
			imageModel:
				"string (required; COPY the exact modelKey selected from enabledImageModels using explicit task facts first, then the account generation preference; never invent or auto-switch)",
			aspect: "string (e.g. 16:9 / 9:16 / 1:1)",
			imageSize:
				"string (optional; MUST match the selected enabledImageModels entry's imageOptions. Omit only when that live entry declares omission/default semantics)",
			sampleCount: "number",
			reversePrompt: "string (optional)",
			styleImages: "string[] (optional). Style reference image URLs from the material library. Runtime passes them as style inputs to guide visual aesthetics without being subject entities.",
			imageCinematicCamera: "optional { enabled: boolean; cameraKey: string; lensKey: string; focalKey: string; apertureKey: string }. Cinematic camera preset injected as prompt instruction. Example: { enabled: true, cameraKey: 'imax_keighley', lensKey: 'cooke_speed_panchro', focalKey: '24mm', apertureKey: 'f/4' }.",
		},
		models: {},
	},
	imageEdit: {
		label: "图片编辑",
		purpose:
			"统一图像编辑节点；以入图为基础做风格/构图/细节编辑，功能以可选能力启用。若编辑任务依赖明确角色或道具身份，必须保留原始 referenceImages / assetInputs / 绑定语义，避免编辑后漂移成默认人物或默认物体。",
		recommendedModels: [],
		modelSelection:
			"显式任务选择优先，否则使用账号 imageModel；必须在 enabledImageModels 中精确验证其 image_edit/reference-guided 能力。没有精确可执行项时显式失败，禁止换模型。",
		output: {
			imageResults: "Array<{ url: string; title?: string }>",
			imageUrl: "string (primary)",
		},
		fields: {
			prompt: "string",
			characterAssetRole:
				"'identity_anchor' | 'state_variant' (optional; 角色参考节点的资产职责。基础身份板用 identity_anchor；明确外观状态变化的派生卡用 state_variant，并同时提供 stateKey/stateDescription。语义由 agents-cli skill 决定，协议层只持久化。)",
			characterProfileVersion:
				"string (optional; 当前角色资产包结构版本；新角色卡统一为 character-card/v3)",
			identityBoardSpec:
				"object (编辑 identity_anchor 角色身份板时保留完整结构契约；字段与 image 节点一致。)",
			identityAnchors:
				"string[] (optional; 3-6 个画面可验证、跨镜必须稳定的身份事实，例如骨相、发型剪影、体型、核心配饰、基准服装结构或身份道具。禁止抽象评价。)",
			prohibitedDrift:
				"string[] (optional; 仅基于正文/既有角色事实的禁止偏移项，不得凭空补设定。)",
			propAssetRole:
				"'identity_anchor' | 'state_variant' (optional; 编辑道具卡时保留 canonical 身份与状态职责。)",
			propProfileVersion:
				"string (optional; 新道具卡唯一结构版本 prop-card/v1)",
			propBoardSpec:
				"object (编辑 identity_anchor 时保留 prop-board/v1 视图职责合同。)",
			propAnchors:
				"string[] (optional; 编辑后仍须保持的可见道具身份事实。)",
			prohibitedPropDrift:
				"string[] (optional; 仅基于已确认道具事实的不可偏移项。)",
			propFunctionSpec:
				"object (prop-function/v1；编辑后仍须保持的物理交互与连续性合同。)",
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
			styleImages:
				"string[] (optional). Style reference image URLs from the material library. Runtime passes them as style inputs to guide visual aesthetics without being subject entities.",
			imageCinematicCamera:
				"optional { enabled: boolean; cameraKey: string; lensKey: string; focalKey: string; apertureKey: string }. Cinematic camera preset injected as prompt instruction. Example: { enabled: true, cameraKey: 'imax_keighley', lensKey: 'cooke_speed_panchro', focalKey: '24mm', apertureKey: 'f/4' }.",
			imageModel:
				"string (required; exact modelKey selected from enabledImageModels after verifying image-edit/reference support)",
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
			productionLayer: "enum (evidence / constraints / anchors / expansion / execution / results / design_board / master_board — 母板层＝4×n 段级关键镜母图，子板的共同来源)",
			creationStage:
				"enum (source_understanding / constraint_definition / world_anchor_lock / character_anchor_lock / shot_anchor_lock / single_variable_expansion / approved_keyframe_selection / video_plan / video_execution / result_persistence / intent_generate_shot_design_board)",
			approvalStatus: "enum (needs_confirmation / approved / rejected)",
			productionMetadata:
				"{ chapterGrounded: true; lockedAnchors: { character: string[]; scene: string[]; prop?: string[]; shot: string[]; continuity: string[]; missing: string[] }; authorityBaseFrame: { status: 'planned' | 'confirmed'; source: string; reason: string; nodeId: string | null } } (prop = 同框道具/法宝/武器名, 服务端会按名从画布道具卡自动补参考图)",
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
	storyboardImage: {
		label: "故事板图像",
		purpose:
			"大故事板模式专用图像节点。分两种角色：① 母板（productionLayer=master_board）：承载整场戏的结构化镜头表（masterShotTable），是全部子板的共同来源；② 小板（productionLayer=design_board）：由母板按节拍拆出，承载单段落 N 镜网格故事板，携带 masterBoardNodeId 指回母板，下游连 video 节点。执行模型和规格只能从本轮 enabledImageModels 动态目录选择，并继承母板画风与角色锚点。",
		output: {
			imageUrl: "string (primary generated storyboard image URL)",
			imageResults: "Array<{ url: string; title?: string }>",
		},
		fields: {
			prompt: "string (required — 分段镜头描述，母板为整场戏，小板为单段落 N 镜)",
			imageModel:
				"string (required; exact modelKey selected from enabledImageModels for the requested storyboard delivery)",
			imageSize:
				"string (required when the selected live model declares size/resolution options; value must match that catalog entry)",
			aspect: "string (optional; e.g. 16:9 / 9:16)",
			referenceImages: "string[] (optional; 继承母板图 URL 作为风格/角色参考)",
			productionLayer:
				"enum (design_board — 子小板层 / master_board — 母板层＝4×n 段级关键镜母图，子板的共同来源)",
			masterShotTable:
				"object (仅 master_board 节点携带；经 MasterShotTableSchema 解析后的结构化镜头表，含 segments[]，每段有 segmentIndex / beatName / durationSeconds / shots[])",
			masterBoardNodeId:
				"string (仅 design_board 小板节点携带；指回其所属母板节点的 id，由 buildMasterStoryboardSplitNodes 写入)",
			segmentIndex:
				"number (optional; 小板所属段落序号，与 masterShotTable.segments[i].segmentIndex 对应)",
			anchorBindings:
				"Canonical semantic anchor array，同 image/storyboard 节点规范。继承角色/场景锚点时显式落此字段。",
		},
	},
	audio: {
		label: "音频",
		purpose:
			"语音合成（TTS）或音乐生成节点，经 new-api relay 产出可播放的音频 URL。audioModel 必须从本轮系统音频模型目录动态选择：speech / voice_card 只能选带 speech 类型标签的可执行模型，music 只能选带 music 类型标签的可执行模型；价格与计费单位以目录实时返回为准。音频节点的 out-audio 可连到 video / composeVideo 节点作为配音轨输入：视频生成完成后服务端用 ffmpeg 把音轨合到成片上（audioMixMode=replace 替换原音轨 / mix 与原音轨叠混）。文案应是最终口播稿（口语化、带停顿标点），不是镜头描述。\n\n**配音卡模式（audioType=voice_card，和角色卡对称）**：把本节点当成某个角色的「可复用声音锚」——只锁音色（doubaoVoiceId 或克隆参考），**不带固定 text**。设 `voiceCharacter=角色名`，把 out-audio **直接连到该角色的多段视频节点**：出片时服务端按「每段视频自己的台词（clipPrompt 引号内对白）+ 本卡音色」即时 TTS 合成再 mux 到该段视频上 → 同一角色多段同嗓音。音色留空则服务端按角色性别自动挑官方音色（可随时改 doubaoVoiceId 覆盖）。一张配音卡 fan-out 连多个视频节点复用，等价于角色卡的 referenceImages 复用。",
		output: {
			audioUrl: "string (mp3 公网 URL)",
			audioDurationSec: "number (optional; 音频时长秒)",
		},
		fields: {
			audioType:
				"enum (optional; speech 语音合成（默认）/ music 音乐生成 / voice_card 配音卡（角色可复用声音锚，无固定 text，连到视频节点按该段台词即时配音）)",
			voiceCharacter:
				"string (optional; 仅 voice_card：该音色归属的角色名，用于按名复用/入库（镜像角色卡）。缺省回退 roleName)",
			text: "string (required — 语音=最终口播文案（≤2万字，超长自动分段拼接）；音乐=曲风/氛围描述)",
			lyrics: "string (optional; 音乐自定义歌词，lyricsMode=custom 时使用)",
			lyricsMode: "enum (optional; 音乐歌词模式：auto AI填词 / custom 自定义歌词 / instrumental 纯音乐（默认）)",
			audioModel:
				"string (required; COPY the exact modelKey from the current enabled audio model catalog. The model must carry a matching tapcanvas:audio-type tag and a positive live price; voice_card additionally requires tapcanvas:audio-engine=doubao. Missing, disabled, mismatched or unroutable models fail explicitly)",
			doubaoVoiceId:
				"string (optional; 豆包语音音色 speaker id，用于 doubao-seed-audio；如 zh_female_vv_uranus_bigtts(Vivi) / zh_male_m191_uranus_bigtts(云舟) / zh_female_cancan_uranus_bigtts(知性灿灿) / zh_male_sunwukong_uranus_bigtts(猴哥)；完整目录见富音色选择器。留空且无参考时不指定音色)",
			speechRate: "number (optional; 豆包语速 -50~100，0=正常)",
			pitchRate: "number (optional; 豆包音调 -12~12，0=正常)",
			loudnessRate: "number (optional; 豆包响度 -50~100，0=正常)",
			referenceAudioUrls:
				"string[] (optional; 豆包音色克隆参考音频 URL，最多 3 个；通过连上游音频节点到 in-audio 提供，与参考图互斥)",
			referenceImageUrl:
				"string (optional; 豆包音色克隆参考图 URL；连上游图片节点到 in-image 提供，图优先于参考音频)",
			voiceId:
				"string (optional; MiniMax 音色 id（仅 speech-* 模型），默认 male-qn-qingse；常用：male-qn-qingse 青涩男声 / male-qn-jingying 精英男声 / female-chengshu 成熟女声 / female-tianmei 甜美女声 / presenter_male 男主持 / presenter_female 女主持 / audiobook_male_1 有声书男 / audiobook_female_1 有声书女)",
			emotion:
				"enum (optional; 仅 MiniMax：happy / sad / angry / fearful / disgusted / surprised / calm / fluent / whisper)",
			speed: "number (optional; 仅 MiniMax：0.5~2.0 语速，默认 1)",
			soundEffects:
				"string[] (optional; 仅 MiniMax：spacious_echo 空旷回音 / auditorium_echo 礼堂回音 / lofi_telephone 复古电话 / robotic 机器人)",
			audioMixMode:
				"enum (optional; 连到视频节点时的混音方式：replace 替换原音轨（默认）/ mix 与原音轨叠混)",
		},
	},
	directorConsole: {
		label: "导演台",
		purpose:
			"真 3D 摄影棚 blocking 节点。节点内全屏 3D 编辑器：摆放骨骼人体素体（角色，含位置/旋转/缩放/颜色/姿势）与机位（位置/注视目标可锁定角色/FOV），双视角（导演视角总览 / 机位视角 POV）切换，按画幅比例从机位 POV 截图，截图可发送到画布生成参考图节点。素体支持 56 种姿势预设（posePresetId，分基础/坐跪/行动/武戏/交流/情绪六类）与逐关节 pose 微调，应按剧情为每个角色设定姿势——缺省 T-pose 无表演信息。适用于镜头 pre-viz、构图与空间关系编排、为 AI 出图提供精确机位/构图参考。",
		fields: {
			scene: "DirectorScene { characters: CharacterObj[], cameras: CameraObj[], aspect, activeCameraId? }",
			"scene.characters[]": "CharacterObj { id, name, modelId, position[3], rotation[3], scale[3], uniformScale, colorHex, posePresetId?, pose?, hidden?, locked? }",
			"scene.characters[].posePresetId": "静态定格姿势预设 id（56 种，完整枚举见 tapcanvas_capture_director_scene 工具 schema），如 sit/kneel/punch/hug/dejected——不会动。",
			"scene.characters[].motionClip": "动画动作预设 id（会动，开箱即用，要角色「做动作」优先用它、别手搓关键帧）：待机 idle-breathe/look-around/impatient；交流 wave-loop/nod/shake-head/bow-once/clap-loop/salute-once/cheer-loop/point-forward；武戏 punch-combo/kick-once/block-recoil/sword-draw/taichi-flow；情绪 stagger-hit/clutch-fall/flinch-loop/dejected-sink。纯位移走 motion.locomotion，与 motionClip 取舍其一。",
			"scene.characters[].pose": "Record<joint, [x,y,z]弧度>（进阶逐关节覆盖，joint=spine|neck|shoulderL|elbowL|shoulderR|elbowR|hipL|kneeL|hipR|kneeR；与 posePresetId 同给时 pose 优先）",
			"scene.cameras[]": "CameraObj { id, name, position[3], lookAtMode('manual'|characterId), lookAt[3], fovDeg, screenshots: CameraShot[] }",
			activeViewpoint: "'director' | 'camera'",
			selectedObjectId: "string (optional; 当前选中对象 id)",
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
			...(tool.execution ? { execution: tool.execution } : {}),
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
