import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	AgentEvaluationResultV1,
	AgentHumanFeedbackV1,
	AgentRegressionExampleV1,
	AgentTraceSpanV1,
} from "@tapcanvas/agent-observability";
import type { AppContext } from "../../types";

const repoMocks = vi.hoisted(() => ({
	createAgentHumanFeedback: vi.fn(),
	createAgentRegressionExample: vi.fn(),
	enqueueAgentAnnotation: vi.fn(async (
		_db: unknown,
		_userId: string,
		_input: { traceId: string; reasonCode: string; priority: number },
	): Promise<void> => undefined),
	listAgentEvaluationResults: vi.fn(async (): Promise<AgentEvaluationResultV1[]> => []),
	listAgentAnnotationQueueItems: vi.fn(async () => []),
	listAgentHumanFeedback: vi.fn(async () => []),
	listAgentRegressionExamples: vi.fn(async (): Promise<AgentRegressionExampleV1[]> => []),
	listAgentTraceRoots: vi.fn(async (): Promise<AgentTraceSpanV1[]> => []),
	listAgentTraceSpans: vi.fn(async (): Promise<AgentTraceSpanV1[]> => []),
	listAgentTraceSpansByTraceIds: vi.fn(async (): Promise<AgentTraceSpanV1[]> => []),
	queryAgentDiagnosticsMetrics: vi.fn(async () => ({
		traceCount: 0,
		succeededCount: 0,
		failedCount: 0,
		partialCount: 0,
		needsInputCount: 0,
		persistedCount: 0,
		degradedCount: 0,
		totalTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadInputTokens: 0,
		totalDurationMs: 0,
		averageDurationMs: null,
		p50DurationMs: null,
		p95DurationMs: null,
		acceptedAsyncCount: 0,
		materializedAsyncCount: 0,
		staleAsyncCount: 0,
	})),
	markAgentAnnotationQueueReviewed: vi.fn(async (): Promise<void> => undefined),
	setAgentTracePersistenceHealth: vi.fn(async (
		_db: unknown,
		_userId: string,
		_traceId: string,
		_input: { status: "persisted" | "degraded"; errorCode: string | null },
	): Promise<void> => undefined),
	writeAgentEvaluationResult: vi.fn(async (
		_db: unknown,
		_userId: string,
		_evaluation: AgentEvaluationResultV1,
	): Promise<void> => undefined),
	writeAgentTraceSpans: vi.fn(async (
		_db: unknown,
		_userId: string,
		_spans: AgentTraceSpanV1[],
	): Promise<void> => undefined),
}));

vi.mock("./agent-observability.repo", () => repoMocks);

import {
	captureAgentRegressionExample,
	persistBuiltAgentObservability,
	submitAgentHumanFeedback,
} from "./agent-observability.service";

const traceId = "a".repeat(32);

function buildSpan(): AgentTraceSpanV1 {
	return {
		version: 1,
		id: `span_${traceId}_${"b".repeat(16)}`,
		traceId,
		spanId: "b".repeat(16),
		parentSpanId: null,
		linkedSpanIds: [],
		requestId: "request-1",
		threadId: "thread-1",
		turnId: "turn-1",
		service: "hono-api",
		kind: "request",
		name: "agents_bridge.request",
		status: "succeeded",
		startedAt: "2026-08-01T00:00:00.000Z",
		finishedAt: "2026-08-01T00:00:01.000Z",
		durationMs: 1_000,
		scope: {
			projectId: "project-1",
			bookId: null,
			chapterId: null,
			flowId: null,
			nodeId: null,
			label: "public_chat",
			workflowKey: "public_chat.general",
		},
		modelKey: "gpt-5",
		inputTokens: 10,
		outputTokens: 5,
		totalTokens: 15,
		cacheReadInputTokens: 0,
		cacheCreationInputTokens: 0,
		costCredits: null,
		capturePolicy: "structural",
		persistenceStatus: "persisted",
		errorCode: null,
		attributes: {},
		createdAt: "2026-08-01T00:00:01.000Z",
	};
}

function buildEvaluation(): AgentEvaluationResultV1 {
	return {
		version: 1,
		id: "evaluation-1",
		traceId,
		spanId: "b".repeat(16),
		threadId: "thread-1",
		artifactId: null,
		evaluatorKey: "delivery_contract",
		evaluatorVersion: "1",
		source: "deterministic",
		target: "trace",
		status: "passed",
		score: 1,
		value: "satisfied",
		rationale: "delivery_verification_satisfied",
		evidence: {},
		createdAt: "2026-08-01T00:00:01.000Z",
	};
}

const context = { env: { DB: {} } } as unknown as AppContext;

describe("persistBuiltAgentObservability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		repoMocks.writeAgentTraceSpans.mockResolvedValue(undefined);
		repoMocks.writeAgentEvaluationResult.mockResolvedValue(undefined);
		repoMocks.enqueueAgentAnnotation.mockResolvedValue(undefined);
		repoMocks.setAgentTracePersistenceHealth.mockResolvedValue(undefined);
	});

	it("keeps spans provisional until every canonical record is persisted", async () => {
		const result = await persistBuiltAgentObservability(context, "user-1", {
			spans: [buildSpan()],
			evaluations: [buildEvaluation()],
		});
		const provisionalSpans = repoMocks.writeAgentTraceSpans.mock.calls[0]?.[2];
		expect(provisionalSpans[0]?.persistenceStatus).toBe("degraded");
		expect(repoMocks.setAgentTracePersistenceHealth).toHaveBeenLastCalledWith(
			context.env.DB,
			"user-1",
			traceId,
			{ status: "persisted", errorCode: null },
		);
		expect(result.status).toBe("persisted");
	});

	it("leaves the trace explicitly degraded when evaluator persistence fails", async () => {
		const persistenceError = new Error("evaluation storage unavailable") as Error & { code: string };
		persistenceError.code = "evaluation_write_failed";
		repoMocks.writeAgentEvaluationResult.mockRejectedValueOnce(persistenceError);
		const result = await persistBuiltAgentObservability(context, "user-1", {
			spans: [buildSpan()],
			evaluations: [buildEvaluation()],
		});
		expect(repoMocks.setAgentTracePersistenceHealth).toHaveBeenCalledTimes(1);
		expect(repoMocks.setAgentTracePersistenceHealth).toHaveBeenCalledWith(
			context.env.DB,
			"user-1",
			traceId,
			{ status: "degraded", errorCode: "evaluation_write_failed" },
		);
		expect(result).toEqual({
			status: "degraded",
			spanCount: 1,
			evaluationCount: 1,
			errorCode: "evaluation_write_failed",
		});
	});
});

describe("agent observability review workflow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		repoMocks.listAgentTraceSpans.mockResolvedValue([]);
		repoMocks.listAgentEvaluationResults.mockResolvedValue([]);
		repoMocks.markAgentAnnotationQueueReviewed.mockResolvedValue(undefined);
	});

	it("queues non-accepted human feedback against an owned trace", async () => {
		const span = buildSpan();
		span.kind = "agent";
		repoMocks.listAgentTraceSpans.mockResolvedValue([span]);
		const feedback: AgentHumanFeedbackV1 = {
			version: 1,
			id: "feedback-1",
			traceId,
			spanId: null,
			threadId: "thread-1",
			feedbackKey: "delivery_quality",
			value: "needs_revision",
			comment: "missing output",
			createdAt: "2026-08-01T00:00:02.000Z",
		};
		repoMocks.createAgentHumanFeedback.mockResolvedValue(feedback);

		await expect(submitAgentHumanFeedback(context, "user-1", {
			traceId,
			threadId: "thread-1",
			feedbackKey: "delivery_quality",
			value: "needs_revision",
			comment: "missing output",
		})).resolves.toEqual(feedback);
		expect(repoMocks.enqueueAgentAnnotation).toHaveBeenCalledWith(
			context.env.DB,
			"user-1",
			{
				traceId,
				reasonCode: "human_feedback:needs_revision",
				priority: 70,
			},
		);
	});

	it("freezes a complete delivery truth chain before reviewing its annotation queue", async () => {
		const span = buildSpan();
		span.kind = "agent";
		span.attributes = {
			expectedDelivery: { active: true, kind: "video" },
			deliveryEvidence: { artifacts: [{ assetType: "video" }] },
			deliveryVerification: { applicable: true, status: "failed" },
		};
		repoMocks.listAgentTraceSpans.mockResolvedValue([span]);
		const example: AgentRegressionExampleV1 = {
			version: 1,
			id: "example-1",
			datasetKey: "delivery-regression",
			datasetVersion: 1,
			traceId,
			expectedDelivery: span.attributes.expectedDelivery as Record<string, unknown>,
			deliveryEvidence: span.attributes.deliveryEvidence as Record<string, unknown>,
			deliveryVerification: span.attributes.deliveryVerification as Record<string, unknown>,
			metadata: {},
			createdAt: "2026-08-01T00:00:02.000Z",
		};
		repoMocks.createAgentRegressionExample.mockResolvedValue(example);

		await expect(captureAgentRegressionExample(context, "user-1", {
			traceId,
			datasetKey: "delivery-regression",
		})).resolves.toEqual(example);
		expect(repoMocks.createAgentRegressionExample).toHaveBeenCalledTimes(1);
		expect(repoMocks.markAgentAnnotationQueueReviewed).toHaveBeenCalledWith(
			context.env.DB,
			"user-1",
			traceId,
		);
		expect(repoMocks.createAgentRegressionExample.mock.invocationCallOrder[0]).toBeLessThan(
			repoMocks.markAgentAnnotationQueueReviewed.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		);
	});

	it("rejects regression capture when the trace has no complete delivery truth chain", async () => {
		const span = buildSpan();
		span.kind = "agent";
		repoMocks.listAgentTraceSpans.mockResolvedValue([span]);

		await expect(captureAgentRegressionExample(context, "user-1", {
			traceId,
			datasetKey: "delivery-regression",
		})).rejects.toMatchObject({
			code: "agent_regression_truth_chain_incomplete",
		});
		expect(repoMocks.createAgentRegressionExample).not.toHaveBeenCalled();
		expect(repoMocks.markAgentAnnotationQueueReviewed).not.toHaveBeenCalled();
	});
});
