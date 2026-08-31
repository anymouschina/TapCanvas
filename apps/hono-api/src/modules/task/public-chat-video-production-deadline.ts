import type { PrismaClient } from "../../types";
import { parseWorkflowNodeOutputV1 } from "../execution/execution.node-runtime";
import {
	appendExecutionTraceEvent,
	getExecutionTraceLifecycleSnapshot,
} from "../memory/execution-trace-events.repo";
import type { DurableTaskReferenceV1 } from "./task.agents-bridge";
import { verifyUserIntentContract } from "./video-orchestrator.user-intent-contract";

export const PUBLIC_CHAT_VIDEO_PRODUCTION_START_DEADLINE_MS = 5 * 60_000;
export const VIDEO_PRODUCTION_START_DEADLINE_EXCEEDED = "video_production_start_deadline_exceeded";

export type PublicChatVideoProductionStartEvidence = Readonly<{
	method: "direct_video_task" | "workflow_video_node";
	taskId: string;
	providerAcceptedAt: string;
	workflowExecutionId: string | null;
	workflowNodeId: string | null;
}>;

export type PublicChatVideoProductionStartStatus = Readonly<{
	version: 6;
	status: "waiting" | "started" | "failed";
	anchor: "request_accepted" | "workflow_execution_created";
	acceptedAt: string;
	deadlineAt: string;
	evaluatedAt: string;
	providerAcceptedAt: string | null;
	lastSuccessfulActionAt: string;
	lastSuccessfulAction: "request_accepted" | "workflow_accepted" | "provider_task_accepted";
	evidence: PublicChatVideoProductionStartEvidence | null;
	diagnostic: Readonly<{
		code: typeof VIDEO_PRODUCTION_START_DEADLINE_EXCEEDED;
		observedAt: string;
		elapsedMs: number;
		blocking: true;
	}> | null;
}>;

type Candidate = Readonly<{
	method: PublicChatVideoProductionStartEvidence["method"];
	taskId: string;
	workflowExecutionId: string | null;
	workflowNodeId: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isVideoAsyncDeliveryContract(value: unknown): boolean {
	const verification = verifyUserIntentContract(value);
	if (!verification.ok) return false;
	const delivery = verification.value.contract.delivery;
	return isRecord(delivery)
		&& delivery.mode === "async_artifact"
		&& delivery.mediaType === "video";
}

function parseInvocationPublicTurnId(inputJson: string | null): string {
	if (!inputJson) return "";
	try {
		const parsed: unknown = JSON.parse(inputJson);
		return isRecord(parsed) ? readString(parsed.publicTurnId) : "";
	} catch {
		return "";
	}
}

function collectWorkflowTaskCandidates(input: Readonly<{
	outputRefs: string | null;
	executionId: string;
	nodeId: string;
}>): Candidate[] {
	let output: ReturnType<typeof parseWorkflowNodeOutputV1>;
	try {
		output = parseWorkflowNodeOutputV1(input.outputRefs);
	} catch {
		return [];
	}
	if (!output || output.executorRef !== "tapcanvas.video.generate/v1") return [];
	const taskIds = new Set<string>();
	const topLevelTaskId = readString(output.evidence.taskId);
	if (topLevelTaskId) taskIds.add(topLevelTaskId);
	for (const item of output.itemRuns ?? []) {
		const taskId = readString(item.evidence.taskId);
		if (taskId) taskIds.add(taskId);
	}
	return [...taskIds].map((taskId) => ({
		method: "workflow_video_node",
		taskId,
		workflowExecutionId: input.executionId,
		workflowNodeId: input.nodeId,
	}));
}

export async function inspectPublicChatVideoProductionStart(input: Readonly<{
	db: PrismaClient;
	userId: string;
	sessionKey: string;
	publicTurnId: string;
	rootTraceId: string;
	userIntentContract: unknown;
	durableTaskReferences?: readonly DurableTaskReferenceV1[];
	now?: Date;
}>): Promise<PublicChatVideoProductionStartStatus | null> {
	if (!isVideoAsyncDeliveryContract(input.userIntentContract)) return null;
	const lifecycle = await getExecutionTraceLifecycleSnapshot(input.db, {
		traceId: input.rootTraceId,
		userId: input.userId,
	});
	if (!lifecycle) return null;
	const now = input.now ?? new Date();
	const nowMs = now.getTime();

	const candidates = new Map<string, Candidate>();
	for (const reference of input.durableTaskReferences ?? []) {
		const taskId = readString(reference.taskId);
		if (!taskId || reference.acceptedAsync !== true) continue;
		candidates.set(taskId, {
			method: "direct_video_task",
			taskId,
			workflowExecutionId: null,
			workflowNodeId: null,
		});
	}

	const invocations = await input.db.agent_capability_invocations.findMany({
		where: { user_id: input.userId, session_id: input.sessionKey },
		orderBy: { created_at: "asc" },
		take: 100,
		include: { workflow_executions: true },
	});
	const ownedInvocations = invocations.filter((row) => parseInvocationPublicTurnId(row.input_json) === input.publicTurnId);
	const workflowExecutionCreatedAt = ownedInvocations
		.flatMap((row) => {
			const execution = isRecord(row.workflow_executions) ? row.workflow_executions : null;
			const createdAt = readString(execution?.created_at);
			return createdAt && Number.isFinite(Date.parse(createdAt)) ? [createdAt] : [];
		})
		.sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
	const acceptedAt = workflowExecutionCreatedAt ?? lifecycle.startedAt;
	const acceptedAtMs = Date.parse(acceptedAt);
	if (!Number.isFinite(acceptedAtMs)) throw new Error(`video_production_deadline_invalid_trace_time:${input.rootTraceId}`);
	const deadlineAtMs = acceptedAtMs + PUBLIC_CHAT_VIDEO_PRODUCTION_START_DEADLINE_MS;
	const familyIds = [...new Set(ownedInvocations.map((row) => row.workflow_executions.execution_family_id.trim()).filter(Boolean))];
	if (familyIds.length > 0) {
		const nodeRuns = await input.db.workflow_node_runs.findMany({
			where: { workflow_executions: { execution_family_id: { in: familyIds } } },
			select: { execution_id: true, node_id: true, output_refs: true },
		});
		for (const nodeRun of nodeRuns) {
			for (const candidate of collectWorkflowTaskCandidates({
				outputRefs: nodeRun.output_refs,
				executionId: nodeRun.execution_id,
				nodeId: nodeRun.node_id,
			})) candidates.set(candidate.taskId, candidate);
		}
	}

	const taskIds = [...candidates.keys()];
	const taskRows = taskIds.length === 0 ? [] : await input.db.task_results.findMany({
		where: { user_id: input.userId, task_id: { in: taskIds }, kind: "video" },
		select: { task_id: true, created_at: true },
	});
	const acceptedEvidence = taskRows
		.map((row): PublicChatVideoProductionStartEvidence | null => {
			const candidate = candidates.get(row.task_id);
			if (!candidate || !Number.isFinite(Date.parse(row.created_at))) return null;
			return { ...candidate, providerAcceptedAt: row.created_at };
		})
		.filter((value): value is PublicChatVideoProductionStartEvidence => value !== null)
		.sort((left, right) => Date.parse(left.providerAcceptedAt) - Date.parse(right.providerAcceptedAt))[0] ?? null;
	const providerAcceptedAtMs = acceptedEvidence ? Date.parse(acceptedEvidence.providerAcceptedAt) : null;
	const startedBeforeDeadline = providerAcceptedAtMs !== null && providerAcceptedAtMs <= deadlineAtMs;
	const exceeded = !startedBeforeDeadline && nowMs >= deadlineAtMs;
	const latestWorkflowAcceptedAt = ownedInvocations
		.flatMap((row) => {
			const execution = isRecord(row.workflow_executions) ? row.workflow_executions : null;
			const createdAt = readString(execution?.created_at);
			return createdAt ? [createdAt] : [];
		})
		.filter((value) => Number.isFinite(Date.parse(value)))
		.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
	const lastSuccessfulAction = acceptedEvidence
		? "provider_task_accepted"
		: latestWorkflowAcceptedAt ? "workflow_accepted" : "request_accepted";
	const lastSuccessfulActionAt = acceptedEvidence
		? acceptedEvidence.providerAcceptedAt
		: latestWorkflowAcceptedAt ?? lifecycle.startedAt;
	return {
		version: 6,
		status: startedBeforeDeadline ? "started" : exceeded ? "failed" : "waiting",
		anchor: workflowExecutionCreatedAt ? "workflow_execution_created" : "request_accepted",
		acceptedAt,
		deadlineAt: new Date(deadlineAtMs).toISOString(),
		evaluatedAt: now.toISOString(),
		providerAcceptedAt: acceptedEvidence?.providerAcceptedAt ?? null,
		lastSuccessfulActionAt,
		lastSuccessfulAction,
		evidence: acceptedEvidence,
		diagnostic: exceeded ? {
			code: VIDEO_PRODUCTION_START_DEADLINE_EXCEEDED,
			observedAt: now.toISOString(),
			elapsedMs: Math.max(0, nowMs - acceptedAtMs),
			blocking: true,
		} : null,
	};
}

export async function recordPublicChatVideoProductionStartDeadlineObservation(input: Readonly<{
	db: PrismaClient;
	userId: string;
	publicTurnId: string;
	rootTraceId: string;
	production: PublicChatVideoProductionStartStatus;
	scheduledDeadlineAt?: string;
}>): Promise<void> {
	if (input.production.status !== "failed") return;
	await appendExecutionTraceEvent(input.db, {
		traceId: input.rootTraceId,
		userId: input.userId,
		producerEventId: `video-production-start-deadline:${input.production.deadlineAt}`,
		eventType: "video.production_start.deadline_exceeded",
		eventClass: "system",
		eventKey: "video.production_start.deadline",
		phase: "termination",
		status: "failed",
		logicalTaskId: input.publicTurnId,
		rootTraceId: input.rootTraceId,
		providerTaskId: input.production.evidence?.taskId ?? null,
		payload: {
			code: VIDEO_PRODUCTION_START_DEADLINE_EXCEEDED,
			blocking: true,
			videoProductionStart: input.production,
			scheduledDeadlineAt: input.scheduledDeadlineAt ?? input.production.deadlineAt,
			observedAt: input.production.evaluatedAt,
		},
	});
}
