export type AuthorSourceJsonValue = null | boolean | number | string | readonly AuthorSourceJsonValue[]
  | { readonly [key: string]: AuthorSourceJsonValue };
export type AuthorSourceIdentityV1 = Readonly<{
  ownerId: string; flowId: string; flowVersionId: string; sourceExecutionId: string;
  rootNodeId: string; rootNodeRunId: string; leafNodeId: string; taskId: string; sessionId: string; turnId: string;
}>;
export const AUTHOR_SOURCE_REPRESENTATION: "harness_accepted_pre_host_compilation_candidate";
export type HarnessAcceptedAuthorSourceV1 = Readonly<{
  version: 1; representation: typeof AUTHOR_SOURCE_REPRESENTATION;
  identity: Readonly<{ taskId: string; sessionId: string; turnId: string }>;
  acceptance: Readonly<{ kind: "harness_accepted_candidate"; receiptRef: string; candidateHash: string; authorContractHash: string }>;
  candidate: string; candidateHash: string;
  authorContract: Readonly<{ ref: string; value: Readonly<Record<string, AuthorSourceJsonValue>>; hash: string }>;
  sourceContext: Readonly<{ value: string; hash: string }>;
}>;
export function normalizeHarnessAcceptedAuthorSource(value: unknown): HarnessAcceptedAuthorSourceV1 | null;
export type ServerAuthorSourceRepresentationV1 = Readonly<{
  version: 1; representation: typeof AUTHOR_SOURCE_REPRESENTATION; identity: AuthorSourceIdentityV1;
  acceptance: Readonly<{ kind: "harness_accepted_candidate"; receiptRef: string; candidateHash: string; authorContractHash: string }>;
  candidate: string; candidateHash: string;
  authorContract: Readonly<{ ref: string; value: Readonly<Record<string, AuthorSourceJsonValue>>; hash: string }>;
  frozenInputs: Readonly<{ ref: string; hash: string }>;
  conversion: Readonly<{ steps: readonly Readonly<{
    converterId: string; converterVersion: string; inputHash: string; outputHash: string; frozenInputHash: string; frozenInputRef: string;
  }>[]; deliveryHash: string }>;
}>;
export type ServerAuthorSourceExpectationsV1 = Readonly<{
  identity: AuthorSourceIdentityV1; acceptanceRef: string; candidateHash: string;
  authorContract: Readonly<{ ref: string; value: Readonly<Record<string, AuthorSourceJsonValue>> }>;
  frozenInputs: Readonly<{ ref: string; value: AuthorSourceJsonValue }>;
  converters: readonly Readonly<{ id: string; version: string }>[];
}>;
export type AuthorSourceRevisionAttemptV1 = Readonly<{
  executionId: string; targetNodeId: string; idempotencyKey: string; requestHash: string;
}>;
export type AuthorSourceAttemptBindingV1 = Readonly<{
  version: 1; executionId: string; targetNodeId: string; idempotencyKey: string; requestHash: string;
  sourceEvidenceHash: string; sourceIdentity: AuthorSourceIdentityV1; candidateHash: string; deliveryHash: string; bindingHash: string;
}>;
export type AuthorSourceRepresentationVerification =
  | Readonly<{ status: "verified"; source: ServerAuthorSourceRepresentationV1; sourceEvidenceHash: string; attemptBinding: AuthorSourceAttemptBindingV1 }>
  | Readonly<{ status: "current_action_not_applied"; diagnostic: Readonly<{ code: string; path: string; currentActionApplied: false }> }>;
export function authorSourceTextHash(value: string): string;
export function authorSourceJsonHash(value: unknown): string;
/** Only server-resolved facts are authorized inputs. This function is not an authentication boundary. */
export function verifyServerAuthorSourceRepresentation(input: Readonly<{
  serverRecord: unknown; expected: ServerAuthorSourceExpectationsV1;
  actualForwardOutputs: readonly string[]; savedDelivery: string; attempt: AuthorSourceRevisionAttemptV1;
}>): AuthorSourceRepresentationVerification;

export type VerifiedAuthorSourceEvidenceV1 = Readonly<{
  source: ServerAuthorSourceRepresentationV1; sourceEvidenceHash: string; attemptBinding: AuthorSourceAttemptBindingV1;
}>;
/** Structural transport validation only; owner-authorized lookup is the server's boundary. */
export function normalizeVerifiedAuthorSourceEvidence(value: unknown): VerifiedAuthorSourceEvidenceV1 | null;
