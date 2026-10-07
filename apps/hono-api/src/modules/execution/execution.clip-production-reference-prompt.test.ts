import { describe, expect, it } from "vitest";
import {
	parseClipProductionReferenceBindings,
	renderClipProductionReferenceHeader,
	renderClipProductionReferencePrompt,
	rebindClipProductionReferencePrompt,
	type ClipProductionReferenceBinding,
} from "./execution.clip-production-reference-prompt";

const bindings: readonly ClipProductionReferenceBinding[] = [
	{ nodeId: "character-node", name: "张羽", referenceType: "character" },
	{ nodeId: "scene-node", name: "药谷", referenceType: "scene" },
];

const preparedImages = [
	{ sourceNodeIds: ["character-node"] },
	{ sourceNodeIds: ["scene-node"] },
];

describe("Clip production reference prompt", () => {
	it("retains body edits and rebinds labels to the final manifest order", () => {
		const preparedHeader = renderClipProductionReferenceHeader({ bindings, images: preparedImages });
		const finalPrompt = rebindClipProductionReferencePrompt({
			prompt: `${preparedHeader}\n改过的提示词正文`,
			preparedHeader,
			bindings,
			images: [
				{ sourceNodeIds: ["scene-node"] },
				{ sourceNodeIds: ["character-node"] },
			],
		});
		expect(finalPrompt).toBe("参考：图1=药谷，图2=张羽。\n改过的提示词正文");
	});

	it("rebinds a legacy suffix legend in place, keeping its separation", () => {
		const legacyHeader = `\n\n${renderClipProductionReferenceHeader({ bindings, images: preparedImages })}`;
		expect(rebindClipProductionReferencePrompt({ prompt: `正文${legacyHeader}`, preparedHeader: legacyHeader, bindings,
			images: [{ sourceNodeIds: ["scene-node"] }, { sourceNodeIds: ["character-node"] }] }))
			.toBe("正文\n\n参考：图1=药谷，图2=张羽。");
	});

	it("opens the prompt with the style lock, then the legend, then the shots", () => {
		const rendered = renderClipProductionReferencePrompt({ prompt: "镜头1：动作。", bindings, images: preparedImages,
			stylePrompt: "国风3D动画电影CG渲染。\n必须看得出是3D。\n" });
		expect(rendered).toBe("画风：国风3D动画电影CG渲染。必须看得出是3D。\n参考：图1=张羽，图2=药谷。\n镜头1：动作。");
		expect(renderClipProductionReferencePrompt({ prompt: "镜头1：动作。", bindings: [], images: [], stylePrompt: "  " })).toBe("镜头1：动作。");
	});

	it("preserves authored scene headings and audio directions without adding global prohibitions", () => {
		const prompt = "【回忆】\n镜头1：母亲推门。\n配乐：温暖的弦乐。字幕：三年前。\n【当下】\n镜头2：女儿合上信封。";
		expect(renderClipProductionReferencePrompt({ prompt, bindings: [], images: [] })).toBe(prompt);
		const quietPrompt = "无配乐、无字幕。\n镜头1：女儿读信。";
		expect(renderClipProductionReferencePrompt({ prompt: quietPrompt, bindings: [], images: [] })).toBe(quietPrompt);
	});

	it("maps multiple source nodes for one provider image to the same image slot", () => {
		const header = renderClipProductionReferenceHeader({
			bindings,
			images: [{ sourceNodeIds: ["scene-node", "character-node"] }],
		});
		expect(header).toBe("参考：图1=张羽、药谷。");
	});

	it("lists adjacent images on one line without repeating reference usage instructions", () => {
		const header = renderClipProductionReferenceHeader({
			bindings: [
				{ nodeId: "a", name: "顾观棋", referenceType: "character" },
				{ nodeId: "b", name: "林嫣儿", referenceType: "character" },
				{ nodeId: "c", name: "雅间", referenceType: "scene" },
			],
			images: [{ sourceNodeIds: ["a"] }, { sourceNodeIds: ["b"] }, { sourceNodeIds: ["c"] }],
		});
		expect(header).toBe("参考：图1=顾观棋，图2=林嫣儿，图3=雅间。");
	});

	it("names an image without usage text when its reference type has no stated usage", () => {
		const header = renderClipProductionReferenceHeader({
			bindings: [{ nodeId: "other-node", name: "旧海报", referenceType: "other" }],
			images: [{ sourceNodeIds: ["other-node"] }],
		});
		expect(header).toBe("参考：图1=旧海报。");
	});

	it("rejects missing or ambiguous source node matches", () => {
		expect(() => renderClipProductionReferenceHeader({
			bindings, images: [{ sourceNodeIds: ["character-node"] }],
		})).toThrow(/missing planned reference node scene-node/);
		expect(() => renderClipProductionReferenceHeader({
			bindings, images: [
				{ sourceNodeIds: ["character-node"] },
				{ sourceNodeIds: ["character-node", "scene-node"] },
			],
		})).toThrow(/ambiguous matches for planned reference node character-node/);
	});

	it("rejects a removed or edited prepared suffix", () => {
		const preparedHeader = renderClipProductionReferenceHeader({ bindings, images: preparedImages });
		expect(() => rebindClipProductionReferencePrompt({
			prompt: `正文${preparedHeader.slice(0, -1)}x`, preparedHeader, bindings, images: preparedImages,
		})).toThrow(/reference header was removed or changed/);
		expect(() => rebindClipProductionReferencePrompt({
			prompt: `正文${preparedHeader}`, preparedHeader: `${preparedHeader}x`, bindings, images: preparedImages,
		})).toThrow(/reference header was removed or changed/);
	});

	it("validates persisted bindings by exact unique node identity", () => {
		expect(parseClipProductionReferenceBindings(bindings)).toEqual(bindings);
		expect(() => parseClipProductionReferenceBindings([
			...bindings, { nodeId: "character-node", name: "另一个名字", referenceType: "character" },
		])).toThrow(/duplicate nodeId character-node/);
		expect(() => parseClipProductionReferenceBindings([{ nodeId: "character-node", name: "张羽" }]))
			.toThrow(/referenceType must be a non-empty string/);
	});

	it("does not append frozen dialogue outside the compiled timeline", () => {
		const authoredText = "  我来，\n现在。 ";
		const quotedText = "\n原文片段  ";
		const speechEvents = [
			{ speechEventId: "speech-authored", speaker: "阿乔", delivery: "on_screen", text: authoredText,
				textOrigin: "authored" as const, eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene" as const, sourceRanges: [] },
			{ speechEventId: "speech-quoted", speaker: "阿乔", delivery: "off_screen", text: quotedText,
				textOrigin: "source_quote" as const, eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene" as const, sourceRanges: [{ sourceIndex: 0, startOffset: 0,
					endOffset: 4, sourceId: "chapter", sourceFingerprint: "sha256:chapter" }] },
		];
		const prompt = "人物转身，停在门口。";
		const rendered = renderClipProductionReferencePrompt({ prompt, speechEvents, bindings: [], images: [] });
		expect(rendered).toBe(prompt);
		expect(renderClipProductionReferencePrompt({ prompt, speechEvents: [], bindings: [], images: [] })).toBe(prompt);
		expect(renderClipProductionReferencePrompt({ prompt, bindings: [], images: [] })).toBe(prompt);
	});

	it("keeps the compiled timeline body intact when prepared submission rebinds reference labels", () => {
		const speechEvents = [{ speechEventId: "speech-1", speaker: "阿乔", delivery: "on_screen", text: "我来。",
			textOrigin: "authored" as const, eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene" as const, sourceRanges: [] }];
		const preparedHeader = renderClipProductionReferenceHeader({ bindings, images: preparedImages });
		const preparedPrompt = renderClipProductionReferencePrompt({ prompt: "动作继续。", speechEvents, bindings, images: preparedImages });
		const finalPrompt = rebindClipProductionReferencePrompt({ prompt: preparedPrompt, preparedHeader, bindings,
			images: [{ sourceNodeIds: ["scene-node"] }, { sourceNodeIds: ["character-node"] }] });
		expect(finalPrompt).toBe(`参考：图1=药谷，图2=张羽。\n动作继续。`);
	});

	it("leaves precompiled descriptive shots and exact text untouched", () => {
		const speechEvents = [{ speechEventId: "speech-after-boundary", speaker: "姐姐", delivery: "自然接话",
			text: "  台词逐字保留。\n", textOrigin: "authored" as const,
			eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene" as const, sourceRanges: [] }];
		const before = structuredClone(speechEvents);
		const timeline = "镜头1\n画面：姐姐转身。\n对白｜姐姐｜语气：自然接话\n台词：{  台词逐字保留。\n}";
		const rendered = renderClipProductionReferencePrompt({ prompt: timeline, speechEvents, bindings: [], images: [] });
		expect(rendered).toBe(timeline);
		expect(speechEvents).toEqual(before);
	});

	it("rebinds deduplicated image slots after final manifest ordering without touching style, shots or speech", () => {
		const body = "场景：药谷。\n镜头1：张羽转身。\n对白｜张羽｜语气：低声\n台词：{  先别走。\n}";
		const stylePrompt = "国风3D动画电影CG渲染。";
		const preparedHeader = renderClipProductionReferenceHeader({ bindings, images: preparedImages });
		const preparedPrompt = renderClipProductionReferencePrompt({ prompt: body, stylePrompt, bindings, images: preparedImages });
		const images = [{ sourceNodeIds: ["unbound-node"] }, { sourceNodeIds: ["scene-node", "character-node"] }];
		const finalPrompt = rebindClipProductionReferencePrompt({ prompt: preparedPrompt, preparedHeader, bindings, images });
		expect(finalPrompt).toBe(`画风：国风3D动画电影CG渲染。\n参考：图2=张羽、药谷。\n${body}`);
		expect(finalPrompt).toBe(renderClipProductionReferencePrompt({ prompt: body, stylePrompt, bindings, images }));
	});
});
