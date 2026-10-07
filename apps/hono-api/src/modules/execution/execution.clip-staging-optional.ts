export type ClipStagingDiagramReceipt = Readonly<{
	nodeIds: readonly string[];
	createdNodeIds: readonly string[];
}>;

export type OptionalClipStagingDiagnostic = Readonly<{
	code: "optional_staging_diagram_failed";
	executionId: string;
	runtimeNodeId: string;
	errorMessage: string;
}>;

/** Optional diagram failures preserve the media receipt and are explicit diagnostic evidence. */
export async function projectOptionalClipStagingDiagrams(
	materialize: (() => Promise<ClipStagingDiagramReceipt>) | undefined,
	context: Readonly<{ executionId: string; runtimeNodeId: string }>,
): Promise<ClipStagingDiagramReceipt & Readonly<{
	status: "not_requested" | "succeeded" | "failed";
	diagnostics: readonly OptionalClipStagingDiagnostic[];
}>> {
	if (!materialize) return { nodeIds: [], createdNodeIds: [], status: "not_requested", diagnostics: [] };
	try {
		return { ...await materialize(), status: "succeeded", diagnostics: [] };
	} catch (error: unknown) {
		const diagnostic: OptionalClipStagingDiagnostic = {
			code: "optional_staging_diagram_failed", ...context,
			errorMessage: error instanceof Error ? error.message : String(error),
		};
		console.warn(JSON.stringify({ event: "workflow_optional_staging_diagram_diagnostic", ...diagnostic }));
		return { nodeIds: [], createdNodeIds: [], status: "failed", diagnostics: [diagnostic] };
	}
}
