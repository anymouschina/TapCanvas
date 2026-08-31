import { z } from "zod";

export const CanvasFlowSchema = z
	.object({
		nodes: z.array(z.record(z.string(), z.unknown())),
		edges: z.array(z.record(z.string(), z.unknown())),
	})
	.strict();

export const GetCanvasFlowResponseSchema = z
	.object({
		chapterId: z.string(),
		revision: z.number().int().min(0),
		flow: CanvasFlowSchema.nullable(),
	})
	.strict();

export const PutCanvasFlowRequestSchema = z
	.object({
		expectedRevision: z.number().int().min(0),
		flow: CanvasFlowSchema,
		// 删除墓碑：前端「本地显式删除、尚未被服务端确认」的节点 id。服务端写保护
		// (reconcileActiveRunVideoNodes) 据此区分「用户显式删除」与「stale autosave 漏带」——
		// 墓碑里的资产节点不再被护栏复活，否则母板/分镜板等永远删不掉（根因）。
		deletedNodeIds: z.array(z.string()).optional(),
		// 写入来源只用于记录调用方事实。无论 user/agent，整图快照的
		// expectedRevision 落后都必须 409；agent 调用方应重读后重新应用结构化 patch。
		source: z.enum(["user", "agent"]).optional(),
	})
	.strict();

export const PutCanvasFlowResponseSchema = z
	.object({
		chapterId: z.string(),
		revision: z.number().int().min(0),
		// Only present when server-side preservation/canonicalization changed the
		// submitted graph. The caller must adopt this authoritative graph instead
		// of tagging its stale local snapshot with the returned revision.
		authoritativeFlow: CanvasFlowSchema.optional(),
	})
	.strict();

export type CanvasFlow = z.infer<typeof CanvasFlowSchema>;
export type GetCanvasFlowResponse = z.infer<typeof GetCanvasFlowResponseSchema>;
export type PutCanvasFlowRequest = z.infer<typeof PutCanvasFlowRequestSchema>;
export type PutCanvasFlowResponse = z.infer<typeof PutCanvasFlowResponseSchema>;
