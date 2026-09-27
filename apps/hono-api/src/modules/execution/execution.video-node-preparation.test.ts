import { describe, expect, it } from "vitest";
import { assertVideoNodePreparationReadback, videoNodePreparationPatch } from "./execution.video-node-preparation";

const plan = { kind: "video", prompt: "frozen prompt", status: "idle", workflowPreparedOnly: true,
	referenceImageNodeIds: ["image-1"], referenceAssetIds: [] };
const ready = { ...plan, firstFrameUrl: "https://assets.example/frame.png",
	assetInputs: [{ url: "https://assets.example/frame.png", assetRefId: "image-1" }] };

describe("video node preparation snapshots", () => {
	it.each([
		{ status: "running" }, { status: "success", videoUrl: "https://assets.example/video.mp4" },
		{ taskId: "accepted-task" }, { videoTaskId: "accepted-task" },
		{ videoResults: [{ url: "https://assets.example/video.mp4" }] }, { workflowPreparedOnly: false },
	])("never rewrites a provider-owned node: %j", (state) => {
		expect(() => videoNodePreparationPatch({ ...plan, ...state }, ready)).toThrow("submitted or completed");
	});
	it("rejects changes to the frozen prompt, identities and existing resolved image", () => {
		expect(() => videoNodePreparationPatch(plan, { ...ready, prompt: "other" })).toThrow("frozen prompt");
		expect(() => videoNodePreparationPatch(plan, { ...ready, referenceImageNodeIds: ["other"] })).toThrow("frozen referenceImageNodeIds");
		expect(() => videoNodePreparationPatch(ready, { ...ready, firstFrameUrl: "https://assets.example/other.png" })).toThrow("resolved firstFrameUrl");
	});
	it("does not accept a readback missing the resolved image snapshot", () => {
		expect(() => assertVideoNodePreparationReadback(plan, ready)).toThrow("firstFrameUrl read-back failed");
		expect(() => assertVideoNodePreparationReadback({ ...ready, assetInputs: [] }, ready)).toThrow("assetInputs read-back failed");
	});
});
