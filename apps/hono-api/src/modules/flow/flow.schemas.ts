import { z } from "zod";

export const FlowSchema = z.object({
	id: z.string(),
	name: z.string(),
	data: z.unknown(),
	ownerType: z.enum(["project", "chapter", "shot"]).nullable().optional(),
	ownerId: z.string().nullable().optional(),
	// 【画布多 tab 版本号防覆盖·2026-07-15】乐观锁版本号，映射 flows.canvas_revision。
	canvasRevision: z.number().int().min(0).optional().default(0),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type FlowDto = z.infer<typeof FlowSchema>;

export const FlowSaveReceiptSchema = FlowSchema.omit({ data: true }).extend({
	// False means the accepted authoring snapshot is byte-for-byte equivalent on
	// the canvas-owned fields, so clients can retain their local snapshot without
	// downloading the full graph again. True instructs them to re-read once.
	dataAdjusted: z.boolean(),
});

export type FlowSaveReceiptDto = z.infer<typeof FlowSaveReceiptSchema>;

export const UpsertFlowSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1),
	data: z.unknown(),
	projectId: z.string().nullable().optional(),
	ownerType: z.enum(["project", "chapter", "shot"]).optional(),
	ownerId: z.string().min(1).optional(),
	// 用户与 agent 共用同一乐观锁版本；携带 expectedRevision 时由 repo 原子校验，
	// 版本落后抛 FlowRevisionConflictError，调用方重读后再合并自身变更。
	expectedRevision: z.number().int().min(0).optional(),
	source: z.enum(["user", "agent"]).optional(),
});

export const FlowVersionSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
});

export const FlowVersionPageSchema = z.object({
	items: FlowVersionSchema.array(),
	nextCursor: z.string().nullable(),
});
