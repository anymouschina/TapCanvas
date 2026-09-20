import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import { projectWorkflowProvenanceForPrompt } from "./execution.prompt-provenance";

describe("workflow prompt provenance projection", () => {
  it("references a historical model response without copying it into downstream prompts", () => {
    const rationale = JSON.stringify({ beats: [{ sourceText: "full chapter".repeat(12000) }] });
    const provenance = [{ executionId: "previous-run", loadedKnowledgeSources: [{ id: "source-1" }],
      retrievalDecisions: [{ version: 1, blocking: false, rationale,
        status: "no_body_read_requested", toolNames: [], toolCallIds: [], at: "2026-09-20" }] }];
    const original = structuredClone(provenance);
    const result = projectWorkflowProvenanceForPrompt(provenance);
    expect(result).toEqual([{ executionId: "previous-run", loadedKnowledgeSources: [{ id: "source-1" }],
      retrievalDecisions: [{ version: 1, blocking: false, status: "no_body_read_requested",
        toolNames: [], toolCallIds: [], at: "2026-09-20", rationaleReceipt: {
          source: "persisted_execution_provenance", characters: rationale.length, sha256: sha256Hex(rationale),
        } }] }]);
    expect(provenance).toEqual(original);
    expect(JSON.stringify(result).length).toBeLessThan(1000);
  });
  it("preserves source identities and actual tool-read receipts", () => {
    const result = projectWorkflowProvenanceForPrompt({ retrievalDecisions: [{ version: 1, blocking: false,
      rationale: "Read the selected source", toolNames: ["knowledge_read"], toolCallIds: ["read-1"], status: "tool_actions_requested" }],
      loadedKnowledgeSources: [{ id: "source-1", contentHash: "hash-1" }] });
    expect(result).toMatchObject({ loadedKnowledgeSources: [{ id: "source-1", contentHash: "hash-1" }],
      retrievalDecisions: [{ toolNames: ["knowledge_read"], toolCallIds: ["read-1"], status: "tool_actions_requested" }] });
  });
  it("does not interpret arbitrary rationale or creative content fields", () => {
    const facts = { rationale: "actual creative rationale", text: "actual source", retrievalDecisions: [{ rationale: "untyped" }] };
    expect(projectWorkflowProvenanceForPrompt(facts)).toEqual(facts);
  });
});
