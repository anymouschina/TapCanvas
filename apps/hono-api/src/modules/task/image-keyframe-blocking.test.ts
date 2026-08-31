import { describe, expect, it } from "vitest";

import { resolveKeyframeBlockingReference } from "./image-keyframe-blocking";
import {
	hashKeyframeCompositionContract,
	type KeyframeCompositionContract,
} from "./keyframe-composition-contract";

const compositionContract: KeyframeCompositionContract = {
	narrativeTask: "两名道童共同宣告宫门开启",
	focusKind: "relationship",
	focusTargetNames: ["昊天", "瑶池"],
	focalPoint: [0.5, 0.42],
	shotScale: "wide",
	environmentVisualWeight: "primary",
	subjects: [
		{
			name: "昊天",
			visualWeight: "secondary",
			depthLayer: "midground",
			centerPlacement: "allowed",
			maxFrameHeightRatio: 0.42,
		},
		{
			name: "瑶池",
			visualWeight: "secondary",
			depthLayer: "midground",
			centerPlacement: "allowed",
			maxFrameHeightRatio: 0.42,
		},
	],
};
const compositionContractHash = hashKeyframeCompositionContract(compositionContract);
const blockingImageUrl = `https://cdn.test/${compositionContractHash}-blocking.png`;

const metadata = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	chapterGrounded: true,
	lockedAnchors: {
		character: ["昊天", "瑶池"],
		scene: ["紫霄宮門外候道場"],
		shot: [],
		continuity: [],
		missing: [],
	},
	authorityBaseFrame: {
		status: "planned",
		source: "chapter_context",
		reason: "pending",
	},
	compositionContract,
	compositionContractHash,
	...over,
});

const blockingNode = {
	id: "blocking-0",
	data: {
		kind: "image",
		productionLayer: "blocking_diagram",
		sceneName: "紫霄宮門外候道場",
		imageUrl: blockingImageUrl,
		productionMetadata: {
			lockedAnchors: { character: ["昊天", "瑶池"] },
			compositionContract,
			compositionContractHash,
		},
	},
};

describe("resolveKeyframeBlockingReference", () => {
	it("does not infer blocking from a multi-character keyframe", () => {
		expect(
			resolveKeyframeBlockingReference({
				nodeData: {
					productionLayer: "keyframe",
					productionMetadata: metadata(),
				},
				nodes: [],
			}),
		).toBeNull();
	});

	it("requires a blocking node for an explicitly spatial keyframe", () => {
		expect(() =>
			resolveKeyframeBlockingReference({
				nodeData: {
					productionLayer: "keyframe",
					productionMetadata: metadata({ spatialBlocking: true }),
				},
				nodes: [],
			}),
		).toThrowError(
			expect.objectContaining({
				code: "keyframe_blocking_reference_required",
				terminal: false,
			}),
		);
	});

	it("returns the verified blocking image when character and scene anchors match", () => {
		expect(
			resolveKeyframeBlockingReference({
				nodeData: {
					productionLayer: "keyframe",
					productionMetadata: metadata({
						spatialBlocking: true,
						blockingFrameNodeId: "blocking-0",
					}),
				},
				nodes: [blockingNode],
			}),
		).toMatchObject({
			nodeId: "blocking-0",
			imageUrl: blockingImageUrl,
			compositionContractHash,
		});
	});

	it("rejects a blocking diagram that omits one of the keyframe characters", () => {
		expect(() =>
			resolveKeyframeBlockingReference({
				nodeData: {
					creationStage: "beat_keyframe",
					productionMetadata: metadata({
						spatialBlocking: true,
						blockingFrameNodeId: "blocking-0",
					}),
				},
				nodes: [
					{
						...blockingNode,
						data: {
							...blockingNode.data,
							productionMetadata: {
								lockedAnchors: { character: ["昊天"] },
							},
						},
					},
				],
			}),
		).toThrowError(
			expect.objectContaining({ code: "keyframe_blocking_character_coverage_missing" }),
		);
	});

	it("does not require blocking for a single-character non-spatial keyframe", () => {
		const single = metadata();
		(single.lockedAnchors as Record<string, unknown>).character = ["昊天"];
		expect(
			resolveKeyframeBlockingReference({
				nodeData: { productionLayer: "keyframe", productionMetadata: single },
				nodes: [],
			}),
		).toBeNull();
	});
});
