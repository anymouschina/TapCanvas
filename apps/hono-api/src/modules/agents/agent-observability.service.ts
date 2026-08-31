import type {
	AgentAnnotationQueueItemV1,
	AgentCanonicalPersistenceHealthV1,
	AgentEvaluationResultV1,
	AgentHumanFeedbackV1,
	AgentRegressionExampleV1,
	AgentTraceSpanV1,
} from "@tapcanvas/agent-observability";
import type { AppContext } from "../../types";
import {
	createAgentHumanFeedback,
	createAgentRegressionExample,
	enqueueAgentAnnotation,
	listAgentEvaluationResults,
	listAgentAnnotationQueueItems,
	listAgentHumanFeedback,
	listAgentRegressionExamples,
	listAgentTraceRoots,
	listAgentTraceSpans,
	listAgentTraceSpansByTraceIds,
	queryAgentDiagnosticsMetrics,
	markAgentAnnotationQueueReviewed,
	setAgentTracePersistenceHealth,
	writeAgentEvaluationResult,
	writeAgentTraceSpans,
	type AgentTraceListFilters,
} from "./agent-observability.repo";
import type { BuiltAgentObservability } from "./agent-observability.spans";

type TraceCursor = { startedAt: string; id: string };

export class AgentObservabilityRequestError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "AgentObservabilityRequestError";
		this.code = code;
	}
}

export type AgentObservabilityQuery = Omit<AgentTraceListFilters, "cursor"> & {
	cursor?: string;
};

export type AgentObservabilityQueryResult = {
	spans: AgentTraceSpanV1[];
	metrics: Awaited<ReturnType<typeof queryAgentDiagnosticsMetrics>>;
	evaluations: AgentEvaluationResultV1[];
	humanFeedback: AgentHumanFeedbackV1[];
	annotationQueue: AgentAnnotationQueueItemV1[];
	regressionExamples: AgentRegressionExampleV1[];
	nextCursor: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function errorCode(error: unknown): string {
	if (error && typeof error === "object" && !Array.isArray(error)) {
		const code = (error as Record<string, unknown>).code;
		if (typeof code === "string" && code.trim()) return code.trim().slice(0, 160);
	}
	return error instanceof Error && error.name ? error.name.slice(0, 160) : "agent_observability_persist_failed";
}

export function encodeAgentTraceCursor(cursor: TraceCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAgentTraceCursor(value: string | undefined): TraceCursor | undefined {
	if (!value) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch (error: unknown) {
		throw new AgentObservabilityRequestError(
			"agent_diagnostics_cursor_invalid",
			`agent diagnostics cursor is invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const record = asRecord(parsed);
	const startedAt = typeof record?.startedAt === "string" ? record.startedAt : "";
	const id = typeof record?.id === "string" ? record.id : "";
	if (!startedAt || !Number.isFinite(Date.parse(startedAt)) || !id || id.length > 200) {
		throw new AgentObservabilityRequestError(
			"agent_diagnostics_cursor_invalid",
			"agent diagnostics cursor is invalid",
		);
	}
	return { startedAt, id };
}

export async function persistBuiltAgentObservability(
	c: AppContext,
	userId: string,
	built: BuiltAgentObservability,
): Promise<AgentCanonicalPersistenceHealthV1> {
	const traceIds = [...new Set(built.spans.map((span) => span.traceId))];
	try {
		await writeAgentTraceSpans(
			c.env.DB,
			userId,
			built.spans.map((span) => ({ ...span, persistenceStatus: "degraded" })),
		);
		for (const evaluation of built.evaluations) {
			await writeAgentEvaluationResult(c.env.DB, userId, evaluation);
			if (evaluation.status === "failed" || evaluation.status === "needs_review") {
				await enqueueAgentAnnotation(c.env.DB, userId, {
					traceId: evaluation.traceId,
					reasonCode: `${evaluation.evaluatorKey}:${evaluation.status}`,
					priority: evaluation.status === "failed" ? 80 : 50,
				});
			}
		}
		for (const traceId of traceIds) {
			await setAgentTracePersistenceHealth(c.env.DB, userId, traceId, {
				status: "persisted",
				errorCode: null,
			});
		}
		return {
			status: "persisted",
			spanCount: built.spans.length,
			evaluationCount: built.evaluations.length,
			errorCode: null,
		};
	} catch (error: unknown) {
		const code = errorCode(error);
		for (const traceId of traceIds) {
			try {
				await setAgentTracePersistenceHealth(c.env.DB, userId, traceId, {
					status: "degraded",
					errorCode: code,
				});
			} catch (healthError: unknown) {
				console.error(
					`[agent-observability] persistence health marker failed user=${userId} trace=${traceId} code=${errorCode(healthError)}`,
				);
			}
		}
		console.error(`[agent-observability] canonical persistence degraded user=${userId} code=${code}`);
		return {
			status: "degraded",
			spanCount: built.spans.length,
			evaluationCount: built.evaluations.length,
			errorCode: code,
		};
	}
}

export async function queryAgentObservability(
	c: AppContext,
	userId: string,
	input: AgentObservabilityQuery,
): Promise<AgentObservabilityQueryResult> {
	const limit = Math.max(1, Math.min(200, Math.trunc(input.limit)));
	const { cursor: cursorToken, ...filters } = input;
	const cursor = decodeAgentTraceCursor(cursorToken);
	const page = await listAgentTraceRoots(c.env.DB, userId, {
		...filters,
		limit: limit + 1,
		...(cursor ? { cursor } : {}),
	});
	const hasMore = page.length > limit;
	const roots = hasMore ? page.slice(0, limit) : page;
	const traceIds = roots.map((span) => span.traceId);
	const spans = await listAgentTraceSpansByTraceIds(c.env.DB, userId, traceIds);
	const [metrics, evaluations, humanFeedback, annotationQueue, regressionExamples] = await Promise.all([
		queryAgentDiagnosticsMetrics(c.env.DB, userId, filters),
		listAgentEvaluationResults(c.env.DB, userId, traceIds),
		listAgentHumanFeedback(c.env.DB, userId, traceIds),
		listAgentAnnotationQueueItems(c.env.DB, userId, traceIds),
		listAgentRegressionExamples(c.env.DB, userId, { limit }),
	]);
	const last = roots[roots.length - 1];
	return {
		spans,
		metrics,
		evaluations,
		humanFeedback,
		annotationQueue,
		regressionExamples,
		nextCursor: hasMore && last
			? encodeAgentTraceCursor({ startedAt: last.startedAt, id: last.id })
			: null,
	};
}

async function requireOwnedTrace(
	c: AppContext,
	userId: string,
	traceId: string,
): Promise<AgentTraceSpanV1[]> {
	const spans = await listAgentTraceSpans(c.env.DB, userId, {
		traceId,
		limit: 1_000,
	});
	if (spans.length === 0) {
		throw new AgentObservabilityRequestError(
			"agent_observability_trace_not_found",
			"agent observability trace not found",
		);
	}
	return spans;
}

export async function submitAgentHumanFeedback(
	c: AppContext,
	userId: string,
	input: {
		traceId: string;
		spanId?: string | null;
		threadId?: string | null;
		feedbackKey: string;
		value: AgentHumanFeedbackV1["value"];
		comment?: string | null;
	},
): Promise<AgentHumanFeedbackV1> {
	const spans = await requireOwnedTrace(c, userId, input.traceId);
	if (input.spanId && !spans.some((span) => span.spanId === input.spanId)) {
		throw new AgentObservabilityRequestError(
			"agent_observability_span_not_found",
			"agent observability span not found in trace",
		);
	}
	const canonicalThreadId = spans.find((span) => span.kind === "agent")?.threadId ?? null;
	if (input.threadId !== undefined && input.threadId !== null && input.threadId !== canonicalThreadId) {
		throw new AgentObservabilityRequestError(
			"agent_observability_thread_mismatch",
			"agent observability thread does not match trace",
		);
	}
	const feedback = await createAgentHumanFeedback(c.env.DB, userId, {
		traceId: input.traceId,
		spanId: input.spanId ?? null,
		threadId: canonicalThreadId,
		feedbackKey: input.feedbackKey,
		value: input.value,
		comment: input.comment ?? null,
	});
	if (feedback.value !== "accepted") {
		await enqueueAgentAnnotation(c.env.DB, userId, {
			traceId: feedback.traceId,
			reasonCode: `human_feedback:${feedback.value}`,
			priority: feedback.value === "rejected" ? 100 : 70,
		});
	}
	return feedback;
}

export async function captureAgentRegressionExample(
	c: AppContext,
	userId: string,
	input: { traceId: string; datasetKey: string },
): Promise<AgentRegressionExampleV1> {
	const spans = await requireOwnedTrace(c, userId, input.traceId);
	const agentSpan = spans.find((span) => span.kind === "agent");
	if (!agentSpan) {
		throw new AgentObservabilityRequestError(
			"agent_observability_agent_span_missing",
			"agent root span is missing",
		);
	}
	const expectedDelivery = asRecord(agentSpan.attributes.expectedDelivery);
	const deliveryEvidence = asRecord(agentSpan.attributes.deliveryEvidence);
	const deliveryVerification = asRecord(agentSpan.attributes.deliveryVerification);
	if (!expectedDelivery || !deliveryEvidence || !deliveryVerification) {
		throw new AgentObservabilityRequestError(
			"agent_regression_truth_chain_incomplete",
			"trace delivery truth chain is incomplete and cannot become a regression example",
		);
	}
	if (expectedDelivery.active !== true || deliveryVerification.applicable !== true) {
		throw new AgentObservabilityRequestError(
			"agent_regression_truth_chain_not_applicable",
			"trace delivery truth chain is not applicable and cannot become a regression example",
		);
	}
	const evaluations = await listAgentEvaluationResults(c.env.DB, userId, [input.traceId]);
	const example = await createAgentRegressionExample(c.env.DB, userId, {
		datasetKey: input.datasetKey,
		traceId: input.traceId,
		expectedDelivery,
		deliveryEvidence,
		deliveryVerification,
		metadata: {
			modelKey: agentSpan.modelKey,
			scope: agentSpan.scope,
			status: agentSpan.status,
			evaluations: evaluations.map((evaluation) => ({
				evaluatorKey: evaluation.evaluatorKey,
				evaluatorVersion: evaluation.evaluatorVersion,
				status: evaluation.status,
				score: evaluation.score,
			})),
		},
	});
	try {
		await markAgentAnnotationQueueReviewed(c.env.DB, userId, input.traceId);
	} catch (error: unknown) {
		throw new Error(
			`regression example ${example.id} was created but annotation review failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return example;
}
