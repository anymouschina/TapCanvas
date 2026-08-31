import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentTraceSpanV1 } from "@tapcanvas/agent-observability";
import type { PrismaClient } from "../../types";

const dbMocks = vi.hoisted(() => ({
	execute: vi.fn(async (_db: unknown, _sql: string, _bindings: unknown[] = []) => undefined),
	queryAll: vi.fn(async (_db: unknown, _sql: string, _bindings: unknown[] = []): Promise<unknown[]> => []),
	queryOne: vi.fn(async (_db: unknown, _sql: string, _bindings: unknown[] = []): Promise<unknown> => null),
}));

vi.mock("../../db/db", () => dbMocks);

import {
	createAgentRegressionExample,
	listAgentAnnotationQueueItems,
	listAgentRegressionExamples,
	listAgentTraceRoots,
	markAgentAnnotationQueueReviewed,
	queryAgentDiagnosticsMetrics,
	setAgentTracePersistenceHealth,
	writeAgentTraceSpans,
} from "./agent-observability.repo";

const db = {} as unknown as PrismaClient;

describe("agent observability repository queries", () => {
	beforeEach(() => {
		dbMocks.execute.mockClear();
		dbMocks.queryAll.mockClear();
		dbMocks.queryOne.mockClear();
	});

	it("binds a structural span-kind filter exactly once while paging trace roots", async () => {
		await listAgentTraceRoots(db, "user-1", {
			kind: "tool",
			limit: 2,
		});
		const queryCall = dbMocks.queryAll.mock.calls.at(-1);
		expect(queryCall?.[2]).toEqual(["user-1", "request", "tool", 2]);
		expect(String(queryCall?.[1]).match(/\?/g)).toHaveLength(4);
	});

	it("binds flow and node scope filters on the canonical request root", async () => {
		await listAgentTraceRoots(db, "user-1", {
			flowId: "flow-1",
			nodeId: "node-1",
			limit: 2,
		});
		const queryCall = dbMocks.queryAll.mock.calls.at(-1);
		expect(queryCall?.[2]).toEqual(["user-1", "flow-1", "node-1", "request", 2]);
	});

	it("excludes accepted async spans that have a later matching materialization", async () => {
		await queryAgentDiagnosticsMetrics(db, "user-1", {
			kind: "async_task",
		});
		const asyncMetricCall = dbMocks.queryOne.mock.calls.at(-1);
		const sql = String(asyncMetricCall?.[1]);
		expect(asyncMetricCall?.[2]).toEqual(["user-1", "request", "async_task", "user-1"]);
		expect(sql).toContain("NOT EXISTS");
		expect(sql).toContain("WHEN lifecycle_span.async_task_id IS NOT NULL");
		expect(sql).toContain("materialized_span.async_task_id = lifecycle_span.async_task_id");
		expect(sql).toContain("materialized_span.async_run_id = lifecycle_span.async_run_id");
		expect(sql).toContain("materialized_span.async_node_id = lifecycle_span.async_node_id");
		expect(sql).toContain("materialized_span.flow_id IS NOT DISTINCT FROM lifecycle_span.flow_id");
	});

	it("persists every stable async identity in indexed columns", async () => {
		const span: AgentTraceSpanV1 = {
			version: 1,
			id: "span-1",
			traceId: "a".repeat(32),
			spanId: "b".repeat(16),
			parentSpanId: null,
			linkedSpanIds: [],
			requestId: "request-1",
			threadId: "thread-1",
			turnId: "turn-1",
			service: "tool",
			kind: "async_task",
			name: "accepted_async.video",
			status: "accepted_async",
			startedAt: "2026-08-01T00:00:00.000Z",
			finishedAt: null,
			durationMs: null,
			scope: {
				projectId: "project-1",
				bookId: null,
				chapterId: null,
				flowId: null,
				nodeId: "node-1",
				label: "public_chat",
				workflowKey: "public_chat.general",
			},
			modelKey: "gpt-5",
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			cacheReadInputTokens: 0,
			cacheCreationInputTokens: 0,
			costCredits: null,
			capturePolicy: "structural",
			persistenceStatus: "persisted",
			errorCode: null,
			attributes: { taskId: "task-1", runId: "run-1", nodeId: "node-1" },
			createdAt: "2026-08-01T00:00:00.000Z",
		};
		await writeAgentTraceSpans(db, "user-1", [span]);
		const insertCall = dbMocks.execute.mock.calls.at(-1);
		const sql = String(insertCall?.[1]);
		const bindings = insertCall?.[2] ?? [];
		expect(sql).toContain("async_task_id, async_run_id, async_node_id");
		expect(bindings[21]).toBe("task-1");
		expect(bindings[22]).toBe("run-1");
		expect(bindings[23]).toBe("node-1");
		expect(sql.match(/\?/g)).toHaveLength(bindings.length);
	});

	it("counts partial verdicts independently from accepted async requests", async () => {
		await queryAgentDiagnosticsMetrics(db, "user-1", {});
		const rootMetricCall = dbMocks.queryOne.mock.calls.at(-2);
		const sql = String(rootMetricCall?.[1]);
		expect(sql).toContain("attributes_json::jsonb #>> '{turnVerdict,status}' = 'partial'");
		expect(sql).not.toContain("WHERE status = 'accepted_async')::bigint AS partial_count");
	});

	it("returns duration aggregates as JavaScript numbers instead of PostgreSQL numeric objects", async () => {
		await queryAgentDiagnosticsMetrics(db, "user-1", {});
		const rootMetricCall = dbMocks.queryOne.mock.calls.at(-2);
		const sql = String(rootMetricCall?.[1]);
		expect(sql).toContain("AVG(duration_ms)");
		expect(sql.match(/::double precision/g)).toHaveLength(3);
		expect(sql).toContain("AS average_duration_ms");
		expect(sql).toContain("AS p50_duration_ms");
		expect(sql).toContain("AS p95_duration_ms");
	});

	it("commits provisional trace persistence health with an explicit status update", async () => {
		await setAgentTracePersistenceHealth(db, "user-1", "trace-1", {
			status: "degraded",
			errorCode: "evaluation_write_failed",
		});
		const updateCall = dbMocks.execute.mock.calls.at(-1);
		expect(String(updateCall?.[1])).toContain("UPDATE agent_trace_spans");
		expect(updateCall?.[2]).toEqual([
			"degraded",
			"degraded",
			"evaluation_write_failed",
			"user-1",
			"trace-1",
		]);
	});

	it("lists and explicitly reviews annotation queue items", async () => {
		dbMocks.queryAll.mockResolvedValueOnce([{
			id: "annotation-1",
			trace_id: "a".repeat(32),
			reason_code: "delivery_contract:failed",
			status: "pending",
			priority: 80,
			created_at: "2026-08-01T00:00:00.000Z",
			reviewed_at: null,
		}]);
		const items = await listAgentAnnotationQueueItems(db, "user-1", ["a".repeat(32)]);
		expect(items[0]).toEqual(expect.objectContaining({
			id: "annotation-1",
			status: "pending",
			priority: 80,
		}));

		await markAgentAnnotationQueueReviewed(db, "user-1", "a".repeat(32));
		const updateCall = dbMocks.execute.mock.calls.at(-1);
		expect(String(updateCall?.[1])).toContain("status = 'reviewed'");
		expect(updateCall?.[2]?.slice(1)).toEqual(["user-1", "a".repeat(32)]);
	});

	it("returns an existing regression example without allocating another dataset version", async () => {
		const existingRow = {
			id: "example-1",
			dataset_key: "delivery-regression",
			dataset_version: 4,
			trace_id: "a".repeat(32),
			expected_delivery_json: JSON.stringify({ active: true }),
			delivery_evidence_json: JSON.stringify({ artifacts: [] }),
			delivery_verification_json: JSON.stringify({ applicable: true }),
			metadata_json: JSON.stringify({ modelKey: "gpt-5" }),
			created_at: "2026-08-01T00:00:00.000Z",
		};
		dbMocks.queryOne.mockResolvedValueOnce(existingRow);
		const result = await createAgentRegressionExample(db, "user-1", {
			datasetKey: "delivery-regression",
			traceId: "a".repeat(32),
			expectedDelivery: { active: true },
			deliveryEvidence: { artifacts: [] },
			deliveryVerification: { applicable: true },
			metadata: { modelKey: "gpt-5" },
		});
		expect(result.id).toBe("example-1");
		expect(result.datasetVersion).toBe(4);
		expect(dbMocks.queryOne).toHaveBeenCalledTimes(1);
	});

	it("lists regression examples newest-first within one dataset", async () => {
		dbMocks.queryAll.mockResolvedValueOnce([{
			id: "example-1",
			dataset_key: "delivery-regression",
			dataset_version: 4,
			trace_id: "a".repeat(32),
			expected_delivery_json: JSON.stringify({ active: true }),
			delivery_evidence_json: JSON.stringify({ artifacts: [] }),
			delivery_verification_json: JSON.stringify({ applicable: true }),
			metadata_json: JSON.stringify({ modelKey: "gpt-5" }),
			created_at: "2026-08-01T00:00:00.000Z",
		}]);
		const result = await listAgentRegressionExamples(db, "user-1", {
			datasetKey: "delivery-regression",
			limit: 50,
		});
		expect(result).toHaveLength(1);
		expect(result[0]?.datasetVersion).toBe(4);
		expect(dbMocks.queryAll).toHaveBeenLastCalledWith(
			db,
			expect.stringContaining("WHERE user_id = ? AND dataset_key = ?"),
			["user-1", "delivery-regression", 50],
		);
	});
});
