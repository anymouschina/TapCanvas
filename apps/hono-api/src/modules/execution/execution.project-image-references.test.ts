import { describe, expect, it } from "vitest";

import { frozenReadyProjectImages, resolveWorkflowProjectImageReferences } from "./execution.project-image-references";
import type { WorkflowProjectAssetSnapshot, WorkflowProjectContext } from "./execution.project-context";

function asset(
	assetId: string,
	mediaIdentityKey: string | null,
): WorkflowProjectAssetSnapshot {
	return {
		assetId,
		assetVersion: 1,
		assetVersionId: `${assetId}:revision:1`,
		contentFingerprint: `${assetId}:fingerprint`,
		projectId: "project-1",
		name: assetId,
		canonicalName: assetId,
		kind: "scene",
		referenceType: "scene",
		approvalStatus: "needs_confirmation",
		origin: "project_node",
		flowId: "canvas-1",
		nodeId: `node:${assetId}`,
		mediaKind: "image",
		state: "ready",
		assetUsage: null,
		assetPurpose: null,
		productionEligible: true,
		productionExclusionReason: null,
		styleFingerprint: null,
		sourceFacts: {
			referenceType: "scene",
			roleName: assetId,
			physicalIdentityKey: null,
			mediaIdentityKey,
			sourceIdentity: {},
			characterAssetRole: null,
			characterProfileVersion: null,
			identityAnchors: [],
			prohibitedDrift: [],
			sourceNodeId: `node:${assetId}`,
			workflowExecutionId: null,
			taskId: null,
			prompt: null,
		},
		updatedAt: "2026-09-23T00:00:00.000Z",
	};
}

function context(assetSnapshot: readonly WorkflowProjectAssetSnapshot[]): WorkflowProjectContext {
	return {
		version: 3,
		projectId: "project-1",
		canvasId: "canvas-1",
		sourceNodeId: null,
		selectedAssetIds: [],
		projectAssetIds: assetSnapshot.map((entry) => entry.assetId),
		timeline: { clips: [] },
		selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
		permissions: { principalId: "principal-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
		assetSnapshot,
		capturedAt: "2026-09-23T00:00:00.000Z",
	};
}

describe("frozenReadyProjectImages", () => {
	it("requires a non-empty media identity derived from a real image URL", () => {
		const ready = asset("ready-with-url-evidence", "image-urls:sha256:abc");
		const missingIdentity = asset("ready-without-url-evidence", null);

		expect(frozenReadyProjectImages(context([ready, missingIdentity]))).toEqual([ready]);
	});

	it("reports an invalid exact handle without expanding unqueried project assets", () => {
		const snapshot = context([asset("unqueried-private-handle", "image-a"), asset("another-private-handle", "image-b")]);
		let failure = "";
		try {
			resolveWorkflowProjectImageReferences({ referenceAssetIds: ["invented-id"] }, snapshot);
		} catch (error: unknown) {
			failure = error instanceof Error ? error.message : String(error);
		}
		expect(failure).toContain("assetId=invented-id outside the frozen ready production image set");
		expect(failure).toContain("frozenAssetMatch");
		expect(failure).not.toContain("unqueried-private-handle");
		expect(failure).not.toContain("another-private-handle");
	});
});
