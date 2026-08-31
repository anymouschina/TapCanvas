import { CronExpressionParser } from "cron-parser";
import {
	parseWorkflowTriggerSpec,
	type ScheduleWorkflowTriggerSpecV1,
	type WorkflowTriggerOccurrenceV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkerEnv } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import { startWorkflowExecution } from "./execution.start-service";

const SCHEDULE_TRIGGER_PREFIX = "workflow.schedule/v1";
const SCHEDULE_ON_TIME_GRACE_MS = 90_000;

type JsonRecord = Record<string, unknown>;

export type WorkflowSchedulePreview = Readonly<{
	valid: true;
	nextRuns: readonly string[];
}>;

export type WorkflowScheduleDiagnostic = Readonly<{
	flowId: string;
	triggerNodeId: string | null;
	code: string;
	message: string;
}>;

export type WorkflowScheduleScanResult = Readonly<{
	flows: number;
	schedules: number;
	due: number;
	created: number;
	deduplicated: number;
	diagnostics: readonly WorkflowScheduleDiagnostic[];
}>;

type ScheduleCandidate = Readonly<{
	flow: FlowRow;
	triggerNodeId: string;
	workflowKey: string;
	workflowDefinitionVersion: number;
	spec: ScheduleWorkflowTriggerSpecV1;
}>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFlowGraph(raw: string): JsonRecord {
	const parsed = JSON.parse(raw) as unknown;
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
		throw new Error("Saved flow must contain nodes and edges arrays");
	}
	return parsed;
}

function readString(record: JsonRecord, key: string): string {
	const value = record[key];
	return typeof value === "string" ? value.trim() : "";
}

function encodedSchedulePrefix(scheduleId: string, triggerNodeId: string): string {
	return `${SCHEDULE_TRIGGER_PREFIX}|${encodeURIComponent(scheduleId)}|${encodeURIComponent(triggerNodeId)}|`;
}

export function serializeScheduleExecutionTrigger(input: Readonly<{
	scheduleId: string;
	triggerNodeId: string;
	scheduledFor: string;
}>): string {
	return `${encodedSchedulePrefix(input.scheduleId, input.triggerNodeId)}${input.scheduledFor}`;
}

export function parseScheduledForFromExecutionTrigger(
	trigger: string | null | undefined,
	scheduleId: string,
	triggerNodeId: string,
): Date | null {
	if (!trigger) return null;
	const prefix = encodedSchedulePrefix(scheduleId, triggerNodeId);
	if (!trigger.startsWith(prefix)) return null;
	const parsed = new Date(trigger.slice(prefix.length));
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function previewWorkflowSchedule(
	spec: ScheduleWorkflowTriggerSpecV1,
	now: Date = new Date(),
	count = 3,
): WorkflowSchedulePreview {
	const boundedCount = Math.max(1, Math.min(10, Math.floor(count)));
	const interval = CronExpressionParser.parse(spec.cron, {
		currentDate: now,
		tz: spec.timezone,
	});
	const nextRuns = Array.from({ length: boundedCount }, () => interval.next().toDate().toISOString());
	return { valid: true, nextRuns };
}

export function resolveDueScheduleOccurrence(input: Readonly<{
	spec: ScheduleWorkflowTriggerSpecV1;
	baseline: Date;
	now: Date;
}>): Date | null {
	const nowMs = input.now.getTime();
	const baselineMs = input.baseline.getTime();
	if (!Number.isFinite(nowMs) || !Number.isFinite(baselineMs)) {
		throw new Error("Schedule baseline and current time must be valid dates");
	}
	const interval = CronExpressionParser.parse(input.spec.cron, {
		currentDate: new Date(nowMs + 1),
		tz: input.spec.timezone,
	});
	const latest = interval.prev().toDate();
	if (latest.getTime() <= baselineMs) return null;
	const delayMs = nowMs - latest.getTime();
	if (delayMs <= SCHEDULE_ON_TIME_GRACE_MS) return latest;
	if (input.spec.misfirePolicy === "skip") return null;
	return input.spec.maxCatchUpRuns > 0 ? latest : null;
}

function scheduleCandidates(flow: FlowRow): Readonly<{
	candidates: readonly ScheduleCandidate[];
	diagnostics: readonly WorkflowScheduleDiagnostic[];
}> {
	const graph = parseFlowGraph(flow.data);
	const candidates: ScheduleCandidate[] = [];
	const diagnostics: WorkflowScheduleDiagnostic[] = [];
	for (const rawNode of graph.nodes as unknown[]) {
		if (!isRecord(rawNode) || rawNode.type !== "taskNode" || !isRecord(rawNode.data)) continue;
		const data = rawNode.data;
		if (data.kind !== "workflowTrigger" || data.adminWorkflow !== true) continue;
		const rawSpec = isRecord(data.workflowTriggerSpec) ? data.workflowTriggerSpec : null;
		if (rawSpec?.kind !== "schedule") continue;
		const triggerNodeId = readString(rawNode, "id");
		const parsed = parseWorkflowTriggerSpec(rawSpec);
		if (!parsed.success || parsed.data.kind !== "schedule") {
			if (rawSpec.enabled === true) {
				diagnostics.push({
					flowId: flow.id,
					triggerNodeId: triggerNodeId || null,
					code: "schedule_contract_invalid",
					message: parsed.success ? "Trigger is not a schedule" : parsed.error.message,
				});
			}
			continue;
		}
		if (!parsed.data.enabled) continue;
		const workflowKey = readString(data, "workflowKey");
		const version = data.workflowDefinitionVersion;
		if (!triggerNodeId || !workflowKey || !Number.isInteger(version) || Number(version) < 1) {
			diagnostics.push({
				flowId: flow.id,
				triggerNodeId: triggerNodeId || null,
				code: "schedule_workflow_identity_invalid",
				message: "Enabled schedule requires trigger node id, workflow key, and positive definition version",
			});
			continue;
		}
		candidates.push({
			flow,
			triggerNodeId,
			workflowKey,
			workflowDefinitionVersion: Number(version),
			spec: parsed.data,
		});
	}
	return { candidates, diagnostics };
}

async function latestScheduleExecution(env: WorkerEnv, candidate: ScheduleCandidate): Promise<Readonly<{
	scheduledFor: Date;
	status: string;
}> | null> {
	const prefix = encodedSchedulePrefix(candidate.spec.scheduleId, candidate.triggerNodeId);
	const latest = await env.DB.workflow_executions.findFirst({
		where: {
			flow_id: candidate.flow.id,
			trigger: { startsWith: prefix },
		},
		select: { trigger: true, status: true },
		orderBy: { created_at: "desc" },
	});
	const scheduledFor = parseScheduledForFromExecutionTrigger(
		latest?.trigger,
		candidate.spec.scheduleId,
		candidate.triggerNodeId,
	);
	return scheduledFor && latest ? { scheduledFor, status: latest.status } : null;
}

function occurrence(candidate: ScheduleCandidate, scheduledFor: Date): WorkflowTriggerOccurrenceV1 {
	const scheduledForIso = scheduledFor.toISOString();
	return {
		version: 1,
		triggerId: candidate.spec.scheduleId,
		workflowKey: candidate.workflowKey,
		workflowDefinitionVersion: candidate.workflowDefinitionVersion,
		scheduledFor: scheduledForIso,
		occurrenceKey: `${candidate.flow.id}:${candidate.triggerNodeId}:${candidate.spec.scheduleId}:${scheduledForIso}`,
	};
}

export async function scanDueWorkflowSchedules(
	env: WorkerEnv,
	now: Date = new Date(),
): Promise<WorkflowScheduleScanResult> {
	const rows = await env.DB.flows.findMany({
		where: { owner_id: { not: null } },
		select: {
			id: true,
			name: true,
			data: true,
			owner_id: true,
			project_id: true,
			created_at: true,
			updated_at: true,
			canvas_revision: true,
		},
	});
	const diagnostics: WorkflowScheduleDiagnostic[] = [];
	const candidates: ScheduleCandidate[] = [];
	for (const flow of rows) {
		try {
			const parsed = scheduleCandidates(flow);
			candidates.push(...parsed.candidates);
			diagnostics.push(...parsed.diagnostics);
		} catch (error: unknown) {
			diagnostics.push({
				flowId: flow.id,
				triggerNodeId: null,
				code: "schedule_flow_invalid",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	let due = 0;
	let created = 0;
	let deduplicated = 0;
	const adminOwners = new Map<string, boolean>();
	for (const candidate of candidates) {
		const ownerId = candidate.flow.owner_id;
		if (!ownerId) continue;
		let ownerIsAdmin = adminOwners.get(ownerId);
		if (ownerIsAdmin === undefined) {
			const owner = await env.DB.users.findUnique({
				where: { id: ownerId },
				select: { role: true, disabled: true, deleted_at: true },
			});
			ownerIsAdmin = owner?.role === "admin" && owner.disabled === 0 && owner.deleted_at === null;
			adminOwners.set(ownerId, ownerIsAdmin);
		}
		if (!ownerIsAdmin) {
			diagnostics.push({
				flowId: candidate.flow.id,
				triggerNodeId: candidate.triggerNodeId,
				code: "schedule_owner_not_admin",
				message: "Enabled administrator schedule owner is not an active administrator",
			});
			continue;
		}
		try {
			const latestExecution = await latestScheduleExecution(env, candidate);
			const flowUpdatedAt = new Date(candidate.flow.updated_at);
			if (Number.isNaN(flowUpdatedAt.getTime())) throw new Error("Flow updated_at is not a valid date");
			const scheduledFor = latestExecution?.status === "queued"
				? latestExecution.scheduledFor
				: resolveDueScheduleOccurrence({
					spec: candidate.spec,
					baseline: latestExecution?.scheduledFor ?? flowUpdatedAt,
					now,
				});
			if (!scheduledFor) continue;
			due += 1;
			const nextOccurrence = occurrence(candidate, scheduledFor);
			const result = await startWorkflowExecution(env, {
				flow: candidate.flow,
				ownerId,
				triggerNodeId: candidate.triggerNodeId,
				trigger: serializeScheduleExecutionTrigger({
					scheduleId: candidate.spec.scheduleId,
					triggerNodeId: candidate.triggerNodeId,
					scheduledFor: nextOccurrence.scheduledFor,
				}),
				idempotencyKey: nextOccurrence.occurrenceKey,
				now,
			});
			if (result.created) created += 1;
			else deduplicated += 1;
		} catch (error: unknown) {
			diagnostics.push({
				flowId: candidate.flow.id,
				triggerNodeId: candidate.triggerNodeId,
				code: "schedule_activation_failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return {
		flows: rows.length,
		schedules: candidates.length,
		due,
		created,
		deduplicated,
		diagnostics,
	};
}

export function startLocalWorkflowScheduleScanner(env: WorkerEnv): () => void {
	let running = false;
	const scan = async (): Promise<void> => {
		if (running) return;
		running = true;
		try {
			const result = await scanDueWorkflowSchedules(env);
			if (result.created > 0 || result.deduplicated > 0) {
				console.info("[workflow-schedule] scan completed", result);
			}
			for (const diagnostic of result.diagnostics) {
				console.error("[workflow-schedule] schedule diagnostic", diagnostic);
			}
		} catch (error: unknown) {
			console.error("[workflow-schedule] scanner failed", error);
		} finally {
			running = false;
		}
	};
	const initial = setTimeout(() => void scan(), 5_000);
	initial.unref?.();
	const timer = setInterval(() => void scan(), 30_000);
	timer.unref?.();
	return () => {
		clearTimeout(initial);
		clearInterval(timer);
	};
}
