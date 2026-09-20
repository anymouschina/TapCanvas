export { inspectClipReferenceSelection } from "../../../../../packages/schemas/clip-reference-selection/index.mjs";

/** Keep explicit reference order across inventory and materialization order. */
export function orderClipReferenceEntries<T extends Readonly<{
	assetId: string;
	existingAssetId?: string;
	existingNodeId?: string;
	nodeId?: string;
}>>(
	entries: readonly T[],
	contracts: readonly Readonly<{ referenceAssetIds?: readonly string[]; referenceImageNodeIds: readonly string[] }>[],
): T[] {
	const handles = contracts.flatMap((contract) => [
		...(contract.referenceAssetIds ?? []), ...contract.referenceImageNodeIds,
	]);
	const rank = (entry: T): number => {
		const index = handles.findIndex((id) => id === (entry.existingAssetId ?? entry.assetId)
			|| id === entry.existingNodeId || id === entry.nodeId);
		return index < 0 ? Number.POSITIVE_INFINITY : index;
	};
	return [...entries].sort((left, right) => rank(left) - rank(right));
}
