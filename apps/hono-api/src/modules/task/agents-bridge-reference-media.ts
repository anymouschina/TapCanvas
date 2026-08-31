export type SelectedReferenceMediaIdentity = {
	nodeId?: string | null;
	approvalStatus?: string | null;
	imageUrl?: string | null;
	sourceUrl?: string | null;
};

export type ReferenceMediaAssetInput = {
	nodeId?: string;
	url: string;
};

export type FilteredReferenceMedia<TAssetInput extends ReferenceMediaAssetInput> = {
	referenceImages: string[];
	assetInputs: TAssetInput[];
	selectedReferenceProtocolImages: string[];
	selectedReferenceRejected: boolean;
};

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function isSelectedReferenceRejected(
	selectedReference: SelectedReferenceMediaIdentity | null,
): boolean {
	return normalizeText(selectedReference?.approvalStatus).toLowerCase() === "rejected";
}

/**
 * Rejected is an explicit lifecycle state, not a semantic quality guess. The
 * node remains visible to the agent as rejected evidence, while its bytes are
 * removed from model-bound reference media.
 */
export function filterRejectedSelectedReferenceMedia<
	TAssetInput extends ReferenceMediaAssetInput,
>(input: {
	referenceImages: readonly string[];
	assetInputs: readonly TAssetInput[];
	selectedReferenceProtocolImages: readonly string[];
	selectedReference: SelectedReferenceMediaIdentity | null;
}): FilteredReferenceMedia<TAssetInput> {
	const selectedReferenceRejected = isSelectedReferenceRejected(input.selectedReference);
	if (!selectedReferenceRejected) {
		return {
			referenceImages: [...input.referenceImages],
			assetInputs: [...input.assetInputs],
			selectedReferenceProtocolImages: [...input.selectedReferenceProtocolImages],
			selectedReferenceRejected: false,
		};
	}

	const selectedNodeId = normalizeText(input.selectedReference?.nodeId);
	const rejectedUrls = new Set(
		[
			input.selectedReference?.imageUrl,
			input.selectedReference?.sourceUrl,
			...input.selectedReferenceProtocolImages,
		]
			.map(normalizeText)
			.filter(Boolean),
	);
	return {
		referenceImages: input.referenceImages.filter(
			(url) => !rejectedUrls.has(normalizeText(url)),
		),
		assetInputs: input.assetInputs.filter((assetInput) => {
			if (selectedNodeId && normalizeText(assetInput.nodeId) === selectedNodeId) return false;
			return !rejectedUrls.has(normalizeText(assetInput.url));
		}),
		selectedReferenceProtocolImages: [],
		selectedReferenceRejected: true,
	};
}
