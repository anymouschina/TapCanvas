import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import { bindChapterScriptAuthoringContract, compileChapterScript } from "./execution.chapter-script";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { compileClipProductionTimeline } from "../../../../../packages/schemas/clip-production-packet/timeline.mjs";
import { projectChapterSequence } from "./execution.chapter-sequence";
import { clipSegmentStaging, clipStagingPlan, readClipStaging } from "./execution.chapter-staging";

// The chapter author learns from a worked example rather than from host checks, so the
// example it is shown must always be a script this contract accepts as written.
const EXAMPLE = path.resolve(__dirname, "../../../../agents-cli/skills/tapcanvas-video-authoring-stages/references/example-opening-60s.md");
const SHOTS_EXAMPLE = path.resolve(__dirname, "../../../../agents-cli/skills/tapcanvas-video-prompt-writer/references/example-clip-shots-opening.md");
const SOURCE = path.resolve(__dirname, "__fixtures__/chapter-opening-original-source.txt");

function jsonBlock(file: string): unknown {
	const block = fs.readFileSync(file, "utf8").match(/```json\n([\s\S]*?)\n```/u);
	if (!block) throw new Error(`${path.basename(file)} has no json block`);
	return JSON.parse(block[1]!);
}
const exampleScript = () => jsonBlock(EXAMPLE);

function openingDelivery(content: string) {
	return {
		protocolVersion: "2", executionScope: "media_delivery", targetDurationSeconds: 60, sourceExtent: "opening",
		generationContract: { videoModel: "dola-seedance-2.5", durationOptions: [30], maxDurationSeconds: 30, clipPlanningPolicy: "agent_semantic_duration_budget" },
		canvasFacts: { authoritativeSources: [{ sourceId: "chapter:workshop-1", sourceFingerprint: sha256Hex(content), content }] },
	};
}

describe("chapter author skill example", () => {
	it("is a 60-second opening the current contract accepts as written", () => {
		const contract = openingDelivery(fs.readFileSync(SOURCE, "utf8"));
		const schema = bindChapterScriptAuthoringContract({ allowedFields: [] }, contract).jsonSchema!;
		const script = exampleScript();
		expect(validateWorkflowToolArguments(schema, script)).toEqual([]);
		const sequence = compileChapterScript(script, contract);
		expect(sequence.totalDurationSeconds).toBe(60);
		expect(sequence.clips).toHaveLength(2);
		// It ends on the hook, with every covered line of dialogue said verbatim.
		expect(sequence.speechEvents.at(-1)).toMatchObject({ speaker: "许岚", text: "先别拿，比例尺贴反了！" });
	});

	it("keeps host staging for a Clip that cuts through unstaged memory montages", () => {
		// A Clip with four unstaged memories must retain the surrounding staging without requiring a
		// full blockingPlan and one malformed landmark failed the Clip.
		const contract = openingDelivery(fs.readFileSync(SOURCE, "utf8"));
		const sequence = compileChapterScript(exampleScript(), contract);
		const clips = projectChapterSequence({ executionId: "e", nodeId: "n", sequence, deliveryContract: contract }).clipCollection.items.map((item) => item.value);
		expect(clips.map((clip) => readClipStaging(clip) !== null)).toEqual([true, true]);
		const plan = clipStagingPlan(clips[0]);
		expect(plan?.stages.map((stage) => stage.sceneId)).toEqual(["street", "room", "room-wait"]);
		const segments = [{ storyEventIds: ["street-b1"] }, { storyEventIds: ["room-b1", "room-b2"] }, { storyEventIds: ["past-life-b1", "rebirth-b1", "rescue-b1", "chess-b1"] }, { storyEventIds: ["room-wait-b1"] }];
		const staged = clipSegmentStaging(clips[0], segments)!;
		expect(staged[2]).toEqual({ positions: null, moves: [] });
		expect(staged[3]!.positions).not.toBeNull();
	});

	it("pairs with descriptive shots that bind each frozen line once without per-shot clocks", () => {
		const contract = openingDelivery(fs.readFileSync(SOURCE, "utf8"));
		const sequence = compileChapterScript(exampleScript(), contract);
		const clip = projectChapterSequence({ executionId: "example", nodeId: "sequence", sequence, deliveryContract: contract }).clipCollection.items[1]!.value;
		const draft = jsonBlock(SHOTS_EXAMPLE) as { shots: { storyEventIds: string[]; speechEventIds: string[] }[] };
		expect(draft.shots.every((shot) => !("durationSeconds" in shot))).toBe(true);
		const prompt = compileClipProductionTimeline({ draft, storyEvents: clip.storyEvents, speechEvents: clip.speechEvents });
		if (process.env.PRINT_EXAMPLE_PROMPT) console.log(prompt);
		expect(prompt).toContain("说：“我是周禾，请问怎么称呼二位？”");
		expect(prompt).toContain("说：“先别拿，比例尺贴反了！”");
		expect(prompt.split("说：“先别拿，比例尺贴反了！”")).toHaveLength(2);
		expect(prompt).not.toMatch(/镜头\d+（[\d.]+[–-][\d.]+s）/u);
	});

	it("keeps the opening's quoted thought and authored memory speech as spoken prompt lines once across shots", () => {
		const contract = openingDelivery(fs.readFileSync(SOURCE, "utf8"));
		const sequence = compileChapterScript(exampleScript(), contract);
		const clip = projectChapterSequence({ executionId: "opening-audio", nodeId: "sequence", sequence, deliveryContract: contract }).clipCollection.items[0]!.value;
		const expectedSpeech = [
			{ speechEventId: "room-s2", speaker: "周禾", text: "这回尺寸应该能对上了吧？", textOrigin: "source_quote", voice: "inner", scope: "beat" },
			{ speechEventId: "past-life-memory-voice", speaker: "周禾", text: "上周，我发现图纸上的一处尺寸画错了。", textOrigin: "authored", voice: "offscreen", scope: "scene" },
			{ speechEventId: "rebirth-memory-voice", speaker: "周禾", text: "后来，我在库房找到了完整的备份图。", textOrigin: "authored", voice: "offscreen", scope: "scene" },
			{ speechEventId: "rescue-memory-voice", speaker: "周禾", text: "前天，我和陶叔修好了工作台。", textOrigin: "authored", voice: "offscreen", scope: "scene" },
			{ speechEventId: "chess-memory-voice", speaker: "陶叔", text: "我请了两位同伴来帮忙复核。", textOrigin: "authored", voice: "onscreen", scope: "scene" },
			{ speechEventId: "chess-s2", speaker: "陶叔", text: "她们对这些尺寸很熟。", textOrigin: "authored", voice: "onscreen", scope: "beat" },
			{ speechEventId: "chess-s3", speaker: "周禾", text: "那就一起核对。", textOrigin: "authored", voice: "onscreen", scope: "beat" },
		];
		const compiledSpeech = sequence.speechEvents.filter((event) => event.clipId === "opening-memory");
		expect(compiledSpeech).toMatchObject(expectedSpeech);
		expect(clip.speechEvents).toEqual(compiledSpeech);
		// These are authored shot bindings, not a second implementation of the compiler.
		// Both memory voices begin once and continue while their scene cuts to another shot.
		const draft = { scene: "工坊会合前的当下与回忆", shots: [
			{ action: "工坊外观。", camera: "", sound: "", storyEventIds: ["street-b1"], speechEventIds: [] },
			{ action: "坐在工作台前，展开图纸。", camera: "", sound: "", storyEventIds: ["room-b1", "room-b2"], speechEventIds: ["room-s2"] },
			{ action: "回忆上周，周禾走向旧展板。", camera: "", sound: "", storyEventIds: ["past-life-b1"], speechEventIds: ["past-life-memory-voice"] },
			{ action: "尺子放在错位的尺寸标记上。", camera: "", sound: "尺子触碰桌面的声音", storyEventIds: ["past-life-b2"], speechEventIds: [] },
			{ action: "库房里，周禾取出备份图纸。", camera: "", sound: "", storyEventIds: ["rebirth-b1"], speechEventIds: ["rebirth-memory-voice"] },
			{ action: "周禾展开图纸核对比例尺。", camera: "", sound: "", storyEventIds: ["rebirth-b2"], speechEventIds: [] },
			{ action: "周禾帮陶叔扶正工作台。", camera: "", sound: "", storyEventIds: ["rescue-b1"], speechEventIds: ["rescue-memory-voice"] },
			{ action: "陶叔在工坊桌前提议共同复核。", camera: "", sound: "", storyEventIds: ["chess-b1"], speechEventIds: ["chess-memory-voice"] },
			{ action: "陶叔指向门外，邀请同伴。", camera: "", sound: "", storyEventIds: ["chess-b2"], speechEventIds: ["chess-s2"] },
			{ action: "周禾放好图纸，点头答应。", camera: "", sound: "纸张声", storyEventIds: ["chess-b3"], speechEventIds: ["chess-s3"] },
			{ action: "回到工坊，周禾看向入口。", camera: "", sound: "", storyEventIds: ["room-wait-b1"], speechEventIds: [] },
		] };
		const prompt = compileClipProductionTimeline({ draft, storyEvents: clip.storyEvents, speechEvents: clip.speechEvents });
		// Chinese-quoted speech is what the production renderer sends as spoken text;
		// a line surviving only in visual description does not satisfy this assertion.
		const spokenTexts = Array.from(prompt.matchAll(/：“([^”]*)”/gu), (match) => match[1]);
		expect(spokenTexts).toEqual(expectedSpeech.map((event) => event.text));
		for (const event of expectedSpeech) expect(prompt.split(event.text)).toHaveLength(2);
		expect(prompt).toContain("周禾的内心独白（周禾声音，平静，带点自嘲）：“这回尺寸应该能对上了吧？”");
		for (const event of expectedSpeech.filter((event) => event.voice === "offscreen")) {
			expect(prompt).toContain(`周禾画外音（平静）：“${event.text}”`);
		}
		expect(prompt).toContain("陶叔（眉飞色舞）说：“我请了两位同伴来帮忙复核。”");
		expect(prompt).toContain("陶叔（得意地）说：“她们对这些尺寸很熟。”");
		expect(prompt).toContain("周禾（笑着应下）说：“那就一起核对。”");
	});
});
