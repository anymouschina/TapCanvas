import { createHash } from 'node:crypto';
import { AppError } from '../../middleware/error';

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
	const existing = current?.nodes?.find((node) => node.id === input.nodeId);
	const data = input.node.data as Readonly<Record<string, unknown>>;
	const workflowTaskId = typeof data.workflowTaskId === 'string' ? data.workflowTaskId.trim() : '';
	if (!workflowTaskId) {
		throw new AppError('Workflow image effect requires a stable task identity before submission', {
			status: 400, code: 'workflow_image_task_identity_required',
		});
	}
	const claimData = {
		...data,
		status: 'submitting',
		workflowEffectId: input.effectId,
		workflowTaskId,
		workflowSubmissionState: 'submitting',
		workflowSubmissionClaimedAt: input.claimedAt,
	};
	if (existing) {
		const existingData = existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data)
			? existing.data as Record<string, unknown> : null;
		const frozenFields = [
			'prompt', 'negativePrompt', 'modelKey', 'modelAlias', 'imageModel', 'aspect', 'imageSize', 'imageQuality',
			'referenceAssetBindings', 'styleImages', 'stylePrompt', 'styleFingerprint', 'workflowEffectId', 'workflowExecutionFamilyId',
		] as const;
		const matches = existingData && frozenFields.every((field) => (
			JSON.stringify(existingData[field] ?? null) === JSON.stringify(data[field] ?? null)
		));
		const expectedKind = Array.isArray(data.referenceAssetBindings) && data.referenceAssetBindings.length > 0
			? 'imageEdit' : 'image';
		const validKinds = data.kind === expectedKind
			&& (existingData?.kind === 'image' || existingData?.kind === 'imageEdit');
		const hasAsset = existingData && (
			(typeof existingData.imageUrl === 'string' && existingData.imageUrl.trim())
			|| (Array.isArray(existingData.imageResults) && existingData.imageResults.length > 0)
		);
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
