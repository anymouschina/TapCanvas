export type AtomicAuthorCriterionV1 = Readonly<{
  requirement: string;
  evidenceIds: readonly string[];
  assessment: "met" | "revision_required" | "diagnostic";
  rationale: string;
  revisionAction: string | null;
}>;
export type AtomicAuthorInferenceCallV1 = Readonly<{
  model: string;
  reasoningEffort: string | null;
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  usage?: Readonly<{ totalTokens: number; inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>;
  error?: string;
}>;
export type AtomicAuthorSelfCheckReceiptV1 = Readonly<{
  version: 1;
  status: "performed" | "not_performed";
  scopeHash: string;
  candidateHash: string;
  evidenceFingerprint: string;
  criteria: readonly AtomicAuthorCriterionV1[];
  reason?: string;
  execution: Readonly<{ model: string; reasoningEffort: string | null }>;
  inferenceCalls: readonly AtomicAuthorInferenceCallV1[];
}>;
export type AtomicAuthorSelfCheckProjectionIssueV1 = Readonly<{
  reason: "invalid_receipt" | "candidate_identity_mismatch" | "invalid_projection_issue";
  observedCandidateHash?: string;
  expectedCandidateHash?: string;
}>;
export type AtomicAuthorSelfCheckProjectionV1 = Readonly<{
  receipt: AtomicAuthorSelfCheckReceiptV1 | null;
  issue: AtomicAuthorSelfCheckProjectionIssueV1 | null;
}>;
export function projectAtomicAuthorSelfCheck(value: unknown, expectedCandidateHash?: string): AtomicAuthorSelfCheckProjectionV1;
export function normalizeAtomicAuthorSelfCheckProjectionIssue(value: unknown): AtomicAuthorSelfCheckProjectionIssueV1 | null;
export function projectAtomicAuthorSelfCheckMetadata(value: unknown, expectedCandidateHash?: string): Readonly<{
  atomicAuthorSelfCheck?: AtomicAuthorSelfCheckReceiptV1;
  atomicAuthorSelfCheckProjectionIssue?: AtomicAuthorSelfCheckProjectionIssueV1;
}>;
