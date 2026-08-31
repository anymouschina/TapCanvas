import {
	sanitizeAgentObservabilityRecord,
	sanitizeAgentObservabilityValue,
} from "../agents/agent-observability.sanitizer";
import type { ExecutionTraceWriteRequest } from "./memory.schemas";

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readString(record: Record<string, unknown> | null, key: string): string {
	const value = record?.[key];
	return typeof value === "string" ? value.trim() : "";
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
	const value = record?.[key];
	return typeof value === "boolean" ? value : null;
}

function readStringArray(record: Record<string, unknown> | null, key: string): string[] {
	const value = record?.[key];
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim())
		.slice(0, 16);
}

function readRecords(record: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
	const value = record?.[key];
	if (!Array.isArray(value)) return [];
	return value
		.map(readRecord)
		.filter((item): item is Record<string, unknown> => Boolean(item))
		.slice(0, 64);
}

function readSourceUrls(record: Record<string, unknown> | null): unknown[] {
	const value = record?.sourceUrls;
	if (!Array.isArray(value)) return [];
	return value.slice(0, 16).map((item) => sanitizeAgentObservabilityRecord({ sourceUrl: item }).sourceUrl);
}

function readBodyChars(record: Record<string, unknown> | null): number | null {
	const body = record?.body;
	if (typeof body === "string") return body.length;
	const bodyRecord = readRecord(body);
	const chars = bodyRecord?.chars;
	return typeof chars === "number" && Number.isFinite(chars) && chars >= 0
		? Math.trunc(chars)
		: null;
}

function buildRetrievalSandboxEvidence(output: Record<string, unknown>): Record<string, unknown> | null {
	const receipt = readRecord(output.retrievalSandbox);
	if (readString(receipt, "protocolVersion") !== "retrieval-sandbox-receipt/v1") return null;
	return {
		protocolVersion: "retrieval-sandbox-receipt/v1",
		...(readString(receipt, "requestHash") ? { requestHash: readString(receipt, "requestHash") } : {}),
		...(readString(receipt, "candidateKind") ? { candidateKind: readString(receipt, "candidateKind") } : {}),
		...(readStringArray(receipt, "queryViewIds").length > 0
			? { queryViewIds: readStringArray(receipt, "queryViewIds") }
			: {}),
		...(readNumber(receipt, "availableCandidateCount") !== null
			? { availableCandidateCount: readNumber(receipt, "availableCandidateCount") }
			: {}),
		...(readNumber(receipt, "returnedCandidateCount") !== null
			? { returnedCandidateCount: readNumber(receipt, "returnedCandidateCount") }
			: {}),
		...(readBoolean(receipt, "abstained") !== null ? { abstained: readBoolean(receipt, "abstained") } : {}),
		...(readBoolean(receipt, "blocking") !== null ? { blocking: readBoolean(receipt, "blocking") } : {}),
		...(readString(receipt, "reason") ? { reason: readString(receipt, "reason") } : {}),
		...(readString(receipt, "bodyAccess") ? { bodyAccess: readString(receipt, "bodyAccess") } : {}),
	};
}

function buildKnowledgeSearchEvidence(output: Record<string, unknown>): Record<string, unknown> {
	const diagnostics = readRecord(output.diagnostics);
	const retrievalSandbox = buildRetrievalSandboxEvidence(output);
	const results = readRecords(output, "results").map((candidate) => ({
		...(readString(candidate, "id") ? { id: readString(candidate, "id") } : {}),
		...(readString(candidate, "domain") ? { domain: readString(candidate, "domain") } : {}),
		...(readString(candidate, "facet") ? { facet: readString(candidate, "facet") } : {}),
		...(readString(candidate, "title") ? { title: readString(candidate, "title") } : {}),
		...(readNumber(candidate, "score") !== null ? { score: readNumber(candidate, "score") } : {}),
		...(readNumber(candidate, "vectorScore") !== null ? { vectorScore: readNumber(candidate, "vectorScore") } : {}),
		...(readNumber(candidate, "vectorRank") !== null ? { vectorRank: readNumber(candidate, "vectorRank") } : {}),
		...(readStringArray(candidate, "sources").length > 0 ? { sources: readStringArray(candidate, "sources") } : {}),
		...(readStringArray(candidate, "matchedQueryIds").length > 0 ? { matchedQueryIds: readStringArray(candidate, "matchedQueryIds") } : {}),
		...(readSourceUrls(candidate).length > 0 ? { sourceUrls: readSourceUrls(candidate) } : {}),
	}));
	const safeDiagnostics = {
		...(readNumber(diagnostics, "vectorCandidates") !== null ? { vectorCandidates: readNumber(diagnostics, "vectorCandidates") } : {}),
		...(readNumber(diagnostics, "vectorHits") !== null ? { vectorHits: readNumber(diagnostics, "vectorHits") } : {}),
		...(readNumber(diagnostics, "requestedQueryViews") !== null ? { requestedQueryViews: readNumber(diagnostics, "requestedQueryViews") } : {}),
		...(readNumber(diagnostics, "queryViews") !== null ? { queryViews: readNumber(diagnostics, "queryViews") } : {}),
		...(readNumber(diagnostics, "omittedQueryViews") !== null ? { omittedQueryViews: readNumber(diagnostics, "omittedQueryViews") } : {}),
		...(readNumber(diagnostics, "vectorSearches") !== null ? { vectorSearches: readNumber(diagnostics, "vectorSearches") } : {}),
		...(readNumber(diagnostics, "indexedCards") !== null ? { indexedCards: readNumber(diagnostics, "indexedCards") } : {}),
		...(readNumber(diagnostics, "availableCards") !== null ? { availableCards: readNumber(diagnostics, "availableCards") } : {}),
		...(readString(diagnostics, "embeddingModel") ? { embeddingModel: readString(diagnostics, "embeddingModel") } : {}),
	};
	return {
		kind: "knowledge_search",
		...(readString(output, "candidateSetId") ? { candidateSetId: readString(output, "candidateSetId") } : {}),
		...(readString(output, "retrievalMode") ? { retrievalMode: readString(output, "retrievalMode") } : {}),
		...(readNumber(output, "count") !== null ? { count: readNumber(output, "count") } : {}),
		...(readBoolean(output, "abstained") !== null ? { abstained: readBoolean(output, "abstained") } : {}),
		...(readString(output, "reason") ? { reason: readString(output, "reason") } : {}),
		...(retrievalSandbox ? { retrievalSandbox } : {}),
		diagnostics: safeDiagnostics,
		results,
	};
}

function buildKnowledgeReadEvidence(
	input: Record<string, unknown> | null,
	output: Record<string, unknown>,
): Record<string, unknown> {
	return {
		kind: "knowledge_read",
		...(readString(input, "candidateSetId") ? { candidateSetId: readString(input, "candidateSetId") } : {}),
		...(readString(output, "id") ? { id: readString(output, "id") } : {}),
		...(readString(output, "domain") ? { domain: readString(output, "domain") } : {}),
		...(readString(output, "facet") ? { facet: readString(output, "facet") } : {}),
		...(readString(output, "title") ? { title: readString(output, "title") } : {}),
		...(readSourceUrls(output).length > 0 ? { sourceUrls: readSourceUrls(output) } : {}),
		...(readBodyChars(output) !== null ? { bodyChars: readBodyChars(output) } : {}),
	};
}

function buildKnowledgeEvidence(toolCall: Record<string, unknown>): Record<string, unknown> | null {
	const name = readString(toolCall, "toolName") || readString(toolCall, "name");
	const output = readRecord(toolCall.outputJson);
	if (!output) return null;
	if (name === "knowledge_search") return buildKnowledgeSearchEvidence(output);
	if (name === "knowledge_read") {
		const input = readRecord(toolCall.input) ?? readRecord(toolCall.inputJson) ?? readRecord(toolCall.args);
		return buildKnowledgeReadEvidence(input, output);
	}
	return null;
}

function serializeStructuralAuditText(value: string): string {
	return JSON.stringify(sanitizeAgentObservabilityValue(value));
}

export function buildStructuralExecutionTraceWriteRequest(
	input: ExecutionTraceWriteRequest,
): ExecutionTraceWriteRequest {
	return {
		scopeType: input.scopeType,
		scopeId: input.scopeId,
		...(input.taskId ? { taskId: input.taskId } : {}),
		requestKind: input.requestKind,
		inputSummary: serializeStructuralAuditText(input.inputSummary),
		...(input.decisionLog
			? { decisionLog: input.decisionLog.map(serializeStructuralAuditText) }
			: {}),
		...(input.toolCalls
			? {
				toolCalls: input.toolCalls.map((toolCall) => {
					const sanitized = sanitizeAgentObservabilityRecord(toolCall);
					const knowledgeEvidence = buildKnowledgeEvidence(toolCall);
					return knowledgeEvidence ? { ...sanitized, knowledgeEvidence } : sanitized;
				}),
			}
			: {}),
		...(input.meta ? { meta: sanitizeAgentObservabilityRecord(input.meta) } : {}),
		...(typeof input.resultSummary === "string"
			? { resultSummary: serializeStructuralAuditText(input.resultSummary) }
			: {}),
		...(input.errorCode ? { errorCode: input.errorCode } : {}),
		...(typeof input.errorDetail === "string"
			? { errorDetail: serializeStructuralAuditText(input.errorDetail) }
			: {}),
	};
}
