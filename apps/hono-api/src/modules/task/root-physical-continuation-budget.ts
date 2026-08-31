const ROOT_PHYSICAL_RUN_ARTIFACT_PREFIX = "root_physical_run:";

export const MAX_ROOT_PHYSICAL_WINDOWS_WITHOUT_PROGRESS = 3;

export type RootPhysicalNoProgressWindow = {
	progressRevision: number;
	priorWindowCount: number;
	currentWindowCount: number;
	exhausted: boolean;
};

/**
 * Counts prior physical-window receipts at the same monotonic durable progress
 * revision. A new revision resets the count without a compatibility field or a
 * second state store.
 */
export function evaluateRootPhysicalNoProgressWindow(input: {
	handledArtifactIds: string[];
	progressRevision: number;
	limit?: number;
}): RootPhysicalNoProgressWindow {
	const revision = Math.max(0, Math.trunc(input.progressRevision));
	const limit = Math.max(1, Math.trunc(input.limit ?? MAX_ROOT_PHYSICAL_WINDOWS_WITHOUT_PROGRESS));
	const revisionSuffix = `:${revision}`;
	const priorWindowCount = input.handledArtifactIds.filter(
		(identity) =>
			identity.startsWith(ROOT_PHYSICAL_RUN_ARTIFACT_PREFIX) &&
			identity.endsWith(revisionSuffix),
	).length;
	const currentWindowCount = priorWindowCount + 1;
	return {
		progressRevision: revision,
		priorWindowCount,
		currentWindowCount,
		exhausted: currentWindowCount >= limit,
	};
}
