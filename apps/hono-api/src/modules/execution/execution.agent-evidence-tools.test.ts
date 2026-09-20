import { describe, expect, it } from "vitest";
import { workflowAgentMediaEvidenceTools } from "./execution.agent-evidence-tools";

const image = { assetId: "image-1", projectId: "project-1", state: "ready" as const, mediaKind: "image" as const, nodeId: "node-1", flowId: "flow-1" };
const context = { projectId: "project-1", canvasId: "flow-1", projectAssetIds: ["image-1"], assetSnapshot: [image] };

describe("workflow media evidence access", () => {
	it("exposes image understanding without requiring a manual selection or generation tools", () => {
		expect(workflowAgentMediaEvidenceTools(context)).toEqual(["tapcanvas_image_refs_get", "tapcanvas_analyze_image"]);
	});
	it("does not grant media tools for absent, invisible, foreign or unready inputs", () => {
		expect(workflowAgentMediaEvidenceTools(null)).toEqual([]);
		expect(workflowAgentMediaEvidenceTools({ ...context, projectAssetIds: [] })).toEqual([]);
		expect(workflowAgentMediaEvidenceTools({ ...context, assetSnapshot: [{ ...image, projectId: "other" }] })).toEqual([]);
		expect(workflowAgentMediaEvidenceTools({ ...context, assetSnapshot: [{ ...image, state: "transcoding" }] })).toEqual([]);
		expect(workflowAgentMediaEvidenceTools({ ...context, assetSnapshot: [{ ...image, mediaKind: "text" }] })).toEqual([]);
	});
	it("only exposes video understanding for an addressable current-canvas node", () => {
		const video = { ...image, mediaKind: "video" as const };
		expect(workflowAgentMediaEvidenceTools({ ...context, assetSnapshot: [video] })).toEqual(["tapcanvas_analyze_video"]);
		expect(workflowAgentMediaEvidenceTools({ ...context, assetSnapshot: [{ ...video, nodeId: null }] })).toEqual([]);
		expect(workflowAgentMediaEvidenceTools({ ...context, assetSnapshot: [{ ...video, flowId: "other-flow" }] })).toEqual([]);
	});
});
