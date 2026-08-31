import { describe, expect, it } from "vitest";

import type { AgentRuntimeObservabilityV1 } from "@tapcanvas/agent-observability";
import { buildAgentObservabilitySpans } from "./agent-observability.spans";

const runtime: AgentRuntimeObservabilityV1 = {
	version: 1,
	correlation: {
		version: 1,
		traceId: "a".repeat(32),
		spanId: "c".repeat(16),
		parentSpanId: "b".repeat(16),
		requestId: "request-1",
		threadId: "thread-1",
		turnId: "turn-1",
		service: "agents-cli",
		capturePolicy: "structural",
		startedAt: "2026-08-01T00:00:00.000Z",
	},
	status: "suspended",
	finishedAt: "2026-08-01T00:00:02.000Z",
	durationMs: 2_000,
	usage: {
		inputTokens: 10,
		outputTokens: 5,
		totalTokens: 15,
		cacheReadInputTokens: 4,
		cacheCreationInputTokens: 0,
	},
	llmSpans: [],
	payloadCapture: {
		policy: "structural",
		status: "disabled",
		eventCount: 0,
		droppedEventCount: 0,
		lastErrorCode: null,
	},
};

const baseInput = {
	traceContext: {
		traceId: "a".repeat(32),
		requestSpanId: "b".repeat(16),
		incomingParentSpanId: null,
		agentsInput: {
			version: 1 as const,
			traceId: "a".repeat(32),
			parentSpanId: "b".repeat(16),
			requestId: "request-1",
			threadId: "thread-1",
			capturePolicy: "structural" as const,
			startedAt: "2026-08-01T00:00:00.000Z",
		},
		traceparent: `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
	},
	runtime,
	requestFinishedAt: "2026-08-01T00:00:03.000Z",
	scope: {
		projectId: "project-1",
		bookId: null,
		chapterId: null,
		flowId: null,
		nodeId: null,
		label: "public_chat",
		workflowKey: "public_chat.general",
	},
	modelKey: "gpt-5.6-sol",
	toolCalls: [],
	assets: [],
	expectedDelivery: { active: true, kind: "video" },
	deliveryEvidence: {
		artifacts: [{
			toolCallId: "tool-1",
			toolName: "generate_video",
			assetType: "video",
			deliveryState: "accepted_async",
			nodeId: "node-1",
			taskId: "task-1",
			runId: "run-1",
			clipIndex: 0,
			assetUrl: null,
		}],
	},
	deliveryVerification: {
		applicable: true,
		status: "satisfied",
		code: null,
		summary: "video accepted",
	},
	turnVerdict: { status: "partial" as const, reasons: ["async"] },
	requestTerminal: {
		version: 1 as const,
		terminal: true as const,
		status: "suspended" as const,
		reason: "async_execution_suspended_until_delivery_verified",
	},
	performanceSnapshot: {
		version: 1 as const,
		wallTimeMs: 2_000,
		timeToFirstTextMs: 1_500,
		timeToFirstToolMs: 500,
		model: {
			turnCount: 1,
			durationMs: 1_400,
			wallTimeShare: 0.7,
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
			cacheReadInputTokens: 4,
			cacheCreationInputTokens: 0,
		},
		tools: {
			callCount: 1,
			durationMs: 100,
			wallTimeShare: 0.05,
			schemaDiscoveryCount: 0,
			blockedCount: 0,
			failedCount: 0,
		},
		context: {
			budgetTokens: 64_000,
			thresholdTokens: 54_400,
			totalTokens: 10_000,
			peakTotalTokens: 12_000,
			systemTokens: 2_000,
			messageTokens: 4_000,
			toolTokens: 4_000,
			overBudget: false,
		},
		toolSurface: {
			modelVisibleCount: 12,
			sentSchemaChars: 8_000,
			modelVisibleDefinitionChars: 10_000,
			initialSentSchemaChars: 7_000,
			maxSentSchemaChars: 8_000,
			initialModelVisibleDefinitionChars: 9_000,
			maxModelVisibleDefinitionChars: 10_000,
			catalogRemoteCount: 28,
			authorizedRemoteDefinitionChars: 90_000,
			catalogNameChars: 827,
			duplicatedWrapperEnumChars: 1_824,
		},
		progress: {
			revision: 1,
			durableClaimCount: 1,
			progressSincePhysicalRunStart: 1,
			suspended: true,
			suspensionBudgetKind: "turns",
			suspensionLimit: 12,
			suspensionObserved: 12,
			suspensionUsageTokens: 15,
			projectedInputTokens: null,
			projectedMinimumOutputTokens: null,
			projectedTotalTokens: null,
		},
	},
};

describe("buildAgentObservabilitySpans", () => {
	it("creates one correlated tree with distinct accepted-async evidence", () => {
		const result = buildAgentObservabilitySpans(baseInput);
		const repeated = buildAgentObservabilitySpans(baseInput);
		expect(result.spans.every((span) => span.traceId === runtime.correlation.traceId)).toBe(true);
		const requestSpan = result.spans.find((span) => span.kind === "request");
		expect(requestSpan?.spanId).toBe("b".repeat(16));
		expect(requestSpan?.totalTokens).toBe(15);
		expect(result.spans.find((span) => span.kind === "agent")?.parentSpanId).toBe("b".repeat(16));
		const persistedPerformance = result.spans.find(
			(span) => span.kind === "agent",
		)?.attributes.performanceSnapshot as Record<string, unknown> | undefined;
		expect(persistedPerformance).toMatchObject({
			version: 1,
			wallTimeMs: 2_000,
			timeToFirstTextMs: 1_500,
		});
		expect(persistedPerformance?.model).toMatchObject({
			durationMs: 1_400,
			inputTokens: 10,
		});
		expect(persistedPerformance?.toolSurface).toMatchObject({ sentSchemaChars: 8_000 });
		expect(result.spans.find((span) => span.kind === "async_task")?.status).toBe("accepted_async");
		expect(result.evaluations[0]?.status).toBe("passed");
		expect(repeated.evaluations[0]?.id).toBe(result.evaluations[0]?.id);
	});

	it("rejects a runtime trace that breaks cross-service correlation", () => {
		expect(() => buildAgentObservabilitySpans({
			...baseInput,
			traceContext: { ...baseInput.traceContext, traceId: "f".repeat(32) },
		})).toThrow(/traceId/);
	});

	it("uses tool timing and does not double-count the same materialized response asset", () => {
		const assetUrl = "https://assets.tapcanvas.example/video.mp4";
		const result = buildAgentObservabilitySpans({
			...baseInput,
			runtime: { ...runtime, status: "succeeded" },
			toolCalls: [{
				toolCallId: "tool-1",
				seq: 1,
				name: "generate_video",
				status: "succeeded",
				pathHint: "",
				errorMessage: "",
				outputChars: 100,
				outputJson: null,
				inputJson: null,
				requestedAgentType: "",
				startedAt: "2026-08-01T00:00:00.500Z",
				finishedAt: "2026-08-01T00:00:01.500Z",
				durationMs: 1_000,
			}],
			assets: [{ type: "video", url: assetUrl }],
			deliveryEvidence: {
				artifacts: [{
					toolCallId: "tool-1",
					toolName: "generate_video",
					assetType: "video",
					deliveryState: "materialized",
					nodeId: "node-1",
					taskId: "task-1",
					runId: "run-1",
					clipIndex: 0,
					assetUrl,
				}],
			},
			turnVerdict: { status: "satisfied", reasons: [] },
			requestTerminal: {
				version: 1,
				terminal: true,
				status: "succeeded",
				reason: "delivery_verified",
			},
		});
		const materializationSpans = result.spans.filter((span) => span.kind === "asset_materialization");
		expect(materializationSpans).toHaveLength(1);
		expect(materializationSpans[0]?.startedAt).toBe("2026-08-01T00:00:00.500Z");
		expect(materializationSpans[0]?.finishedAt).toBe("2026-08-01T00:00:01.500Z");
		expect(materializationSpans[0]?.durationMs).toBe(1_000);
	});
});
