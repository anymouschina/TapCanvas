import { isDeepStrictEqual } from "node:util";

type NodeData = Readonly<Record<string, unknown>>;

const frozenFields = [
	"kind", "prompt", "workflowVideoInputMode", "modelKey", "videoModel",
	"workflowPromptSourceProtocol", "workflowSourcePrompt", "workflowSpeechEvents", "workflowReferenceHeader", "workflowReferenceBindings",
	"videoDurationSeconds", "videoResolution", "videoSize", "aspectRatio",
	"workflowEffectId", "workflowExecutionFamilyId", "workflowClipId",
	"referenceImageNodeIds", "referenceAssetIds",
] as const;

/** Only an unsubmitted plan can acquire its resolved image snapshot. */
export function videoNodePreparationPatch(existing: NodeData, prepared: NodeData): Record<string, unknown> | null {
	if (existing.workflowPreparedOnly !== true || existing.status !== "idle"
		|| existing.taskId || existing.videoTaskId || existing.providerAcceptedAt
		|| existing.videoUrl || (Array.isArray(existing.videoResults) && existing.videoResults.length > 0)) {
		throw new Error("Video preparation cannot modify a submitted or completed video node");
	}
	for (const field of frozenFields) {
		if (!isDeepStrictEqual(existing[field], prepared[field])) {
			throw new Error(`Prepared video node changed frozen ${field}`);
		}
	}
	const patch: Record<string, unknown> = {};
	for (const field of ["firstFrameUrl", "assetInputs"] as const) {
		if (isDeepStrictEqual(existing[field], prepared[field])) continue;
		const unbound = existing[field] === undefined || existing[field] === null
			|| (field === "firstFrameUrl" && existing[field] === "")
			|| (field === "assetInputs" && Array.isArray(existing[field]) && existing[field].length === 0);
		if (!unbound) throw new Error(`Prepared video node changed resolved ${field}`);
		if (prepared[field] !== undefined) patch[field] = prepared[field];
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

export function assertVideoNodePreparationReadback(persisted: NodeData, prepared: NodeData): void {
	for (const field of [...frozenFields, "firstFrameUrl", "assetInputs"] as const) {
		if (!isDeepStrictEqual(persisted[field], prepared[field])) {
			throw new Error(`Prepared video node ${field} read-back failed`);
		}
	}
}

export type WorkflowVideoPreparationReceipt = Readonly<{
	nodeId: string;
	persisted: true;
	promptPersisted: true;
	referenceImageNodeIds: readonly string[];
	referenceAssetIds: readonly string[];
	firstFrameUrl?: string;
	imageDependencies: readonly Readonly<{ referenceId: string; url: string }>[];
}>;
