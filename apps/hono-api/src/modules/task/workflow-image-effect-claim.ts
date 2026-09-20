import { AppError } from '../../middleware/error';

/** Called inside the canvas compare-and-swap builder, again after a conflict. */
export function buildWorkflowImageClaim(input: Readonly<{
  current: unknown;
  node: Readonly<Record<string, unknown>>;
  nodeId: string;
  effectId: string;
  claimedAt: string;
}>) {
  const current = input.current as { nodes?: readonly { id?: unknown }[] } | null;
  if (current?.nodes?.some(node => node.id === input.nodeId)) {
    throw new AppError('Workflow image effect already claimed; no duplicate provider request submitted', {
      status: 409, code: 'workflow_image_effect_already_claimed',
      details: { nodeId: input.nodeId, effectId: input.effectId, upstreamRequestAttempted: false },
    });
  }
  const data = input.node.data as Readonly<Record<string, unknown>>;
  return { createNodes: [{ ...input.node, id: input.nodeId, data: {
    ...data, status: 'submitting', workflowEffectId: input.effectId,
    workflowSubmissionState: 'submitting', workflowSubmissionClaimedAt: input.claimedAt,
  } }] };
}
