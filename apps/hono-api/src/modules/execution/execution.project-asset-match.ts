import { createHash } from "node:crypto";
import type { SemanticRecallRequest, SemanticRecallResponse } from "../agents/semantic-recall.client";
import { isWorkflowProjectImageReady, type WorkflowProjectAssetSnapshot, type WorkflowProjectContext } from "./execution.project-context";

type Facts = Readonly<Record<string, unknown>>;
const read = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export type WorkflowProjectAssetMatchRequest = Readonly<{
  projectId: string;
  executionFamilyId?: string;
  assetMetadata: Facts;
  prompt: string;
  styleFingerprint: string | null;
}>;
export type WorkflowProjectAssetMatchResult = Readonly<{
  assetId: string | null;
  assetVersionId: string | null;
  /** Media/identity fingerprint of the matched version; survives canvas-revision-only bumps. */
  assetContentFingerprint?: string | null;
  candidateCount: number;
  reason: "exact_identity_ranked" | "identity_unavailable" | "no_exact_identity";
  diagnostics: SemanticRecallResponse["diagnostics"] | null;
}>;

/**
 * Grant this node's resolved match access to one freshly verified version only.
 * A canvas node's version id is the whole chapter canvas revision, so any
 * concurrent node write (e.g. sibling Clips persisting) bumps it. For project
 * nodes the matched media and identity, not the canvas revision, must hold.
 */
export function scopeMatchedProjectImage(
  context: WorkflowProjectContext,
  candidate: WorkflowProjectAssetSnapshot,
  expectedVersionId: string,
  expectedContentFingerprint?: string | null,
): WorkflowProjectContext {
  const sameVersion = Boolean(expectedVersionId) && candidate.assetVersionId === expectedVersionId;
  const sameProjectNodeContent = candidate.origin === "project_node" && Boolean(expectedContentFingerprint)
    && candidate.contentFingerprint === expectedContentFingerprint;
  if (candidate.projectId !== context.projectId || !candidate.assetId
    || !(sameVersion || sameProjectNodeContent) || !isWorkflowProjectImageReady(candidate)) {
    throw new Error(`Matched project asset ${candidate.assetId} changed after memory recall`);
  }
  return { ...context,
    projectAssetIds: context.projectAssetIds.includes(candidate.assetId)
      ? context.projectAssetIds : [...context.projectAssetIds, candidate.assetId],
    assetSnapshot: [...context.assetSnapshot.filter(asset => asset.assetId !== candidate.assetId), candidate] };
}

/**
 * Stable authored identity determines eligibility. The Agent ranks only eligible
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
    return { assetId: null, assetVersionId: null, candidateCount: 0, reason: "identity_unavailable", diagnostics: null };
  }
  const candidates = assetCandidates.filter(asset => {
    // A media effect produced by this execution family is claimed by its stable
    // effect identity. Recalling it as a project asset races its own canvas
    // projection/version update and loses the exact per-item output receipt.
    if (request.executionFamilyId && asset.assetId.includes(`::family::${request.executionFamilyId}::output::`)) return false;
    if (asset.projectId !== request.projectId
      || !isWorkflowProjectImageReady(asset) || !asset.assetVersionId || asset.referenceType !== role) return false;
    if (request.styleFingerprint && asset.styleFingerprint && asset.styleFingerprint !== request.styleFingerprint) return false;
    if (reuseKey && asset.sourceFacts.assetReuseKey === reuseKey) return true;
    return Boolean(physicalKey && asset.sourceFacts.physicalIdentityKey === physicalKey
      && asset.sourceFacts.characterAssetRole === "identity_anchor");
  });
  if (!candidates.length) return { assetId: null, assetVersionId: null, candidateCount: 0, reason: "no_exact_identity", diagnostics: null };
  const scope = `workflow-project-image:${createHash("sha256").update(JSON.stringify([
    request.projectId, candidates.map(asset => [asset.assetId, asset.assetVersionId]),
  ])).digest("hex")}`;
  const result = await recall({ scope, limit: 1,
    query: JSON.stringify({ referenceType: role, displayName: metadata.displayName,
      canonicalName: metadata.canonicalName, physicalIdentityKey: physicalKey || null,
      prompt: request.prompt }),
    documents: candidates.map(asset => ({ id: asset.assetId, text: JSON.stringify({ name: asset.name,
      canonicalName: asset.canonicalName, referenceType: asset.referenceType,
      roleName: asset.sourceFacts.roleName, prompt: asset.sourceFacts.prompt,
      identityAnchors: asset.sourceFacts.identityAnchors }) })),
  });
  if (result.results.length === 0) throw new Error("workflow_project_asset_agent_rank_unavailable");
  const allowed = new Set(candidates.map(asset => asset.assetId));
  const winner = result.results[0];
  if (result.scope !== scope || !winner || !allowed.has(winner.id)) throw new Error("workflow_project_asset_agent_scope_mismatch");
  const matched = candidates.find(asset => asset.assetId === winner.id);
  return { assetId: winner.id, assetVersionId: matched?.assetVersionId ?? null,
    assetContentFingerprint: matched?.contentFingerprint ?? null,
    candidateCount: candidates.length,
    reason: "exact_identity_ranked", diagnostics: result.diagnostics };
}
