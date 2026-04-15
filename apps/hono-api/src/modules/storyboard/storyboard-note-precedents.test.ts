import { describe, expect, it } from "vitest";
import {
	buildStoryboardPrecedentPromptBlock,
	retrieveRelevantStoryboardPrecedents,
	summarizeStoryboardPrecedentContent,
} from "./storyboard-note-precedents";

describe("storyboard note precedents", () => {
	it("summarizes creative-process json into compact structured fields", () => {
		const summary = summarizeStoryboardPrecedentContent({
			sourcePath: "/tmp/example.json",
			sourceName: "example.json",
			text: JSON.stringify({
				title: "山村夜戏",
				theme: "民俗惊悚与因果报应",
				tone: "冷峻压迫",
				arc: "异变降临后的生存调查",
				pacing: "前慢后快，冲突逐镜抬升",
				shotPatterns: ["先建立空间，再切入人物异常反应"],
				antiPatterns: ["不要把作者说明塞进镜头"],
				summary: "夜雨中的祠堂异变，角色被迫调查尸体与旧俗。",
			}),
		});

		expect(summary?.kind).toBe("creative_process_json");
		expect(summary?.theme).toContain("民俗惊悚");
		expect(summary?.shotPatterns).toContain("先建立空间，再切入人物异常反应");
		expect(summary?.antiPatterns).toContain("不要把作者说明塞进镜头");
	});

	it("summarizes text notes and preserves noise-filter anti-patterns", () => {
		const summary = summarizeStoryboardPrecedentContent({
			sourcePath: "/tmp/note.txt",
			sourceName: "note.txt",
			text: [
				"《蛊真人》/作者：蛊真人",
				"内容简介：一个目标执念极强、黑暗成长的长篇故事。",
				"扫书报告：整体气质残酷冷峻，前期压抑，后续持续升级。",
				"来源：http://example.com",
				"作者说明：以下不是正文。",
				"第一章 魔头复生，山雨将至。",
			].join("\n"),
		});

		expect(summary?.kind).toBe("creative_process_text");
		expect(summary?.theme).toContain("黑暗成长");
		expect(summary?.tone).toBe("冷峻压迫");
		expect(summary?.antiPatterns).toContain("排除作者自述与章节外说明");
		expect(summary?.antiPatterns).toContain("排除站点水印、链接与平台导流文本");
		expect(summary?.synopsis).toContain("黑暗成长");
		expect(summary?.synopsis).not.toContain("扫书报告");
		expect(summary?.pacing).toBe("冲突持续升级");
	});

	it("filters review boilerplate instead of treating it as story synopsis", () => {
		const summary = summarizeStoryboardPrecedentContent({
			sourcePath: "/tmp/review-note.txt",
			sourceName: "review-note.txt",
			text: [
				"某书评整理",
				"扫书报告：这本书很爽很上头，我个人觉得节奏飞起。",
				"书评：读者都说太精彩了。",
				"来源：www.example.com",
				"作者说明：以下不是正文。",
				"第一章，少年在祠堂里发现一具倒吊尸体，连夜追查真相。",
			].join("\n"),
		});

		expect(summary?.synopsis).toContain("少年在祠堂里发现一具倒吊尸体");
		expect(summary?.synopsis).not.toContain("很爽很上头");
		expect(summary?.theme).not.toContain("精彩");
		expect(summary?.pacing).toBeUndefined();
	});

	it("retrieves only the most relevant summarized precedents for the prompt", () => {
		const summaries = [
			summarizeStoryboardPrecedentContent({
				sourcePath: "/tmp/a.json",
				sourceName: "a.json",
				text: JSON.stringify({
					title: "民俗惊悚先例",
					theme: "民俗惊悚与尸体调查",
					tone: "冷峻压迫",
					shotPatterns: ["先建立祠堂空间，再切异常反应"],
				}),
			}),
			summarizeStoryboardPrecedentContent({
				sourcePath: "/tmp/b.json",
				sourceName: "b.json",
				text: JSON.stringify({
					title: "热血升级先例",
					theme: "热血修炼与正面对战",
					tone: "高燃昂扬",
					shotPatterns: ["多用正面冲锋和大开大合动作"],
				}),
			}),
		].filter((item): item is NonNullable<typeof item> => Boolean(item));

		const matches = retrieveRelevantStoryboardPrecedents({
			summaries,
			queryText: "祠堂夜雨中的尸体调查，气质冷峻压迫，先建立空间再切角色反应",
			limit: 1,
		});

		expect(matches).toHaveLength(1);
		expect(matches[0]?.summary.title).toBe("民俗惊悚先例");

		const promptBlock = buildStoryboardPrecedentPromptBlock(matches);
		expect(promptBlock).toContain("本地 precedent 摘要库");
		expect(promptBlock).toContain("民俗惊悚先例");
		expect(promptBlock).not.toContain("热血升级先例");
	});
});
