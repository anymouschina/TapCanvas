import { describe, expect, it } from "vitest";
import { AgentNodeReadSchema } from "./execution.agent-history";
import { collectWorkflowCandidateProjections, projectWorkflowCandidateInput } from "./execution.retrieval-input-projection";

describe("workflow candidate input references", () => {
  it("retains the whole artifact while giving a valid exact input reader path", () => {
    const artifact = {
      protocolVersion: "workflow.knowledge-candidates/v2", candidateSetId: "set", requestHash: "request",
      createdAt: "2026-09-22T00:00:00.000Z", retrievalMode: "vector", abstained: false,
      diagnostics: { vectorCandidates: 2316, indexedCards: 2316, availableCards: 2316, embeddingModel: "bge-m3", channels: { vector: "ready", lexical: "no_hits", graph: "not_requested" } },
      candidates: Array.from({ length: 2316 }, (_, i) => ({ cardId: `card-${i}`, sourceRoot: "scope", domain: "dialogue", facet: null,
        title: `PRIVATE-CANDIDATE-${i}`, roleScope: [], contentSha256: "a".repeat(64), bodyBytes: 100,
        rank: i + 1, score: 0.01, vectorScore: 0.5, vectorRank: i + 1, matchedQueryIds: ["agent_query"] })),
    };
    const before = JSON.stringify(artifact);
    const input = { "knowledge-candidates": [{ nested: artifact }] };
    const result = projectWorkflowCandidateInput(artifact, { executionId: "run", nodeId: "writer", revision: "source-revision", path: ["knowledge-candidates", "0", "nested"] }) as {
      candidateCount: number; contentRead: { args: unknown }; diagnostics: unknown;
    };
    expect(result.candidateCount).toBe(2316);
    expect(result.diagnostics).toEqual(artifact.diagnostics);
    const reader = AgentNodeReadSchema.parse(result.contentRead.args);
    expect(reader).toMatchObject({ executionId: "run", nodeId: "writer", field: "input", view: "content" });
    let selected: unknown = input;
    for (const key of reader.path) selected = (selected as Record<string, unknown>)[key];
    expect(selected).toBe(artifact.candidates);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-CANDIDATE");
    expect(JSON.stringify(result).length).toBeLessThan(1500);
    expect(JSON.stringify(artifact)).toBe(before);
    const { projections, unreferencedCandidateSets } = collectWorkflowCandidateProjections(input, { executionId: "run", persistedInputSource: { nodeId: "writer", revision: "source-revision", inputs: input } });
    expect(unreferencedCandidateSets).toBe(0);
    expect(projections).toHaveLength(1);
    expect(projections[0]).toEqual({ source: before, reference: JSON.stringify(result), requiredTool: "tapcanvas_execution_node_runs_get" });
    const sliced = { chosen: [artifact] };
    const grouped = { input: [{ items: [{ value: artifact }] }] };
    const fromParent = collectWorkflowCandidateProjections(sliced, { executionId: "run", persistedInputSource: { nodeId: "parent", revision: "parent-revision", inputs: grouped } });
    expect(JSON.parse(fromParent.projections[0]!.reference).contentRead.args).toMatchObject({ nodeId: "parent", revision: "parent-revision", path: ["input", "0", "items", "0", "value", "candidates"] });
    expect(fromParent.unreferencedCandidateSets).toBe(0);
    expect(collectWorkflowCandidateProjections(sliced, { executionId: "run" })).toEqual({ projections: [], unreferencedCandidateSets: 1 });
    expect(collectWorkflowCandidateProjections({ chosen: [{ ...artifact, candidateSetId: "changed" }] }, { executionId: "run", persistedInputSource: { nodeId: "parent", revision: "parent-revision", inputs: grouped } })).toEqual({ projections: [], unreferencedCandidateSets: 1 });
  });
  it("leaves authored source facts outside the candidate protocol unchanged", () => {
    expect(projectWorkflowCandidateInput({ text: "真实剧情", candidates: ["a"] }, { executionId: "run", nodeId: "writer", path: ["source", "0"] })).toBeNull();
  });
});
