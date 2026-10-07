import { z } from "zod";
import type { AgentsBridgeStreamEvent } from "../task/task.agents-bridge";

const AgentActivityEventTypeSchema = z.enum([
	"content",
	"block",
	"suggestions",
	"tool",
	"skill",
	"todo_list",
	"result",
	"agent_role",
	"status-update",
	"artifact-update",
	"error",
	"done",
	"thread.started",
	"turn.started",
	"item.started",
	"item.updated",
	"item.completed",
	"turn.completed",
]);

const AgentActivityNameSchema = z.string().trim().min(1).max(120);
const AgentActivityIdentitySchema = z.string().trim().min(1).max(1_024);
const AgentActivityPhaseSchema = z.string().trim().min(1).max(120);
const AgentActivityStatusSchema = z.string().trim().min(1).max(120);

const WorkflowAgentActivitySnapshotSchema = z.object({
	lastActivityAt: z.string().datetime({ offset: true }),
	eventType: AgentActivityEventTypeSchema,
	phase: AgentActivityPhaseSchema.optional(),
	displayName: AgentActivityNameSchema.optional(),
	runtimeNodeId: AgentActivityIdentitySchema.optional(),
	itemId: AgentActivityIdentitySchema.optional(),
	itemIndex: z.number().int().nonnegative().optional(),
	tool: z.object({
		name: AgentActivityNameSchema.optional(),
		phase: AgentActivityPhaseSchema.optional(),
		status: AgentActivityStatusSchema.optional(),
	}).strict().optional(),
	skill: z.object({
		name: AgentActivityNameSchema.optional(),
		phase: AgentActivityPhaseSchema.optional(),
		status: AgentActivityStatusSchema.optional(),
	}).strict().optional(),
	role: z.object({
		name: AgentActivityNameSchema.optional(),
		status: AgentActivityStatusSchema.optional(),
	}).strict().optional(),
	todoCounts: z.object({
		total: z.number().int().nonnegative().optional(),
		completed: z.number().int().nonnegative().optional(),
		inProgress: z.number().int().nonnegative().optional(),
	}).strict().optional(),
	streamedOutputChars: z.number().int().nonnegative(),
	observedEventCount: z.number().int().nonnegative(),
}).strict();

export const WorkflowNodeAgentProgressSchema = WorkflowAgentActivitySnapshotSchema.extend({
	version: z.literal(1),
	attempt: z.number().int().positive(),
}).strict();

export type WorkflowAgentActivitySnapshot = z.infer<typeof WorkflowAgentActivitySnapshotSchema>;
export type WorkflowNodeAgentProgress = z.infer<typeof WorkflowNodeAgentProgressSchema>;

type AgentActivityCounter = {
	streamedOutputChars: number;
	observedEventCount: number;
};

function safeString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().slice(0, 120);
	return normalized || undefined;
}

function safeIdentity(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized || undefined;
}

function safeCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;
}

/**
 * Projects a named bridge event to bounded display metadata. Event payload text,
 * prompts, tool arguments/results, error messages, and model reasoning are never
 * retained. SSE comment heartbeats never reach this function.
 */
export function projectWorkflowAgentActivityEvent(input: Readonly<{
	event: AgentsBridgeStreamEvent;
	counter: AgentActivityCounter;
	nowIso: string;
	context?: Readonly<Pick<WorkflowAgentActivitySnapshot,
		"displayName" | "runtimeNodeId" | "itemId" | "itemIndex">>;
}>): WorkflowAgentActivitySnapshot {
	input.counter.observedEventCount = Math.min(Number.MAX_SAFE_INTEGER, input.counter.observedEventCount + 1);
	if (input.event.event === "content" && typeof input.event.data.delta === "string") {
		input.counter.streamedOutputChars = Math.min(
			Number.MAX_SAFE_INTEGER,
			input.counter.streamedOutputChars + input.event.data.delta.length,
		);
	}
	const data = input.event.data as Record<string, unknown>;
	const phase = input.event.event === "status-update" ? safeString(data.phase) : undefined;
	const toolActivity = input.event.event === "tool"
		? {
			...(safeString(data.toolName) ? { name: safeString(data.toolName) } : {}),
			...(safeString(data.phase) ? { phase: safeString(data.phase) } : {}),
			...(safeString(data.status) ? { status: safeString(data.status) } : {}),
		}
		: undefined;
	const skillActivity = input.event.event === "skill"
		? {
			...(safeString(data.name) ? { name: safeString(data.name) } : {}),
			...(safeString(data.phase) ? { phase: safeString(data.phase) } : {}),
			...(safeString(data.status) ? { status: safeString(data.status) } : {}),
		}
		: undefined;
	const roleActivity = input.event.event === "agent_role"
		? {
			...(safeString(data.roleName) ? { name: safeString(data.roleName) } : {}),
			...(safeString(data.status) ? { status: safeString(data.status) } : {}),
		}
		: undefined;
	const todoCounts = input.event.event === "todo_list"
		? {
			...(safeCount(data.totalCount) !== undefined ? { total: safeCount(data.totalCount) } : {}),
			...(safeCount(data.completedCount) !== undefined ? { completed: safeCount(data.completedCount) } : {}),
			...(safeCount(data.inProgressCount) !== undefined ? { inProgress: safeCount(data.inProgressCount) } : {}),
		}
		: undefined;
	const projected = {
		lastActivityAt: input.nowIso,
		eventType: input.event.event,
		...(phase ? { phase } : {}),
	...(input.context?.displayName ? { displayName: safeString(input.context.displayName) } : {}),
	...(input.context?.runtimeNodeId ? { runtimeNodeId: safeIdentity(input.context.runtimeNodeId) } : {}),
	...(input.context?.itemId ? { itemId: safeIdentity(input.context.itemId) } : {}),
		...(input.context?.itemIndex !== undefined ? { itemIndex: input.context.itemIndex } : {}),
		...(toolActivity && Object.keys(toolActivity).length > 0 ? { tool: toolActivity } : {}),
		...(skillActivity && Object.keys(skillActivity).length > 0 ? { skill: skillActivity } : {}),
		...(roleActivity && Object.keys(roleActivity).length > 0 ? { role: roleActivity } : {}),
		...(todoCounts && Object.keys(todoCounts).length > 0 ? { todoCounts } : {}),
		streamedOutputChars: input.counter.streamedOutputChars,
		observedEventCount: input.counter.observedEventCount,
	};
	return WorkflowAgentActivitySnapshotSchema.parse(projected);
}

export function parseWorkflowNodeAgentProgress(value: unknown): WorkflowNodeAgentProgress | null {
	const parsed = WorkflowNodeAgentProgressSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Coalesces stream events into bounded activity writes and flushes the tail. */
export function createWorkflowAgentActivityReporter(input: Readonly<{
	write: (snapshot: WorkflowAgentActivitySnapshot) => void | Promise<void>;
	onWriteError: (error: unknown, snapshot: WorkflowAgentActivitySnapshot) => void;
	onProjectionError: (error: unknown, event: AgentsBridgeStreamEvent) => void;
	context?: Readonly<Pick<WorkflowAgentActivitySnapshot, "displayName" | "runtimeNodeId" | "itemId" | "itemIndex">>;
	intervalMs?: number;
	clock?: () => number;
	toIsoString?: () => string;
}>): Readonly<{
	observe: (event: AgentsBridgeStreamEvent) => void;
	flush: () => Promise<void>;
}> {
	const intervalMs = Math.max(0, Math.floor(input.intervalMs ?? 1_000));
	const clock = input.clock ?? Date.now;
	const toIsoString = input.toIsoString ?? (() => new Date().toISOString());
	const counter: AgentActivityCounter = { streamedOutputChars: 0, observedEventCount: 0 };
	let pending: WorkflowAgentActivitySnapshot | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inFlight: Promise<void> | null = null;
	let lastWriteAt = Number.NEGATIVE_INFINITY;
	let closed = false;

	const drain = async (force: boolean): Promise<void> => {
		if (inFlight) {
			await inFlight;
			if (pending) await drain(force);
			return;
		}
		if (!pending) return;
		const elapsed = clock() - lastWriteAt;
		if (!force && elapsed < intervalMs) {
			if (timer === null) {
				timer = setTimeout(() => {
					timer = null;
					void drain(false);
				}, Math.max(0, intervalMs - elapsed));
			}
			return;
		}
		const snapshot = pending;
		pending = null;
		lastWriteAt = clock();
		inFlight = Promise.resolve()
			.then(() => input.write(snapshot))
			.catch((error: unknown) => {
				try {
					input.onWriteError(error, snapshot);
				} catch {
					// Telemetry callbacks cannot affect the Agent execution they observe.
				}
			})
			.finally(() => { inFlight = null; });
		await inFlight;
		if (pending) await drain(force);
	};

	return {
		observe: (event) => {
			if (closed) return;
			try {
				pending = projectWorkflowAgentActivityEvent({
					event,
					counter,
					nowIso: toIsoString(),
					...(input.context ? { context: input.context } : {}),
				});
			} catch (error: unknown) {
				try {
					input.onProjectionError(error, event);
				} catch {
					// Projection diagnostics cannot affect the Agent execution they observe.
				}
				return;
			}
			if (timer !== null) return;
			const elapsed = clock() - lastWriteAt;
			const delayMs = Math.max(0, intervalMs - elapsed);
			timer = setTimeout(() => {
				timer = null;
				void drain(false);
			}, delayMs);
		},
		flush: async () => {
			closed = true;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			await drain(true);
		},
	};
}
