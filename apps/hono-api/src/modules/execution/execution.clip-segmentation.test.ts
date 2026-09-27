import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import { applyWorkflowArtifactJsonObjectContract } from "./execution.agent-output-contract";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import {
	bindClipSegmentationAuthoringContract,
	projectClipSegmentation,
} from "./execution.clip-segmentation";
import { CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE } from "../../../../../packages/schemas/video-clip-segmentation/index.mjs";

const sourceContents = ["甲👩‍🚀乙。", "第二幕。"] as const;
const deliveryContract = {
	protocolVersion: "2",
	executionScope: "media_delivery",
	targetDurationSeconds: 10,
	generationContract: {
		videoModel: "test-video-model",
		durationOptions: [4, 6],
		maxDurationSeconds: 6,
		clipPlanningPolicy: "agent_semantic_duration_budget",
	},
	canvasFacts: {
		authoritativeSources: sourceContents.map((content, index) => ({
			sourceId: `source-${index}`,
			sourceFingerprint: sha256Hex(content.trim()),
			content,
		})),
	},
};

function segmentationArtifact() {
	const splitOffset = sourceContents[0].indexOf("乙");
	return {
		protocolVersion: CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE,
		clips: [
			{ durationSeconds: 4, sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: splitOffset }] },
			{ durationSeconds: 6, sourceRanges: [
				{ sourceIndex: 0, startOffset: splitOffset, endOffset: sourceContents[0].length },
				{ sourceIndex: 1, startOffset: 0, endOffset: sourceContents[1].length },
			] },
		],
	};
}

describe("chapter Clip segmentation contract", () => {
	it("binds one compact schema to the frozen provider duration options", () => {
		const contract = bindClipSegmentationAuthoringContract({ allowedFields: ["protocolVersion"] }, deliveryContract);
		const artifactContract = applyWorkflowArtifactJsonObjectContract(CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE, contract);
		const clipsSchema = contract.jsonSchema?.properties as Record<string, unknown> | undefined;

		expect(contract.contractName).toBe("tapcanvas.chapter-clip-segmentation");
		expect(contract.contractVersion).toBe("1");
		expect(contract.allowedFields).toEqual(["protocolVersion", "clips"]);
		expect(contract.requiredArrayFields).toEqual(["clips"]);
		expect(clipsSchema?.clips).toMatchObject({
			items: { properties: { durationSeconds: { enum: [4, 6] } } },
		});
		expect(artifactContract).toMatchObject({ allowedFields: ["protocolVersion", "clips"] });
		expect(validateWorkflowToolArguments(contract.jsonSchema ?? {}, segmentationArtifact())).toEqual([]);
	});

	it("states every source's exact UTF-16 terminal boundary independently of duration character counts", () => {
		const contract = bindClipSegmentationAuthoringContract({ allowedFields: [] }, {
			...deliveryContract,
			sourceProfile: { sourceChars: 1, sourceSpeechChars: 1 },
		});
		const description = contract.jsonSchema?.description;
		expect(typeof description).toBe("string");
		if (typeof description !== "string") throw new Error("Missing source coordinate description");
		const facts = JSON.parse(description.slice(description.lastIndexOf("\n") + 1)) as {
			coordinateSystem: string;
			sources: Array<{ sourceIndex: number; sourceId: string; endOffset: number; utf16Length: number; forbiddenSurrogateOffsets: number[] }>;
		};
		expect(facts.coordinateSystem).toBe("utf16");
		expect(facts.sources).toEqual([
			{ sourceIndex: 0, sourceId: "source-0", startOffset: 0, endOffset: 8, utf16Length: 8, forbiddenSurrogateOffsets: [2, 5] },
			{ sourceIndex: 1, sourceId: "source-1", startOffset: 0, endOffset: 4, utf16Length: 4, forbiddenSurrogateOffsets: [] },
		]);
		expect(description).toContain("sourceProfile.sourceChars/sourceSpeechChars");
		expect(description).not.toContain(sourceContents[0]);
		expect(description).not.toContain(sourceContents[1]);
	});

	it("projects a complete partition into stable Clip items with exact frozen UTF-16 slices", () => {
		const projection = projectClipSegmentation({
			executionId: "execution-1",
			nodeId: "chapter-segmentation",
			segmentation: { text: JSON.stringify(segmentationArtifact()) },
			deliveryContract,
		});
		const first = projection.clipCollection.items[0];
		const second = projection.clipCollection.items[1];
		const sourceSetFingerprint = sha256Hex(JSON.stringify(sourceContents.map((content, index) => ({
			sourceId: `source-${index}`,
			sourceFingerprint: sha256Hex(content.trim()),
		}))));

		expect(projection.clipCollection.collectionId).toBe("execution-1:chapter-segmentation:clip-segments");
		expect(projection.clipCollection.items.map((item) => item.itemId)).toEqual([
			`${sourceSetFingerprint}:clip:0`,
			`${sourceSetFingerprint}:clip:1`,
		]);
		expect(first?.value.sourceSlices).toEqual([{
			sourceIndex: 0,
			sourceId: "source-0",
			sourceFingerprint: sha256Hex(sourceContents[0].trim()),
			startOffset: 0,
			endOffset: sourceContents[0].indexOf("乙"),
			text: sourceContents[0].slice(0, sourceContents[0].indexOf("乙")),
		}]);
		expect(second?.value.sourceSlices.map((slice) => slice.text)).toEqual([
			sourceContents[0].slice(sourceContents[0].indexOf("乙")),
			sourceContents[1],
		]);
		expect([first?.value.durationSeconds, second?.value.durationSeconds]).toEqual([4, 6]);
		expect(projection.sourceReceipt).toMatchObject({
			protocolVersion: "tapcanvas.clip-source-segment/v1",
			clipIds: projection.clipCollection.items.map((item) => item.itemId),
			totalDurationSeconds: 10,
		});
	});

	it("keeps the workflow's full 80-Clip configured range executable", () => {
		const content = "甲".repeat(80);
		const wideDeliveryContract = {
			protocolVersion: "2",
			executionScope: "media_delivery",
			generationContract: {
				videoModel: "test-video-model",
				durationOptions: [1],
				maxDurationSeconds: 1,
				clipPlanningPolicy: "agent_semantic_duration_budget",
			},
			canvasFacts: {
				authoritativeSources: [{ sourceId: "source-wide", sourceFingerprint: sha256Hex(content), content }],
			},
		};
		const segmentation = {
			protocolVersion: CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE,
			clips: Array.from({ length: 80 }, (_unused, index) => ({
				durationSeconds: 1,
				sourceRanges: [{ sourceIndex: 0, startOffset: index, endOffset: index + 1 }],
			})),
		};
		const projection = projectClipSegmentation({
			executionId: "execution-wide",
			nodeId: "chapter-segmentation",
			segmentation,
			deliveryContract: wideDeliveryContract,
		});

		expect(projection.clipCollection.items).toHaveLength(80);
		expect(projection.clipCollection.items[79]?.value.sourceSlices[0]?.text).toBe("甲");
	});

	it("rejects a source gap, overlap, out-of-bounds offset or non-provider duration", () => {
		const valid = segmentationArtifact();
		const secondClip = valid.clips[1]!;
		const source0Range = secondClip.sourceRanges[0]!;
		expect(() => projectClipSegmentation({
			executionId: "execution-1", nodeId: "segmentation",
			segmentation: { ...valid, clips: [valid.clips[0], { ...secondClip,
				sourceRanges: [{ ...source0Range, startOffset: source0Range.startOffset + 1 }, secondClip.sourceRanges[1]!],
			}] }, deliveryContract,
		})).toThrow(/source coverage.*cursor/u);
		expect(() => projectClipSegmentation({
			executionId: "execution-1", nodeId: "segmentation",
			segmentation: { ...valid, clips: [valid.clips[0], { ...secondClip,
				sourceRanges: [{ ...source0Range, startOffset: 0 }, secondClip.sourceRanges[1]!],
			}] }, deliveryContract,
		})).toThrow(/source coverage.*cursor/u);
		expect(() => projectClipSegmentation({
			executionId: "execution-1", nodeId: "segmentation",
			segmentation: { ...valid, clips: [{ ...valid.clips[0], durationSeconds: 5 }, secondClip] }, deliveryContract,
		})).toThrow(/durationSeconds is outside the allowed enum/u);
	});

	it("enforces exact user-frozen clip counts and duration order", () => {
		const explicitDurations = {
			...deliveryContract,
			generationContract: {
				...deliveryContract.generationContract,
				providerSubmissionTopology: {
					targetDurationSeconds: 10,
					expectedClipCount: 2,
					minimumClipDurations: [6, 4],
					source: "user_clip_durations",
				},
			},
		};
		const contract = bindClipSegmentationAuthoringContract({ allowedFields: [] }, explicitDurations);
		expect(contract.expectedArrayLengths).toEqual({ clips: 2 });
		expect(contract.arrayItemExactNumberFields?.clips).toEqual([
			{ durationSeconds: 6 },
			{ durationSeconds: 4 },
		]);
		expect(() => projectClipSegmentation({
			executionId: "execution-1", nodeId: "segmentation", segmentation: segmentationArtifact(), deliveryContract: explicitDurations,
		})).toThrow(/preserve frozen requested clip durations/u);
	});

	it("rejects a stale source fingerprint and extra authored semantics", () => {
		const staleContract = {
			...deliveryContract,
			canvasFacts: {
				authoritativeSources: [{
					sourceId: "source-0",
					sourceFingerprint: "stale-fingerprint",
					content: sourceContents[0],
				}],
			},
		};
		expect(() => projectClipSegmentation({
			executionId: "execution-1", nodeId: "segmentation", segmentation: segmentationArtifact(), deliveryContract: staleContract,
		})).toThrow(/sourceFingerprint does not match/u);
		const extraSemantics = { ...segmentationArtifact(), chapterArc: "not an authored field" };
		expect(() => projectClipSegmentation({
			executionId: "execution-1", nodeId: "segmentation", segmentation: extraSemantics, deliveryContract,
		})).toThrow(/chapterArc is not allowed/u);
	});
});
