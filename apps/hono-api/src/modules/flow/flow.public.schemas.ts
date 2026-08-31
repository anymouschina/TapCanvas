import { z } from "zod";
import {
	PUBLIC_FLOW_ANCHOR_BINDING_KINDS,
	PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS,
} from "./flow.anchor-bindings";
import { WORKFLOW_EXECUTION_PROJECTION_OWNER } from "./flow.workflow-execution-projection";

export const PUBLIC_FLOW_AUTHORITY_BASE_FRAME_STATUSES = [
	"planned",
	"confirmed",
] as const;

export const PUBLIC_FLOW_PRODUCTION_LAYERS = [
	"evidence",
	"constraints",
	"anchors",
	"preproduction",
	"draft",
	"expansion",
	"blocking_diagram",
	"keyframe",
	"execution",
	"results",
	"design_board",
	"master_board",
	"preview",
] as const;

export const PUBLIC_FLOW_CREATION_STAGES = [
	"source_understanding",
	"constraint_definition",
	"preproduction",
	"world_anchor_lock",
	"character_anchor_lock",
	"shot_anchor_lock",
	"authority_base_frame",
	"intent_generate_scene_references",
	"spatial_blocking",
	"single_variable_expansion",
	"storyboard_stills",
	"approved_keyframe_selection",
	"intent_generate_shot_design_board",
	"story_preview",
	"beat_keyframe",
	"video_plan",
	"video_followup",
	"video_execution",
	"result_persistence",
] as const;

function toArray(value: unknown): unknown[] | undefined {
	if (typeof value === "undefined") return undefined;
	return Array.isArray(value) ? value : [value];
}

function normalizePatchNodeDataItem(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const item = value as Record<string, unknown>;
	if (typeof item.id === "string" && item.id.trim()) return item;
	// Some model/tool adapters use nodeId for the same structural identifier.
	// This is a lossless schema normalization: it never derives an id from labels,
	// positions, array indexes, or semantic content.
	if (typeof item.nodeId === "string" && item.nodeId.trim()) {
		return { ...item, id: item.nodeId };
	}
	return item;
}

function normalizePublicFlowPatchRequest(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const raw = value as Record<string, unknown>;
	// agent 有时把操作包在 operations/{} 或 patch/{} 里，展开后与顶层字段合并
	const ops =
		raw.operations && typeof raw.operations === "object" && !Array.isArray(raw.operations)
			? (raw.operations as Record<string, unknown>)
			: raw.patch && typeof raw.patch === "object" && !Array.isArray(raw.patch)
				? (raw.patch as Record<string, unknown>)
				: {};
	const deleteNodeIds = toArray(raw.deleteNodeIds ?? ops.deleteNodeIds);
	const deleteEdgeIds = toArray(raw.deleteEdgeIds ?? ops.deleteEdgeIds);
	const createNodes = [
		...(toArray(raw.createNodes ?? ops.createNodes) || []),
		...(toArray(raw.createNode ?? ops.createNode) || []),
	];
	const createEdges = [
		...(toArray(raw.createEdges ?? ops.createEdges) || []),
		...(toArray(raw.createEdge ?? ops.createEdge) || []),
	];
	const patchNodeData = [
		...(toArray(raw.patchNodeData ?? ops.patchNodeData)?.map(normalizePatchNodeDataItem) || []),
		...(toArray(raw.patchNode ?? ops.patchNode)?.map(normalizePatchNodeDataItem) || []),
	];
	const appendNodeArrays = [
		...(toArray(raw.appendNodeArrays ?? ops.appendNodeArrays) || []),
		...(toArray(raw.appendNodeArray ?? ops.appendNodeArray) || []),
	];
	return {
		allowOverwrite: raw.allowOverwrite ?? ops.allowOverwrite,
		...(deleteNodeIds?.length ? { deleteNodeIds } : {}),
		...(deleteEdgeIds?.length ? { deleteEdgeIds } : {}),
		...(createNodes.length ? { createNodes } : {}),
		...(createEdges.length ? { createEdges } : {}),
		...(patchNodeData.length ? { patchNodeData } : {}),
		...(appendNodeArrays.length ? { appendNodeArrays } : {}),
	};
}

export const PublicFlowGraphSchema = z.object({
	nodes: z.array(z.unknown()).default([]),
	edges: z.array(z.unknown()).default([]),
	viewport: z
		.object({
			x: z.number(),
			y: z.number(),
			zoom: z.number(),
		})
		.nullable()
		.optional(),
});

export type PublicFlowGraph = z.infer<typeof PublicFlowGraphSchema>;

export const PublicFlowGetResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	data: PublicFlowGraphSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type PublicFlowGetResponseDto = z.infer<typeof PublicFlowGetResponseSchema>;

export const PublicFlowPatchNodeDataSchema = z.object({
	id: z.string().min(1),
	data: z.record(z.string(), z.unknown()),
	// 条目级覆盖确认：错误提示与 root-persona 自愈协议都指示「在该 patchNodeData 条目上加
	// allowOverwrite: true」。此前 schema 只认顶层 allowOverwrite、条目级被 zod strip 掉，
	// 导致 agent 按提示补在条目上仍 409 死循环（pendingUserInput 被 hono schema 吞同类坑）。
	allowOverwrite: z.boolean().optional(),
});

export const PublicFlowAppendNodeArraySchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	items: z.array(z.unknown()).min(1),
});

export const PublicFlowCreateEdgeSchema = z
	.object({
		id: z.string().min(1).optional(),
		source: z.string().min(1),
		target: z.string().min(1),
		sourceHandle: z.string().min(1).optional(),
		targetHandle: z.string().min(1).optional(),
		type: z.string().min(1).optional(),
		label: z.string().optional(),
		data: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

const PublicFlowNodePositionSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
});

export const PUBLIC_FLOW_ADMIN_WORKFLOW_TASK_NODE_KINDS = [
	"workflowTrigger",
	"workflowStage",
] as const;

const PublicFlowTaskNodeKindSchema = z.enum([
	"text",
	"codex",
	"image",
	"imageEdit",
	"video",
	"storyboard",
	"novelDoc",
	"scriptDoc",
	"storyboardScript",
	"cameraRef",
	"workflowInput",
	"workflowOutput",
	"storyboardImage",
	"imageFission",
	"composeVideo",
	"audio",
	"videoAnalysis",
	"shotTable",
	"subtitle",
	...PUBLIC_FLOW_ADMIN_WORKFLOW_TASK_NODE_KINDS,
]);

const PublicFlowProductionLayerSchema = z.enum(PUBLIC_FLOW_PRODUCTION_LAYERS);

const PublicFlowCreationStageSchema = z.enum(PUBLIC_FLOW_CREATION_STAGES);

const PublicFlowApprovalStatusSchema = z.enum([
	"needs_confirmation",
	"approved",
	"rejected",
]);

const PublicFlowStoryboardEditorCellSchema = z
	.object({
		id: z.string().min(1),
		imageUrl: z.string().min(1).nullable().optional(),
		label: z.string().optional(),
		prompt: z.string().optional(),
		sourceKind: z.string().optional(),
		sourceNodeId: z.string().min(1).optional(),
		sourceIndex: z.number().int().min(0).optional(),
		shotNo: z.number().int().min(1).optional(),
		aspect: z.string().optional(),
	})
	.passthrough();

const PublicFlowAnchorBindingSchema = z
	.object({
		kind: z.enum(PUBLIC_FLOW_ANCHOR_BINDING_KINDS),
		refId: z.string().min(1).optional(),
		entityId: z.string().min(1).optional(),
		label: z.string().min(1).optional(),
		sourceBookId: z.string().min(1).optional(),
		sourceNodeId: z.string().min(1).optional(),
		assetId: z.string().min(1).optional(),
		assetRefId: z.string().min(1).optional(),
		imageUrl: z.string().min(1).optional(),
		referenceView: z.enum(PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS).optional(),
		category: z.string().min(1).optional(),
		note: z.string().min(1).optional(),
	})
	.passthrough();

const PublicFlowChapterGroundedProductionMetadataSchema = z
	.object({
		chapterGrounded: z.literal(true),
		lockedAnchors: z.object({
			character: z.array(z.string()),
			scene: z.array(z.string()),
			shot: z.array(z.string()),
			continuity: z.array(z.string()),
			missing: z.array(z.string()),
		}),
		authorityBaseFrame: z.object({
			status: z.enum(PUBLIC_FLOW_AUTHORITY_BASE_FRAME_STATUSES),
			source: z.string().min(1),
			reason: z.string().min(1),
			nodeId: z.string().min(1).nullable().optional(),
		}),
	})
	.passthrough();

const PublicFlowImageCameraControlSchema = z
	.object({
		enabled: z.boolean().optional(),
		presetId: z.string().min(1).optional(),
		azimuthDeg: z.number().finite().optional(),
		elevationDeg: z.number().finite().optional(),
		distance: z.number().finite().optional(),
	})
	.passthrough();

const PublicFlowImageLightControlSchema = z
	.object({
		enabled: z.boolean().optional(),
		presetId: z.string().min(1).optional(),
		azimuthDeg: z.number().finite().optional(),
		elevationDeg: z.number().finite().optional(),
		intensity: z.number().finite().optional(),
		colorHex: z.string().min(1).optional(),
	})
	.passthrough();

const PublicFlowImageLightingRigSchema = z
	.object({
		main: PublicFlowImageLightControlSchema.optional(),
		fill: PublicFlowImageLightControlSchema.optional(),
	})
	.passthrough();

const PublicFlowShotTableColumnSchema = z.object({
	key: z.string().min(1),
	label: z.string().min(1),
	scope: z.enum(["shot", "timeline"]),
});

const PublicFlowShotTableRowSchema = z.object({
	id: z.string().min(1),
	shotId: z.string().min(1),
	values: z.record(z.string(), z.string()),
});

const PublicFlowStoryPreviewReferenceSchema = z
	.object({
		nodeId: z.string().min(1).optional(),
		assetId: z.string().min(1).optional(),
		role: z.enum(["identity", "layout", "content", "style"]),
		entityKind: z.enum(["character", "scene", "prop", "vfx", "content"]),
		entityName: z.string().min(1),
	})
	.superRefine((reference, context) => {
		if (Boolean(reference.nodeId) === Boolean(reference.assetId)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["nodeId"],
				message: "故事预览参考必须且只能绑定 nodeId 或 assetId 之一。",
			});
		}
	});

const PublicFlowStoryPreviewContractSchema = z
	.object({
		schemaVersion: z.literal("story-preview-contract/v1"),
		storyDurationSeconds: z.number().finite().positive().max(3600),
		previewScope: z.enum(["full_story", "user_window"]).optional(),
		previewWindow: z.object({
			startSeconds: z.number().finite().min(0),
			endSeconds: z.number().finite().positive(),
		}),
		frameIntervalSeconds: z.number().finite().positive(),
		requiredReferences: z.array(PublicFlowStoryPreviewReferenceSchema).min(1).max(32),
	})
	.superRefine((contract, context) => {
		if (contract.previewScope === "full_story" && (
			contract.previewWindow.startSeconds !== 0 ||
			contract.previewWindow.endSeconds !== contract.storyDurationSeconds
		)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["previewWindow"],
				message: "全剧情预览窗口必须覆盖 0 到整段故事总时长。",
			});
		}
		if (contract.previewWindow.endSeconds <= contract.previewWindow.startSeconds) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["previewWindow", "endSeconds"],
				message: "故事预览窗口必须是正向时间区间。",
			});
		}
		if (contract.previewWindow.endSeconds > contract.storyDurationSeconds) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["previewWindow", "endSeconds"],
				message: "故事预览窗口不能超出整段故事总时长。",
			});
		}
	});

const PublicFlowStoryPreviewCellSchema = z.object({
	cellIndex: z.number().int().min(1).max(9),
	startSeconds: z.number().finite().min(0),
	endSeconds: z.number().finite().positive(),
	timeRange: z.string().min(1),
	narrativeFunction: z.string().min(1),
	frameDescription: z.string().min(1),
	visibleAction: z.string().min(1),
	stateBefore: z.string().min(1),
	stateAfter: z.string().min(1),
	causeFromPrevious: z.string().min(1),
	transitionToNext: z.string().min(1),
	blocking: z.string().min(1),
	cameraState: z.string().min(1),
	motionTransition: z.string().min(1),
	physicalFeedback: z.string().min(1),
	environmentChange: z.string().min(1),
	subjectRefIds: z.array(z.string().regex(/^(?:node|asset):[^\s:][^\s]*$/u)).min(1).max(32),
});

export const PublicFlowShotTableSchema = z.object({
	version: z.literal(1),
	overview: z.record(z.string(), z.string()),
	columns: z.array(PublicFlowShotTableColumnSchema).min(1),
	rows: z.array(PublicFlowShotTableRowSchema).min(1),
}).superRefine((table, context) => {
	const columnKeys = new Set<string>();
	for (const [index, column] of table.columns.entries()) {
		if (columnKeys.has(column.key)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["columns", index, "key"],
				message: `分镜表列 key 重复：${column.key}`,
			});
		}
		columnKeys.add(column.key);
	}
	const rowIds = new Set<string>();
	for (const [index, row] of table.rows.entries()) {
		if (rowIds.has(row.id)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["rows", index, "id"],
				message: `分镜表行 id 重复：${row.id}`,
			});
		}
		rowIds.add(row.id);
	}
});

export const PublicFlowTaskNodeDataSchema = z
	.object({
		kind: PublicFlowTaskNodeKindSchema,
		label: z.string().optional(),
		referenceImages: z.array(z.string().min(1)).optional(),
		anchorBindings: z.array(PublicFlowAnchorBindingSchema).optional(),
		assetInputs: z
			.array(
				z.object({
					assetId: z.string().min(1).optional(),
					assetRefId: z.string().min(1).optional(),
					url: z.string().min(1),
					role: z.string().min(1).optional(),
					weight: z.number().finite().optional(),
					note: z.string().optional(),
					name: z.string().optional(),
				}),
			)
			.optional(),
		nodeWidth: z.number().finite().optional(),
		nodeHeight: z.number().finite().optional(),
		// These fields are executable provenance for downstream production gates. Unknown values
		// must reject the whole patch instead of silently stripping the evidence from a created node.
		productionLayer: PublicFlowProductionLayerSchema.optional(),
		creationStage: PublicFlowCreationStageSchema.optional(),
		approvalStatus: PublicFlowApprovalStatusSchema.optional(),
		assetUsage: z.enum(["production", "preview_only"]).optional(),
		assetPurpose: z.enum(["story_preview"]).optional(),
		productionEligible: z.boolean().optional(),
		previewSeriesId: z.string().min(1).optional(),
		previewBoardIndex: z.number().int().min(0).optional(),
		previewBoardCount: z.number().int().min(1).optional(),
		previewShotCount: z.number().int().min(1).max(9).optional(),
		storyPreviewContract: PublicFlowStoryPreviewContractSchema.optional(),
		referenceManifest: z.array(PublicFlowStoryPreviewReferenceSchema).min(1).max(32).optional(),
		storyPreviewCells: z.array(PublicFlowStoryPreviewCellSchema).min(1).max(9).optional(),
		sourceChapterRevision: z.number().int().min(0).optional(),
		sourceHash: z.string().min(1).optional(),
		storyboardEditorGrid: z.enum(["2x2", "3x2", "3x3", "5x5"]).optional(),
		storyboardEditorAspect: z.enum(["1:1", "4:3", "16:9", "9:16"]).optional(),
		storyboardEditorCollapsed: z.boolean().optional(),
		storyboardEditorEditMode: z.boolean().optional(),
		storyboardEditorCells: z.array(PublicFlowStoryboardEditorCellSchema).optional(),
		imageCameraControl: PublicFlowImageCameraControlSchema.optional(),
		imageLightingRig: PublicFlowImageLightingRigSchema.optional(),
		productionMetadata: PublicFlowChapterGroundedProductionMetadataSchema.optional(),
		shotTable: PublicFlowShotTableSchema.optional(),
	})
	.passthrough()
	.superRefine((data, context) => {
		if (data.kind !== "shotTable" || data.shotTable) return;
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["shotTable"],
			message: "data.shotTable: 分镜表数据不是对象。",
		});
	});

const PublicFlowGroupNodeDataSchema = z
	.object({
		label: z.string().optional(),
		isGroup: z.boolean().optional(),
		groupKind: z.string().optional(),
	})
	.passthrough();

const PublicFlowGroupNodeStyleSchema = z
	.object({
		width: z.number().finite(),
		height: z.number().finite(),
	})
	.passthrough();

export const PublicFlowCreateTaskNodeSchema = z
	.object({
		id: z.string().min(1).optional(),
		type: z.literal("taskNode"),
		position: PublicFlowNodePositionSchema,
		data: PublicFlowTaskNodeDataSchema,
		parentId: z.string().min(1).optional(),
		selected: z.boolean().optional(),
		draggable: z.boolean().optional(),
		selectable: z.boolean().optional(),
		focusable: z.boolean().optional(),
		dragHandle: z.string().min(1).optional(),
	})
	.passthrough();

export const PublicFlowCreateGroupNodeSchema = z
	.object({
		id: z.string().min(1).optional(),
		type: z.literal("groupNode"),
		position: PublicFlowNodePositionSchema,
		data: PublicFlowGroupNodeDataSchema,
		style: PublicFlowGroupNodeStyleSchema,
		parentId: z.string().min(1).optional(),
		selected: z.boolean().optional(),
		draggable: z.boolean().optional(),
		selectable: z.boolean().optional(),
		focusable: z.boolean().optional(),
	})
	.passthrough();

export const PublicFlowCreateWorkflowExecutionNodeSchema = z
	.object({
		id: z.string().min(1).optional(),
		type: z.literal("workflowExecutionNode"),
		position: PublicFlowNodePositionSchema,
		data: z.object({
			kind: z.literal("workflowExecution"),
			managedProjection: z.literal(WORKFLOW_EXECUTION_PROJECTION_OWNER),
			workflowRuntimeReference: z.literal(false),
			workflowExecutionId: z.string().min(1),
			workflowExecutionCreatedAt: z.string().min(1),
			workflowStatus: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
			workflowCompletedUnits: z.number().int().min(0).optional(),
			workflowTotalUnits: z.number().int().min(0).optional(),
			workflowErrorCount: z.number().int().min(0).optional(),
			label: z.string().min(1).optional(),
		}).passthrough(),
		selected: z.boolean().optional(),
		draggable: z.boolean().optional(),
		selectable: z.boolean().optional(),
		deletable: z.boolean().optional(),
		focusable: z.boolean().optional(),
	})
	.passthrough();

export const PublicFlowCreateNodeSchema = z.union([
	PublicFlowCreateTaskNodeSchema,
	PublicFlowCreateGroupNodeSchema,
	PublicFlowCreateWorkflowExecutionNodeSchema,
]);

export const PublicFlowPatchRequestSchema = z.preprocess(
	normalizePublicFlowPatchRequest,
	z.object({
		allowOverwrite: z.boolean().optional(),
		deleteNodeIds: z.array(z.string().min(1)).optional(),
		deleteEdgeIds: z.array(z.string().min(1)).optional(),
		createNodes: z.array(PublicFlowCreateNodeSchema).optional(),
		createEdges: z.array(PublicFlowCreateEdgeSchema).optional(),
		patchNodeData: z.array(PublicFlowPatchNodeDataSchema).optional(),
		appendNodeArrays: z.array(PublicFlowAppendNodeArraySchema).optional(),
	}),
);

export type PublicFlowPatchRequestDto = z.infer<typeof PublicFlowPatchRequestSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataDeclaresAdminWorkflow(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return PUBLIC_FLOW_ADMIN_WORKFLOW_TASK_NODE_KINDS.includes(
		value.kind as (typeof PUBLIC_FLOW_ADMIN_WORKFLOW_TASK_NODE_KINDS)[number],
	) || value.adminWorkflow === true
		|| value.managedProjection === WORKFLOW_EXECUTION_PROJECTION_OWNER
		|| Object.prototype.hasOwnProperty.call(value, "workflowPermission");
}

/** Deterministic authorization fact: this patch declares or mutates admin-only workflow data. */
export function publicFlowPatchRequestsAdminWorkflow(
	patch: PublicFlowPatchRequestDto,
): boolean {
	return (patch.createNodes ?? []).some((node) => dataDeclaresAdminWorkflow(node.data))
		|| (patch.patchNodeData ?? []).some((entry) => dataDeclaresAdminWorkflow(entry.data));
}

export const FlowPatchNodeSnapshotSchema = z.object({
	id: z.string(),
	type: z.string().optional(),
	data: z.record(z.unknown()).optional(),
	position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const FlowPatchEdgeSnapshotSchema = z.object({
	id: z.string(),
	source: z.string(),
	target: z.string(),
	sourceHandle: z.string().optional(),
	targetHandle: z.string().optional(),
});

export const PublicFlowPatchResponseSchema = z.object({
	ok: z.literal(true),
	flowId: z.string(),
	updatedAt: z.string(),
	stats: z.object({
		deletedNodes: z.number(),
		deletedEdges: z.number(),
		createdNodes: z.number(),
		createdEdges: z.number(),
		patchedNodes: z.number(),
		appendedArrays: z.number(),
	}),
	/** Persisted data snapshot for each newly created node. AI can verify kind/label/fields. */
	createdNodeSnapshots: z.array(FlowPatchNodeSnapshotSchema).optional(),
	/** Persisted data snapshot for each newly created edge. AI can verify source/target/handles. */
	createdEdgeSnapshots: z.array(FlowPatchEdgeSnapshotSchema).optional(),
	data: PublicFlowGraphSchema,
});

export type PublicFlowPatchResponseDto = z.infer<typeof PublicFlowPatchResponseSchema>;

export const PublicProjectFlowListItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	updatedAt: z.string(),
});

export const PublicProjectFlowsResponseSchema = z.object({
	items: z.array(PublicProjectFlowListItemSchema),
});

export type PublicProjectFlowsResponseDto = z.infer<typeof PublicProjectFlowsResponseSchema>;

export const PublicProjectFlowScopeRepairRequestSchema = z.object({
	expectedUpdatedAt: z.string().min(1),
	expectedNodeCount: z.number().int().min(0),
	expectedEdgeCount: z.number().int().min(0),
});

export type PublicProjectFlowScopeRepairRequestDto = z.infer<
	typeof PublicProjectFlowScopeRepairRequestSchema
>;

export const PublicProjectFlowScopeRepairResponseSchema = z.object({
	ok: z.literal(true),
	flowId: z.string(),
	projectId: z.string(),
	ownerType: z.literal("project"),
	ownerId: z.string(),
	updatedAt: z.string(),
	nodeCount: z.number().int().min(0),
	edgeCount: z.number().int().min(0),
});

export type PublicProjectFlowScopeRepairResponseDto = z.infer<
	typeof PublicProjectFlowScopeRepairResponseSchema
>;
