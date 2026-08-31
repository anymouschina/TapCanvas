// 宿主流文本清洗器测试：跨 chunk 剥离 choices/tc-card、正文零误伤、未闭合 flush 原样吐回。
import { describe, expect, it } from "vitest";
import {
	HostStreamSanitizer,
	choicesCardToText,
	tcCardToText,
	type ChoicesCardPayload,
} from "./host-stream-sanitizer";

const CHOICES_JSON =
	'{"question":"选哪个风格?","options":[{"label":"赛博朋克","description":"霓虹夜景"},{"label":"水彩"}]}';

describe("HostStreamSanitizer", () => {
	it("单 chunk 完整 ```choices 围栏卡：剥离原文、产出 card、保留前后正文", () => {
		const s = new HostStreamSanitizer();
		const res = s.feed(`先说结论。\n\`\`\`choices\n${CHOICES_JSON}\n\`\`\`\n再补一句。`);
		expect(res.cards).toHaveLength(1);
		expect(res.cards[0].kind).toBe("choices");
		const payload = res.cards[0].payload as ChoicesCardPayload;
		expect(payload.question).toBe("选哪个风格?");
		expect(payload.options).toEqual([
			{ label: "赛博朋克", description: "霓虹夜景" },
			{ label: "水彩" },
		]);
		expect(res.text + s.flush()).toBe("先说结论。\n再补一句。");
		expect(res.text).not.toContain("choices");
		expect(res.text).not.toContain("{");
	});

	it("围栏卡跨 3 个 chunk 分片：文本零延迟、卡片在闭合 chunk 产出", () => {
		const s = new HostStreamSanitizer();
		const r1 = s.feed("正文开头\n``");
		// 尾部 "``" 是围栏前缀 → 扣留，正文即时透传
		expect(r1.text).toBe("正文开头\n");
		expect(r1.cards).toHaveLength(0);
		const r2 = s.feed('`choices\n{"question":"选?","options":[{"label":"A"},');
		expect(r2.text).toBe("");
		expect(r2.cards).toHaveLength(0);
		const r3 = s.feed('{"label":"B"}]}\n```\n收尾');
		expect(r3.cards).toHaveLength(1);
		expect((r3.cards[0].payload as ChoicesCardPayload).options.map((o) => o.label)).toEqual([
			"A",
			"B",
		]);
		expect(r3.text).toBe("收尾");
		expect(s.flush()).toBe("");
	});

	it("SBA choices 在宿主清洗后仍保留真实分支身份", () => {
		const s = new HostStreamSanitizer();
		const body = '{"question":"[SBA]接下来——","options":[{"label":"进山洞","metadata":{"kind":"sba_branch","version":1,"selectionEventId":"selection-1","branchNodeId":"node-1","sbaPath":"1A","basisFingerprint":"abc123"}}]}';
		const result = s.feed(`\`\`\`choices\n${body}\n\`\`\``);
		const payload = result.cards[0]!.payload as ChoicesCardPayload;
		expect(payload.options[0]!.metadata).toEqual({
			kind: "sba_branch",
			version: 1,
			selectionEventId: "selection-1",
			branchNodeId: "node-1",
			sbaPath: "1A",
			basisFingerprint: "abc123",
		});
	});

	it("裸 JSON（漏围栏行首 {\"question\"）跨 chunk：配平后产 card", () => {
		const s = new HostStreamSanitizer();
		const r1 = s.feed('说明：\n{"question":"哪个?","options":[{"la');
		expect(r1.text).toBe("说明：\n");
		expect(r1.cards).toHaveLength(0);
		const r2 = s.feed('bel":"甲"}]}\n后续');
		expect(r2.cards).toHaveLength(1);
		expect((r2.cards[0].payload as ChoicesCardPayload).options).toEqual([{ label: "甲" }]);
		expect(r2.text).toBe("\n后续");
	});

	it("正文含普通花括号/行中 JSON 不误伤、零延迟透传", () => {
		const s = new HostStreamSanitizer();
		const line = '代码里写 {"question": 1} 或 obj = {a: {b: 2}} 都是普通正文。';
		const r = s.feed(line);
		// 行中 {"question" 不在行首 → 不触发缓冲
		expect(r.text).toBe(line);
		expect(r.cards).toHaveLength(0);
		expect(s.flush()).toBe("");
		// 其他语言围栏（```json）也原样透传
		const s2 = new HostStreamSanitizer();
		const fence = '```json\n{"a":1}\n```\n';
		const r2 = s2.feed(fence);
		expect(r2.text + s2.flush()).toBe(fence);
		expect(r2.cards).toHaveLength(0);
	});

	it("流尾未闭合围栏：flush 原样吐回（宁漏勿吞）", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed('前文\n```choices\n{"question":"未闭合');
		expect(r.text).toBe("前文\n");
		expect(r.cards).toHaveLength(0);
		expect(s.flush()).toBe('```choices\n{"question":"未闭合');
	});

	it("```tc-card 围栏 → kind:tc-card 卡；解析失败原文吐回", () => {
		const s = new HostStreamSanitizer();
		const body = '{"name":"role_note","payload":{"role":"director","markdown":"ok"}}';
		const r = s.feed(`\`\`\`tc-card\n${body}\n\`\`\`\n`);
		expect(r.cards).toHaveLength(1);
		expect(r.cards[0].kind).toBe("tc-card");
		expect(r.cards[0].payload).toEqual({
			name: "role_note",
			payload: { role: "director", markdown: "ok" },
		});
		expect(r.text + s.flush()).toBe("");
		// 解析失败（非 JSON）→ 原样吐回
		const s2 = new HostStreamSanitizer();
		const bad = "```tc-card\nnot-json\n```\n";
		const r2 = s2.feed(bad);
		expect(r2.cards).toHaveLength(0);
		expect(r2.text + s2.flush()).toBe(bad);
	});

	it("artifact 卡的 markdown 内含代码围栏：闭合按行首 ``` 判定，不被内层围栏提前截断", () => {
		// 线上泄漏成因：body 里 markdown 合法带 ``` → 裸 indexOf("```") 提前截断 →
		// JSON.parse 失败 → 整张卡当正文吐回（宿主气泡出现 {"name":"artifact"...}）。
		const s = new HostStreamSanitizer();
		const body = JSON.stringify({
			name: "artifact",
			payload: { title: "TVC 脚本", markdown: "用法：\n```bash\nnpm run build\n```\n完" },
		});
		const r = s.feed(`前言\n\`\`\`tc-card\n${body}\n\`\`\`\n后记`);
		expect(r.cards).toHaveLength(1);
		expect(r.cards[0].kind).toBe("tc-card");
		expect((r.cards[0].payload as { name: string }).name).toBe("artifact");
		expect(r.text + s.flush()).toBe("前言\n后记");
		expect(r.text).not.toContain('{"name"');
	});

	it("```choices 闭合前换行可选（同行收尾）：对齐内核 CHOICES_FENCE_RE 的 \\n? ", () => {
		// 内核 choices 正则闭合换行可选、tc-card 必需；facade 若统一成「只认行首 ```」
		// 会让同行收尾的 choices 退化成原文泄漏（本用例钉住两者语义不同）。
		const s = new HostStreamSanitizer();
		const r = s.feed('前文\n```choices\n{"question":"选?","options":[{"label":"A"}]}```\n后文');
		expect(r.cards).toHaveLength(1);
		expect(r.cards[0].kind).toBe("choices");
		expect(r.text + s.flush()).toBe("前文\n后文");
	});

	it('漏围栏裸卡 JSON（行首 {"name"）：已注册 name 产 card，未注册原样吐回', () => {
		const s = new HostStreamSanitizer();
		const body = '{"name":"artifact","payload":{"title":"方案","markdown":"正文"}}';
		const r = s.feed(`说明：\n${body}\n收尾`);
		expect(r.cards).toHaveLength(1);
		expect(r.cards[0].kind).toBe("tc-card");
		expect((r.cards[0].payload as { name: string }).name).toBe("artifact");
		expect(r.text + s.flush()).toBe("说明：\n\n收尾");

		// 未注册 name（正文里合法的 JSON 示例）→ 不吃，原样吐回
		const s2 = new HostStreamSanitizer();
		const notCard = '{"name":"foo","payload":{"a":1}}';
		const r2 = s2.feed(`${notCard}\n尾`);
		expect(r2.cards).toHaveLength(0);
		expect(r2.text + s2.flush()).toBe(`${notCard}\n尾`);
	});

	it("配平成功但非有效 choices 的行首 JSON → 原样吐回", () => {
		const s = new HostStreamSanitizer();
		const notCard = '{"question":"没有options"}';
		const r = s.feed(`${notCard}\n尾`);
		expect(r.cards).toHaveLength(0);
		expect(r.text + s.flush()).toBe(`${notCard}\n尾`);
	});
});

// 「工具调用写成文本」格式滑落剥离（2026-07-16 Tanva 实测：整坨 flow_patch XML 露给用户）。
// native 靠收尾覆盖 canonical 文本免疫，facade 的 append-only 流没有覆盖语义，只能在这里剥。
describe("HostStreamSanitizer · antml 工具 XML 剥离", () => {
	const INVOKE_XML =
		'<invoke name="flow_patch">\n<parameter name="op">updateNodeData</parameter>\n<parameter name="id">directorConsole_1784178230919</parameter>\n</invoke>';

	it("线上实测形状：<invoke>…</invoke> 整块剥离，前后正文保留、不产 card", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed(`我先看一下画布。\n${INVOKE_XML}\n画布上确实有导演台节点。`);
		expect(r.cards).toHaveLength(0);
		const out = r.text + s.flush();
		expect(out).toBe("我先看一下画布。\n\n画布上确实有导演台节点。");
		expect(out).not.toContain("invoke");
		expect(out).not.toContain("updateNodeData");
	});

	it("<function_calls> 外壳形状：壳与内层 invoke 一并剥净", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed(`开头\n<function_calls>\n${INVOKE_XML}\n</function_calls>\n结尾`);
		expect(r.text + s.flush()).toBe("开头\n\n\n\n结尾");
	});

	it("antml: 命名空间前缀：块与孤儿闭合标签同样剥离", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed('前<antml:invoke name="flow_patch">x</antml:invoke>后</antml:function_calls>尾');
		expect(r.text + s.flush()).toBe("前后尾");
	});

	it("不限行首：XML 接在正文句尾也剥（卡片标记才限行首）", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed(`盘点一下 ${INVOKE_XML} 完事`);
		expect(r.text + s.flush()).toBe("盘点一下  完事");
	});

	it("跨 chunk 分片：标记被切开也能剥，正文零延迟透传", () => {
		const s = new HostStreamSanitizer();
		const r1 = s.feed("正文开头<inv");
		expect(r1.text).toBe("正文开头"); // 尾部 "<inv" 是 marker 前缀 → 扣留
		const r2 = s.feed('oke name="flow_patch">\n<parameter name="op">addNode</parameter>');
		expect(r2.text).toBe("");
		const r3 = s.feed("\n</invoke>\n收尾");
		expect(r3.text + s.flush()).toBe("\n收尾");
		expect(r3.cards).toHaveLength(0);
	});

	it("孤儿闭合标签（</invoke> / </function_calls>）单独出现也丢", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed("甲</invoke>乙</function_calls>丙");
		expect(r.text + s.flush()).toBe("甲乙丙");
	});

	it("流尾未闭合的 <invoke：原样吐回（宁漏勿吞，不能连累后面纠正轮的正文）", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed('正文\n<invoke name="flow_patch">\n<parameter name="op">addNode');
		expect(r.text).toBe("正文\n");
		expect(s.flush()).toBe('<invoke name="flow_patch">\n<parameter name="op">addNode');
	});

	it("正文零误伤：普通尖括号 / 类 XML 词不被吞", () => {
		const s = new HostStreamSanitizer();
		const text = "a < b 且 c <= d，见 <invoked> 与 <function_call> 两词。";
		const r = s.feed(text);
		expect(r.text + s.flush()).toBe(text);
		expect(r.cards).toHaveLength(0);
	});

	it("与卡片剥离共存：同一段里 XML 丢弃、choices 卡照常产出", () => {
		const s = new HostStreamSanitizer();
		const r = s.feed(`${INVOKE_XML}\n\`\`\`choices\n${CHOICES_JSON}\n\`\`\`\n请选。`);
		expect(r.cards).toHaveLength(1);
		expect(r.cards[0].kind).toBe("choices");
		const out = r.text + s.flush();
		expect(out).toBe("\n请选。");
		expect(out).not.toContain("invoke");
	});
});

describe("tcCardToText（未声明宿主的降级）", () => {
	it("artifact 摊平成标题+摘要+markdown 正文", () => {
		expect(
			tcCardToText("artifact", { title: "TVC 脚本", summary: "15s", markdown: "| a |\n|---|" }),
		).toBe("## TVC 脚本\n\n15s\n\n| a |\n|---|");
	});

	it("列表类摊平成编号列点；action_banner 摊平成标题+说明", () => {
		expect(
			tcCardToText("scene_list", { items: [{ name: "车间", summary: "冷光" }, { name: "沙丘" }] }),
		).toBe("场景列表\n\n1. 车间 — 冷光\n\n2. 沙丘");
		expect(tcCardToText("action_banner", { title: "出片", action: "开始" })).toBe("**出片**");
	});

	it("source_contract 与 generation_task 在宿主未声明时保留范围、状态和提示词事实", () => {
		const source = tcCardToText("source_contract", {
			source: "第1章正文",
			scope: "仅当前章节",
			mode: "忠实改编",
			confirmed: ["原文已提供"],
			unresolved: ["目标时长待确认"],
		});
		expect(source).toContain("来源：第1章正文");
		expect(source).toContain("范围：仅当前章节");
		expect(source).toContain("待确认");

		const task = tcCardToText("generation_task", {
			title: "15秒视频提示词",
			status: "failed",
			model: "Seedance 2.0",
			prompt: "白玉广场借钱名场面",
			failureReason: "任务被上游拒绝",
		});
		expect(task).toContain("**15秒视频提示词**（failed）");
		expect(task).toContain("模型：Seedance 2.0");
		expect(task).toContain("任务被上游拒绝");
	});

	it("未注册卡 / 空内容 → 空串（不下发）", () => {
		expect(tcCardToText("unknown_card", { a: 1 })).toBe("");
		expect(tcCardToText("artifact", {})).toBe("");
	});
});

describe("顶层裸数组选项卡（2026-07-29 实测：无围栏无 question 的 [{\"label\":…}] 整坨泄漏进宿主气泡）", () => {
	const BARE =
		'[\n  {"label":"就按这个设计继续跑全章","description":"补齐资产后提交 BeatSheet"},\n  {"label":"先只做这两段看效果","description":"只生产 clip0+clip1"}\n]';

	it("行首裸数组 → 无标题 choices 卡，原文剥离，正文保留", () => {
		const s = new HostStreamSanitizer();
		const res = s.feed(`设计如上。\n${BARE}\n`);
		expect(res.cards).toHaveLength(1);
		expect(res.cards[0].kind).toBe("choices");
		const payload = res.cards[0].payload as ChoicesCardPayload;
		expect(payload.question).toBeUndefined();
		expect(payload.options).toEqual([
			{ label: "就按这个设计继续跑全章", description: "补齐资产后提交 BeatSheet" },
			{ label: "先只做这两段看效果", description: "只生产 clip0+clip1" },
		]);
		// 卡片原文之后的 \n 按既有 rawjson 语义保留（同 {"name"} 裸卡分支）
		expect(res.text + s.flush()).toBe("设计如上。\n\n");
		expect(res.text).not.toContain("label");
	});

	it("裸数组跨 chunk 分片：闭合那一片才产卡，正文不泄漏", () => {
		const s = new HostStreamSanitizer();
		const a = s.feed('设计如上。\n[{"label":"继续","desc');
		expect(a.cards).toHaveLength(0);
		expect(a.text).toBe("设计如上。\n");
		const b = s.feed('ription":"跑全章"}]\n收尾');
		expect(b.cards).toHaveLength(1);
		expect((b.cards[0].payload as ChoicesCardPayload).options).toEqual([
			{ label: "继续", description: "跑全章" },
		]);
		expect(b.text + s.flush()).toBe("\n收尾");
	});

	it("正文里的普通 JSON 数组不被误吃（键集合超出 label/description）", () => {
		const s = new HostStreamSanitizer();
		const text = '返回结构：\n[{"id":1,"name":"x"}]\n以上';
		const res = s.feed(text);
		expect(res.cards).toHaveLength(0);
		expect(res.text + s.flush()).toBe(text);
	});

	it("未闭合的裸数组到 flush 仍原样吐回（宁漏勿吞）", () => {
		const s = new HostStreamSanitizer();
		const res = s.feed('前文\n[{"label":"半截');
		expect(res.cards).toHaveLength(0);
		expect(res.text + s.flush()).toBe('前文\n[{"label":"半截');
	});
});

describe("choicesCardToText", () => {
	it("问题 + 编号列点 + description 破折号", () => {
		expect(
			choicesCardToText({
				question: "选哪个?",
				options: [{ label: "A", description: "第一" }, { label: "B" }],
			}),
		).toBe("选哪个?\n1. A — 第一\n2. B");
	});
});
