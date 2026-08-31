import { describe, expect, it } from "vitest";

import { buildStructuralExecutionTraceWriteRequest } from "./memory.execution-trace-sanitizer";

describe("buildStructuralExecutionTraceWriteRequest", () => {
	it("removes raw prompt, response, tool payload, credentials, and URL query data", () => {
		const result = buildStructuralExecutionTraceWriteRequest({
			scopeType: "project",
			scopeId: "project-1",
			taskId: "task-1",
			requestKind: "agents_bridge:chat",
			inputSummary: "prompt=private user prompt",
			decisionLog: ["baseUrl=https://agents.example/chat?token=private"],
			toolCalls: [{
				toolCallId: "call-1",
				toolName: "tapcanvas_call_tool",
				status: "succeeded",
				input: { prompt: "private tool prompt" },
				outputJson: {
					assetUrl: "https://cdn.example/image.png?token=private",
					message: "private tool output",
					authorization: "Bearer private",
				},
			}],
			meta: {
				assistantTextPreview: "private assistant answer",
				responseTrace: { output: { head: "private head", tail: "private tail" } },
			},
			resultSummary: "private completion summary",
			errorCode: "stable_error_code",
			errorDetail: "private provider failure",
		});

		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("private");
		expect(serialized).not.toContain("Bearer");
		expect(serialized).not.toContain("?token=");
		expect(result.scopeId).toBe("project-1");
		expect(result.taskId).toBe("task-1");
		expect(result.errorCode).toBe("stable_error_code");
		expect(result.toolCalls?.[0]).toEqual(expect.objectContaining({
			toolCallId: "call-1",
			toolName: "tapcanvas_call_tool",
			status: "succeeded",
		}));
	});

	it("keeps only scoped knowledge retrieval evidence for the execution graph", () => {
		const result = buildStructuralExecutionTraceWriteRequest({
			scopeType: "project",
			scopeId: "project-1",
			requestKind: "agents_bridge:chat",
			inputSummary: "private user request",
			toolCalls: [{
				toolCallId: "knowledge-call-1",
				toolName: "knowledge_search",
				status: "succeeded",
				input: { query: "private user request" },
				outputJson: {
					candidateSetId: "domain-set-1",
					retrievalSandbox: {
						protocolVersion: "retrieval-sandbox-receipt/v1",
						requestHash: "request-hash-1",
						candidateKind: "domain",
						queryViewIds: ["user_request", "context:input:canvas-facts"],
						availableCandidateCount: 12,
						returnedCandidateCount: 3,
						abstained: false,
						blocking: false,
						reason: "positive_ranked_candidates",
						bodyAccess: "candidate_set_required",
					},
					retrievalMode: "vector",
					diagnostics: {
						vectorCandidates: 3,
						vectorHits: 7,
						requestedQueryViews: 3,
						queryViews: 3,
						omittedQueryViews: 0,
						vectorSearches: 3,
						indexedCards: 281,
						availableCards: 281,
						embeddingModel: "text-embedding-v4",
					},
					results: [{
						id: "weapon-collision-frames",
						domain: "generation",
						title: "武器碰撞帧数约束",
						vectorRank: 2,
						sources: ["vector"],
						sourceUrls: ["https://docs.example.com/weapon-collision-frames"],
						bodyPreview: "不得持续超过 1 帧",
					}],
				},
			}],
		});
		const call = result.toolCalls?.[0];
		const evidence = call && typeof call.knowledgeEvidence === "object" && !Array.isArray(call.knowledgeEvidence)
			? call.knowledgeEvidence as Record<string, unknown>
			: null;
		expect(evidence).toEqual(expect.objectContaining({
			kind: "knowledge_search",
			candidateSetId: "domain-set-1",
			retrievalMode: "vector",
		}));
		expect(evidence).toEqual(expect.objectContaining({
			diagnostics: expect.objectContaining({
				vectorCandidates: 3,
				vectorHits: 7,
				requestedQueryViews: 3,
				queryViews: 3,
				omittedQueryViews: 0,
				vectorSearches: 3,
			}),
			retrievalSandbox: expect.objectContaining({
				protocolVersion: "retrieval-sandbox-receipt/v1",
				availableCandidateCount: 12,
				returnedCandidateCount: 3,
				blocking: false,
				bodyAccess: "candidate_set_required",
			}),
		}));
		const serialized = JSON.stringify(result);
		expect(serialized).toContain("武器碰撞帧数约束");
		expect(serialized).not.toContain("不得持续超过 1 帧");
		expect(serialized).not.toContain("private user request");
	});
});
