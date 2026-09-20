type AssetDiagnostic = Readonly<{ referenceId: string | null; code: string }>;

/** Keep diagnostic facts visible without copying the whole project audit into every task. */
export function projectAssetDiagnosticsForPrompt(
	diagnostics: readonly AssetDiagnostic[],
	selectedAssetIds: ReadonlySet<string>,
) {
	const counts = new Map<string, number>();
	for (const diagnostic of diagnostics) {
		counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
	}
	return {
		total: diagnostics.length,
		byCode: Array.from(counts, ([code, count]) => ({ code, count })),
		selectedAndUnscoped: diagnostics.filter(({ referenceId }) => (
			referenceId === null || selectedAssetIds.has(referenceId)
		)),
		detailsSource: "frozenAssetRead",
	};
}
