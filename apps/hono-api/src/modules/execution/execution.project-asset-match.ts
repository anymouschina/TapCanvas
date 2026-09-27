import { createHash } from "node:crypto";
import type { SemanticRecallRequest, SemanticRecallResponse } from "../agents/semantic-recall.client";
import { isWorkflowProjectImageReady, type WorkflowProjectAssetSnapshot, type WorkflowProjectContext } from "./execution.project-context";

type Facts = Readonly<Record<string, unknown>>;
const read = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export type WorkflowProjectAssetMatchRequest = Readonly<{
  projectId: string;
  assetMetadata: Facts;
  prompt: string;
  styleFingerprint: string | null;
}>;
export type WorkflowProjectAssetMatchResult = Readonly<{
  assetId: string | null;
  assetVersionId: string | null;
  candidateCount: number;
  reason: "exact_identity_ranked" | "identity_unavailable" | "no_exact_identity";
  channels: SemanticRecallResponse["diagnostics"]["channels"] | null;
}>;

/** Grant this node's resolved match access to one freshly verified version only. */
export function scopeMatchedProjectImage(
  context: WorkflowProjectContext,
  candidate: WorkflowProjectAssetSnapshot,
  expectedVersionId: string,
): WorkflowProjectContext {
  if (candidate.projectId !== context.projectId || !candidate.assetId || !expectedVersionId
    || candidate.assetVersionId !== expectedVersionId || !isWorkflowProjectImageReady(candidate)) {
    throw new Error(`Matched project asset ${candidate.assetId} changed after memory recall`);
  }
  return { ...context,
    projectAssetIds: context.projectAssetIds.includes(candidate.assetId)
      ? context.projectAssetIds : [...context.projectAssetIds, candidate.assetId],
    assetSnapshot: [...context.assetSnapshot.filter(asset => asset.assetId !== candidate.assetId), candidate] };
}

/**
 * Stable authored identity determines eligibility. Palace ranks only eligible
 * frozen project assets; a semantic near-neighbour never grants reuse.
 */
export async function matchWorkflowProjectImage(
  request: WorkflowProjectAssetMatchRequest,
  assetCandidates: readonly WorkflowProjectAssetSnapshot[],
  recall: (input: SemanticRecallRequest) => Promise<SemanticRecallResponse>,
): Promise<WorkflowProjectAssetMatchResult> {
  const metadata = request.assetMetadata;
  const role = read(metadata.referenceType);
  const reuseKey = read(metadata.assetReuseKey);
  const physicalKey = role === "character" && read(metadata.characterAssetRole) === "identity_anchor"
    ? read(metadata.physicalIdentityKey) : "";
  if (!role || (!reuseKey && !physicalKey)) {
    return { assetId: null, assetVersionId: null, candidateCount: 0, reason: "identity_unavailable", channels: null };
  }
  const candidates = assetCandidates.filter(asset => {
    if (asset.projectId !== request.projectId
      || !isWorkflowProjectImageReady(asset) || !asset.assetVersionId || asset.referenceType !== role) return false;
    if (request.styleFingerprint && asset.styleFingerprint && asset.styleFingerprint !== request.styleFingerprint) return false;
    if (reuseKey && asset.sourceFacts.assetReuseKey === reuseKey) return true;
    return Boolean(physicalKey && asset.sourceFacts.physicalIdentityKey === physicalKey
      && asset.sourceFacts.characterAssetRole === "identity_anchor");
  });
  if (!candidates.length) return { assetId: null, assetVersionId: null, candidateCount: 0, reason: "no_exact_identity", channels: null };
  const scope = `workflow-project-image:${createHash("sha256").update(JSON.stringify([
    request.projectId, candidates.map(asset => [asset.assetId, asset.assetVersionId]),
  ])).digest("hex")}`;
  const result = await recall({ scope,
    query: JSON.stringify({ referenceType: role, displayName: metadata.displayName,
      canonicalName: metadata.canonicalName, physicalIdentityKey: physicalKey || null,
      prompt: request.prompt }),
    documents: candidates.map(asset => ({ id: asset.assetId, text: JSON.stringify({ name: asset.name,
      canonicalName: asset.canonicalName, referenceType: asset.referenceType,
      roleName: asset.sourceFacts.roleName, prompt: asset.sourceFacts.prompt,
      identityAnchors: asset.sourceFacts.identityAnchors }) })),
  });
  if (result.diagnostics.channels.vector !== "ready" || result.results.length === 0) {
    throw new Error(`workflow_project_asset_palace_rank_unavailable:${result.diagnostics.channels.vector}`);
  }
  const allowed = new Set(candidates.map(asset => asset.assetId));
  const winner = result.results[0];
  if (result.scope !== scope || !winner || !allowed.has(winner.id)) throw new Error("workflow_project_asset_palace_scope_mismatch");
  return { assetId: winner.id, assetVersionId: candidates.find(asset => asset.assetId === winner.id)?.assetVersionId ?? null,
    candidateCount: candidates.length,
    reason: "exact_identity_ranked", channels: result.diagnostics.channels };
}
