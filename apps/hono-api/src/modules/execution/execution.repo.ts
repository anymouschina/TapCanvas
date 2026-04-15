import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import type {
	WorkflowExecutionDto,
	WorkflowExecutionEventDto,
	WorkflowNodeRunDto,
} from "./execution.schemas";

export type ExecutionRow = {
	id: string;
	flow_id: string;
	flow_version_id: string;
	owner_id: string;
	status: string;
	concurrency: number;
	trigger: string | null;
	error_message: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export type NodeRunRow = {
	id: string;
	execution_id: string;
	node_id: string;
	status: string;
	attempt: number;
	error_message: string | null;
	output_refs: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
};

export type ExecutionEventRow = {
	id: string;
	execution_id: string;
	seq: number;
	event_type: string;
	level: string;
	node_id: string | null;
	message: string | null;
	data: string | null;
	created_at: string;
};

export function mapExecutionRow(row: ExecutionRow): WorkflowExecutionDto {
	return {
		id: row.id,
		flowId: row.flow_id,
		flowVersionId: row.flow_version_id,
		ownerId: row.owner_id,
		status: row.status as WorkflowExecutionDto["status"],
		concurrency: Number(row.concurrency || 1),
		trigger: row.trigger,
		errorMessage: row.error_message,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function mapNodeRunRow(row: NodeRunRow): WorkflowNodeRunDto {
	let outputRefs: unknown = undefined;
	if (row.output_refs) {
		try {
			outputRefs = JSON.parse(row.output_refs);
		} catch {
			outputRefs = row.output_refs;
		}
	}
	return {
		id: row.id,
		executionId: row.execution_id,
		nodeId: row.node_id,
		status: row.status as WorkflowNodeRunDto["status"],
		attempt: Number(row.attempt || 1),
		errorMessage: row.error_message,
		outputRefs,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}

export function mapExecutionEventRow(
	row: ExecutionEventRow,
): WorkflowExecutionEventDto {
	let data: unknown = undefined;
	if (row.data) {
		try {
			data = JSON.parse(row.data);
		} catch {
			data = row.data;
		}
	}
	return {
		id: row.id,
		executionId: row.execution_id,
		seq: Number(row.seq),
		eventType: row.event_type as WorkflowExecutionEventDto["eventType"],
		level: row.level as WorkflowExecutionEventDto["level"],
		nodeId: row.node_id,
		message: row.message,
		data,
		createdAt: row.created_at,
	};
}

export async function createExecution(
	db: PrismaClient,
	params: {
		id: string;
		flowId: string;
		flowVersionId: string;
		ownerId: string;
		concurrency: number;
		trigger?: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const { id, flowId, flowVersionId, ownerId, concurrency, trigger, nowIso } =
		params;
	await getPrismaClient().workflow_executions.create({
		data: {
			id,
			flow_id: flowId,
			flow_version_id: flowVersionId,
			owner_id: ownerId,
			status: "queued",
			concurrency,
			trigger: trigger ?? null,
			created_at: nowIso,
		},
	});
}

export async function getExecutionForOwner(
	db: PrismaClient,
	executionId: string,
	ownerId: string,
): Promise<ExecutionRow | null> {
	void db;
	return getPrismaClient().workflow_executions.findFirst({
		where: { id: executionId, owner_id: ownerId },
	});
}

export async function getExecutionById(
	db: PrismaClient,
	executionId: string,
): Promise<ExecutionRow | null> {
	void db;
	return getPrismaClient().workflow_executions.findUnique({
		where: { id: executionId },
	});
}

export async function listExecutionsForOwnerFlow(
	db: PrismaClient,
	params: { ownerId: string; flowId: string; limit?: number },
): Promise<ExecutionRow[]> {
	void db;
	const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 30)));
	return getPrismaClient().workflow_executions.findMany({
		where: {
			owner_id: params.ownerId,
			flow_id: params.flowId,
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function listNodeRunsForExecutionOwner(
	db: PrismaClient,
	params: { ownerId: string; executionId: string },
): Promise<NodeRunRow[]> {
	void db;
	return getPrismaClient().workflow_node_runs.findMany({
		where: {
			execution_id: params.executionId,
			workflow_executions: {
				owner_id: params.ownerId,
			},
		},
		orderBy: { created_at: "asc" },
	});
}

export async function updateExecutionStatus(
	db: PrismaClient,
	params: {
		executionId: string;
		status: string;
		errorMessage?: string | null;
		startedAt?: string | null;
		finishedAt?: string | null;
	},
): Promise<void> {
	void db;
	const data: {
		status: string;
		error_message?: string;
		started_at?: string;
		finished_at?: string;
	} = { status: params.status };
	if (params.errorMessage != null) data.error_message = params.errorMessage;
	if (params.startedAt != null) data.started_at = params.startedAt;
	if (params.finishedAt != null) data.finished_at = params.finishedAt;

	await getPrismaClient().workflow_executions.update({
		where: { id: params.executionId },
		data,
	});
}

export async function ensureNodeRuns(
	db: PrismaClient,
	params: { executionId: string; nodeIds: string[]; nowIso: string },
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	if (params.nodeIds.length === 0) return;
	const existing = await prisma.workflow_node_runs.findMany({
		where: {
			execution_id: params.executionId,
			node_id: { in: params.nodeIds },
		},
		select: { node_id: true },
	});
	const existingSet = new Set(existing.map((row) => row.node_id));
	const createData = params.nodeIds
		.filter((nodeId) => !existingSet.has(nodeId))
		.map((nodeId) => ({
			id: crypto.randomUUID(),
			execution_id: params.executionId,
			node_id: nodeId,
			status: "queued",
			attempt: 1,
			created_at: params.nowIso,
		}));
	if (createData.length > 0) {
		await prisma.workflow_node_runs.createMany({ data: createData });
	}
}

export async function updateNodeRun(
	db: PrismaClient,
	params: {
		executionId: string;
		nodeId: string;
		status: string;
		errorMessage?: string | null;
		outputRefs?: unknown;
		startedAt?: string | null;
		finishedAt?: string | null;
	},
): Promise<void> {
	void db;
	const data: {
		status: string;
		error_message?: string;
		output_refs?: string;
		started_at?: string;
		finished_at?: string;
	} = { status: params.status };

	if (params.errorMessage != null) {
		data.error_message = params.errorMessage;
	}
	if (params.outputRefs != null) {
		try {
			data.output_refs = JSON.stringify(params.outputRefs);
		} catch {
			data.output_refs = String(params.outputRefs);
		}
	}
	if (params.startedAt != null) {
		data.started_at = params.startedAt;
	}
	if (params.finishedAt != null) {
		data.finished_at = params.finishedAt;
	}

	await getPrismaClient().workflow_node_runs.update({
		where: {
			execution_id_node_id: {
				execution_id: params.executionId,
				node_id: params.nodeId,
			},
		},
		data,
	});
}

export async function insertExecutionEvent(
	db: PrismaClient,
	params: {
		id: string;
		executionId: string;
		seq: number;
		eventType: string;
		level?: string;
		nodeId?: string | null;
		message?: string | null;
		data?: unknown;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const payload =
		params.data != null
			? (() => {
					try {
						return JSON.stringify(params.data);
					} catch {
						return String(params.data);
					}
				})()
			: null;
	await getPrismaClient().workflow_execution_events.create({
		data: {
			id: params.id,
			execution_id: params.executionId,
			seq: params.seq,
			event_type: params.eventType,
			level: params.level || "info",
			node_id: params.nodeId ?? null,
			message: params.message ?? null,
			data: payload,
			created_at: params.nowIso,
		},
	});
}

export async function listExecutionEvents(
	db: PrismaClient,
	params: { executionId: string; afterSeq: number; limit: number },
): Promise<ExecutionEventRow[]> {
	void db;
	const limit = Math.max(1, Math.min(200, Math.floor(params.limit || 50)));
	return getPrismaClient().workflow_execution_events.findMany({
		where: {
			execution_id: params.executionId,
			seq: { gt: params.afterSeq },
		},
		orderBy: { seq: "asc" },
		take: limit,
	});
}
