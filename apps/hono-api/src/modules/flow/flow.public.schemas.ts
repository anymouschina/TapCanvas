import { z } from "zod";
import {
	PUBLIC_FLOW_ANCHOR_BINDING_KINDS,
	PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS,
} from "./flow.anchor-bindings";

function toArray(value: unknown): unknown[] | undefined {
	if (typeof value === "undefined") return undefined;
	return Array.isArray(value) ? value : [value];
}

function normalizePublicFlowPatchRequest(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const raw = value as Record<string, unknown>;
	const deleteNodeIds = toArray(raw.deleteNodeIds);
	const deleteEdgeIds = toArray(raw.deleteEdgeIds);
	const createNodes = [
		...(toArray(raw.createNodes) || []),
		...(toArray(raw.createNode) || []),
	];
	const createEdges = [
		...(toArray(raw.createEdges) || []),
		...(toArray(raw.createEdge) || []),
	];
	const patchNodeData = [
		...(toArray(raw.patchNodeData) || []),
		...(toArray(raw.patchNode) || []),
	];
	const appendNodeArrays = [
		...(toArray(raw.appendNodeArrays) || []),
		...(toArray(raw.appendNodeArray) || []),
	];
	return {
		allowOverwrite: raw.allowOverwrite,
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

const PublicFlowTaskNodeKindSchema = z.enum([
	"text",
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
	"mosaic",
	"composeVideo",
	"audio",
	"subtitle",
]);

const PublicFlowProductionLayerSchema = z.enum([
	"evidence",
	"constraints",
	"anchors",
	"expansion",
	"execution",
	"results",
]);

const PublicFlowCreationStageSchema = z.enum([
	"source_understanding",
	"constraint_definition",
	"world_anchor_lock",
	"character_anchor_lock",
	"shot_anchor_lock",
	"single_variable_expansion",
	"approved_keyframe_selection",
	"video_plan",
	"video_execution",
	"result_persistence",
]);

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
			status: z.enum(["planned", "confirmed"]),
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

const PublicFlowTaskNodeDataSchema = z
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
		productionLayer: PublicFlowProductionLayerSchema.optional(),
		creationStage: PublicFlowCreationStageSchema.optional(),
		approvalStatus: PublicFlowApprovalStatusSchema.optional(),
		storyboardEditorGrid: z.enum(["2x2", "3x2", "3x3", "5x5"]).optional(),
		storyboardEditorAspect: z.enum(["1:1", "4:3", "16:9", "9:16"]).optional(),
		storyboardEditorCollapsed: z.boolean().optional(),
		storyboardEditorEditMode: z.boolean().optional(),
		storyboardEditorCells: z.array(PublicFlowStoryboardEditorCellSchema).optional(),
		imageCameraControl: PublicFlowImageCameraControlSchema.optional(),
		imageLightingRig: PublicFlowImageLightingRigSchema.optional(),
		productionMetadata: PublicFlowChapterGroundedProductionMetadataSchema.optional(),
	})
	.passthrough();

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

export const PublicFlowCreateNodeSchema = z.union([
	PublicFlowCreateTaskNodeSchema,
	PublicFlowCreateGroupNodeSchema,
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
