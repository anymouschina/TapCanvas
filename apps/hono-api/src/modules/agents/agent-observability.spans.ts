import { createHash } from "node:crypto";

import type {
	AgentEvaluationResultV1,
	AgentPerformanceSnapshotV1,
	AgentRequestTerminalV1,
	AgentRuntimeObservabilityV1,
	AgentSpanKind,
	AgentSpanStatus,
	AgentTraceScopeV1,
	AgentTraceSpanV1,
	AgentTraceTerminalStatus,
} from "@tapcanvas/agent-observability";
import type { HonoAgentTraceContext } from "./agent-observability.context";
import { sanitizeAgentObservabilityRecord } from "./agent-observability.sanitizer";

type UnknownRecord = Record<string, unknown>;

export type AgentObservabilityToolCall = {
	toolCallId: string;
	seq: number | null;
	name: string;
	status: "succeeded" | "failed" | "denied" | "blocked" | "";
	pathHint: string;
	errorMessage: string;
	outputChars: number | null;
	outputJson: Record<string, unknown> | null;
	inputJson: Record<string, unknown> | null;
	requestedAgentType: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number | null;
};

export type AgentObservabilityAsset = {
	type: "image" | "video" | "audio";
	url: string;
	thumbnailUrl?: string;
};

export type BuildAgentObservabilitySpansInput = {
	traceContext: HonoAgentTraceContext;
	runtime: AgentRuntimeObservabilityV1;
	requestFinishedAt: string;
	scope: AgentTraceScopeV1;
	modelKey: string | null;
	toolCalls: AgentObservabilityToolCall[];
	assets: AgentObservabilityAsset[];
	expectedDelivery: unknown;
	deliveryEvidence: unknown;
	deliveryVerification: unknown;
	turnVerdict: { status: "satisfied" | "partial" | "failed"; reasons: string[] };
	requestTerminal: AgentRequestTerminalV1;
	performanceSnapshot?: AgentPerformanceSnapshotV1 | null;
};

export type BuiltAgentObservability = {
	spans: AgentTraceSpanV1[];
	evaluations: AgentEvaluationResultV1[];
};

function deterministicEvaluationId(traceId: string, evaluatorKey: string, evaluatorVersion: string): string {
	return `evaluation_${createHash("sha256")
		.update(`${traceId}:${evaluatorKey}:${evaluatorVersion}`)
		.digest("hex")}`;
}

export function buildFailedHonoAgentObservability(input: {
	traceContext: HonoAgentTraceContext;
	requestFinishedAt: string;
	scope: AgentTraceScopeV1;
	modelKey: string | null;
	errorCode: string;
}): BuiltAgentObservability {
	const traceId = input.traceContext.traceId;
	const evaluation: AgentEvaluationResultV1 = {
		version: 1,
		id: deterministicEvaluationId(traceId, "bridge_transport", "1"),
		traceId,
		spanId: input.traceContext.requestSpanId,
		threadId: input.traceContext.agentsInput.threadId,
		artifactId: null,
		evaluatorKey: "bridge_transport",
		evaluatorVersion: "1",
		source: "deterministic",
		target: "trace",
		status: "failed",
		score: 0,
		value: input.errorCode,
		rationale: "agents_bridge_request_failed_before_verified_delivery",
		evidence: { errorCode: input.errorCode },
		createdAt: input.requestFinishedAt,
	};
	const span = baseSpan({
		traceId,
		spanId: input.traceContext.requestSpanId,
		parentSpanId: input.traceContext.incomingParentSpanId,
		requestId: input.traceContext.agentsInput.requestId,
		threadId: input.traceContext.agentsInput.threadId,
		turnId: null,
		service: "hono-api",
		kind: "request",
		name: "agents_bridge.request",
		status: "failed",
		startedAt: input.traceContext.agentsInput.startedAt,
		finishedAt: input.requestFinishedAt,
		durationMs: durationBetween(input.traceContext.agentsInput.startedAt, input.requestFinishedAt),
		scope: input.scope,
		modelKey: input.modelKey,
		capturePolicy: input.traceContext.agentsInput.capturePolicy,
		errorCode: input.errorCode,
		attributes: { errorCode: input.errorCode },
		createdAt: input.requestFinishedAt,
	});
	return { spans: [span], evaluations: [evaluation] };
}

function asRecord(value: unknown): UnknownRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function readString(record: UnknownRecord | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableString(record: UnknownRecord | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readInteger(record: UnknownRecord | null, key: string): number | null {
	const value = record?.[key];
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isIsoTimestamp(value: string): boolean {
	return value.length <= 64 && Number.isFinite(Date.parse(value));
}

function durationBetween(startedAt: string, finishedAt: string): number {
	return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

function deterministicSpanId(traceId: string, identity: string): string {
	return createHash("sha256").update(`${traceId}:${identity}`).digest("hex").slice(0, 16);
}

function persistedSpanId(traceId: string, spanId: string): string {
	return `span_${traceId}_${spanId}`;
}

function terminalStatusToSpan(status: AgentTraceTerminalStatus): AgentSpanStatus {
	return status;
}

function toolStatusToSpan(status: AgentObservabilityToolCall["status"]): AgentSpanStatus {
	if (status === "succeeded" || status === "failed" || status === "denied" || status === "blocked") {
		return status;
	}
	return "failed";
}

function toolSpanKind(tool: AgentObservabilityToolCall): AgentSpanKind {
	if (tool.name === "Skill") return "skill";
	if (tool.name === "spawn_agent" || tool.name === "delegate") return "subagent";
	return "tool";
}

function errorFingerprint(errorMessage: string): Record<string, unknown> {
	if (!errorMessage) return {};
	return {
		errorMessageChars: errorMessage.length,
		errorMessageHash: createHash("sha256").update(errorMessage).digest("hex"),
	};
}

function baseSpan(input: {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	linkedSpanIds?: string[];
	requestId: string | null;
	threadId: string | null;
	turnId: string | null;
	service: AgentTraceSpanV1["service"];
	kind: AgentTraceSpanV1["kind"];
	name: string;
	status: AgentTraceSpanV1["status"];
	startedAt: string;
	finishedAt: string | null;
	durationMs: number | null;
	scope: AgentTraceScopeV1;
	modelKey: string | null;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
	capturePolicy: AgentTraceSpanV1["capturePolicy"];
	errorCode?: string | null;
	attributes?: Record<string, unknown>;
	createdAt: string;
}): AgentTraceSpanV1 {
	return {
		version: 1,
		id: persistedSpanId(input.traceId, input.spanId),
		traceId: input.traceId,
		spanId: input.spanId,
		parentSpanId: input.parentSpanId,
		linkedSpanIds: input.linkedSpanIds ?? [],
		requestId: input.requestId,
		threadId: input.threadId,
		turnId: input.turnId,
		service: input.service,
		kind: input.kind,
		name: input.name,
		status: input.status,
		startedAt: input.startedAt,
		finishedAt: input.finishedAt,
		durationMs: input.durationMs,
		scope: { ...input.scope },
		modelKey: input.modelKey,
		inputTokens: input.inputTokens ?? 0,
		outputTokens: input.outputTokens ?? 0,
		totalTokens: input.totalTokens ?? 0,
		cacheReadInputTokens: input.cacheReadInputTokens ?? 0,
		cacheCreationInputTokens: input.cacheCreationInputTokens ?? 0,
		costCredits: null,
		capturePolicy: input.capturePolicy,
		persistenceStatus: "persisted",
		errorCode: input.errorCode ?? null,
		attributes: input.attributes ?? {},
		createdAt: input.createdAt,
	};
}

type DeliveryArtifact = {
	toolCallId: string;
	toolName: string;
	assetType: "image" | "video" | "audio";
	deliveryState: "materialized" | "accepted_async";
	nodeId: string | null;
	taskId: string | null;
	runId: string | null;
	clipIndex: number | null;
	assetUrl: string | null;
};

function readDeliveryArtifacts(value: unknown): DeliveryArtifact[] {
	const record = asRecord(value);
	const rawArtifacts = Array.isArray(record?.artifacts) ? record.artifacts : [];
	const artifacts: DeliveryArtifact[] = [];
	for (const raw of rawArtifacts.slice(0, 256)) {
		const artifact = asRecord(raw);
		const assetType = readString(artifact, "assetType");
		const deliveryState = readString(artifact, "deliveryState");
		if (
			(assetType !== "image" && assetType !== "video" && assetType !== "audio") ||
			(deliveryState !== "materialized" && deliveryState !== "accepted_async")
		) continue;
		artifacts.push({
			toolCallId: readString(artifact, "toolCallId") ?? "",
			toolName: readString(artifact, "toolName") ?? "tool",
			assetType,
			deliveryState,
			nodeId: readNullableString(artifact, "nodeId"),
			taskId: readNullableString(artifact, "taskId"),
			runId: readNullableString(artifact, "runId"),
			clipIndex: readInteger(artifact, "clipIndex"),
			assetUrl: readNullableString(artifact, "assetUrl"),
		});
	}
	return artifacts;
}

function evaluationFromDelivery(input: BuildAgentObservabilitySpansInput): AgentEvaluationResultV1 {
	const verification = asRecord(input.deliveryVerification);
	const applicable = verification?.applicable === true;
	const status = readString(verification, "status");
	const resultStatus: AgentEvaluationResultV1["status"] = !applicable
		? "not_applicable"
		: status === "satisfied"
			? "passed"
			: "failed";
	return {
		version: 1,
		id: deterministicEvaluationId(input.runtime.correlation.traceId, "delivery_contract", "1"),
		traceId: input.runtime.correlation.traceId,
		spanId: input.runtime.correlation.spanId,
		threadId: input.runtime.correlation.threadId,
		artifactId: null,
		evaluatorKey: "delivery_contract",
		evaluatorVersion: "1",
		source: "deterministic",
		target: "trace",
		status: resultStatus,
		score: resultStatus === "passed" ? 1 : resultStatus === "failed" ? 0 : null,
		value: status,
		rationale: status
			? `delivery_verification_${status}`
			: "delivery_verification_unreported",
		evidence: sanitizeAgentObservabilityRecord({
			expectedDelivery: input.expectedDelivery,
			deliveryEvidence: input.deliveryEvidence,
			deliveryVerification: input.deliveryVerification,
		}),
		createdAt: input.requestFinishedAt,
	};
}

export function buildAgentObservabilitySpans(
	input: BuildAgentObservabilitySpansInput,
): BuiltAgentObservability {
	const { runtime, traceContext } = input;
	const traceId = runtime.correlation.traceId;
	if (traceId !== traceContext.traceId) {
		throw new Error("agents runtime traceId does not match Hono request traceId");
	}
	if (runtime.correlation.parentSpanId !== traceContext.requestSpanId) {
		throw new Error("agents runtime parentSpanId does not match Hono request spanId");
	}
	const createdAt = input.requestFinishedAt;
	const requestStatus = terminalStatusToSpan(input.requestTerminal.status);
	const spans: AgentTraceSpanV1[] = [
		baseSpan({
			traceId,
			spanId: traceContext.requestSpanId,
			parentSpanId: traceContext.incomingParentSpanId,
			requestId: runtime.correlation.requestId,
			threadId: runtime.correlation.threadId,
			turnId: runtime.correlation.turnId,
			service: "hono-api",
			kind: "request",
			name: "agents_bridge.request",
			status: requestStatus,
			startedAt: traceContext.agentsInput.startedAt,
			finishedAt: input.requestFinishedAt,
			durationMs: durationBetween(traceContext.agentsInput.startedAt, input.requestFinishedAt),
			scope: input.scope,
			modelKey: input.modelKey,
			inputTokens: runtime.usage.inputTokens,
			outputTokens: runtime.usage.outputTokens,
			totalTokens: runtime.usage.totalTokens,
			cacheReadInputTokens: runtime.usage.cacheReadInputTokens,
			cacheCreationInputTokens: runtime.usage.cacheCreationInputTokens,
			capturePolicy: runtime.correlation.capturePolicy,
			errorCode: requestStatus === "failed" ? input.requestTerminal.reason : null,
			attributes: sanitizeAgentObservabilityRecord({
				requestTerminal: input.requestTerminal,
				turnVerdict: input.turnVerdict,
			}),
			createdAt,
		}),
		baseSpan({
			traceId,
			spanId: runtime.correlation.spanId,
			parentSpanId: traceContext.requestSpanId,
			requestId: runtime.correlation.requestId,
			threadId: runtime.correlation.threadId,
			turnId: runtime.correlation.turnId,
			service: "agents-cli",
			kind: "agent",
			name: "agents-cli.turn",
			status: requestStatus,
			startedAt: runtime.correlation.startedAt,
			finishedAt: runtime.finishedAt,
			durationMs: runtime.durationMs,
			scope: input.scope,
			modelKey: input.modelKey,
			inputTokens: runtime.usage.inputTokens,
			outputTokens: runtime.usage.outputTokens,
			totalTokens: runtime.usage.totalTokens,
			cacheReadInputTokens: runtime.usage.cacheReadInputTokens,
			cacheCreationInputTokens: runtime.usage.cacheCreationInputTokens,
			capturePolicy: runtime.correlation.capturePolicy,
			errorCode: requestStatus === "failed" ? input.requestTerminal.reason : null,
			attributes: sanitizeAgentObservabilityRecord({
				agentsRuntimeStatus: runtime.status,
				payloadCapture: runtime.payloadCapture,
				performanceSnapshot: input.performanceSnapshot ?? null,
				expectedDelivery: input.expectedDelivery,
				deliveryEvidence: input.deliveryEvidence,
				deliveryVerification: input.deliveryVerification,
				turnVerdict: input.turnVerdict,
				requestTerminal: input.requestTerminal,
			}),
			createdAt,
		}),
	];

	for (const llm of runtime.llmSpans) {
		spans.push(baseSpan({
			traceId,
			spanId: llm.spanId,
			parentSpanId: runtime.correlation.spanId,
			requestId: runtime.correlation.requestId,
			threadId: runtime.correlation.threadId,
			turnId: runtime.correlation.turnId,
			service: "vendor",
			kind: "llm",
			name: `llm.turn.${llm.turn}`,
			status: llm.status,
			startedAt: llm.startedAt,
			finishedAt: llm.finishedAt,
			durationMs: llm.durationMs,
			scope: input.scope,
			modelKey: input.modelKey,
			inputTokens: llm.usage.inputTokens,
			outputTokens: llm.usage.outputTokens,
			totalTokens: llm.usage.totalTokens,
			cacheReadInputTokens: llm.usage.cacheReadInputTokens,
			cacheCreationInputTokens: llm.usage.cacheCreationInputTokens,
			capturePolicy: runtime.correlation.capturePolicy,
			errorCode: llm.status === "failed" ? llm.stopReason ?? "llm_failed" : null,
			attributes: sanitizeAgentObservabilityRecord({
				turn: llm.turn,
				phase: llm.phase,
				stopReason: llm.stopReason,
				providerStopReason: llm.providerStopReason,
			}),
			createdAt,
		}));
	}

	const toolSpanIdByCallId = new Map<string, string>();
	const toolCallById = new Map<string, AgentObservabilityToolCall>();
	for (const [index, tool] of input.toolCalls.entries()) {
		const spanId = deterministicSpanId(traceId, `tool:${tool.toolCallId || index}`);
		if (tool.toolCallId) {
			toolSpanIdByCallId.set(tool.toolCallId, spanId);
			toolCallById.set(tool.toolCallId, tool);
		}
		const hasTiming = isIsoTimestamp(tool.startedAt) && isIsoTimestamp(tool.finishedAt);
		const status = toolStatusToSpan(tool.status);
		spans.push(baseSpan({
			traceId,
			spanId,
			parentSpanId: runtime.correlation.spanId,
			requestId: runtime.correlation.requestId,
			threadId: runtime.correlation.threadId,
			turnId: runtime.correlation.turnId,
			service: "tool",
			kind: toolSpanKind(tool),
			name: tool.name || "tool",
			status,
			startedAt: hasTiming ? tool.startedAt : runtime.correlation.startedAt,
			finishedAt: hasTiming ? tool.finishedAt : runtime.finishedAt,
			durationMs: hasTiming
				? tool.durationMs ?? durationBetween(tool.startedAt, tool.finishedAt)
				: null,
			scope: input.scope,
			modelKey: input.modelKey,
			capturePolicy: runtime.correlation.capturePolicy,
			errorCode: !hasTiming
				? "tool_timing_missing"
				: status === "failed" || status === "denied" || status === "blocked"
					? `tool_${status}`
					: null,
			attributes: sanitizeAgentObservabilityRecord({
				toolCallId: tool.toolCallId,
				seq: tool.seq,
				pathHint: tool.pathHint || null,
				outputChars: tool.outputChars,
				requestedAgentType: tool.requestedAgentType || null,
				...errorFingerprint(tool.errorMessage),
			}),
			createdAt,
		}));
	}

	const deliveryArtifacts = readDeliveryArtifacts(input.deliveryEvidence);
	const materializedAssetUrls = new Set(
		deliveryArtifacts.flatMap((artifact) =>
			artifact.deliveryState === "materialized" && artifact.assetUrl
				? [artifact.assetUrl]
				: [],
		),
	);
	for (const [index, artifact] of deliveryArtifacts.entries()) {
		const parentToolSpanId = toolSpanIdByCallId.get(artifact.toolCallId) ?? runtime.correlation.spanId;
		const toolCall = toolCallById.get(artifact.toolCallId);
		const hasToolTiming = Boolean(
			toolCall && isIsoTimestamp(toolCall.startedAt) && isIsoTimestamp(toolCall.finishedAt),
		);
		const isMaterialized = artifact.deliveryState === "materialized";
		const artifactStartedAt = hasToolTiming && toolCall
			? toolCall.startedAt
			: runtime.correlation.startedAt;
		const artifactFinishedAt = isMaterialized
			? hasToolTiming && toolCall
				? toolCall.finishedAt
				: runtime.finishedAt
			: null;
		const spanId = deterministicSpanId(
			traceId,
			`${artifact.deliveryState}:${artifact.toolCallId}:${artifact.taskId ?? artifact.runId ?? artifact.nodeId ?? index}`,
		);
		const artifactScope: AgentTraceScopeV1 = {
			...input.scope,
			nodeId: artifact.nodeId ?? input.scope.nodeId,
		};
		spans.push(baseSpan({
			traceId,
			spanId,
			parentSpanId: parentToolSpanId,
			requestId: runtime.correlation.requestId,
			threadId: runtime.correlation.threadId,
			turnId: runtime.correlation.turnId,
			service: "tool",
			kind: isMaterialized ? "asset_materialization" : "async_task",
			name: `${artifact.deliveryState}.${artifact.assetType}`,
			status: isMaterialized ? "succeeded" : "accepted_async",
			startedAt: artifactStartedAt,
			finishedAt: artifactFinishedAt,
			durationMs: isMaterialized && artifactFinishedAt
				? hasToolTiming && toolCall
					? toolCall.durationMs ?? durationBetween(toolCall.startedAt, toolCall.finishedAt)
					: durationBetween(artifactStartedAt, artifactFinishedAt)
				: null,
			scope: artifactScope,
			modelKey: input.modelKey,
			capturePolicy: runtime.correlation.capturePolicy,
			attributes: sanitizeAgentObservabilityRecord({
				...artifact,
				timingSource: hasToolTiming ? "tool_call" : "agents_runtime",
			}),
			createdAt,
		}));
	}

	for (const [index, asset] of input.assets.entries()) {
		if (materializedAssetUrls.has(asset.url)) continue;
		const spanId = deterministicSpanId(traceId, `response-asset:${asset.type}:${index}:${asset.url}`);
		spans.push(baseSpan({
			traceId,
			spanId,
			parentSpanId: runtime.correlation.spanId,
			requestId: runtime.correlation.requestId,
			threadId: runtime.correlation.threadId,
			turnId: runtime.correlation.turnId,
			service: "hono-api",
			kind: "asset_materialization",
			name: `response_asset.${asset.type}`,
			status: "succeeded",
			startedAt: runtime.finishedAt,
			finishedAt: input.requestFinishedAt,
			durationMs: durationBetween(runtime.finishedAt, input.requestFinishedAt),
			scope: input.scope,
			modelKey: input.modelKey,
			capturePolicy: runtime.correlation.capturePolicy,
			attributes: sanitizeAgentObservabilityRecord(asset),
			createdAt,
		}));
	}

	const verification = asRecord(input.deliveryVerification);
	const verificationStatus = readString(verification, "status");
	const verificationSpanId = deterministicSpanId(traceId, "delivery-verification");
	spans.push(baseSpan({
		traceId,
		spanId: verificationSpanId,
		parentSpanId: runtime.correlation.spanId,
		requestId: runtime.correlation.requestId,
		threadId: runtime.correlation.threadId,
		turnId: runtime.correlation.turnId,
		service: "hono-api",
		kind: "delivery_verification",
		name: "delivery.verification",
		status: verificationStatus === "failed" ? "failed" : "succeeded",
		startedAt: runtime.finishedAt,
		finishedAt: input.requestFinishedAt,
		durationMs: durationBetween(runtime.finishedAt, input.requestFinishedAt),
		scope: input.scope,
		modelKey: input.modelKey,
		capturePolicy: runtime.correlation.capturePolicy,
		errorCode: verificationStatus === "failed" ? readString(verification, "code") ?? "delivery_failed" : null,
		attributes: sanitizeAgentObservabilityRecord({
			expectedDelivery: input.expectedDelivery,
			deliveryEvidence: input.deliveryEvidence,
			deliveryVerification: input.deliveryVerification,
		}),
		createdAt,
	}));

	const evaluations = [evaluationFromDelivery(input)];
	for (const evaluation of evaluations) {
		const evaluationSpanId = deterministicSpanId(traceId, `evaluation:${evaluation.evaluatorKey}`);
		spans.push(baseSpan({
			traceId,
			spanId: evaluationSpanId,
			parentSpanId: verificationSpanId,
			requestId: runtime.correlation.requestId,
			threadId: runtime.correlation.threadId,
			turnId: runtime.correlation.turnId,
			service: evaluation.source === "agents_judge" ? "agents-cli" : "hono-api",
			kind: "evaluation",
			name: evaluation.evaluatorKey,
			status: evaluation.status === "failed" ? "failed" : "succeeded",
			startedAt: input.requestFinishedAt,
			finishedAt: input.requestFinishedAt,
			durationMs: 0,
			scope: input.scope,
			modelKey: input.modelKey,
			capturePolicy: runtime.correlation.capturePolicy,
			errorCode: evaluation.status === "failed" ? `${evaluation.evaluatorKey}_failed` : null,
			attributes: sanitizeAgentObservabilityRecord(evaluation),
			createdAt,
		}));
	}

	return { spans, evaluations };
}
