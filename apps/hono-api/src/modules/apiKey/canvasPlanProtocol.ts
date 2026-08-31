import { z } from "zod";

export {
	CANVAS_PLAN_NOVEL_TRACEABILITY_REQUIRED_HINT,
	CANVAS_PLAN_PROTOCOL_FORMAT_HINT,
	CANVAS_PLAN_STORYBOARD_EDITOR_REQUIRED_HINT,
	CANVAS_PLAN_TAG_NAME,
	CANVAS_PLAN_VIDEO_GOVERNANCE_HINT,
	CANVAS_PLAN_VIDEO_PROMPT_REQUIRED_HINT,
	CANVAS_PLAN_VISUAL_PROMPT_REQUIRED_HINT,
	type CanvasPlanPosition,
	type ChatCanvasPlan,
	type ChatCanvasPlanEdge,
	type ChatCanvasPlanNode,
} from "../../../../../packages/schemas/canvas-plan-protocol";

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
