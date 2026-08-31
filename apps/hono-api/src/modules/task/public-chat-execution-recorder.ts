import { randomUUID } from "node:crypto";
import type { AgentsChatRequestDto, AgentsChatResponseDto } from "../apiKey/apiKey.schemas";
import type { AppContext } from "../../types";
import type { TaskResultDto } from "./task.schemas";
import {
	appendExecutionTraceEvents,
	beginExecutionTraceRun,
	finalizeExecutionTraceRun,
	type AppendExecutionTraceEventInput,
	type ExecutionTraceEvent,
	type ExecutionTraceEventCorrelation,
	type ExecutionTraceRunStatus,
} from "../memory/execution-trace-events.repo";

type BridgeEvent = {
	event: string;
	data: unknown;
};

export type PublicChatExecutionRecorder = {
	recordBridgeEvent: (event: BridgeEvent) => Promise<void>;
	/**
	 * Persists one browser-visible projection and returns the database-assigned
	 * sequence. Callers must await this before exposing the corresponding SSE id.
	 */
	recordDurableBridgeEvent: (event: BridgeEvent) => Promise<ExecutionTraceEvent>;
	finishSucceeded: (response: AgentsChatResponseDto, result: TaskResultDto) => Promise<void>;
	finishFailed: (error: unknown, cancelled?: boolean) => Promise<void>;
	getHealth: () => {
		status: "persisted" | "degraded";
		failedEventCount: number;
		lastError: string | null;
		pendingEventCount: number;
		persistedEventCount: number;
		batchWriteCount: number;
		lastFlushAt: string | null;
	};
};

const EVENT_BATCH_SIZE = 48;
const EVENT_FLUSH_INTERVAL_MS = 300;
const FLUSH_BARRIER_EVENTS = new Set([
	"request.accepted",
	"tool",
	"skill",
	"agent_role",
	"todo_list",
	"result",
	"error",
	"done",
	"thread.started",
	"turn.started",
	"turn.completed",
	"item.started",
	"item.completed",
	"execution.cancelled",
	"execution.failed",
	"response.completed",
]);

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readString(record: Record<string, unknown> | null, key: string): string {
	const value = record?.[key];
	return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(record: Record<string, unknown> | null, key: string): number | null {
	const value = record?.[key];
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function resolveEventClass(eventType: string): string {
	if (eventType === "content" || eventType === "block" || eventType === "suggestions") return "content";
	if (eventType === "tool" || eventType.startsWith("item.")) return "tool";
	if (eventType === "skill") return "skill";
	if (eventType === "agent_role") return "agent";
	if (eventType === "todo_list") return "planning";
	if (eventType === "result" || eventType === "response.completed") return "result";
	if (
		eventType === "request.accepted" ||
		eventType === "done" ||
		eventType === "error" ||
		eventType.startsWith("thread.") ||
		eventType.startsWith("turn.") ||
		eventType.startsWith("execution.")
	) return "lifecycle";
	return "diagnostic";
}

function resolveCorrelation(
	data: Record<string, unknown> | null,
	base: Required<Pick<ExecutionTraceEventCorrelation, "logicalTaskId" | "rootTraceId">> &
		Pick<ExecutionTraceEventCorrelation, "parentTraceId">,
): ExecutionTraceEventCorrelation {
	return {
		logicalTaskId: readString(data, "logicalTaskId") || base.logicalTaskId,
		rootTraceId: readString(data, "rootTraceId") || base.rootTraceId,
		parentTraceId: readString(data, "parentTraceId") || base.parentTraceId || null,
		physicalRunId: readString(data, "physicalRunId") || null,
		workflowRunId: readString(data, "workflowRunId") || readString(data, "runId") || null,
		workflowNodeId: readString(data, "workflowNodeId") || null,
		agentId: readString(data, "agentId") || null,
		parentAgentId: readString(data, "parentAgentId") || null,
		toolCallId: readString(data, "toolCallId") || null,
		effectId: readString(data, "effectId") || null,
		providerTaskId: readString(data, "providerTaskId") || null,
		spanId: readString(data, "spanId") || null,
		parentSpanId: readString(data, "parentSpanId") || null,
		attempt: readPositiveInteger(data, "attempt"),
	};
}

function resolveScope(input: AgentsChatRequestDto, traceId: string): { scopeType: string; scopeId: string } {
	const chapterId = typeof input.chapterId === "string" ? input.chapterId.trim() : "";
	if (chapterId) return { scopeType: "chapter", scopeId: chapterId };
	const bookId = typeof input.bookId === "string" ? input.bookId.trim() : "";
	if (bookId) return { scopeType: "book", scopeId: bookId };
	const projectId = typeof input.canvasProjectId === "string" ? input.canvasProjectId.trim() : "";
	if (projectId) return { scopeType: "project", scopeId: projectId };
	const sessionKey = typeof input.sessionKey === "string" ? input.sessionKey.trim() : "";
	if (sessionKey) return { scopeType: "session", scopeId: sessionKey };
	return { scopeType: "task", scopeId: traceId };
}

function resolveEventIdentity(event: BridgeEvent): {
	eventKey: string;
	phase: string | null;
	status: string | null;
} {
	const data = readRecord(event.data);
	const eventKey =
		readString(data, "toolCallId") ||
		readString(data, "itemId") ||
		readString(data, "agentId") ||
		readString(data, "id") ||
		readString(data, "toolName") ||
		event.event;
	return {
		eventKey,
		phase: readString(data, "phase") || null,
		status: readString(data, "status") || readString(data, "state") || null,
	};
}

function errorRecord(error: unknown): { message: string; code: string | null } {
	const record = readRecord(error);
	return {
		message: error instanceof Error ? error.message : String(error),
		code: readString(record, "code") || null,
	};
}

function terminalRunStatus(response: AgentsChatResponseDto, result: TaskResultDto): Exclude<ExecutionTraceRunStatus, "running"> {
	const logicalTaskState = readRecord(response.trace?.logicalTaskState);
	const logicalStatus = readString(logicalTaskState, "status");
	if (logicalStatus === "active" || logicalStatus === "waiting_input" || logicalStatus === "waiting_external") {
		return "waiting_async";
	}
	if (logicalStatus === "failed" || logicalStatus === "cancelled" || result.status === "failed") return "failed";
	return "succeeded";
}

function resultMeta(response: AgentsChatResponseDto, result: TaskResultDto, health: ReturnType<PublicChatExecutionRecorder["getHealth"]>): Record<string, unknown> {
	const raw = readRecord(result.raw);
	const runtimeMeta = readRecord(raw?.meta);
	return {
		...(runtimeMeta ?? {}),
		responseTrace: response.trace ?? null,
		executionEventPersistence: health,
	};
}

function resultToolCalls(result: TaskResultDto): Array<Record<string, unknown>> {
	const raw = readRecord(result.raw);
	const meta = readRecord(raw?.meta);
	const candidates = Array.isArray(meta?.toolCalls)
		? meta.toolCalls
		: Array.isArray(raw?.toolCalls)
			? raw.toolCalls
			: [];
	return candidates
		.map(readRecord)
		.filter((item): item is Record<string, unknown> => Boolean(item))
		.slice(0, 500);
}

export async function startPublicChatExecutionRecorder(input: {
	c: AppContext;
	userId: string;
	traceId: string;
	request: AgentsChatRequestDto;
	/** Server-authored facts required to recreate an identical trusted execution. */
	recoveryContext?: Record<string, unknown>;
	executionKind?: "root" | "continuation";
	parentTraceId?: string | null;
	rootTraceId?: string | null;
	logicalTaskId?: string | null;
	physicalRunId?: string | null;
}): Promise<PublicChatExecutionRecorder> {
	const scope = resolveScope(input.request, input.traceId);
	const sessionKey = typeof input.request.sessionKey === "string" && input.request.sessionKey.trim()
		? input.request.sessionKey.trim()
		: null;
	const workflowKey = "public_agents_chat";
	const prompt = typeof input.request.prompt === "string" ? input.request.prompt : "";
	const rootTraceId = input.rootTraceId?.trim() || input.traceId;
	const logicalTaskId = input.logicalTaskId?.trim() || rootTraceId;
	await beginExecutionTraceRun(input.c.env.DB, {
		traceId: input.traceId,
		userId: input.userId,
		...scope,
		requestKind: "agents_bridge:public_chat",
		inputSummary: `promptChars=${prompt.length}; inputMode=${Array.isArray(input.request.input) ? "responses" : "text"}`,
		sessionKey,
		workflowKey,
		logicalTaskId,
		rootTraceId,
		parentTraceId: input.parentTraceId ?? null,
		meta: {
			requestId: input.traceId,
			workflowKey,
			executionKind: input.executionKind ?? "root",
			parentTraceId: input.parentTraceId ?? null,
		},
	});

	let failedEventCount = 0;
	let lastError: string | null = null;
	let persistedEventCount = 0;
	let batchWriteCount = 0;
	let lastFlushAt: string | null = null;
	let producerSequence = 0;
	let pendingEvents: AppendExecutionTraceEventInput[] = [];
	const durableProducerEventIds = new Set<string>();
	const persistedDurableEvents = new Map<string, ExecutionTraceEvent>();
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	let flushTail: Promise<void> = Promise.resolve();
	let closed = false;
	const ingestionSessionId = randomUUID();
	const capturedToolCalls: Array<Record<string, unknown>> = [];
	const recordPersistenceFailure = (error: unknown): void => {
		failedEventCount += 1;
		lastError = error instanceof Error ? error.message : String(error);
	};
	const attachHealthToResult = (result: TaskResultDto): void => {
		const raw = readRecord(result.raw);
		const meta = readRecord(raw?.meta);
		if (meta) Object.assign(meta, { executionEventPersistence: health() });
	};
	const health = () => ({
		status: failedEventCount > 0 ? "degraded" as const : "persisted" as const,
		failedEventCount,
		lastError,
		pendingEventCount: pendingEvents.length,
		persistedEventCount,
		batchWriteCount,
		lastFlushAt,
	});
	const clearFlushTimer = (): void => {
		if (flushTimer === null) return;
		clearTimeout(flushTimer);
		flushTimer = null;
	};
	const scheduleFlush = (): void => {
		if (closed || flushTimer !== null) return;
		flushTimer = setTimeout(() => {
			flushTimer = null;
			void flushOneBatch();
		}, EVENT_FLUSH_INTERVAL_MS);
	};
	const flushOneBatch = async (): Promise<void> => {
		clearFlushTimer();
		const operation = flushTail.then(async () => {
			if (pendingEvents.length === 0) return;
			const batch = pendingEvents.slice(0, EVENT_BATCH_SIZE);
			try {
				const persisted = await appendExecutionTraceEvents(input.c.env.DB, {
					traceId: input.traceId,
					userId: input.userId,
					events: batch,
				});
				pendingEvents = pendingEvents.slice(batch.length);
				persistedEventCount += persisted.length;
				for (const event of persisted) {
					if (durableProducerEventIds.has(event.producerEventId)) {
						persistedDurableEvents.set(event.producerEventId, event);
					}
				}
				batchWriteCount += 1;
				lastFlushAt = new Date().toISOString();
			} catch (error: unknown) {
				recordPersistenceFailure(error);
				console.error("[public-agents-chat] execution event batch persistence degraded", {
					traceId: input.traceId,
					batchSize: batch.length,
					pendingEventCount: pendingEvents.length,
					error: lastError,
				});
			}
		});
		flushTail = operation.catch(() => undefined);
		await operation;
		if (!closed && pendingEvents.length > 0) scheduleFlush();
	};
	const flushAll = async (): Promise<void> => {
		clearFlushTimer();
		let previousPendingCount = -1;
		while (pendingEvents.length > 0 && pendingEvents.length !== previousPendingCount) {
			previousPendingCount = pendingEvents.length;
			await flushOneBatch();
		}
		await flushTail;
	};
	const enqueue = async (
		event: BridgeEvent,
		requireDurableSequence = false,
	): Promise<ExecutionTraceEvent | null> => {
		if (closed) throw new Error(`execution_trace_recorder_closed:${input.traceId}`);
		const identity = resolveEventIdentity(event);
		const eventData = readRecord(event.data);
		if (event.event === "tool" && eventData && capturedToolCalls.length < 500) {
			capturedToolCalls.push(eventData);
		}
		producerSequence += 1;
		const producerEventId = `${ingestionSessionId}:${producerSequence}`;
		pendingEvents.push({
			producerEventId,
			eventType: event.event,
			eventClass: resolveEventClass(event.event),
			eventKey: identity.eventKey,
			phase: identity.phase,
			status: identity.status,
			payload: eventData ?? { value: event.data },
			...resolveCorrelation(eventData, {
				logicalTaskId,
				rootTraceId,
				parentTraceId: input.parentTraceId ?? null,
			}),
		});
		if (requireDurableSequence) durableProducerEventIds.add(producerEventId);
		if (FLUSH_BARRIER_EVENTS.has(event.event) || pendingEvents.length >= EVENT_BATCH_SIZE) {
			await flushOneBatch();
		} else {
			scheduleFlush();
		}
		if (requireDurableSequence) await flushAll();
		if (!requireDurableSequence) return null;
		const persisted = persistedDurableEvents.get(producerEventId) ?? null;
		durableProducerEventIds.delete(producerEventId);
		persistedDurableEvents.delete(producerEventId);
		if (!persisted) {
			throw new Error(`execution_trace_durable_event_not_persisted:${input.traceId}:${producerEventId}`);
		}
		return persisted;
	};

	await enqueue({
		event: "request.accepted",
		data: {
			requestId: input.traceId,
			executionKind: input.executionKind ?? "root",
			parentTraceId: input.parentTraceId ?? null,
			physicalRunId: input.physicalRunId ?? null,
			request: input.request,
			...(input.recoveryContext ? { recoveryContext: input.recoveryContext } : {}),
		},
	});
	await flushAll();
	if (failedEventCount > 0) {
		closed = true;
		clearFlushTimer();
		try {
			await finalizeExecutionTraceRun(input.c.env.DB, {
				traceId: input.traceId,
				userId: input.userId,
				status: "failed",
				errorCode: "execution_trace_initial_event_write_failed",
				errorDetail: lastError,
				meta: { executionEventPersistence: health() },
			});
		} catch (finalizeError: unknown) {
			console.error("[public-agents-chat] initial execution trace failure could not be finalized", {
				traceId: input.traceId,
				error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
			});
		}
		throw new Error(`execution_trace_initial_event_write_failed:${lastError ?? "unknown"}`);
	}

	return {
		recordBridgeEvent: async (event) => {
			await enqueue(event);
		},
		recordDurableBridgeEvent: async (event) => {
			const persisted = await enqueue(event, true);
			if (!persisted) {
				throw new Error(`execution_trace_durable_event_missing:${input.traceId}`);
			}
			return persisted;
		},
		getHealth: health,
		finishSucceeded: async (response, result) => {
			await enqueue({
				event: "response.completed",
				data: {
					requestId: input.traceId,
					status: result.status,
					response,
				},
			});
			await flushAll();
			closed = true;
			clearFlushTimer();
			try {
				await finalizeExecutionTraceRun(input.c.env.DB, {
					traceId: input.traceId,
					userId: input.userId,
					status: terminalRunStatus(response, result),
					resultSummary: response.text,
					meta: resultMeta(response, result, health()),
					toolCalls: resultToolCalls(result).length > 0
						? resultToolCalls(result)
						: capturedToolCalls,
				});
			} catch (error: unknown) {
				recordPersistenceFailure(error);
				console.error("[public-agents-chat] execution trace finalization degraded", {
					traceId: input.traceId,
					error: lastError,
				});
			}
			attachHealthToResult(result);
		},
		finishFailed: async (error, cancelled = false) => {
			const failure = errorRecord(error);
			await enqueue({
				event: cancelled ? "execution.cancelled" : "execution.failed",
				data: {
					requestId: input.traceId,
					status: cancelled ? "cancelled" : "failed",
					...failure,
				},
			});
			await flushAll();
			closed = true;
			clearFlushTimer();
			try {
				await finalizeExecutionTraceRun(input.c.env.DB, {
					traceId: input.traceId,
					userId: input.userId,
					status: cancelled ? "cancelled" : "failed",
					errorCode: failure.code,
					errorDetail: failure.message,
					meta: { executionEventPersistence: health() },
				});
			} catch (persistenceError: unknown) {
				recordPersistenceFailure(persistenceError);
				console.error("[public-agents-chat] failed execution trace finalization degraded", {
					traceId: input.traceId,
					error: lastError,
				});
			}
		},
	};
}
