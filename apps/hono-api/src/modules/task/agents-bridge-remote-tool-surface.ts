import type { ToolExecutionSemantics } from "../ai/tool-schemas";

export type RemoteToolSurfaceEntry = {
	name: string;
	description: string;
	parameters?: Record<string, unknown>;
};

export type AgentsBridgeRemoteToolScopeName =
	| "project"
	| "canvas"
	| "chapter_canvas"
	| "book"
	| "node"
	| "execution";

export type AgentsBridgeRemoteToolCapability =
	| "project_discovery"
	| "project_persistence"
	| "book_read"
	| "book_persistence"
	| "material_read"
	| "material_persistence"
	| "canvas_core"
	| "canvas_extended"
	| "node_diagnostics"
	| "execution_diagnostics"
	| "workflow_execution"
	| "one_click_video"
	| "paid_media_generation"
	| "media_analysis"
	| "director_console"
	| "diagnostic_reviewer";

export type BuiltInSmallTCapability = Readonly<{
	id: string;
	key: AgentsBridgeRemoteToolCapability;
	name: string;
	description: string;
	requiredTools: readonly string[];
	sideEffects: readonly ("none" | "external_mutation" | "paid_generation")[];
	/** Whether an equipped workflow may replace this capability as the primary route. */
	replaceable: boolean;
}>;

export type AgentsBridgeRemoteToolScope = {
	publicAgentsRequest: boolean;
	projectId: string | null | undefined;
	flowId: string | null | undefined;
	bookId: string | null | undefined;
	chapterId: string | null | undefined;
	nodeId: string | null | undefined;
	executionId: string | null | undefined;
};

export type RemoteToolSurfaceMeasurement = {
	visibleToolCount: number;
	descriptionChars: number;
	schemaChars: number;
};

export type RemoteToolCatalogIndexMeasurement = {
	visibleToolCount: number;
	nameChars: number;
	enumJsonChars: number;
	duplicatedWrapperEnumChars: number;
	capabilityCounts: Partial<Record<AgentsBridgeRemoteToolCapability, number>>;
};

export type AgentsBridgeRemoteToolCatalogEntry<T extends RemoteToolSurfaceEntry> = T & {
	requiredScope: AgentsBridgeRemoteToolScopeName[];
	capability: AgentsBridgeRemoteToolCapability;
	schemaDeferred?: boolean;
	descriptionDeferred?: boolean;
};

export type AgentsBridgeRemoteToolSurfaceResolution<T extends RemoteToolSurfaceEntry> = {
	tools: T[];
	catalog: Array<AgentsBridgeRemoteToolCatalogEntry<T>>;
	explicitCapabilityTools: T[];
	hiddenToolNames: string[];
	before: RemoteToolSurfaceMeasurement;
	after: RemoteToolSurfaceMeasurement;
	catalogMeasurement: RemoteToolSurfaceMeasurement;
	catalogIndexMeasurement: RemoteToolCatalogIndexMeasurement;
	satisfiedScopes: AgentsBridgeRemoteToolScopeName[];
};

type RemoteToolContract = {
	requiredScope: AgentsBridgeRemoteToolScopeName[];
	capability: AgentsBridgeRemoteToolCapability;
	capabilityGated: boolean;
	directWhenScopeSatisfied: boolean;
	requiresProjectFlowId: boolean;
	directOnlyWhileScopeMissing?: AgentsBridgeRemoteToolScopeName;
	directOnlyWhenScopeSatisfied?: AgentsBridgeRemoteToolScopeName;
};

export type RemoteToolCapabilityRegistryEntry = Readonly<{
	name: string;
	requiredScope: readonly AgentsBridgeRemoteToolScopeName[];
	capability: AgentsBridgeRemoteToolCapability;
	capabilityGated: boolean;
	execution: ToolExecutionSemantics;
	endpoint: Readonly<{ method: "POST"; path: "/agent-tools/:toolName" }>;
	schemaSource: "remote_tool_definition";
}>;

const contract = (
	requiredScope: AgentsBridgeRemoteToolScopeName[],
	capability: AgentsBridgeRemoteToolCapability,
	directWhenScopeSatisfied = false,
	requiresProjectFlowId = false,
	directOnlyWhileScopeMissing?: AgentsBridgeRemoteToolScopeName,
	directOnlyWhenScopeSatisfied?: AgentsBridgeRemoteToolScopeName,
	capabilityGated = true,
): RemoteToolContract => ({
	requiredScope,
	capability,
	capabilityGated,
	directWhenScopeSatisfied,
	requiresProjectFlowId,
	directOnlyWhileScopeMissing,
	directOnlyWhenScopeSatisfied,
});

const directContract = (
	requiredScope: AgentsBridgeRemoteToolScopeName[],
	capability: AgentsBridgeRemoteToolCapability,
	requiresProjectFlowId = false,
	directOnlyWhileScopeMissing?: AgentsBridgeRemoteToolScopeName,
	directOnlyWhenScopeSatisfied?: AgentsBridgeRemoteToolScopeName,
): RemoteToolContract =>
	contract(
		requiredScope,
		capability,
		true,
		requiresProjectFlowId,
		directOnlyWhileScopeMissing,
		directOnlyWhenScopeSatisfied,
	);

const protocolDiscoveryContract = (): RemoteToolContract =>
	contract([], "project_discovery", true, false, undefined, undefined, false);

const equippedWorkflowExecutionContract = (): RemoteToolContract =>
	contract([], "workflow_execution", true, false, undefined, undefined, false);

const PROJECT = ["project"] as AgentsBridgeRemoteToolScopeName[];
const PROJECT_CANVAS = ["project", "canvas"] as AgentsBridgeRemoteToolScopeName[];
const PROJECT_BOOK = ["project", "book"] as AgentsBridgeRemoteToolScopeName[];
const PROJECT_CANVAS_BOOK = ["project", "canvas", "book"] as AgentsBridgeRemoteToolScopeName[];
const PROJECT_CANVAS_NODE = ["project", "canvas", "node"] as AgentsBridgeRemoteToolScopeName[];
const PROJECT_CHAPTER_CANVAS = [
	"project",
	"canvas",
	"chapter_canvas",
] as AgentsBridgeRemoteToolScopeName[];
const REMOTE_TOOL_CONTRACTS: Readonly<Record<string, RemoteToolContract>> = {
	// Catalog wrappers are public Agent protocol infrastructure. They still need
	// deterministic surface metadata, but must remain available so the caller can
	// discover which product capabilities are currently enabled or disabled.
	tapcanvas_tool_catalog_get: protocolDiscoveryContract(),
	tapcanvas_tool_schema_get: protocolDiscoveryContract(),
	tapcanvas_shot_table_critic: contract([], "diagnostic_reviewer"),
	tapcanvas_project_flows_list: directContract(PROJECT, "project_discovery", false, "canvas"),
	// Project context contains versioned markdown files and can be very large. Keep it
	// authorized, but defer it whenever the authenticated canvas envelope already exists;
	// Project narrative context is shared by the root canvas and every independent chapter
	// canvas, so it remains a direct read throughout the authorized project scope.
	tapcanvas_project_context_get: directContract(PROJECT, "project_discovery"),
	tapcanvas_project_creative_brief_update: contract(PROJECT, "project_persistence"),
	tapcanvas_project_chapters_list: directContract(PROJECT, "project_discovery"),
	tapcanvas_project_chapter_get: directContract(PROJECT, "project_discovery"),
	tapcanvas_project_chapter_update: contract(PROJECT_CHAPTER_CANVAS, "project_persistence"),
	tapcanvas_story_facts_get: directContract(PROJECT_BOOK, "book_read"),
	tapcanvas_story_facts_commit: contract(PROJECT_BOOK, "book_persistence"),
	tapcanvas_books_list: directContract(PROJECT, "project_discovery", false, "book"),
	tapcanvas_book_index_get: directContract(PROJECT_BOOK, "book_read"),
	tapcanvas_book_evidence_search: directContract(PROJECT_BOOK, "book_read"),
	tapcanvas_book_style_confirm: contract(PROJECT_BOOK, "book_persistence"),
	tapcanvas_book_chapter_get: directContract(PROJECT_BOOK, "book_read"),
	tapcanvas_book_chapter_summary_set: contract(PROJECT_BOOK, "book_persistence"),
	tapcanvas_book_worldbible_confirm: contract(PROJECT_BOOK, "book_persistence"),
	tapcanvas_book_storyboard_plan_get: directContract(PROJECT_BOOK, "book_read"),
	tapcanvas_book_storyboard_plan_upsert: contract(PROJECT_BOOK, "book_persistence"),
	tapcanvas_storyboard_continuity_get: directContract(PROJECT_BOOK, "book_read"),
	tapcanvas_material_assets_list: directContract(PROJECT, "material_read"),
	tapcanvas_material_assets_sync: contract(PROJECT_CANVAS, "material_persistence"),
	tapcanvas_material_asset_versions_get: directContract(PROJECT, "material_read"),
	tapcanvas_material_asset_version_create: contract(PROJECT_CANVAS, "material_persistence"),
	tapcanvas_material_asset_delete: contract(PROJECT, "material_persistence"),
	// Style lookup is task-specific. Keep it in the cold catalog so ordinary
	// conversations do not pay its schema on every turn.
	tapcanvas_get_style_reference: contract(PROJECT, "material_read"),
	tapcanvas_set_style_reference: contract(PROJECT_CANVAS, "material_persistence"),
	tapcanvas_project_look_bible_get: contract(PROJECT, "material_read"),
	tapcanvas_project_look_bible_confirm: contract(PROJECT_CANVAS, "material_persistence"),
	// The lookup is project-authorized but only hot on a concrete canvas. In a
	// project-only discovery turn it stays deferred instead of occupying one of
	// the five structural discovery definitions.
	tapcanvas_storyboard_anchor_candidates: directContract(
		PROJECT,
		"material_read",
		false,
		undefined,
		"canvas",
	),
	tapcanvas_storyboard_source_bundle_get: contract(
		PROJECT_CANVAS_BOOK,
		"book_read",
		false,
		true,
	),
	tapcanvas_node_context_bundle_get: directContract(PROJECT_CANVAS_NODE, "node_diagnostics"),
	tapcanvas_video_review_bundle_get: directContract(PROJECT_CANVAS_NODE, "node_diagnostics"),
	tapcanvas_pipeline_runs_list: directContract(PROJECT, "execution_diagnostics"),
	tapcanvas_pipeline_run_get: directContract(PROJECT, "execution_diagnostics"),
	tapcanvas_executions_list: directContract(PROJECT_CANVAS, "execution_diagnostics"),
	// These reads already require an explicit executionId argument and the route
	// authorizes that execution against the current project/canvas. Requiring an
	// execution id to have existed before the agent starts would make the freshly
	// returned id from equipped_workflow_run impossible to inspect in the same turn.
	tapcanvas_execution_get: directContract(PROJECT_CANVAS, "execution_diagnostics"),
	tapcanvas_execution_node_runs_get: directContract(PROJECT_CANVAS, "execution_diagnostics"),
	tapcanvas_execution_events_list: directContract(PROJECT_CANVAS, "execution_diagnostics"),
	tapcanvas_workflow_execution_inspect: directContract(PROJECT_CANVAS, "execution_diagnostics"),
	// Recovery is protocol infrastructure for an already accepted durable run.
	// It must remain available even when an equipped workflow replaces the
	// built-in start route, otherwise a pre-existing execution family can be
	// orphaned by a capability switch.
	tapcanvas_workflow_resume: contract(
		PROJECT_CANVAS,
		"workflow_execution",
		true,
		false,
		undefined,
		undefined,
		false,
	),
	// This is the invocation gateway for user-equipped replacement capabilities,
	// not the built-in workflow-execution product route itself. The attachment id
	// is pinned by this request's exact schema, and ownership/version/access are
	// revalidated at execution time. Disabling or replacing a built-in capability
	// must therefore never remove the only gateway that can invoke its replacement.
	tapcanvas_equipped_workflow_run: equippedWorkflowExecutionContract(),
	tapcanvas_workflow_run: directContract(PROJECT_CANVAS, "workflow_execution"),
	tapcanvas_prompt_library_sync: directContract(PROJECT_CANVAS, "project_persistence"),
	tapcanvas_image_refs_get: directContract(PROJECT_CANVAS, "canvas_core"),
	tapcanvas_flow_get: directContract(PROJECT_CANVAS, "canvas_core"),
	tapcanvas_flow_search: directContract(PROJECT_CANVAS, "canvas_core"),
	tapcanvas_node_text_edit: directContract(PROJECT_CHAPTER_CANVAS, "canvas_core"),
	tapcanvas_flow_patch: directContract(PROJECT_CANVAS, "canvas_core"),
	tapcanvas_asset_add_to_canvas: contract(PROJECT_CANVAS, "canvas_extended"),
	// Story preview is a durable, chapter-scoped paid graph. Keep the compact
	// operation index in the catalog and project the exact frontier schema only
	// for the next missing board, matching the equipped workflow executor.
	tapcanvas_story_preview_orchestrate: contract(
		PROJECT_CHAPTER_CANVAS,
		"paid_media_generation",
	),
	tapcanvas_image_generate_to_canvas: contract(PROJECT_CANVAS, "paid_media_generation"),
	tapcanvas_video_generate_to_canvas: contract(PROJECT_CANVAS, "paid_media_generation"),
	tapcanvas_video_extract_last_frame: contract(PROJECT_CANVAS, "paid_media_generation"),
	tapcanvas_video_extract_frames: contract(PROJECT_CANVAS, "paid_media_generation"),
	tapcanvas_video_concat: contract(PROJECT_CANVAS, "paid_media_generation"),
	tapcanvas_voice_card_dub: contract(PROJECT_CANVAS, "paid_media_generation"),
	tapcanvas_hyperframes_render: contract(PROJECT, "paid_media_generation"),
	tapcanvas_annotate_shot: contract(PROJECT_CANVAS, "canvas_extended"),
	tapcanvas_render_blocking_diagram: contract(PROJECT_CANVAS, "paid_media_generation"),
	tapcanvas_video_reconcile: contract(PROJECT_CANVAS, "canvas_extended"),
	tapcanvas_image_reconcile: contract(PROJECT_CANVAS, "canvas_extended"),
	tapcanvas_analyze_image: contract(PROJECT_CANVAS, "media_analysis"),
	tapcanvas_analyze_video: contract(PROJECT_CANVAS, "media_analysis"),
	tapcanvas_decompose_video: contract(PROJECT_CANVAS, "media_analysis"),
	tapcanvas_distill_director_breakdown: contract(PROJECT_CANVAS, "media_analysis"),
	tapcanvas_video_compare: contract(PROJECT_CANVAS, "media_analysis"),
	tapcanvas_fetch_video_from_url: contract(PROJECT_CANVAS, "media_analysis"),
	tapcanvas_capture_director_scene: contract(PROJECT_CANVAS, "director_console"),
	tapcanvas_render_director_clip: contract(PROJECT_CANVAS, "director_console"),
	tapcanvas_director_define_motion: contract(PROJECT_CANVAS, "director_console"),
	tapcanvas_director_set_character_motion: contract(PROJECT_CANVAS, "director_console"),
	tapcanvas_master_storyboard_split: contract(PROJECT_CANVAS, "canvas_extended"),
};

const SAFE_READ_REMOTE_TOOLS = new Set([
	"tapcanvas_project_flows_list", "tapcanvas_project_context_get", "tapcanvas_project_chapters_list", "tapcanvas_project_chapter_get", "tapcanvas_books_list",
	"tapcanvas_book_index_get", "tapcanvas_book_evidence_search", "tapcanvas_story_facts_get", "tapcanvas_book_chapter_get", "tapcanvas_book_storyboard_plan_get",
	"tapcanvas_storyboard_continuity_get", "tapcanvas_material_assets_list", "tapcanvas_material_asset_versions_get",
	"tapcanvas_get_style_reference", "tapcanvas_project_look_bible_get", "tapcanvas_storyboard_anchor_candidates",
	"tapcanvas_storyboard_source_bundle_get", "tapcanvas_node_context_bundle_get", "tapcanvas_video_review_bundle_get", "tapcanvas_pipeline_runs_list", "tapcanvas_pipeline_run_get",
	"tapcanvas_executions_list", "tapcanvas_execution_get", "tapcanvas_execution_node_runs_get", "tapcanvas_execution_events_list", "tapcanvas_workflow_execution_inspect",
	"tapcanvas_flow_get", "tapcanvas_flow_search", "tapcanvas_image_refs_get", "tapcanvas_shot_table_critic",
]);

const PAID_REMOTE_TOOLS = new Set([
	"tapcanvas_image_generate_to_canvas", "tapcanvas_video_generate_to_canvas", "tapcanvas_video_extract_last_frame", "tapcanvas_video_extract_frames",
	"tapcanvas_video_concat", "tapcanvas_voice_card_dub", "tapcanvas_hyperframes_render", "tapcanvas_render_blocking_diagram", "tapcanvas_analyze_image",
	"tapcanvas_analyze_video", "tapcanvas_decompose_video", "tapcanvas_distill_director_breakdown", "tapcanvas_video_compare", "tapcanvas_fetch_video_from_url",
	"tapcanvas_capture_director_scene", "tapcanvas_render_director_clip",
]);

const IDEMPOTENT_REMOTE_TOOLS: Readonly<Record<string, string>> = {
	tapcanvas_story_facts_commit: "commitId",
	tapcanvas_workflow_run: "idempotencyKey",
	tapcanvas_prompt_library_sync: "idempotencyKey",
	tapcanvas_equipped_workflow_run: "idempotencyKey",
};

const UNSAFE_REMOTE_TOOLS = new Set([
	"tapcanvas_workflow_resume", "tapcanvas_project_creative_brief_update", "tapcanvas_project_chapter_update",
	"tapcanvas_book_style_confirm", "tapcanvas_book_chapter_summary_set", "tapcanvas_book_worldbible_confirm", "tapcanvas_book_storyboard_plan_upsert",
	"tapcanvas_material_asset_version_create", "tapcanvas_material_asset_delete", "tapcanvas_material_assets_sync", "tapcanvas_set_style_reference",
	"tapcanvas_project_look_bible_confirm", "tapcanvas_node_text_edit", "tapcanvas_flow_patch", "tapcanvas_annotate_shot", "tapcanvas_asset_add_to_canvas",
	"tapcanvas_video_reconcile", "tapcanvas_image_reconcile", "tapcanvas_director_define_motion",
	"tapcanvas_director_set_character_motion", "tapcanvas_master_storyboard_split", "tapcanvas_story_preview_orchestrate",
]);

function resolveRemoteToolExecution(name: string): ToolExecutionSemantics {
	if (SAFE_READ_REMOTE_TOOLS.has(name)) {
		return { sideEffect: "none", retrySafety: "safe", executionMode: "parallel_safe", idempotencyKeyField: null, resultLookupSupported: true };
	}
	if (PAID_REMOTE_TOOLS.has(name)) {
		return { sideEffect: "paid_generation", retrySafety: "unsafe", executionMode: "exclusive", idempotencyKeyField: null, resultLookupSupported: true };
	}
	const idempotencyKeyField = IDEMPOTENT_REMOTE_TOOLS[name];
	if (idempotencyKeyField) {
		return { sideEffect: "external_mutation", retrySafety: "idempotency_key_required", executionMode: "sequential", idempotencyKeyField, resultLookupSupported: true };
	}
	if (UNSAFE_REMOTE_TOOLS.has(name)) {
		return { sideEffect: "external_mutation", retrySafety: "unsafe", executionMode: "sequential", idempotencyKeyField: null, resultLookupSupported: false };
	}
	throw new Error(`Remote tool ${name} is missing execution metadata in the capability registry.`);
}

const BUILT_IN_SMALL_T_CAPABILITY_PRESENTATION: Readonly<Record<
	AgentsBridgeRemoteToolCapability,
	Readonly<{
		name: string;
		description: string;
		sideEffects: readonly ("none" | "external_mutation" | "paid_generation")[];
		replaceable?: boolean;
	}>>> = {
	project_discovery: { name: "项目发现", description: "发现项目、画布与项目上下文。", sideEffects: ["none"] },
	project_persistence: { name: "项目设定持久化", description: "保存跨章节共享的项目级创作设定。", sideEffects: ["external_mutation"] },
	book_read: { name: "小说与章节读取", description: "读取书籍、章节、故事事实、分镜计划与连续性证据。", sideEffects: ["none"] },
	book_persistence: { name: "小说与章节写入", description: "确认或写入世界观、章节摘要、故事事实与分镜计划。", sideEffects: ["external_mutation"] },
	material_read: { name: "素材读取", description: "读取项目素材、版本、风格参考与视觉圣经。", sideEffects: ["none"] },
	material_persistence: { name: "素材管理", description: "同步、创建、删除素材版本以及确认项目视觉风格。", sideEffects: ["external_mutation"] },
	canvas_core: { name: "画布基础编辑", description: "读取画布、检索节点并修改节点文本或画布结构。", sideEffects: ["none", "external_mutation"] },
	canvas_extended: { name: "画布扩展制作", description: "向画布添加资产、镜头标注、分镜拆分并对账媒体任务。", sideEffects: ["external_mutation"] },
	node_diagnostics: { name: "节点诊断", description: "读取节点上下文与视频审查证据。", sideEffects: ["none"] },
	execution_diagnostics: { name: "运行诊断", description: "读取工作流执行、节点运行与事件日志。", sideEffects: ["none"] },
	workflow_execution: { name: "工作流执行", description: "在授权范围内启动并跟踪已保存的工作流。", sideEffects: ["external_mutation"] },
	one_click_video: {
		name: "一键成片",
		description: "从创作目标规划并交付完整成片。",
		sideEffects: ["paid_generation"],
		replaceable: true,
	},
	// Workflow IR nodes consume the foundational media primitives internally.
	paid_media_generation: {
		name: "真实媒体生成",
		description: "生成图片、视频、配音与合成结果。",
		sideEffects: ["paid_generation"],
		replaceable: false,
	},
	media_analysis: { name: "媒体分析", description: "分析、拆解、比较图片和视频并提炼导演信息。", sideEffects: ["none"] },
	director_console: { name: "3D导演台", description: "捕获导演场景、定义角色运动并渲染导演片段。", sideEffects: ["external_mutation", "paid_generation"] },
	diagnostic_reviewer: { name: "创作诊断审查", description: "审查镜头表等创作合同并给出诊断证据。", sideEffects: ["none"] },
};

export function listBuiltInSmallTCapabilities(): BuiltInSmallTCapability[] {
	return Object.entries(BUILT_IN_SMALL_T_CAPABILITY_PRESENTATION).map(([key, presentation]) => {
		const capability = key as AgentsBridgeRemoteToolCapability;
		return {
			id: `builtin:${capability}`,
			key: capability,
			name: presentation.name,
			description: presentation.description,
			requiredTools: Object.entries(REMOTE_TOOL_CONTRACTS)
				.filter(
					([, toolContract]) =>
						toolContract.capabilityGated && toolContract.capability === capability,
				)
				.map(([toolName]) => toolName)
				.sort(),
			sideEffects: presentation.sideEffects,
			replaceable: presentation.replaceable ?? true,
		};
	});
}

export const BOOK_SCOPED_PERSISTENCE_REMOTE_TOOL_NAMES = new Set(
	Object.entries(REMOTE_TOOL_CONTRACTS)
		.filter(([, value]) => value.capability === "book_persistence")
		.map(([name]) => name),
);

const hasScopeId = (value: string | null | undefined): boolean =>
	typeof value === "string" && value.trim().length > 0;

export const deriveBookScopeIdFromChapterId = (
	chapterId: string | null | undefined,
): string | null => {
	const normalizedChapterId = String(chapterId ?? "").trim();
	if (!normalizedChapterId.startsWith("book-")) return null;
	const chapterMarkerIndex = normalizedChapterId.lastIndexOf("-ch");
	if (chapterMarkerIndex <= "book-".length) return null;
	const chapterSequence = normalizedChapterId.slice(chapterMarkerIndex + 3);
	if (
		chapterSequence.length === 0 ||
		Array.from(chapterSequence).some((character) => character < "0" || character > "9")
	) {
		return null;
	}
	const bookId = normalizedChapterId.slice("book-".length, chapterMarkerIndex).trim();
	return bookId.length > 0 ? bookId : null;
};

const normalizeRemoteToolScope = (
	scope: AgentsBridgeRemoteToolScope,
): AgentsBridgeRemoteToolScope => {
	const explicitBookId = String(scope.bookId ?? "").trim();
	const derivedBookId = deriveBookScopeIdFromChapterId(scope.chapterId);
	return {
		...scope,
		bookId: explicitBookId || derivedBookId,
	};
};

const readSatisfiedScopes = (
	scope: AgentsBridgeRemoteToolScope,
): Set<AgentsBridgeRemoteToolScopeName> => {
	const satisfied = new Set<AgentsBridgeRemoteToolScopeName>();
	if (hasScopeId(scope.projectId)) satisfied.add("project");
	if (hasScopeId(scope.flowId) || hasScopeId(scope.chapterId)) satisfied.add("canvas");
	if (hasScopeId(scope.chapterId)) satisfied.add("chapter_canvas");
	if (hasScopeId(scope.bookId)) satisfied.add("book");
	if (hasScopeId(scope.nodeId)) satisfied.add("node");
	if (hasScopeId(scope.executionId)) satisfied.add("execution");
	return satisfied;
};

const readToolContract = (name: string): RemoteToolContract => {
	const toolContract = REMOTE_TOOL_CONTRACTS[name];
	if (!toolContract) {
		throw new Error(`Remote tool ${name} is missing deterministic surface metadata.`);
	}
	return toolContract;
};

export function readRemoteToolSurfaceMetadata(name: string): {
	requiredScope: AgentsBridgeRemoteToolScopeName[];
	capability: AgentsBridgeRemoteToolCapability;
	capabilityGated: boolean;
} {
	const toolContract = readToolContract(name);
	return {
		requiredScope: [...toolContract.requiredScope],
		capability: toolContract.capability,
		capabilityGated: toolContract.capabilityGated,
	};
}

/**
 * Canonical capability registry projection. Tool schema bodies remain owned by
 * their builders, while authorization, capability grouping, execution safety
 * and transport endpoint are derived here exactly once.
 */
export function readRemoteToolCapabilityRegistryEntry(
	name: string,
): RemoteToolCapabilityRegistryEntry {
	const toolContract = readToolContract(name);
	return {
		name,
		requiredScope: [...toolContract.requiredScope],
		capability: toolContract.capability,
		capabilityGated: toolContract.capabilityGated,
		execution: resolveRemoteToolExecution(name),
		endpoint: { method: "POST", path: "/agent-tools/:toolName" },
		schemaSource: "remote_tool_definition",
	};
}

const hasSatisfiedRequiredScopes = (
	toolContract: RemoteToolContract,
	satisfiedScopes: ReadonlySet<AgentsBridgeRemoteToolScopeName>,
): boolean =>
	toolContract.requiredScope.every((scope) => satisfiedScopes.has(scope));

const hasCompatibleCanvasEnvelope = (
	toolContract: RemoteToolContract,
	scope: AgentsBridgeRemoteToolScope,
): boolean => !toolContract.requiresProjectFlowId || hasScopeId(scope.flowId);

export function measureRemoteToolSurface(
	tools: readonly RemoteToolSurfaceEntry[],
): RemoteToolSurfaceMeasurement {
	return tools.reduce<RemoteToolSurfaceMeasurement>(
		(measurement, tool) => ({
			visibleToolCount: measurement.visibleToolCount + 1,
			descriptionChars: measurement.descriptionChars + tool.description.length,
			schemaChars:
				measurement.schemaChars + JSON.stringify(tool.parameters ?? {}).length,
		}),
		{ visibleToolCount: 0, descriptionChars: 0, schemaChars: 0 },
	);
}

export function measureRemoteToolCatalogIndex<T extends RemoteToolSurfaceEntry>(
	tools: readonly AgentsBridgeRemoteToolCatalogEntry<T>[],
): RemoteToolCatalogIndexMeasurement {
	const names = Array.from(new Set(tools.map((tool) => tool.name))).sort((left, right) =>
		left.localeCompare(right),
	);
	const capabilityCounts: Partial<Record<AgentsBridgeRemoteToolCapability, number>> = {};
	for (const tool of tools) {
		capabilityCounts[tool.capability] = (capabilityCounts[tool.capability] ?? 0) + 1;
	}
	const enumJsonChars = names.length > 0 ? JSON.stringify(names).length : 0;
	return {
		visibleToolCount: names.length,
		nameChars: names.reduce((total, name) => total + name.length, 0),
		enumJsonChars,
		// agents-cli builds one exact-name enum for schema discovery and one for
		// the generic catalog caller. Track the duplicated name payload explicitly;
		// scope slicing below is what keeps this bounded without weakening auth.
		duplicatedWrapperEnumChars: enumJsonChars * 2,
		capabilityCounts,
	};
}

/**
 * Splits one project-authorized tool directory into a small direct surface and
 * an authorized deferred catalog. Decisions use only verified scope ids and
 * exact tool contracts; prompt text and semantic intent are never inspected.
 */
export function resolveAgentsBridgeRemoteToolSurface<T extends RemoteToolSurfaceEntry>(input: {
	scope: AgentsBridgeRemoteToolScope;
	tools: readonly T[];
	disabledCapabilities?: readonly string[];
}): AgentsBridgeRemoteToolSurfaceResolution<T> {
	const before = measureRemoteToolSurface(input.tools);
	const normalizedScope = normalizeRemoteToolScope(input.scope);
	const hasProjectScope = hasScopeId(normalizedScope.projectId);
	const satisfiedScopes = readSatisfiedScopes(normalizedScope);
	const disabledCapabilities = new Set(input.disabledCapabilities ?? []);
	const enabledTools = input.tools.filter((tool) => {
		const toolContract = readToolContract(tool.name);
		return (
			!toolContract.capabilityGated ||
			!disabledCapabilities.has(toolContract.capability)
		);
	});
	const explicitCapabilityTools = normalizedScope.publicAgentsRequest
		? enabledTools.filter(
				(tool) => readToolContract(tool.name).capability === "diagnostic_reviewer",
			)
		: [];

	if (!normalizedScope.publicAgentsRequest) {
		const emptyCatalog: Array<AgentsBridgeRemoteToolCatalogEntry<T>> = [];
		return {
			tools: [],
			catalog: emptyCatalog,
			explicitCapabilityTools,
			hiddenToolNames: input.tools.map((tool) => tool.name),
			before,
			after: measureRemoteToolSurface([]),
			catalogMeasurement: measureRemoteToolSurface(emptyCatalog),
			catalogIndexMeasurement: measureRemoteToolCatalogIndex(emptyCatalog),
			satisfiedScopes: Array.from(satisfiedScopes),
		};
	}

	if (!hasProjectScope) {
		const tools = enabledTools.filter((tool) => {
			const toolContract = readToolContract(tool.name);
			return (
				toolContract.capability !== "diagnostic_reviewer" &&
				toolContract.directWhenScopeSatisfied &&
				toolContract.requiredScope.length === 0 &&
				hasCompatibleCanvasEnvelope(toolContract, normalizedScope)
			);
		});
		const directNames = new Set(tools.map((tool) => tool.name));
		const emptyCatalog: Array<AgentsBridgeRemoteToolCatalogEntry<T>> = [];
		return {
			tools,
			catalog: emptyCatalog,
			explicitCapabilityTools,
			hiddenToolNames: input.tools
				.filter((tool) => !directNames.has(tool.name))
				.map((tool) => tool.name),
			before,
			after: measureRemoteToolSurface(tools),
			catalogMeasurement: measureRemoteToolSurface(emptyCatalog),
			catalogIndexMeasurement: measureRemoteToolCatalogIndex(emptyCatalog),
			satisfiedScopes: Array.from(satisfiedScopes),
		};
	}

	const authorizedTools = enabledTools.filter(
		(tool) => readToolContract(tool.name).capability !== "diagnostic_reviewer",
	);
	const tools = authorizedTools.filter((tool) => {
		const toolContract = readToolContract(tool.name);
		return (
			hasCompatibleCanvasEnvelope(toolContract, normalizedScope) &&
			toolContract.directWhenScopeSatisfied &&
			(!toolContract.directOnlyWhileScopeMissing ||
				!satisfiedScopes.has(toolContract.directOnlyWhileScopeMissing)) &&
			(!toolContract.directOnlyWhenScopeSatisfied ||
				satisfiedScopes.has(toolContract.directOnlyWhenScopeSatisfied)) &&
			toolContract.requiredScope.every((scope) => satisfiedScopes.has(scope))
		);
	});
	const directNames = new Set(tools.map((tool) => tool.name));
	const catalog = authorizedTools
		.filter((tool) => {
			if (directNames.has(tool.name)) return false;
			const toolContract = readToolContract(tool.name);
			// Discovery-only tools are useful before an envelope establishes the
			// corresponding scope, but become redundant once the current request
			// already carries that scope. Do not leave them in the cold catalog:
			// their presence invites the model to re-discover project/book context
			// that was already injected or can be read through the task-specific
			// tools. This is a structural scope rule, not semantic routing.
			if (
				toolContract.directOnlyWhileScopeMissing &&
				satisfiedScopes.has(toolContract.directOnlyWhileScopeMissing)
			) {
				return false;
			}
			// Every required scope must already be present in the authenticated
			// request envelope. A later model-supplied book/node/execution id cannot
			// widen the catalog or its duplicated wrapper enums.
			return (
				hasCompatibleCanvasEnvelope(toolContract, normalizedScope) &&
				hasSatisfiedRequiredScopes(toolContract, satisfiedScopes)
			);
		})
		.map((tool) => {
			const toolContract = readToolContract(tool.name);
			return {
				...tool,
				requiredScope: [...toolContract.requiredScope],
				capability: toolContract.capability,
			};
		});
	const authorizedNames = new Set([
		...tools.map((tool) => tool.name),
		...catalog.map((tool) => tool.name),
	]);

	return {
		tools,
		catalog,
		explicitCapabilityTools,
		hiddenToolNames: input.tools
			.filter((tool) => !authorizedNames.has(tool.name))
			.map((tool) => tool.name),
		before,
		after: measureRemoteToolSurface(tools),
		catalogMeasurement: measureRemoteToolSurface(catalog),
		catalogIndexMeasurement: measureRemoteToolCatalogIndex(catalog),
		satisfiedScopes: Array.from(satisfiedScopes),
	};
}
