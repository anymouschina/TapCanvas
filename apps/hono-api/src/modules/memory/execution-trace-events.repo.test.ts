import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";

const dbMocks = vi.hoisted(() => ({
	execute: vi.fn(async (_db: unknown, _sql: string, _bindings?: unknown[]): Promise<void> => undefined),
	executeWithChanges: vi.fn(async (_db: unknown, _sql: string, _bindings?: unknown[]): Promise<number> => 1),
	queryAll: vi.fn(async (_db: unknown, _sql: string, _bindings?: unknown[]): Promise<unknown[]> => []),
	queryOne: vi.fn(async (_db: unknown, _sql: string, _bindings?: unknown[]): Promise<unknown> => null),
}));

vi.mock("../../db/db", () => dbMocks);
vi.mock("./execution-trace-schema", () => ({
	assertExecutionTraceSchemaReady: vi.fn(async (): Promise<void> => undefined),
}));

import {
	appendExecutionTraceEvent,
	appendExecutionTraceEvents,
	beginExecutionTraceRun,
	evaluateExecutionTraceIntegrity,
	finalizeExecutionTraceRun,
	getExecutionTraceDiagnosticBundle,
	getExecutionTraceAcceptedRequest,
	getExecutionTraceAcceptedSnapshot,
	getExecutionTraceLifecycleSnapshot,
	listExecutionTraceEvents,
	queryExecutionTraceHealth,
	sweepStaleExecutionTraceRuns,
} from "./execution-trace-events.repo";

describe("execution trace event store", () => {
	const db = {
		$transaction: async <T>(callback: (transaction: PrismaClient) => Promise<T>): Promise<T> => (
			await callback({} as unknown as PrismaClient)
		),
	} as unknown as PrismaClient;
	const eventRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
		id: "event-1",
		trace_id: "trace-1",
		user_id: "user-1",
		seq: 7,
		producer_event_id: "producer-1",
		event_type: "tool",
		event_class: "tool",
		event_key: "tool-call-1",
		phase: "completed",
		status: "succeeded",
		logical_task_id: "logical-1",
		root_trace_id: "trace-1",
		parent_trace_id: null,
		physical_run_id: "physical-1",
		workflow_run_id: "run-1",
		workflow_node_id: "media-production",
		agent_id: "agent-1",
		parent_agent_id: null,
		tool_call_id: "tool-call-1",
		effect_id: "effect-1",
		provider_task_id: "provider-task-1",
		span_id: "span-1",
		parent_span_id: null,
		attempt: 1,
		payload_json: JSON.stringify({ toolName: "Skill", output: "loaded" }),
		payload_size_bytes: 38,
		payload_truncated: false,
		created_at: "2026-08-10T00:00:00.000Z",
		...overrides,
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("allocates a batch under one trace lock and sanitizes its payload", async () => {
		dbMocks.queryOne.mockResolvedValueOnce({ next_event_seq: 6 });
		dbMocks.queryAll
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([eventRow()]);

		const event = await appendExecutionTraceEvent(db, {
			traceId: "trace-1",
			userId: "user-1",
			producerEventId: "producer-1",
			eventClass: "tool",
			eventType: "tool",
			eventKey: "tool-call-1",
			phase: "completed",
			status: "succeeded",
			payload: { toolName: "Skill", output: "loaded", apiKey: "secret-value" },
		});

		expect(event.seq).toBe(7);
		expect(event.payload).toEqual({ toolName: "Skill", output: "loaded" });
		expect(dbMocks.execute).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining("pg_advisory_xact_lock"),
			["trace-1"],
		);
		expect(dbMocks.queryAll).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.stringContaining("jsonb_to_recordset"),
			expect.arrayContaining([expect.stringContaining("[REDACTED]")]),
		);
	});

	it("does not allocate new sequences for producer events already persisted", async () => {
		dbMocks.queryOne.mockResolvedValueOnce({ next_event_seq: 9 });
		dbMocks.queryAll.mockResolvedValueOnce([{ producer_event_id: "producer-1" }]);
		const events = await appendExecutionTraceEvents(db, {
			traceId: "trace-1",
			userId: "user-1",
			events: [{
				producerEventId: "producer-1",
				eventType: "tool",
				eventClass: "tool",
				eventKey: "tool-call-1",
				payload: {},
			}],
		});
		expect(events).toEqual([]);
		expect(dbMocks.execute.mock.calls.some((call) => String(call[1]).startsWith("UPDATE execution_traces"))).toBe(false);
	});

	it("refuses to reopen an existing physical execution identity", async () => {
		dbMocks.executeWithChanges.mockResolvedValueOnce(0);
		dbMocks.queryOne.mockResolvedValueOnce({
			user_id: "user-1",
			root_trace_id: "root-1",
			logical_task_id: "logical-1",
			status: "succeeded",
		});

		await expect(beginExecutionTraceRun(db, {
			traceId: "continuation-1",
			userId: "user-1",
			scopeType: "project",
			scopeId: "project-1",
			requestKind: "agents_bridge:public_chat",
			inputSummary: "promptChars=10",
			sessionKey: "session-1",
			workflowKey: "public_agents_chat",
			logicalTaskId: "logical-1",
			rootTraceId: "root-1",
		})).rejects.toThrow("execution_trace_already_exists:continuation-1:succeeded");

		expect(dbMocks.executeWithChanges).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining("ON CONFLICT (id) DO NOTHING"),
			expect.any(Array),
		);
	});

	it("reads the durable lifecycle row before bridge events are projected", async () => {
		dbMocks.queryOne.mockResolvedValueOnce({
			id: "turn-accepted",
			status: "running",
			logical_task_id: "turn-accepted",
			root_trace_id: "turn-accepted",
			started_at: "2026-08-10T00:00:00.000Z",
			updated_at: "2026-08-10T00:00:00.001Z",
			finished_at: null,
		});

		await expect(getExecutionTraceLifecycleSnapshot(db, {
			traceId: "turn-accepted",
			userId: "user-1",
		})).resolves.toEqual({
			traceId: "turn-accepted",
			status: "running",
			logicalTaskId: "turn-accepted",
			rootTraceId: "turn-accepted",
			startedAt: "2026-08-10T00:00:00.000Z",
			updatedAt: "2026-08-10T00:00:00.001Z",
			finishedAt: null,
		});
		expect(dbMocks.queryOne).toHaveBeenCalledWith(
			db,
			expect.stringContaining("FROM execution_traces"),
			["turn-accepted", "user-1"],
		);
	});

	it("keeps trace terminal state monotonic while allowing an identical finalize replay", async () => {
		dbMocks.executeWithChanges.mockResolvedValueOnce(0);
		dbMocks.queryOne.mockResolvedValueOnce({ status: "succeeded" });
		await expect(finalizeExecutionTraceRun(db, {
			traceId: "trace-terminal",
			userId: "user-1",
			status: "succeeded",
		})).resolves.toBeUndefined();

		dbMocks.executeWithChanges.mockResolvedValueOnce(0);
		dbMocks.queryOne.mockResolvedValueOnce({ status: "succeeded" });
		await expect(finalizeExecutionTraceRun(db, {
			traceId: "trace-terminal",
			userId: "user-1",
			status: "failed",
		})).rejects.toThrow("execution_trace_terminal_conflict:trace-terminal:succeeded:failed");
	});

	it("reopens a failed host projection only for an explicitly verified waiting continuation", async () => {
		dbMocks.executeWithChanges.mockResolvedValueOnce(1);
		await expect(finalizeExecutionTraceRun(db, {
			traceId: "trace-recoverable-physical-window",
			userId: "user-1",
			status: "waiting_async",
			allowFailedToWaitingAsyncRecovery: true,
			resultSummary: "durable continuation registered",
		})).resolves.toBeUndefined();

		expect(dbMocks.executeWithChanges).toHaveBeenCalledWith(
			db,
			expect.stringContaining("status IN ('running', 'waiting_async', 'failed')"),
			expect.arrayContaining([
				"waiting_async",
				"durable continuation registered",
				"trace-recoverable-physical-window",
				"user-1",
			]),
		);

		dbMocks.executeWithChanges.mockResolvedValueOnce(0);
		dbMocks.queryOne.mockResolvedValueOnce({ status: "failed" });
		await expect(finalizeExecutionTraceRun(db, {
			traceId: "trace-nonrecoverable",
			userId: "user-1",
			status: "waiting_async",
		})).rejects.toThrow("execution_trace_terminal_conflict:trace-nonrecoverable:failed:waiting_async");
	});

	it("reconciles persisted terminal events and expires only stale running physical traces", async () => {
		dbMocks.queryAll.mockResolvedValueOnce([
			{
				id: "trace-failed-event",
				user_id: "user-1",
				terminal_event_type: "execution.failed",
				terminal_payload_json: JSON.stringify({ status: "failed" }),
			},
			{
				id: "trace-waiting-event",
				user_id: "user-1",
				terminal_event_type: "response.completed",
				terminal_payload_json: JSON.stringify({
					status: "succeeded",
					response: { trace: { requestTerminal: { status: "suspended" } } },
				}),
			},
			{
				id: "trace-lease-expired",
				user_id: "user-1",
				terminal_event_type: null,
				terminal_payload_json: null,
			},
		]);

		const result = await sweepStaleExecutionTraceRuns(db, {
			nowMs: Date.parse("2026-08-14T08:00:00.000Z"),
			staleMs: 35 * 60_000,
		});

		expect(result).toEqual({
			scanned: 3,
			succeeded: 0,
			failed: 2,
			cancelled: 0,
			waitingAsync: 1,
			errors: [],
		});
		expect(dbMocks.queryAll).toHaveBeenCalledWith(
			db,
			expect.stringContaining("trace.status = 'running'"),
			["2026-08-14T07:25:00.000Z", 100],
		);
		expect(dbMocks.executeWithChanges).toHaveBeenCalledTimes(3);
		expect(dbMocks.executeWithChanges.mock.calls.map((call) => call[2]?.[0])).toEqual([
			"failed",
			"waiting_async",
			"failed",
		]);
	});

	it("returns ordered replay pages with an explicit continuation cursor", async () => {
		dbMocks.queryOne
			.mockResolvedValueOnce({ status: "running", next_event_seq: 2, finished_at: null })
			.mockResolvedValueOnce({
				persisted_event_count: 2,
				latest_persisted_seq: 2,
				request_accepted_count: 1,
				terminal_event_count: 0,
			});
		dbMocks.queryAll.mockResolvedValueOnce([
			eventRow({ seq: 1, producer_event_id: "p-1", event_type: "request.accepted", event_class: "lifecycle", event_key: "request.accepted", phase: null, status: null, payload_json: "{}" }),
			eventRow({ id: "event-2", seq: 2, producer_event_id: "p-2", event_key: "tool-1", phase: "started", status: "running", payload_json: "{}" }),
		]);

		const page = await listExecutionTraceEvents({} as unknown as PrismaClient, {
			traceId: "trace-1",
			userId: "user-1",
			limit: 1,
		});

		expect(page.events.map((event) => event.seq)).toEqual([1]);
		expect(page.nextAfterSeq).toBe(1);
		expect(page.latestSeq).toBe(2);
		expect(page.traceStatus).toBe("running");
		expect(page.hasMore).toBe(true);
		expect(page.integrity.status).toBe("consistent");
	});

	it("reports structural terminal and sequence contradictions without inspecting prompt semantics", () => {
		const integrity = evaluateExecutionTraceIntegrity({
			traceStatus: "succeeded",
			finishedAt: null,
			nextEventSeq: 5,
			persistedEventCount: 3,
			latestPersistedSeq: 4,
			requestAcceptedCount: 2,
			terminalEventCount: 0,
		});
		expect(integrity.status).toBe("inconsistent");
		expect(integrity.issues.map((issue) => issue.code)).toEqual([
			"request_accepted_count_invalid",
			"event_sequence_incomplete",
			"terminal_trace_missing_finished_at",
			"terminal_trace_missing_terminal_event",
		]);
	});

	it("summarizes operational health from persisted structural facts", async () => {
		dbMocks.queryOne.mockResolvedValueOnce({
			total_trace_count: 12,
			running_trace_count: 2,
			waiting_async_trace_count: 1,
			stale_running_trace_count: 1,
			sequence_mismatch_count: 0,
			terminal_integrity_issue_count: 1,
			orphan_parent_trace_count: 0,
			persistence_degraded_trace_count: 2,
			total_event_count: 430,
			total_payload_bytes: 2048,
			oldest_active_started_at: "2026-08-10T00:00:00.000Z",
		});
		const health = await queryExecutionTraceHealth(db, {
			userId: "user-1",
			staleAfterSeconds: 300,
		});
		expect(health).toMatchObject({
			status: "degraded",
			staleAfterSeconds: 300,
			totalTraceCount: 12,
			staleRunningTraceCount: 1,
			terminalIntegrityIssueCount: 1,
			persistenceDegradedTraceCount: 2,
			totalEventCount: 430,
			totalPayloadBytes: 2048,
		});
		expect(dbMocks.queryOne).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining("trace.request_kind = 'agents_bridge:public_chat'"),
			expect.arrayContaining(["user-1"]),
		);
	});

	it("exports a bounded owner-scoped diagnostic bundle with integrity facts", async () => {
		dbMocks.queryOne
			.mockResolvedValueOnce({
				id: "trace-1",
				status: "succeeded",
				request_kind: "agents_bridge:public_chat",
				scope_type: "project",
				scope_id: "project-1",
				logical_task_id: "logical-1",
				root_trace_id: "trace-1",
				parent_trace_id: null,
				physical_run_id: "physical-1",
				workflow_run_id: "workflow-1",
				started_at: "2026-08-10T00:00:00.000Z",
				updated_at: "2026-08-10T00:01:00.000Z",
				finished_at: "2026-08-10T00:01:00.000Z",
				meta_json: JSON.stringify({ executionEventPersistence: { status: "persisted" } }),
			})
			.mockResolvedValueOnce({ status: "succeeded", next_event_seq: 2, finished_at: "2026-08-10T00:01:00.000Z" })
			.mockResolvedValueOnce({
				persisted_event_count: 2,
				latest_persisted_seq: 2,
				request_accepted_count: 1,
				terminal_event_count: 1,
			});
		dbMocks.queryAll
			.mockResolvedValueOnce([eventRow({ seq: 1 }), eventRow({ id: "event-2", seq: 2 })])
			.mockResolvedValueOnce([eventRow({ seq: 1 }), eventRow({ id: "event-2", seq: 2 })]);

		const bundle = await getExecutionTraceDiagnosticBundle(db, {
			traceId: "trace-1",
			userId: "user-1",
			maxEvents: 1,
		});
		expect(bundle).toMatchObject({
			schemaVersion: "tapcanvas.execution-diagnostic-bundle.v1",
			eventCount: 2,
			includedEventCount: 1,
			truncated: true,
			integrity: { status: "consistent" },
		});
		expect(dbMocks.queryAll).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.stringContaining("WHERE trace_id = ? AND user_id = ?"),
			["trace-1", "user-1", 2],
		);
	});

	it("recovers only an immutable request selected by an owned active or provably recoverable trace", async () => {
		dbMocks.queryOne.mockResolvedValueOnce(eventRow({
			seq: 1,
			producer_event_id: "request-accepted",
			event_type: "request.accepted",
			event_class: "lifecycle",
			event_key: "request.accepted",
			phase: null,
			status: null,
			payload_json: JSON.stringify({
				requestId: "trace-1",
				request: { prompt: "执行 V2", sessionKey: "session-1" },
			}),
		}));

		const request = await getExecutionTraceAcceptedRequest({} as unknown as PrismaClient, {
			traceId: "trace-1",
			userId: "user-1",
		});

		expect(request).toEqual({ prompt: "执行 V2", sessionKey: "session-1" });
		expect(dbMocks.queryOne).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringMatching(
				/trace\.status IN \('running', 'waiting_async'\)[\s\S]*trace\.status = 'failed'[\s\S]*runOutcome,status[\s\S]*physicalRunId/,
			),
			["trace-1", "user-1"],
		);
	});

	it("keeps server-owned recovery context beside the immutable public request", async () => {
		dbMocks.queryOne.mockResolvedValueOnce(eventRow({
			seq: 1,
			producer_event_id: "request-accepted-workflow",
			event_type: "request.accepted",
			event_class: "lifecycle",
			event_key: "request.accepted",
			phase: null,
			status: null,
			payload_json: JSON.stringify({
				request: { prompt: "拆分章节", sessionKey: "workflow:run:planner" },
				recoveryContext: {
					continuationExecutionContract: {
						version: 1,
						directForcedAgentExecution: true,
						outputContract: { kind: "json", requiredArrayField: "$" },
					},
				},
			}),
		}));

		await expect(getExecutionTraceAcceptedSnapshot(
			{} as unknown as PrismaClient,
			{ traceId: "trace-1", userId: "user-1" },
		)).resolves.toEqual({
			request: { prompt: "拆分章节", sessionKey: "workflow:run:planner" },
			recoveryContext: {
				continuationExecutionContract: {
					version: 1,
					directForcedAgentExecution: true,
					outputContract: { kind: "json", requiredArrayField: "$" },
				},
			},
		});
	});
});
