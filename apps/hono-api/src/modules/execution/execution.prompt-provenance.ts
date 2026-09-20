import { sha256Hex } from "../asset/book-content-hash";

/** Project audit metadata for a model without replaying past model responses. */
export function projectWorkflowProvenanceForPrompt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectWorkflowProvenanceForPrompt);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => {
    if (key !== "retrievalDecisions" || !Array.isArray(child)) return [key, child];
    return [key, child.map(decision => {
      if (!decision || typeof decision !== "object" || Array.isArray(decision)) return decision;
      const entry = decision as Record<string, unknown>;
      if (entry.version !== 1 || entry.blocking !== false || typeof entry.rationale !== "string") return decision;
      const { rationale, ...facts } = entry;
      return { ...facts, rationaleReceipt: {
        source: "persisted_execution_provenance",
        characters: rationale.length,
        sha256: sha256Hex(rationale),
      } };
    })];
  }));
}
