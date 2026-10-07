import { AppError } from '../../middleware/error';
import { createHash } from 'node:crypto';

export function buildWorkflowImageTaskId(input: Readonly<{ ownerId: string; effectId: string }>): string {
  const ownerId = input.ownerId.trim();
  const effectId = input.effectId.trim();
  if (!ownerId || !effectId) throw new Error('workflow_image_task_identity_required');
  const digest = createHash('sha256').update(JSON.stringify([ownerId, effectId])).digest('hex');
  return `task_workflow_${digest}`;
}

/** Called inside the canvas compare-and-swap builder, again after a conflict. */
export function buildWorkflowImageClaim(input: Readonly<{
  current: unknown;
  node: Readonly<Record<string, unknown>>;
  nodeId: string;
  effectId: string;
  claimedAt: string;
}>) {
  const current = input.current as { nodes?: readonly { id?: unknown; data?: unknown }[] } | null;
  const existing = current?.nodes?.find(node => node.id === input.nodeId);
  const data = input.node.data as Readonly<Record<string, unknown>>;
  const workflowTaskId = typeof data.workflowTaskId === 'string' ? data.workflowTaskId.trim() : '';
  if (!workflowTaskId) {
    throw new AppError('Workflow image effect requires a stable task identity before submission', {
      status: 400, code: 'workflow_image_task_identity_required',
    });
  }
  const claimData = {
    ...data, status: 'submitting', workflowEffectId: input.effectId,
    workflowTaskId, workflowSubmissionState: 'submitting', workflowSubmissionClaimedAt: input.claimedAt,
  };
  if (existing) {
    const existingData = existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data)
      ? existing.data as Record<string, unknown> : null;
    const frozenFields = ['prompt', 'negativePrompt', 'modelKey', 'modelAlias', 'imageModel', 'aspect', 'imageSize', 'imageQuality',
      'referenceAssetBindings', 'styleImages', 'stylePrompt', 'styleFingerprint',
      'workflowEffectId', 'workflowExecutionFamilyId'] as const;
    const matches = existingData && frozenFields.every(field => JSON.stringify(existingData[field] ?? null) === JSON.stringify(data[field] ?? null));
    const expectedKind = Array.isArray(data.referenceAssetBindings) && data.referenceAssetBindings.length > 0
      ? 'imageEdit' : 'image';
    // The binding contract determines whether this is an image edit. The
    // prepared node has no provider effect yet, so normalize its display kind
    // atomically with the first claim while preserving every frozen input.
    const validKinds = data.kind === expectedKind
      && (existingData?.kind === 'image' || existingData?.kind === 'imageEdit');
    const hasAsset = existingData && (typeof existingData.imageUrl === 'string' && existingData.imageUrl.trim()
      || Array.isArray(existingData.imageResults) && existingData.imageResults.length > 0);
    if (!existingData || existingData.workflowPreparedOnly !== true || existingData.status !== 'idle'
      || existingData.taskId || existingData.imageTaskId || existingData.workflowSubmissionState || hasAsset
      || existingData.workflowTaskId !== workflowTaskId || !matches || !validKinds) {
      throw new AppError('Workflow image effect already claimed or planned generation contract changed', {
        status: 409, code: 'workflow_image_effect_already_claimed',
        details: { nodeId: input.nodeId, effectId: input.effectId, upstreamRequestAttempted: false },
      });
    }
    return { allowOverwrite: true, patchNodeData: [{ id: input.nodeId, data: {
      ...existingData, ...claimData, workflowPreparedOnly: false,
    } }] };
  }
  return { createNodes: [{ ...input.node, id: input.nodeId, data: claimData }] };
}

export function buildWorkflowImagePreUpstreamRejection(input: Readonly<{
  current: unknown;
  nodeId: string;
  effectId: string;
  workflowTaskId: string;
  failedAt: string;
  errorMessage: string;
}>) {
  const graph = input.current as { nodes?: readonly { id?: unknown; data?: unknown }[] } | null;
  const currentNode = graph?.nodes?.find((node) => node.id === input.nodeId);
  const currentData = currentNode?.data;
  if (!currentNode || !currentData || typeof currentData !== 'object' || Array.isArray(currentData)) {
    throw new AppError('Workflow image claim disappeared before rejection could be recorded', {
      status: 409, code: 'workflow_image_rejection_claim_missing',
    });
  }
  const data = currentData as Record<string, unknown>;
  const hasAsset = [data.imageUrl, data.assetUrl, data.mediaUrl].some((value) => typeof value === 'string' && value.trim())
    || (Array.isArray(data.imageResults) && data.imageResults.length > 0);
  if (data.workflowEffectId !== input.effectId || data.workflowTaskId !== input.workflowTaskId
    || data.workflowSubmissionState !== 'submitting' || data.taskId || data.imageTaskId || hasAsset) {
    throw new AppError('Workflow image claim changed before pre-upstream rejection was recorded', {
      status: 409, code: 'workflow_image_rejection_claim_conflict',
      details: { nodeId: input.nodeId, effectId: input.effectId },
    });
  }
  return {
    allowOverwrite: true,
    patchNodeData: [{ id: input.nodeId, data: {
      ...data,
      status: 'error',
      workflowSubmissionState: 'rejected_pre_upstream',
      workflowSubmissionRejectedAt: input.failedAt,
      workflowSubmissionError: input.errorMessage,
    } }],
  };
}
