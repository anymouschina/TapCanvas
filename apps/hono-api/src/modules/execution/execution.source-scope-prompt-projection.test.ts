import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import { CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE } from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION } from "../../../../../packages/schemas/video-clip-segmentation/index.mjs";
import { projectFrozenSourceScopePromptInputs } from "./execution.source-scope-prompt-projection";

function fixture() {
	const sourceId = "chapter-source";
	const content = `${"前文".repeat(400)}“甲说：开门🌟。”后文「乙说：来了！」尾声`;
	const sourceFingerprint = sha256Hex(content);
	const sourceSetFingerprint = sha256Hex(`${sourceId}\u0000${content}`);
	const firstSpeechStart = content.indexOf("甲说");
	const firstSpeechEnd = content.indexOf("”", firstSpeechStart);
	const currentScopeEnd = firstSpeechEnd + 1;
	const sourceRange = {
		sourceIndex: 0,
		sourceId,
		sourceFingerprint,
		startOffset: 0,
		endOffset: currentScopeEnd,
	};
	const firstSpeech = content.slice(firstSpeechStart, firstSpeechEnd);
	const secondSpeechStart = content.indexOf("乙说");
	const secondSpeechEnd = content.indexOf("」", secondSpeechStart);
	const secondSpeech = content.slice(secondSpeechStart, secondSpeechEnd);
	const sourceProfile = {
		protocolVersion: "tapcanvas.beat-sheet-source-profile/v2",
		sourceIds: [sourceId],
		sourceChars: content.length,
		sourceQuotedChars: firstSpeech.length + secondSpeech.length,
		sourceQuotedUnits: [
			{ unitId: "source-quote-001", sourceId, verbatim: firstSpeech, chars: firstSpeech.length },
			{ unitId: "source-quote-002", sourceId, verbatim: secondSpeech, chars: secondSpeech.length },
		],
		sourceSetFingerprint,
	};
	const inputs = {
		"clip-segment": [{
			protocolVersion: CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION,
			clipId: "source-fingerprint:clip:0",
			clipIndex: 0,
			durationSeconds: 10,
			sourceId,
			sourceFingerprint,
			sourceRanges: [sourceRange],
			sourceSlices: [{ ...sourceRange, text: content.slice(0, currentScopeEnd) }],
		}],
		"clip-sequence": [{
			protocolVersion: CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE,
			clipId: "source-fingerprint:clip:0",
			clipIndex: 0,
			durationSeconds: 10,
			sourceRanges: [sourceRange],
			speechEvents: [{
				speechEventId: "speech-current",
				speaker: "甲",
				delivery: "on_screen",
				text: firstSpeech,
				textOrigin: "source_quote",
				startSeconds: 1,
				endSeconds: 3,
				sourceRanges: [{
					sourceIndex: 0,
					sourceId,
					sourceFingerprint,
					startOffset: firstSpeechStart,
					endOffset: firstSpeechEnd,
				}],
			}],
		}],
		"delivery-contract": [{
			protocolVersion: "tapcanvas.workflow-delivery-contract/v2",
			canvasFacts: { authoritativeSources: [{ sourceId, sourceFingerprint, content }] },
			sourceProfile,
		}],
	} satisfies Readonly<Record<string, readonly unknown[]>>;
	return { inputs, content, firstSpeech, sourceProfile, sourceRange };
}

describe("projectFrozenSourceScopePromptInputs", () => {
	it("projects verified source text into a reference and speech statistics without mutating frozen inputs", () => {
		const { inputs, content, firstSpeech, sourceProfile, sourceRange } = fixture();
		const original = structuredClone(inputs);

		const result = projectFrozenSourceScopePromptInputs(inputs);

		expect(result.status).toBe("projected");
		expect(result.reason).toBe("frozen_source_scope_and_sequence_verified");
		expect(result.segmentPort).toBe("clip-segment");
		expect(result.sequencePort).toBe("clip-sequence");
		expect(result.removedSourceBodyCount).toBe(1);
		expect(result.removedQuotedUnitCount).toBe(2);
		expect(result.inputCharactersAfter).toBeLessThan(result.inputCharactersBefore);
		expect(inputs).toEqual(original);

		const delivery = result.inputs["delivery-contract"]?.[0] as {
			canvasFacts: { authoritativeSources: readonly Record<string, unknown>[] };
			sourceProfile: Record<string, unknown>;
		};
		expect(delivery.canvasFacts.authoritativeSources[0]).toMatchObject({
			sourceId: "chapter-source",
			sourceFingerprint: sha256Hex(content),
			contentReference: {
				fullSourceCharacters: content.length,
				scopedRanges: [sourceRange],
			},
		});
		expect(delivery.canvasFacts.authoritativeSources[0]).not.toHaveProperty("content");
		expect(delivery.sourceProfile).not.toHaveProperty("sourceQuotedUnits");
		expect(delivery.sourceProfile.sourceQuotedUnitsSummary).toMatchObject({
			unitCount: 2,
			verbatimCharacters: sourceProfile.sourceQuotedUnits.reduce((sum, unit) => sum + unit.verbatim.length, 0),
			structuredScopePort: "clip-sequence",
			clipId: "source-fingerprint:clip:0",
		});
		expect(result.inputs["clip-segment"]?.[0]).toEqual(inputs["clip-segment"]?.[0]);
		expect(result.inputs["clip-sequence"]?.[0]).toMatchObject({
			speechEvents: [{ text: firstSpeech, textOrigin: "source_quote" }],
		});
	});

	it("retains source facts and diagnoses a slice that differs from its frozen range", () => {
		const { inputs } = fixture();
		const alteredInputs = structuredClone(inputs) as Record<string, readonly unknown[]>;
		const segment = alteredInputs["clip-segment"]?.[0] as Record<string, unknown>;
		const sourceSlices = segment.sourceSlices as Array<Record<string, unknown>>;
		sourceSlices[0] = { ...sourceSlices[0], text: "x".repeat(String(sourceSlices[0]?.text).length) };

		const result = projectFrozenSourceScopePromptInputs(alteredInputs);

		expect(result.status).toBe("retained");
		expect(result.reason).toBe("frozen_source_identity_unverified");
		expect(result.inputs).toBe(alteredInputs);
		expect(JSON.stringify(result.inputs)).toContain("authoritativeSources");
		expect(result.removedSourceBodyCount).toBe(0);
		expect(result.removedQuotedUnitCount).toBe(0);
	});

	it("retains a source quote range that splits a UTF-16 surrogate pair", () => {
		const { inputs, content } = fixture();
		const alteredInputs = structuredClone(inputs) as Record<string, readonly unknown[]>;
		const sequence = alteredInputs["clip-sequence"]?.[0] as Record<string, unknown>;
		const speechEvents = sequence.speechEvents as Array<Record<string, unknown>>;
		const speechEvent = speechEvents[0];
		if (!speechEvent) throw new Error("fixture speech event missing");
		const emojiOffset = content.indexOf("🌟");
		const delivery = alteredInputs["delivery-contract"]?.[0] as {
			canvasFacts: { authoritativeSources: readonly Record<string, unknown>[] };
		};
		const source = delivery.canvasFacts.authoritativeSources[0];
		if (!source) throw new Error("fixture source missing");
		const fingerprint = String(source.sourceFingerprint);
		const loneHighSurrogate = content.slice(emojiOffset, emojiOffset + 1);
		speechEvent.text = loneHighSurrogate;
		speechEvent.sourceRanges = [{
			sourceIndex: 0,
			sourceId: "chapter-source",
			sourceFingerprint: fingerprint,
			startOffset: emojiOffset,
			endOffset: emojiOffset + 1,
		}];

		const result = projectFrozenSourceScopePromptInputs(alteredInputs);

		expect(result.status).toBe("retained");
		expect(result.reason).toBe("matching_speech_scope_incomplete_or_mismatched");
		expect(result.inputs).toBe(alteredInputs);
		expect(result.removedSourceBodyCount).toBe(0);
		expect(result.removedQuotedUnitCount).toBe(0);
		expect(JSON.stringify(result.inputs)).toContain("authoritativeSources");
	});

	it("projects a matching empty event list even when the frozen source contains quoted text", () => {
		const { inputs } = fixture();
		const emptyEventsInputs = structuredClone(inputs) as Record<string, readonly unknown[]>;
		const sequence = emptyEventsInputs["clip-sequence"]?.[0] as Record<string, unknown>;
		sequence.speechEvents = [];

		const result = projectFrozenSourceScopePromptInputs(emptyEventsInputs);

		expect(result.status).toBe("projected");
		expect(result.removedSourceBodyCount).toBe(1);
		expect(result.removedQuotedUnitCount).toBe(2);
		const delivery = result.inputs["delivery-contract"]?.[0] as {
			canvasFacts: { authoritativeSources: readonly Record<string, unknown>[] };
			sourceProfile: Record<string, unknown>;
		};
		expect(delivery.canvasFacts.authoritativeSources[0]).not.toHaveProperty("content");
		expect(delivery.sourceProfile).not.toHaveProperty("sourceQuotedUnits");
		expect(result.inputs["clip-sequence"]?.[0]).toMatchObject({ speechEvents: [] });
	});

	it("projects identically when source prose uses quotation marks outside the recognized set", () => {
		const { inputs, content } = fixture();
		const alteredInputs = structuredClone(inputs) as Record<string, readonly unknown[]>;
		const alteredContent = content.replaceAll("“", "<").replaceAll("”", ">").replaceAll("「", "(").replaceAll("」", ")");
		const alteredFingerprint = sha256Hex(alteredContent);
		const alteredSourceSetFingerprint = sha256Hex(`chapter-source\u0000${alteredContent}`);
		const delivery = alteredInputs["delivery-contract"]?.[0] as {
			canvasFacts: { authoritativeSources: Array<Record<string, unknown>> };
			sourceProfile: Record<string, unknown>;
		};
		delivery.canvasFacts.authoritativeSources[0] = {
			...delivery.canvasFacts.authoritativeSources[0],
			content: alteredContent,
			sourceFingerprint: alteredFingerprint,
		};
		delivery.sourceProfile.sourceSetFingerprint = alteredSourceSetFingerprint;
		const segment = alteredInputs["clip-segment"]?.[0] as Record<string, unknown>;
		segment.sourceFingerprint = alteredFingerprint;
		const segmentRanges = segment.sourceRanges as Array<Record<string, unknown>>;
		segmentRanges[0] = { ...segmentRanges[0], sourceFingerprint: alteredFingerprint };
		const segmentSlices = segment.sourceSlices as Array<Record<string, unknown>>;
		segmentSlices[0] = {
			...segmentRanges[0],
			text: alteredContent.slice(Number(segmentRanges[0]?.startOffset), Number(segmentRanges[0]?.endOffset)),
		};
		const sequence = alteredInputs["clip-sequence"]?.[0] as Record<string, unknown>;
		const sequenceRanges = sequence.sourceRanges as Array<Record<string, unknown>>;
		sequenceRanges[0] = { ...sequenceRanges[0], sourceFingerprint: alteredFingerprint };
		const speechEvents = sequence.speechEvents as Array<Record<string, unknown>>;
		const speechEvent = speechEvents[0];
		if (!speechEvent) throw new Error("fixture speech event missing");
		speechEvent.sourceRanges = (speechEvent.sourceRanges as Array<Record<string, unknown>>).map((range) => ({
			...range,
			sourceFingerprint: alteredFingerprint,
		}));

		const result = projectFrozenSourceScopePromptInputs(alteredInputs);

		expect(result.status).toBe("projected");
		expect(result.removedSourceBodyCount).toBe(1);
		expect(result.removedQuotedUnitCount).toBe(2);
	});

	it("accepts a complete authored speech-event projection for the same frozen scope", () => {
		const { inputs } = fixture();
		const authoredInputs = structuredClone(inputs) as Record<string, readonly unknown[]>;
		const sequence = authoredInputs["clip-sequence"]?.[0] as Record<string, unknown>;
		const events = sequence.speechEvents as Array<Record<string, unknown>>;
		events[0] = {
			...events[0],
			text: "按本段结构化时间演出",
			textOrigin: "authored",
			sourceRanges: [],
		};

		const result = projectFrozenSourceScopePromptInputs(authoredInputs);

		expect(result.status).toBe("projected");
		expect(result.removedSourceBodyCount).toBe(1);
		expect(result.removedQuotedUnitCount).toBe(2);
		expect(result.inputs["clip-sequence"]?.[0]).toMatchObject({
			speechEvents: [{ text: "按本段结构化时间演出", textOrigin: "authored", sourceRanges: [] }],
		});
	});

	it("retains a quote profile whose explicit source fingerprint does not match", () => {
		const { inputs } = fixture();
		const alteredInputs = structuredClone(inputs) as Record<string, readonly unknown[]>;
		const delivery = alteredInputs["delivery-contract"]?.[0] as {
			sourceProfile: Record<string, unknown>;
		};
		delivery.sourceProfile.sourceSetFingerprint = "unmatched-source-set";

		const result = projectFrozenSourceScopePromptInputs(alteredInputs);

		expect(result.status).toBe("retained");
		expect(result.reason).toBe("source_profile_does_not_match_frozen_source");
		expect(result.inputs).toBe(alteredInputs);
		expect(result.removedSourceBodyCount).toBe(0);
		expect(result.removedQuotedUnitCount).toBe(0);
	});

	it("retains facts and reports when no frozen scope is present", () => {
		const inputs = { "delivery-contract": [{ sourceProfile: { sourceQuotedUnits: [] } }] };

		const result = projectFrozenSourceScopePromptInputs(inputs);

		expect(result.status).toBe("retained");
		expect(result.reason).toBe("frozen_source_scope_not_found");
		expect(result.observedSourceFacts).toBe(true);
		expect(result.inputs).toBe(inputs);
	});
});
