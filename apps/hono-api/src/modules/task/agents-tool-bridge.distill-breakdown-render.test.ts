import { describe, expect, it } from "vitest";

import {
	renderDirectorBreakdownMarkdown,
	type DirectorBreakdown,
	type DirectorShot,
} from "./agents-tool-bridge.distill-director-breakdown";

// 【拆片卡落画布 v1】markdown 渲染器：人读报告结构完整 + 长片逐镜截断注明。

function makeShot(index: number, overrides?: Partial<DirectorShot>): DirectorShot {
	return {
		index,
		approxStartSec: index * 3,
		approxEndSec: index * 3 + 3,
		approxDurationSec: 3,
		shotSize: "中景",
		cameraAngle: "平视",
		cameraMove: "缓推",
		focalLength: "35mm",
		subject: "女主",
		action: "推门而入",
		sceneEnv: "图书馆",
		lighting: "侧逆光",
		composition: "三分法",
		editRelation: "硬切",
		directorIntent: "建立空间",
		...overrides,
	};
}

function makeBreakdown(shotCount: number): DirectorBreakdown {
	return {
		version: 1,
		sourceVideoUrl: "https://example.com/ref.mp4",
		totalDurationSec: shotCount * 3,
		aspectRatio: "16:9",
		fps: 24,
		logline: "女主发现秘密",
		narrativeStructure: "三幕",
		pacingMode: "continuous",
		visualMotif: { light: "侧逆光", color: "青橙", motion: "缓推" },
		signatureShot: "结尾拉远",
		cast: [{ roleName: "女主", appearance: "红裙长发" }],
		locations: [{ name: "图书馆", description: "老式木质书架" }],
		shotCount,
		shots: Array.from({ length: shotCount }, (_, i) => makeShot(i)),
	};
}

describe("renderDirectorBreakdownMarkdown", () => {
	it("完整结构：头部元信息 + 花名册 + 场景册 + 逐镜行", () => {
		const md = renderDirectorBreakdownMarkdown(makeBreakdown(3));
		expect(md).toContain("# 拆片卡（导演拆解）");
		expect(md).toContain("logline：女主发现秘密");
		expect(md).toContain("节奏 continuous");
		expect(md).toContain("- 女主：红裙长发");
		expect(md).toContain("- 图书馆：老式木质书架");
		expect(md).toContain("1｜0.0-3.0s｜中景/平视/缓推｜女主：推门而入（意图：建立空间）");
		expect(md).toContain("3｜6.0-9.0s｜");
		expect(md).not.toContain("截断");
	});

	it("长片截断：超过 maxShots 只渲染前 N 镜并注明", () => {
		const md = renderDirectorBreakdownMarkdown(makeBreakdown(90), { maxShots: 60 });
		expect(md).toContain("60｜");
		expect(md).not.toContain("\n61｜");
		expect(md).toContain("共 90 镜，此处截断展示前 60 镜");
	});

	it("缺省字段兜底：空 logline/母题/意图不产生 undefined 文本", () => {
		const b = makeBreakdown(1);
		b.logline = "";
		b.visualMotif = { light: "", color: "", motion: "" };
		b.shots[0] = makeShot(0, { directorIntent: "", subject: "", action: "凝视窗外" });
		const md = renderDirectorBreakdownMarkdown(b);
		expect(md).toContain("logline：（无）");
		expect(md).toContain("视觉母题：（无）");
		expect(md).toContain("｜凝视窗外");
		expect(md).not.toContain("undefined");
		expect(md).not.toContain("（意图：）");
	});
});
