import { describe, expect, it } from "vitest";
import { validateClipProductionPacket } from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { bindClipProductionPacketAuthoringContract } from "./execution.clip-production";
import { verifyClipAssetsAgainstChapterRegistry } from "./execution.clip-production-registry";
import { clipProductionBlockingFixture } from "./test-fixtures/clip-production-blocking";

const chapterAssets = {
	objectRegistry: [{
		objectId: "person-1", kind: "character", name: "张羽", physicalIdentityKey: "zhangyu",
		imageSource: { mode: "reuse", assetIds: ["ready-image-1"] },
	}],
	backgroundPlans: [{ objectId: "background-main", plan: { assetId: "hall-floor", displayName: "大厅站位底图",
		prompt: "俯视大厅", negativePrompt: "无人", referenceAssetBindings: [] } }],
};

function packet(source: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
	return validateClipProductionPacket({
		protocolVersion: "tapcanvas.clip-production-packet/v2", clipId: "clip-1", clipIndex: 0,
		durationSeconds: 5, videoInputMode: "image_to_video",
		firstFrameAsset: { assetId: "frame-1", state: "base" },
		referenceAssets: [{ assetId: "frame-1", state: "base" }],
		sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 2, sourceId: "source", sourceFingerprint: "hash" }],
		videoPrompt: "张羽进入画面", blockingPlan: clipProductionBlockingFixture(), clipFacts: { action: "进入" },
		assetIntents: [{ assetId: "frame-1", state: "base", registryObjectId: "person-1",
			displayName: "张羽身份参考", referenceType: "character", physicalIdentityKey: "zhangyu",
			referenceAssetBindings: [], imageSource: source, ...overrides }],
	});
}

describe("Clip assets use frozen chapter identities", () => {
	it("accepts an explicitly selected ready image and a distinct generated state", () => {
		expect(() => verifyClipAssetsAgainstChapterRegistry(packet({ mode: "reuse", existingAssetId: "ready-image-1", existingProjectId: "project-1" }), chapterAssets)).not.toThrow();
		expect(() => verifyClipAssetsAgainstChapterRegistry(packet({ mode: "generate", generationSpecVersion: "v1",
			generationSpec: { prompt: "张羽正面", negativePrompt: "画面无文字", modelKey: "image", aspectRatio: "16:9", size: "2K" } }), chapterAssets)).not.toThrow();
	});

	it("rejects identity drift or an unselected reused asset before paid work", () => {
		expect(() => verifyClipAssetsAgainstChapterRegistry(packet({ mode: "reuse", existingAssetId: "other-image", existingProjectId: "project-1" }), chapterAssets)).toThrow("outside the frozen chapter selection");
		expect(() => verifyClipAssetsAgainstChapterRegistry(packet({ mode: "reuse", existingAssetId: "ready-image-1", existingProjectId: "project-1" }, { registryObjectId: "different" }), chapterAssets)).toThrow("unknown chapter object");
	});

	it("requires the Clip blocking plan to select exactly one frozen chapter background identity", () => {
		const source = { mode: "reuse", existingAssetId: "ready-image-1", existingProjectId: "project-1" };
		const invalid = { ...packet(source), blockingPlan: clipProductionBlockingFixture("invented-background") };
		expect(() => verifyClipAssetsAgainstChapterRegistry(invalid, chapterAssets)).toThrow("must resolve one frozen background plan");
	});

	it("verifies real asset references without requiring optional staging", () => {
		const { blockingPlan: _blockingPlan, ...withoutStaging } = packet({ mode: "reuse", existingAssetId: "ready-image-1", existingProjectId: "project-1" });
		expect(() => verifyClipAssetsAgainstChapterRegistry(withoutStaging, chapterAssets)).not.toThrow();
		expect(() => verifyClipAssetsAgainstChapterRegistry({ ...withoutStaging,
			assetIntents: withoutStaging.assetIntents.map((intent) => ({ ...intent, registryObjectId: "missing" })) }, chapterAssets))
			.toThrow("unknown chapter object");
	});

	it("binds the author schema to frozen chapter background IDs", () => {
		const source = {
			protocolVersion: "tapcanvas.clip-source-segment/v1", clipId: "clip-1", clipIndex: 0,
			durationSeconds: 5, sourceId: "source", sourceFingerprint: "hash",
			sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 2, sourceId: "source", sourceFingerprint: "hash" }],
		};
		const bound = bindClipProductionPacketAuthoringContract({ jsonSchema: {}, allowedFields: [] }, source, ["image_to_video"],
			"image-model", "16:9", "2K", chapterAssets);
		const schema = bound.jsonSchema as { properties: { blockingPlan: { properties: { backgroundObjectId: unknown } } } };
		expect(schema.properties.blockingPlan.properties.backgroundObjectId).toMatchObject({ type: "string", enum: ["background-main"] });
	});

	it("reads the persisted typed Agent result before binding every Clip to the chapter registry", () => {
		const authored = { text: JSON.stringify(chapterAssets), taskId: "chapter-agent-task" };
		expect(() => verifyClipAssetsAgainstChapterRegistry(
			packet({ mode: "reuse", existingAssetId: "ready-image-1", existingProjectId: "project-1" }), authored,
		)).not.toThrow();
		const source = {
			protocolVersion: "tapcanvas.clip-source-segment/v1", clipId: "clip-1", clipIndex: 0,
			durationSeconds: 5, sourceId: "source", sourceFingerprint: "hash",
			sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 2, sourceId: "source", sourceFingerprint: "hash" }],
		};
		const bound = bindClipProductionPacketAuthoringContract({ jsonSchema: {}, allowedFields: [] }, source, ["image_to_video"],
			"image-model", "16:9", "2K", authored);
		const schema = bound.jsonSchema as { properties: { assetIntents: { items: { properties: { registryObjectId: unknown } } } } };
		expect(schema.properties.assetIntents.items.properties.registryObjectId).toMatchObject({ type: "string", enum: ["person-1"] });
		// The writer reads each frozen identity from the contract instead of paging through the asset plan.
		expect((schema.properties.assetIntents.items.properties.registryObjectId as { description: string }).description)
			.toMatch(/^Frozen chapter objects; choose by identity[\s\S]*\nperson-1=/);
	});
});
