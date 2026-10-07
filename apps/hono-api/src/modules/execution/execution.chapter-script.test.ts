import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import { bindChapterScriptAuthoringContract, compileChapterScript, adaptedSources, resolveAdaptationSpans } from "./execution.chapter-script";
import { projectChapterSequence } from "./execution.chapter-sequence";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { retentionCatalog } from "./execution.chapter-retention";

const CONTENT = "顾观棋独坐雅间。\n门外响起敲门声。\n“请进。”顾观棋起身。\n林嫣儿走进来。\n“顾公子，久等了。”林嫣儿说。";
function delivery(targetDurationSeconds?: number) {
	return { protocolVersion: "2", executionScope: "media_delivery", ...(targetDurationSeconds === undefined ? {} : { targetDurationSeconds }),
		generationContract: { videoModel: "test-model", durationOptions: [30], maxDurationSeconds: 30, clipPlanningPolicy: "agent_semantic_duration_budget" },
		canvasFacts: { authoritativeSources: [{ sourceId: "chapter:test", sourceFingerprint: sha256Hex(CONTENT), content: CONTENT }] } };
}
function script() {
	return { wholeFilmIntent: "敲门打断等待，客人入场。", sourceKind: "narrative", characters: ["顾观棋", "林嫣儿"],
		adaptation: [{ spanId: "A", until: "林嫣儿说。", decision: "dramatize", note: "开场" }],
		clips: [{ clipId: "arrival", durationSeconds: 30 }],
		scenes: [{ sceneId: "room", setting: "午后的雅间", place: "雅间", adapts: ["A"], cast: ["顾观棋"], entryState: "顾观棋独坐", exitState: "两人见面",
			beats: [
				{ clipId: "arrival", performance: "atmosphere", picture: "顾观棋手指轻敲桌面，门外传来敲门声", visible: ["顾观棋"], shows: ["U1", "U2"] },
				{ clipId: "arrival", performance: "dialogue", picture: "顾观棋抬头回应，起身走向门口", visible: ["顾观棋"], speech: { speaker: "顾观棋", voice: "onscreen", delivery: "平静", says: "U3" } },
				{ clipId: "arrival", performance: "dialogue", picture: "林嫣儿推门入场，向顾观棋行礼", visible: ["顾观棋", "林嫣儿"], speech: { speaker: "林嫣儿", voice: "onscreen", delivery: "客气", says: "U6" } },
			] }],
	};
}

describe("ordered chapter authoring", () => {
	it("requires provider clip ownership without per-beat or per-line timing", () => {
		const bound = bindChapterScriptAuthoringContract({ allowedFields: [], expectedArrayLengths: { clips: 15 } }, delivery());
		expect(bound.contractVersion).toBe("3");
		expect(bound.requiredArrayFields).toEqual(["adaptation", "scenes", "clips"]);
		expect(bound.expectedArrayLengths).toEqual({});
		expect(bound.exactStringFields).toBeUndefined();
		expect(String(bound.jsonSchema!.description)).toContain("不分配拍内时钟");
		expect(String(bound.jsonSchema!.description)).not.toContain("0 < speech.seconds");
		expect(validateWorkflowToolArguments(bound.jsonSchema!, script())).toEqual([]);
	});
	it("compiles three descriptions into a 30s clip without inventing a beat clock", () => {
		const sequence = compileChapterScript(script(), delivery());
		expect(sequence.protocolVersion).toBe("tapcanvas.chapter-sequence/v4");
		expect(sequence.totalDurationSeconds).toBe(30);
		expect(sequence.storyEvents.map((event) => [event.eventIndex, event.clipId])).toEqual([[0, "arrival"], [1, "arrival"], [2, "arrival"]]);
		for (const event of [...sequence.storyEvents, ...sequence.speechEvents]) {
			expect(event).not.toHaveProperty("startSeconds"); expect(event).not.toHaveProperty("endSeconds");
		}
		expect(sequence.speechEvents[0]).toMatchObject({ text: "请进。", scope: "beat", storyEventId: "room-b2", eventIndex: 1 });
		expect(sequence.storyEvents[2]!.onScreen).toEqual(["顾观棋", "林嫣儿"]);
		expect(sequence.scenes![0]!.clipIds).toEqual(["arrival"]);
		const projection = projectChapterSequence({ executionId: "e", nodeId: "n", sequence, deliveryContract: delivery() });
		expect(projection.clipCollection.items[0]!.value.storyEvents).toEqual(sequence.storyEvents);
	});
	it("rejects obsolete clock fields structurally rather than accepting a false clock", () => {
		const candidate = script();
		const obsolete = { ...candidate, scenes: [{ ...candidate.scenes[0], beats: candidate.scenes[0]!.beats.map((beat) => ({ ...beat, durationSeconds: 2 })) }] };
		expect(() => compileChapterScript(obsolete, delivery())).toThrow(/durationSeconds.*not allowed/);
		const line = candidate.scenes[0]!.beats[1]!;
		const obsoleteSpeech = { ...candidate, scenes: [{ ...candidate.scenes[0], beats: [{ ...line, speech: { ...line.speech, seconds: 2 } }] }] };
		expect(() => compileChapterScript(obsoleteSpeech, delivery())).toThrow(/seconds.*not allowed/);
	});
	it("accepts long dialogue without a local speech-duration or density gate", () => {
		const candidate = script();
		const line = candidate.scenes[0]!.beats[1]!;
		const speech = { ...line.speech, says: "完整台词，不按字数换算时长，也不要求压缩进两秒。".repeat(20) };
		const sequence = compileChapterScript({ ...candidate, scenes: [{ ...candidate.scenes[0], beats: [{ ...line, speech }] }] }, delivery());
		expect(sequence.speechEvents[0]!.text).toBe(speech.says);
	});
	it("keeps memory voice independent of the first beat and requires explicit clip ownership", () => {
		const candidate = script();
		const memoryVoice = { clipId: "arrival", speaker: "顾观棋", voice: "inner", delivery: "回忆", says: "很久以前，他曾在这里等过她。" };
		const sequence = compileChapterScript({ ...candidate, scenes: [{ ...candidate.scenes[0], memoryVoice }] }, delivery());
		expect(sequence.speechEvents.filter((event) => event.scope === "scene")).toEqual([expect.objectContaining({ clipId: "arrival", text: memoryVoice.says, sceneId: "room" })]);
		expect(sequence.speechEvents.filter((event) => event.scope === "beat")).toHaveLength(2);
		expect(sequence.speechEvents.find((event) => event.scope === "scene")).not.toHaveProperty("storyEventId");
		expect(() => compileChapterScript({ ...candidate, scenes: [{ ...candidate.scenes[0], memoryVoice: { ...memoryVoice, clipId: "missing" } }] }, delivery())).toThrow(/must belong to this scene/);
	});
	it("preserves optional staging facts without requiring their creation", () => {
		const candidate = script();
		const layout = { landmarks: [{ kind: "door", label: "门", at: [0, 0.5] }], marks: [{ mark: "table", where: "桌旁", at: [0.5, 0.5] }] };
		const sequence = compileChapterScript({ ...candidate, scenes: [{ ...candidate.scenes[0], layout, positions: [{ who: "顾观棋", mark: "table", posture: "sit" }] }] }, delivery());
		expect(sequence.scenes![0]!.layout).toEqual(layout);
		expect(() => compileChapterScript(candidate, delivery())).not.toThrow();
	});
	it("keeps provider duration and explicit target boundaries", () => {
		const candidate = script();
		expect(() => compileChapterScript({ ...candidate, clips: [{ clipId: "arrival", durationSeconds: 31 }] }, delivery())).toThrow(/frozen provider duration/);
		expect(() => compileChapterScript(candidate, delivery(60))).toThrow(/differs from frozen target/);
	});
	it("rejects unknown owners, empty clips and backwards clip order", () => {
		const candidate = script();
		const scene = candidate.scenes[0]!;
		expect(() => compileChapterScript({ ...candidate, scenes: [{ ...scene, beats: [{ ...scene.beats[0], clipId: "unknown" }] }] }, delivery())).toThrow(/unknown clip/);
		expect(() => compileChapterScript({ ...candidate, clips: [...candidate.clips, { clipId: "empty", durationSeconds: 30 }] }, delivery())).toThrow(/own at least one/);
		expect(() => compileChapterScript({ ...candidate, clips: [{ clipId: "first", durationSeconds: 30 }, ...candidate.clips], scenes: [{ ...scene, beats: [{ ...scene.beats[0], clipId: "arrival" }, { ...scene.beats[0], clipId: "first" }] }] }, delivery())).toThrow(/follow the declared clip order/);
	});
	it("reports invalid source units while preserving author creative choices", () => {
		const candidate = script(); const scene = candidate.scenes[0]!;
		expect(() => compileChapterScript({ ...candidate, scenes: [{ ...scene, beats: [{ ...scene.beats[0], shows: ["U99"] }] }] }, delivery())).toThrow(/not a source unit/);
		expect(() => compileChapterScript({ ...candidate, adaptation: [{ ...candidate.adaptation[0], decision: "cut" }] }, delivery())).not.toThrow();
	});
});

describe("adaptation source facts", () => {
	it("partitions frozen sources and keeps quote coordinates", () => {
		const sources = delivery().canvasFacts.authoritativeSources;
		const spans = resolveAdaptationSpans([{ spanId: "A", until: "顾观棋独坐雅间。", decision: "dramatize", note: "开头" }, { spanId: "B", until: "林嫣儿说。", decision: "condense", note: "其余" }], sources);
		expect(spans.map((span) => CONTENT.slice(span.sourceRanges[0]!.startOffset, span.sourceRanges[0]!.endOffset)).join("")).toBe(CONTENT);
		const opening = adaptedSources(spans.slice(0, 1), sources);
		expect(retentionCatalog(opening)).toHaveLength(1);
		expect(() => resolveAdaptationSpans([{ spanId: "A", until: "原文没有", decision: "dramatize", note: "无" }], sources)).toThrow(/not verbatim source text/);
	});
});
