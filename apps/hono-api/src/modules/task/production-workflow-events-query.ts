import type { PrismaClient } from "@prisma/client";

import {
	VIDEO_PRODUCTION_WORKFLOW_NODE_IDS,
	VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
	parseVideoProductionWorkflowEvent,
	type VideoProductionWorkflowEvent,
	type VideoProductionWorkflowNodeId,
} from "@tapcanvas/video-orchestrator-protocol";

export type ProductionWorkflowEventPage = Readonly<{
	workflowRunId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	events: readonly VideoProductionWorkflowEvent[];
	nextBeforeSeq: number | null;
}>;

export class ProductionWorkflowEventQueryError extends Error {
	readonly status: 400 | 404;

	constructor(message: string, status: 400 | 404 = 400) {
		super(message);
		this.name = "ProductionWorkflowEventQueryError";
		this.status = status;
	}
}

function requireRunId(value: string): string {
	const runId = value.trim();
	if (!runId) throw new ProductionWorkflowEventQueryError("production workflow event query requires runId");
	return runId;
}

function requireWorkflowNodeId(value: string): VideoProductionWorkflowNodeId {
	if ((VIDEO_PRODUCTION_WORKFLOW_NODE_IDS as readonly string[]).includes(value)) {
		return value as VideoProductionWorkflowNodeId;
	}
	throw new ProductionWorkflowEventQueryError(`production workflow event query has non-canonical nodeId: ${value}`);
}

function parseIdArray(value: string, field: string): string[] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string" || !entry.trim())) {
		throw new Error(`production workflow event ${field} must be a JSON string array`);
	}
	return parsed;
}

export function parseProductionWorkflowEventPageQuery(input: {
	beforeSeq?: string;
	limit?: string;
}): { beforeSeq: number | null; limit: number } {
	const beforeSeq = input.beforeSeq === undefined || input.beforeSeq === ""
		? null
		: Number(input.beforeSeq);
	if (beforeSeq !== null && (!Number.isInteger(beforeSeq) || beforeSeq < 1)) {
		throw new ProductionWorkflowEventQueryError("beforeSeq must be a positive integer");
	}
	const limit = input.limit === undefined || input.limit === "" ? 30 : Number(input.limit);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new ProductionWorkflowEventQueryError("limit must be an integer between 1 and 100");
	}
	return { beforeSeq, limit };
}

export async function listProductionWorkflowNodeEvents(input: {
	db: PrismaClient;
	runId: string;
	nodeId: string;
	beforeSeq: number | null;
	limit: number;
}): Promise<ProductionWorkflowEventPage> {
	const workflowRunId = requireRunId(input.runId);
	const workflowNodeId = requireWorkflowNodeId(input.nodeId);
	if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
		throw new ProductionWorkflowEventQueryError("production workflow event limit must be between 1 and 100");
	}
	const run = await input.db.video_runs.findUnique({ where: { id: workflowRunId }, select: { id: true } });
	if (!run) throw new ProductionWorkflowEventQueryError(`production workflow run not found: ${workflowRunId}`, 404);
	const rows = await input.db.production_workflow_events.findMany({
		where: {
			run_id: workflowRunId,
			workflow_node_id: workflowNodeId,
			...(input.beforeSeq !== null ? { seq: { lt: input.beforeSeq } } : {}),
		},
		orderBy: { seq: "desc" },
		take: input.limit + 1,
	});
	const hasMore = rows.length > input.limit;
	const pageRows = rows.slice(0, input.limit);
	const events = pageRows.map((row): VideoProductionWorkflowEvent => {
		const parsed = parseVideoProductionWorkflowEvent({
			protocolVersion: VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
			workflowRunId: row.run_id,
			workflowNodeId: row.workflow_node_id,
			eventId: row.id,
			seq: row.seq,
			kind: row.event_kind,
			occurredAt: row.created_at,
			payloadRef: row.payload_ref,
			artifactIds: parseIdArray(row.artifact_ids, "artifactIds"),
			effectIds: parseIdArray(row.effect_ids, "effectIds"),
		});
		if (!parsed.success) {
			throw new Error(`invalid persisted production workflow event ${row.id}: ${parsed.error.message}`);
		}
		return parsed.data;
	}).reverse();
	return {
		workflowRunId,
		workflowNodeId,
		events,
		nextBeforeSeq: hasMore ? (pageRows.at(-1)?.seq ?? null) : null,
	};
}
