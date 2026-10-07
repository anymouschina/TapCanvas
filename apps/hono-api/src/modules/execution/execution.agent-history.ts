import { z } from "zod";
import { getPrismaClient } from "../../platform/node/prisma";
import { AppError } from "../../middleware/error";

const id = z.string().trim().min(1).max(512);
export const AgentNodeReadSchema = z.object({
	executionId: id,
	// The shared chapter tool envelope injects this scope fact before dispatch.
	bookId: id.optional(),
	view: z.enum(["metadata", "content"]).default("metadata"),
	format: z.enum(["shallow", "json"]).default("shallow"),
	nodeId: id.optional(),
	attemptId: id.optional(),
	revision: id.optional(),
	field: z.enum(["output", "input", "toolCalls", "semantics", "providerReceipts", "tokenUsage", "creditUsage"]).default("output"),
	path: z.array(z.string().max(512)).max(32).default([]),
	cursor: id.optional(),
	limit: z.number().int().min(1).max(100).default(30),
	offset: z.number().int().min(0).max(2_147_483_646).default(0),
	textLimit: z.number().int().min(1).max(12_000).default(4_000),
}).strict().superRefine((args, ctx) => {
	if (args.view === "content" && (!args.nodeId || args.cursor)) ctx.addIssue({ code: "custom", message: "content requires nodeId and does not accept cursor" });
	if (args.view === "metadata" && (args.attemptId || args.revision || args.path.length || args.offset || args.field !== "output")) ctx.addIssue({ code: "custom", message: "content selectors require view=content" });
	if (args.format === "json" && (args.view !== "content" || args.field !== "input")) ctx.addIssue({ code: "custom", message: "format=json requires view=content and field=input" });
	if (!args.attemptId && ["semantics", "providerReceipts", "tokenUsage", "creditUsage"].includes(args.field)) ctx.addIssue({ code: "custom", message: "This field requires an immutable attemptId" });
});
export type AgentNodeRead = z.infer<typeof AgentNodeReadSchema>;

export const executionMetadataSelect = {
	id: true, flow_id: true, flow_version_id: true, owner_id: true, status: true,
	concurrency: true, trigger: true, error_message: true, error_code: true, failure_stage: true,
	project_id: true, canvas_id: true, retry_count: true, recovery_of_execution_id: true,
	execution_family_id: true, uses_project_assets: true, created_at: true, started_at: true, finished_at: true,
} as const;
const nodeMetadataSelect = {
	id: true, execution_id: true, node_id: true, status: true, attempt: true,
	error_message: true, error_code: true, failure_stage: true, node_type: true,
	tool_name: true, model_key: true, created_at: true, started_at: true, finished_at: true,
} as const;

export function getAgentExecutionMetadata(ownerId: string, executionId: string) {
	return getPrismaClient().workflow_executions.findFirst({ where: { id: executionId, owner_id: ownerId }, select: executionMetadataSelect });
}
export function listAgentExecutionMetadata(ownerId: string, flowId: string, limit: number, scope: { projectId: string; isChapterScope: boolean }) {
	return getPrismaClient().workflow_executions.findMany({
		where: { owner_id: ownerId, OR: [
			{ flow_id: flowId },
			{ project_id: scope.projectId, canvas_id: { in: scope.isChapterScope ? [flowId, `chapter:${flowId}`] : [flowId] } },
		] },
		select: executionMetadataSelect, take: limit, orderBy: [{ created_at: "desc" }, { id: "desc" }],
	});
}

/** Bodies are deliberately absent from SELECT, not discarded after ORM hydration. */
export async function listAgentNodeMetadata(ownerId: string, args: Pick<AgentNodeRead, "executionId" | "nodeId" | "cursor" | "limit">, attempts = false) {
	const prisma = getPrismaClient();
	const where = { execution_id: args.executionId, workflow_executions: { owner_id: ownerId }, ...(args.nodeId ? { node_id: args.nodeId } : {}) };
	if (args.cursor) {
		const scoped = attempts
			? await prisma.workflow_node_attempts.findFirst({ where: { ...where, id: args.cursor }, select: { id: true } })
			: await prisma.workflow_node_runs.findFirst({ where: { ...where, id: args.cursor }, select: { id: true } });
		if (!scoped) throw new AppError("Cursor does not belong to this execution scope", { status: 400, code: "workflow_node_cursor_invalid" });
	}
	const query = { where, select: nodeMetadataSelect, orderBy: [{ created_at: "asc" as const }, { id: "asc" as const }], take: args.limit + 1,
		...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}) };
	const rows = attempts ? await prisma.workflow_node_attempts.findMany(query) : await prisma.workflow_node_runs.findMany(query);
	const items = rows.slice(0, args.limit).map((row) => ({
		id: row.id, executionId: row.execution_id, nodeId: row.node_id, status: row.status, attempt: row.attempt,
		errorMessage: row.error_message, errorCode: row.error_code, failureStage: row.failure_stage,
		nodeType: row.node_type, toolName: row.tool_name, modelKey: row.model_key,
		createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
		contentRead: { executionId: row.execution_id, nodeId: row.node_id, view: "content" as const, ...(attempts ? { attemptId: row.id } : {}) },
	}));
	return { items, nextCursor: rows.length > args.limit ? items.at(-1)!.id : null };
}
