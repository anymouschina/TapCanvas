import type { AppContext } from "../../types";
import { loadImageUnderstandingEvidence } from "../task/image-understanding-evidence";
import { isWorkflowProjectImageReady, type WorkflowProjectContext } from "./execution.project-context";
import type { WorkflowAssetResolver } from "./execution.asset-resolver";

/** Append source evidence without changing the frozen selection, asset identity,
 * user intent or canvas. Retries of an existing execution use the same cutoff.
 * Evidence lookup never submits a paid media task or vetoes authoring.
 */
export async function enrichWorkflowMediaUnderstanding(input: {
  c: AppContext;
  ownerId: string;
  context: WorkflowProjectContext;
  resolver: WorkflowAssetResolver;
}): Promise<WorkflowProjectContext> {
  const visible = new Set(input.context.projectAssetIds);
  const inspected = new Set([
    ...(input.context.mediaUnderstanding ?? []).map((item) => item.referenceId),
    ...(input.context.mediaUnderstandingDiagnostics ?? []).map((item) => item.referenceId),
  ]);
  const assets = input.context.assetSnapshot.filter((asset) => asset.projectId === input.context.projectId
    && visible.has(asset.assetId) && isWorkflowProjectImageReady(asset) && !inspected.has(asset.assetId));
  if (assets.length === 0 && input.context.mediaUnderstanding !== undefined) return input.context;
  const diagnostics = [...(input.context.mediaUnderstandingDiagnostics ?? [])];
  try {
    const resolver = input.resolver;
    const references: { referenceId: string; url: string }[] = [];
    for (const asset of assets) {
      try {
        const resolved = await resolver.resolveAssetResource(asset.assetId, "image");
        references.push({ referenceId: asset.assetId, url: resolved.url });
      } catch (error: unknown) {
        diagnostics.push({ referenceId: asset.assetId,
          code: error instanceof Error && "code" in error ? String(error.code) : "media_reference_resolution_failed" });
      }
    }
    const mediaUnderstanding = [...(input.context.mediaUnderstanding ?? []),
      ...await loadImageUnderstandingEvidence({ db: input.c.env.DB,
        ownerId: input.ownerId, references, before: input.context.capturedAt })];
    for (const reference of references) {
      if (!mediaUnderstanding.some((item) => item.referenceId === reference.referenceId)) {
        diagnostics.push({ referenceId: reference.referenceId, code: "no_successful_analysis_receipt" });
      }
    }
    console.info(JSON.stringify({ event: "workflow_media_understanding", projectId: input.context.projectId,
      candidateCount: assets.length, selectedCount: input.context.selectedAssetIds.length,
      evidenceCount: mediaUnderstanding.length, diagnostics }));
    return { ...input.context, mediaUnderstanding, mediaUnderstandingDiagnostics: diagnostics };
  } catch (error: unknown) {
    diagnostics.push({ referenceId: null, code: "analysis_receipt_lookup_failed" });
    console.error(JSON.stringify({ event: "workflow_media_understanding", projectId: input.context.projectId,
      diagnostics, error: error instanceof Error ? error.name : "unknown" }));
    return { ...input.context, mediaUnderstandingDiagnostics: diagnostics };
  }
}
