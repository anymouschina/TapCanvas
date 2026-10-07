import type { ServerAuthorSourceRepresentationV1, AuthorSourceAttemptBindingV1 } from "../author-source-representation/index.mjs" with { "resolution-mode": "import" };

export type AuthorRevisionEvidenceV1 = Readonly<{
  version: 1;
  sourceKind: "delivery_artifact";
  sourceExecutionId: string;
  sourceNodeRunId: string;
  targetNodeId: string;
  deliveryHash: string;
  deliveryArtifact: string;
  diagnostic: string;
  editablePaths?: readonly string[];
  authorSource?: Readonly<{
    source: ServerAuthorSourceRepresentationV1;
    sourceEvidenceHash: string;
    attemptBinding: AuthorSourceAttemptBindingV1;
  }>;
}>;
export function normalizeAuthorRevisionEditablePaths(value: unknown): readonly string[] | undefined;
export function normalizeAuthorRevisionEvidence(value: unknown): AuthorRevisionEvidenceV1 | null;
export function renderAuthorRevisionEvidence(value: unknown): string | null;
export function resolveAuthorRevisionEvidence(supplied: unknown, persisted: unknown): AuthorRevisionEvidenceV1 | null;
export class AuthorRevisionEvidenceError extends Error {}
