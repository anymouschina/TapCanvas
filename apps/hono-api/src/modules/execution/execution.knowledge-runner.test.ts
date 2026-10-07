import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkflowKnowledge, searchWorkflowKnowledge } from "./execution.knowledge-runner";
import { parseInternalApiKey } from "../apiKey/internal-api-key";
import type { WorkerEnv } from "../../types";

afterEach(() => { vi.unstubAllGlobals(); });

describe("workflow knowledge bridge receipt", () => {
  it("keeps more than twelve candidates and source diagnostics through the shared parser", async () => {
    const diagnostics = {
      vectorCandidates: 0, indexedCards: 20, availableCards: 20, embeddingModel: "test-bge",
      channels: { vector: "failed", lexical: "ready", graph: "not_requested" },
      failures: [{ channel: "vector", reason: "embedding unavailable", blocking: false }],
      phases: [{ phase: "embedding", durationMs: 25, status: "failed", error: "embedding unavailable" }],
      vectorHits: 0, lexicalHits: 20, graphHits: 0, searchBodyAccess: "metadata_only", scopedBodyBytes: 500,
    };
    const receipt = {
      protocolVersion: "workflow.knowledge-candidates/v2", candidateSetId: "domain-eval", requestHash: "request-eval",
      createdAt: new Date().toISOString(), retrievalMode: "vector", abstained: false, diagnostics,
      candidates: Array.from({ length: 20 }, (_, index) => ({
        cardId: `card-${index}`, sourceRoot: "evaluation", domain: "domain", facet: null, title: `Card ${index}`,
        roleScope: [], contentSha256: "a".repeat(64), bodyBytes: 25, rank: index + 1,
        score: 1 / (index + 60), vectorScore: 0, vectorRank: Number.MAX_SAFE_INTEGER, matchedQueryIds: ["agent_query"],
      })),
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(receipt), { status: 200 })));
    const result = await searchWorkflowKnowledge({ AGENTS_BRIDGE_BASE_URL: "http://bridge", TAPCANVAS_API_INTERNAL_BASE: "http://api:8788", INTERNAL_WORKER_TOKEN: "test-worker" } as WorkerEnv, {
      ownerId: "actor", rawUserRequest: "task", query: "query", roleScope: null, domain: null, strictFilters: false,
      limit: Number.MAX_SAFE_INTEGER,
    });
    expect(result.candidates).toHaveLength(20);
    expect(result.diagnostics).toEqual(diagnostics);
    expect(result.candidates.every((candidate) => !("body" in candidate))).toBe(true);
  });
});


it("forwards the current execution identity on reads and preserves scope rejection", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { ownerId: string; cardId: string; callerMeta: { userId: string; palaceMemoryBinding: { actorUserId: string }; remoteToolConfig: { apiKey: string } } };
    expect(body.ownerId).toBe("current-execution-owner");
    expect(body.cardId).toBe("private-card");
    expect(body).not.toHaveProperty("callerMeta");
    return new Response(JSON.stringify({ message: "workflow_knowledge_candidate_out_of_scope" }), { status: 400 });
  });
  vi.stubGlobal("fetch", fetch);
  await expect(readWorkflowKnowledge({ AGENTS_BRIDGE_BASE_URL: "http://bridge", TAPCANVAS_API_INTERNAL_BASE: "http://api:8788", INTERNAL_WORKER_TOKEN: "test-worker" } as WorkerEnv, {
    ownerId: "current-execution-owner", cardId: "private-card",
    candidateSet: {
      protocolVersion: "workflow.knowledge-candidates/v2", candidateSetId: "receipt", requestHash: "request",
      createdAt: "2026-09-22T00:00:00Z", retrievalMode: "vector", abstained: true,
      diagnostics: { vectorCandidates: 0, indexedCards: 0, availableCards: 0, embeddingModel: "test" }, candidates: [],
    },
  })).rejects.toThrow("workflow_knowledge_candidate_out_of_scope");
  expect(fetch).toHaveBeenCalledTimes(1);
});
