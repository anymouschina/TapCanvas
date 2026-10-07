import type { WorkflowAgentRunRequest } from "./execution.node-executors";
import { workflowProjectImageCatalog } from "./execution.project-image-candidates";
import { frozenReadyProjectImages } from "./execution.project-image-references";
import { workflowPromptRecordTable } from "./execution.prompt-record-table";
import { OPENING_FRAME_PLAN_ARTIFACT_TYPE } from "./execution.opening-frame";

export function isWorkflowBeatSheetArtifactType(artifactType: string): boolean {
	return artifactType === "tapcanvas.beat-sheet/v2"
		|| artifactType === "tapcanvas.launch-beat-sheet/v1";
}

export function isWorkflowChapterAssetArtifactType(artifactType: string): boolean {
	return artifactType === "tapcanvas.chapter-asset-plan/v3"
		|| artifactType === "tapcanvas.chapter-asset-part/v1";
}

export function workflowAgentProjectContextPromptFacts(
	projectContext: NonNullable<WorkflowAgentRunRequest["projectContext"]>,
	outputArtifactType: string,
	promptMode?: WorkflowAgentRunRequest["projectContextPromptMode"],
): Readonly<Record<string, unknown>> {
	const visualStyle = projectContext.visualStyle ?? {
		referenceImages: [],
		styleLock: null,
		styleFingerprint: null,
	};
	const selectedAssetIds = new Set(projectContext.selectedAssetIds);
	const imageCatalog = workflowProjectImageCatalog(projectContext);
	const isChapterAssetPlanLike = isWorkflowChapterAssetArtifactType(outputArtifactType);
	const exactReferenceIds = outputArtifactType === OPENING_FRAME_PLAN_ARTIFACT_TYPE || isChapterAssetPlanLike
		? new Set(frozenReadyProjectImages(projectContext).map((asset) => asset.assetId))
		: null;
	const referenceCatalog = exactReferenceIds
		? imageCatalog.filter((asset) => exactReferenceIds.has(asset.assetId))
		: imageCatalog;
	const projectAssetCandidates = (isWorkflowBeatSheetArtifactType(outputArtifactType)
		|| outputArtifactType === OPENING_FRAME_PLAN_ARTIFACT_TYPE)
		? referenceCatalog
		: undefined;
	if (outputArtifactType === "tapcanvas.opening-clip/v3") {
		return {
			version: projectContext.version,
			projectId: projectContext.projectId,
			canvasId: projectContext.canvasId,
			sourceNodeId: projectContext.sourceNodeId,
			permissions: projectContext.permissions,
			visualStyle: {
				referenceImageCount: visualStyle.referenceImages.length,
				styleLock: visualStyle.styleLock,
				styleFingerprint: visualStyle.styleFingerprint,
			},
			capturedAt: projectContext.capturedAt,
		};
	}
	if (outputArtifactType === OPENING_FRAME_PLAN_ARTIFACT_TYPE) {
		return {
			version: projectContext.version,
			projectId: projectContext.projectId,
			canvasId: projectContext.canvasId,
			sourceNodeId: projectContext.sourceNodeId,
			selectedAssetIds: projectContext.selectedAssetIds,
			permissions: projectContext.permissions,
			visualStyle: {
				referenceImageCount: visualStyle.referenceImages.length,
				styleLock: visualStyle.styleLock,
				styleFingerprint: visualStyle.styleFingerprint,
			},
			...(projectAssetCandidates ? { projectAssetCandidates: workflowPromptRecordTable(projectAssetCandidates) } : {}),
			capturedAt: projectContext.capturedAt,
		};
	}
	// Asset discovery is an explicit, on-demand tool read. Only user-selected
	// handles belong in the initial author context.
	if (isChapterAssetPlanLike) {
		return {
			version: projectContext.version,
			projectId: projectContext.projectId,
			canvasId: projectContext.canvasId,
			sourceNodeId: projectContext.sourceNodeId,
			selectedAssetIds: projectContext.selectedAssetIds,
			assetSelectionDiagnostics: projectContext.assetSelectionDiagnostics,
			permissions: projectContext.permissions,
			visualStyle: {
				referenceImageCount: visualStyle.referenceImages.length,
				styleLock: visualStyle.styleLock,
				styleFingerprint: visualStyle.styleFingerprint,
			},
			selectedAssetSnapshot: referenceCatalog.filter(asset => selectedAssetIds.has(asset.assetId))
				.map(asset => ({ assetId: asset.assetId, name: asset.name, canonicalName: asset.canonicalName,
					referenceType: asset.referenceType, assetPurpose: asset.assetPurpose,
					physicalIdentityKey: asset.physicalIdentityKey })),
			capturedAt: projectContext.capturedAt,
		};
	}
	// These typed stages consume their source/registry through declared ports.
	if (promptMode === "identity_only" || outputArtifactType === "tapcanvas.source-unit-ledger/v1" || outputArtifactType === "tapcanvas.chapter-beat-plan/v3" || outputArtifactType === "tapcanvas.clip-design/v2") {
		return {
			version: projectContext.version, projectId: projectContext.projectId,
			canvasId: projectContext.canvasId, sourceNodeId: projectContext.sourceNodeId,
			permissions: projectContext.permissions,
			visualStyle: {
				styleLock: visualStyle.styleLock, styleFingerprint: visualStyle.styleFingerprint,
				referenceImageCount: visualStyle.referenceImages.length,
			},
			capturedAt: projectContext.capturedAt,
		};
	}
	return {
		version: projectContext.version,
		projectId: projectContext.projectId,
		canvasId: projectContext.canvasId,
		sourceNodeId: projectContext.sourceNodeId,
		selectedAssetIds: projectContext.selectedAssetIds,
		assetSelectionDiagnostics: projectContext.assetSelectionDiagnostics,
		projectAssetCount: projectContext.projectAssetIds.length,
		assetSnapshotCount: projectContext.assetSnapshot.length,
		timeline: projectContext.timeline,
		selection: projectContext.selection,
		permissions: projectContext.permissions,
		// Image analyses are read only by exact asset ID through the inspection tool.
		// The prompt carries identities, never historical image-understanding text.
		visualStyle: {
			referenceImageCount: visualStyle.referenceImages.length,
			styleLock: visualStyle.styleLock,
			styleFingerprint: visualStyle.styleFingerprint,
		},
		selectedAssetSnapshot: imageCatalog.filter((asset) => (
			selectedAssetIds.has(asset.assetId)
		)),
		...(projectAssetCandidates ? { projectAssetCandidates: workflowPromptRecordTable(projectAssetCandidates) } : {}),
		capturedAt: projectContext.capturedAt,
	};
}
