import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import {
	ACCEPTED_OPENING_CLIP_PROTOCOL,
	OPENING_CLIP_ARTIFACT_TYPE,
	OPENING_CLIP_PREFIX_PROTOCOL,
	OPENING_CLIP_PROMPT_PROTOCOL,
	bindOpeningClipAuthoringContract,
	bindOpeningClipPrefixToSourceLedger,
	mergeOpeningClipPrefix,
	projectOpeningClip,
	spliceOpeningClipPlanPrefix,
	verifyOpeningClipPromptSubmission,
} from "./execution.opening-clip";
import { applyWorkflowArtifactJsonObjectContract } from "./execution.agent-output-contract";

const sourceContent = "甲 👩‍🚀\r\n乙。";
const sourceId = "chapter-1";
const sourceFingerprint = sha256Hex(sourceContent);
const deliveryContract = {
	protocolVersion: "2",
	executionScope: "media_delivery",
	targetDurationSeconds: 30,
	generationContract: {
		videoModel: "test-video-model",
		resolution: "1080p",
		aspectRatio: "16:9",
		durationOptions: [30],
		maxDurationSeconds: 30,
		clipPlanningPolicy: "agent_semantic_duration_budget",
		providerSubmissionTopology: { expectedClipCount: 1, minimumClipDurations: [30], source: "model_max_duration" },
	},
	canvasFacts: {
		sourceMode: "inline_text",
		authoritativeSources: [{ sourceId, sourceFingerprint, content: sourceContent }],
	},
};
const sourceLedger = {
	sourceId,
	sourceFingerprint,
	units: [
		{ unitId: "unit:first", sourceLineId: "source-0:source-line-1", text: "甲 👩‍🚀", expression: "narration", speakerName: null, delivery: null },
		{ unitId: "unit:second", sourceLineId: "source-0:source-line-2", text: "乙。", expression: "narration", speakerName: null, delivery: null },
	],
};

function openingArtifact(endOffset = sourceContent.indexOf("乙"), prompt = "雨夜，一名旅人推开木门走进昏暗的室内；镜头从门外连续跟入。") {
	return {
		protocolVersion: OPENING_CLIP_ARTIFACT_TYPE,
		sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset }],
		clipPrompt: prompt,
	};
}

function project(endOffset?: number) {
	return projectOpeningClip({
		executionId: "execution-1",
		nodeId: "opening-clip-prepare",
		openingClip: openingArtifact(endOffset),
		deliveryContract,
	});
}

describe("Opening Clip v3 minimal authoring and source-bound submit", () => {
	it("projects one raw prompt without requiring a BeatSheet or full prompt package", () => {
		const projection = project();
		const accepted = projection.acceptedOpeningClip;
		const item = projection.clipPromptCollection.items[0];

		expect(accepted.protocolVersion).toBe(ACCEPTED_OPENING_CLIP_PROTOCOL);
		expect(accepted.clipId).toBe(`${sourceFingerprint}:clip:0`);
		expect(accepted.clipPrompt).toBe("雨夜，一名旅人推开木门走进昏暗的室内；镜头从门外连续跟入。");
		expect(accepted.sourceSlices).toEqual([{
			sourceIndex: 0,
			sourceId,
			sourceFingerprint,
			startOffset: 0,
			endOffset: sourceContent.indexOf("乙"),
			text: sourceContent.slice(0, sourceContent.indexOf("乙")),
		}]);
		expect(item?.value).toMatchObject({
			protocolVersion: OPENING_CLIP_PROMPT_PROTOCOL,
			clipId: accepted.clipId,
			clipIndex: 0,
			prompt: accepted.clipPrompt,
			durationSeconds: 30,
			modelKey: "test-video-model",
			resolution: "1080p",
			aspectRatio: "16:9",
		});
		expect(accepted).not.toHaveProperty("chapterPlanBeat");
		expect(accepted).not.toHaveProperty("spokenScript");
	});

	it("binds only the three minimal authored fields and the v3 artifact contract", () => {
		const contract = bindOpeningClipAuthoringContract({ allowedFields: ["protocolVersion"] }, deliveryContract);
		expect(contract.allowedFields).toEqual(["protocolVersion", "sourceRanges", "clipPrompt"]);
		expect(contract.requiredStringFields).toEqual(["protocolVersion", "clipPrompt"]);
		expect(contract.exactStringFields?.protocolVersion).toBe(OPENING_CLIP_ARTIFACT_TYPE);
		expect(contract.jsonSchema).toMatchObject({
			required: ["protocolVersion", "sourceRanges", "clipPrompt"],
			additionalProperties: false,
		});
		const outputContract = applyWorkflowArtifactJsonObjectContract(OPENING_CLIP_ARTIFACT_TYPE, contract);
		expect(outputContract).toMatchObject({
			contractName: "tapcanvas.opening-clip-artifact",
			contractVersion: "3",
			allowedFields: ["protocolVersion", "sourceRanges", "clipPrompt"],
		});
	});

	it("accepts the observed 410-unit clipPrompt draft and projects it as provider prompt", () => {
		const source = "甲".repeat(500);
		const fingerprint = sha256Hex(source);
		const frozenContract = {
			...deliveryContract,
			canvasFacts: {
				...deliveryContract.canvasFacts,
				authoritativeSources: [{ sourceId, sourceFingerprint: fingerprint, content: source }],
			},
		};
		const draft = {
			protocolVersion: OPENING_CLIP_ARTIFACT_TYPE,
			sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 410 }],
			clipPrompt: "A continuous cinematic opening shot.",
		};
		const authorContract = bindOpeningClipAuthoringContract({ allowedFields: [] }, frozenContract);
		expect(authorContract.jsonSchema).toMatchObject({
			properties: { clipPrompt: { type: "string", minLength: 1 } },
			required: ["protocolVersion", "sourceRanges", "clipPrompt"],
			additionalProperties: false,
		});
		expect(Object.keys((authorContract.jsonSchema as { properties: Record<string, unknown> }).properties).sort())
			.toEqual(["clipPrompt", "protocolVersion", "sourceRanges"]);

		const projection = projectOpeningClip({ executionId: "e", nodeId: "n", openingClip: draft, deliveryContract: frozenContract });
		const hostItem = projection.clipPromptCollection.items[0]?.value;
		expect(projection.acceptedOpeningClip.sourceRanges[0]?.endOffset).toBe(410);
		expect(hostItem).toMatchObject({
			protocolVersion: OPENING_CLIP_PROMPT_PROTOCOL,
			prompt: draft.clipPrompt,
			durationSeconds: 30,
			modelKey: "test-video-model",
		});
		expect(hostItem).not.toHaveProperty("clipPrompt");
		expect(() => projectOpeningClip({
			executionId: "e",
			nodeId: "n",
			openingClip: {
				protocolVersion: OPENING_CLIP_ARTIFACT_TYPE,
				sourceRanges: draft.sourceRanges,
				prompt: draft.clipPrompt,
			},
			deliveryContract: frozenContract,
		})).toThrow("opening-clip.prompt is not an accepted author field");
	});

	it("revalidates source slices, prompt hash and frozen provider values before direct submission", () => {
		const projection = project();
		const promptItem = projection.clipPromptCollection.items[0]?.value;
		const verified = verifyOpeningClipPromptSubmission({ promptItem, deliveryContract });
		expect(verified.acceptedOpeningClip.contentHash).toBe(projection.acceptedOpeningClip.contentHash);
		expect(verified.promptItem.prompt).toBe(projection.acceptedOpeningClip.clipPrompt);
		expect(() => verifyOpeningClipPromptSubmission({
			promptItem: { ...promptItem, prompt: "changed after source binding" },
			deliveryContract,
		})).toThrow("content hash or stable identity is invalid");
		expect(() => verifyOpeningClipPromptSubmission({
			promptItem,
			deliveryContract: { ...deliveryContract, generationContract: { ...deliveryContract.generationContract, aspectRatio: "1:1" } },
		})).toThrow("does not match frozen source, range or provider facts");
	});

	it("rejects out-of-bounds, discontinuous and surrogate-splitting source ranges", () => {
		const badStart = { ...openingArtifact(), sourceRanges: [{ sourceIndex: 0, startOffset: 1, endOffset: 4 }] };
		expect(() => projectOpeningClip({ executionId: "e", nodeId: "n", openingClip: badStart, deliveryContract }))
			.toThrow("positive in-bounds UTF-16 prefix range");
		const surrogateOffset = sourceContent.indexOf("👩") + 1;
		const splitSurrogate = openingArtifact(surrogateOffset);
		expect(() => projectOpeningClip({ executionId: "e", nodeId: "n", openingClip: splitSurrogate, deliveryContract }))
			.toThrow("must not split a UTF-16 surrogate pair");
		const skippedSource = {
			...openingArtifact(),
			sourceRanges: [{ sourceIndex: 1, startOffset: 0, endOffset: 1 }],
		};
		expect(() => projectOpeningClip({ executionId: "e", nodeId: "n", openingClip: skippedSource, deliveryContract }))
			.toThrow("follow frozen source order without gaps");
	});

	it("maps accepted UTF-16 ranges to canonical ledger units and preserves the later authored Clip 0", () => {
		const projection = project();
		const prefix = bindOpeningClipPrefixToSourceLedger({
			acceptedOpeningClip: projection.acceptedOpeningClip,
			deliveryContract,
			sourceLedger,
		});
		expect(prefix.protocolVersion).toBe(OPENING_CLIP_PREFIX_PROTOCOL);
		expect(prefix.sourceUnitRefs).toEqual([{ unitId: "unit:first" }]);
		expect(prefix).not.toHaveProperty("chapterPlanBeat");

		const fullPlan = {
			sourceId,
			sourceFingerprint,
			beats: [
				{ clipId: projection.acceptedOpeningClip.clipId, clipIndex: 0, sourceUnitRefs: prefix.sourceUnitRefs, narrativeIntent: "后续全章 Agent 生成的完整语义" },
				{ clipIndex: 1, sourceUnitRefs: [{ unitId: "unit:second" }] },
			],
		};
		const splice = spliceOpeningClipPlanPrefix({ openingPrefix: prefix, chapterPlan: fullPlan, sourceLedger });
		expect(splice.conflict).toBeNull();
		expect(splice.chapterPlan).toEqual(fullPlan);

		const fullBeatSheet = { ...fullPlan, objectRegistry: [], assetPlans: [], blockingPlans: [] };
		expect(mergeOpeningClipPrefix({ openingPrefix: prefix, fullBeatSheet, sourceLedger }).conflict).toBeNull();
		const conflict = mergeOpeningClipPrefix({
			openingPrefix: prefix,
			fullBeatSheet: { ...fullBeatSheet, beats: [{ ...fullBeatSheet.beats[0], sourceUnitRefs: [{ unitId: "unit:second" }] }] },
			sourceLedger,
		});
		expect(conflict.conflict?.code).toBe("opening_clip_prefix_source_allocation_conflict");
	});

	it("maps a partial source-unit boundary and keeps a validated receipt when later semantics differ", () => {
		const singleLine = "甲乙丙";
		const singleFingerprint = sha256Hex(singleLine);
		const singleContract = {
			...deliveryContract,
			canvasFacts: { ...deliveryContract.canvasFacts, authoritativeSources: [{ sourceId, sourceFingerprint: singleFingerprint, content: singleLine }] },
		};
		const singleLedger = {
			sourceId,
			sourceFingerprint: singleFingerprint,
			units: [{ unitId: "unit:line", sourceLineId: "source-0:source-line-1", text: singleLine, expression: "narration", speakerName: null, delivery: null }],
		};
		const projection = projectOpeningClip({
			executionId: "e", nodeId: "n", openingClip: openingArtifact(2), deliveryContract: singleContract,
		});
		const prefix = bindOpeningClipPrefixToSourceLedger({ acceptedOpeningClip: projection.acceptedOpeningClip, deliveryContract: singleContract, sourceLedger: singleLedger });
		expect(prefix.sourceUnitRefs).toEqual([{ unitId: "unit:line", endOffset: 2 }]);
		const fullBeatSheet = {
			sourceId,
			sourceFingerprint: singleFingerprint,
			beats: [{ clipId: projection.acceptedOpeningClip.clipId, clipIndex: 0, sourceUnitRefs: prefix.sourceUnitRefs, narrativeIntent: "后续 Agent 可独立结构化" }],
		};
		expect(mergeOpeningClipPrefix({ openingPrefix: prefix, fullBeatSheet, sourceLedger: singleLedger }).conflict).toBeNull();
	});
});
