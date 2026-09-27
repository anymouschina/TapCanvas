import { AppError } from '../../middleware/error';
import type { AppContext } from '../../types';
import type { FlowRow } from '../flow/flow.repo';
import { hydrateWorkflowClipReusedImageNode } from '../execution/execution.clip-production-node-runner';
import { resolveExecutionImageReferences } from './agents-tool-bridge.image-reference-ids';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Exact declared asset reuse shares the workflow hydration path and never creates a paid task. */
export async function reusePreparedCanvasImage(input: {
  c: AppContext; requestUserId: string; flowId: string; chapterId?: string;
  row: FlowRow; node: Record<string, unknown>;
}): Promise<Record<string, unknown> | null> {
  const data = input.node.data as Record<string, unknown>;
  const assetId = text(data.existingAssetId);
  if (!assetId) return null;
  if (!input.row.project_id || text(data.existingProjectId) !== input.row.project_id) {
    throw new AppError('Prepared image asset belongs to a different project', {
      status: 409, code: 'prepared_media_asset_scope_mismatch',
    });
  }
  const [reference] = await resolveExecutionImageReferences({ c: input.c,
    ownerId: input.requestUserId, row: input.row, assetIds: [assetId] });
  if (!reference) throw new AppError('Prepared image asset has no ready image', {
    status: 422, code: 'prepared_media_asset_unresolved',
  });
  const hydrated = await hydrateWorkflowClipReusedImageNode(input.c.env, {
    executionId: text(data.workflowExecutionId), executionFamilyId: text(data.workflowExecutionFamilyId),
    runtimeNodeId: text(data.workflowRuntimeNodeId), ownerId: input.requestUserId,
    flowId: input.flowId, chapterId: input.chapterId,
    effectAssetId: text(data.assetIdentity), generationSpecVersion: text(data.generationSpecVersion),
    existingAssetId: assetId, imageUrl: reference.url,
  });
  return { ok: true, status: 'success', nodeId: hydrated.nodeId, assetId,
    ready: true, reused: true, upstreamRequestAttempted: false };
}
