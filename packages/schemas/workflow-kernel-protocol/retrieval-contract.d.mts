export type WorkflowKnowledgeDiagnostics = Readonly<{
  vectorCandidates: number;
  indexedCards: number;
  availableCards: number;
  embeddingModel: string;
  /** database: cards looked up in Postgres by id, route or keyword; no embedding model involved. */
  mode?: "vector" | "database";
  vectorHits?: number;
  requestedQueryViews?: number;
  queryViews?: number;
  omittedQueryViews?: number;
  vectorSearches?: number;
  lexicalCandidates?: number;
  lexicalHits?: number;
  lexicalSearches?: number;
  lexicalSearchAvailable?: boolean;
  deduplicatedResults?: number;
  graphHits?: number;
  graphExcludedItems?: number;
  graphTruncated?: boolean;
  scopedBodyBytes?: number;
  searchBodyAccess?: "metadata_only";
  channels?: { vector: string; lexical: string; graph: string };
  failures?: { channel: string; queryId?: string; reason: string; blocking: false }[];
  phases?: { phase: string; durationMs: number; status: "succeeded" | "failed"; error?: string }[];
}>;
export function normalizeKnowledgeCandidateLimit(value: unknown): number;
export function parseWorkflowKnowledgeDiagnostics(value: unknown): WorkflowKnowledgeDiagnostics;
