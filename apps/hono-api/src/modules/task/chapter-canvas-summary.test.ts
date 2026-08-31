import { describe, expect, it } from "vitest";

import {
  selectFlowNodesForTool,
  slimFullNodeForTool,
  summarizeChapterCanvasNodes,
  searchFlowNodes,
  nodeMatchesFilter,
  applyAnchoredTextEdits,
} from "./chapter-canvas-summary";

describe("slimFullNodeForTool（flow_get 完整节点瘦身）", () => {
  it("videoPrompt 与 prompt 逐字相同 → 删重复", () => {
    const out = slimFullNodeForTool({
      id: "v1",
      data: { kind: "video", prompt: "镜头表X", videoPrompt: "镜头表X" },
    });
    const d = out.data as Record<string, unknown>;
    expect(d.prompt).toBe("镜头表X");
    expect("videoPrompt" in d).toBe(false);
  });
  it("videoPrompt 与 prompt 不同 → 保留", () => {
    const out = slimFullNodeForTool({
      id: "v1",
      data: { kind: "video", prompt: "源", videoPrompt: "改写后的" },
    });
    expect((out.data as Record<string, unknown>).videoPrompt).toBe("改写后的");
  });
  it("完整节点不向模型返回图片 URL，并补充可解析的节点引用描述", () => {
    const signed =
      "https://canvas-pro.r2.cloudflarestorage.com/x.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc";
    const out = slimFullNodeForTool({
      id: "v1",
      data: {
        kind: "image",
        label: "项目全局画风",
        assetId: "asset-style",
        referenceImages: [signed],
        firstFrameUrl: signed,
      },
    });
    const d = out.data as Record<string, unknown>;
    expect(d.referenceImages).toEqual([]);
    expect(d.firstFrameUrl).toBeUndefined();
    expect(d.hasImage).toBe(true);
    expect(d.mediaReferences).toEqual([
      {
        referenceId: "node:v1",
        source: "node",
        nodeId: "v1",
        assetId: "asset-style",
        name: "项目全局画风",
        mediaType: "image",
        ready: true,
      },
    ]);
    expect(JSON.stringify(out)).not.toContain("https://canvas-pro.r2.cloudflarestorage.com/x.png");
  });
  it("永久直链(file.beqlee.icu) 与普通 query 不动", () => {
    const perm = "https://file.beqlee.icu/gen/videos/a.mp4";
    const normal = "https://x.com/a?page=2";
    const out = slimFullNodeForTool({
      id: "v1",
      data: { kind: "video", videoUrl: perm, other: normal },
    });
    const d = out.data as Record<string, unknown>;
    expect(d.videoUrl).toBe(perm);
    expect(d.other).toBe(normal);
  });
  it("video 节点的参考图不冒充该视频 assetId 对应的图片资产", () => {
    const out = slimFullNodeForTool({
      id: "video-1",
      data: {
        kind: "video",
        label: "镜1",
        assetId: "asset-video-1",
        referenceImages: ["https://assets.test/character.png"],
        videoUrl: "https://assets.test/video.mp4",
      },
    });
    const d = out.data as Record<string, unknown>;
    expect(d.mediaReferences).toBeUndefined();
    expect(d.hasImage).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("character.png");
  });
  it("DB 节点不被原地改（返回新副本）", () => {
    const node = { id: "v1", data: { kind: "video", prompt: "p", videoPrompt: "p" } };
    slimFullNodeForTool(node);
    expect("videoPrompt" in (node.data as Record<string, unknown>)).toBe(true);
  });
});

const img = (label: string, status?: string, imageUrl?: string) => ({
	data: { kind: "image", label, ...(status ? { status } : {}), ...(imageUrl ? { imageUrl } : {}) },
});

describe("summarizeChapterCanvasNodes", () => {
	it("空画布显式说明（治陈旧前端摘要把已清空画布报成有内容）", () => {
		expect(summarizeChapterCanvasNodes([])).toContain("画布当前为空");
		expect(summarizeChapterCanvasNodes(undefined as never)).toContain("画布当前为空");
	});

	it("统计总数+按kind计数+资产就绪/待生成", () => {
		const s = summarizeChapterCanvasNodes([
			{ data: { kind: "text", label: "标题" } },
			img("角色卡｜李长安", "success", "https://x/a.png"),
			img("设计板01", undefined, undefined), // 空设计板=待生成
			{ data: { kind: "video", label: "片段01", status: "running" } },
		]);
		expect(s).toContain("共 4 节点");
		expect(s).toMatch(/image×2/);
		expect(s).toMatch(/已出图\/片 1/);
		expect(s).toMatch(/待生成\/空 2/); // 空设计板 + running视频
	});

	it("列出关键节点标签带状态", () => {
		const s = summarizeChapterCanvasNodes([img("风格锚｜万妖图录传", "success", "https://x/w.png")]);
		expect(s).toContain("风格锚｜万妖图录传");
	});

	it("资产有 imageUrl 即视为已就绪(即便status空)", () => {
		const s = summarizeChapterCanvasNodes([img("角色卡", "", "https://x/a.png")]);
		expect(s).toMatch(/已出图\/片 1/);
	});
});

describe("selectFlowNodesForTool（flow_get 上下文瘦身）", () => {
	const nodes = [
		{ id: "a", type: "taskNode", data: { kind: "image", label: "角色卡｜李长安", productionLayer: "anchors", imageUrl: "https://x/li.png", prompt: "P".repeat(2000) } },
		{ id: "b", type: "taskNode", data: { kind: "video", label: "段1 Clip01", videoUrl: "https://x/c.mp4", prompt: "Q".repeat(5000) } },
		{ id: "c", data: { kind: "text", label: "剧本", prompt: "Y".repeat(9000) } },
	];

	it("默认返精简摘要：只有 id/label/kind/层/hasMedia，剥掉 prompt/imageUrl 大字段", () => {
		const r = selectFlowNodesForTool(nodes as never);
		expect(r.mode).toBe("slim");
		expect(r.nodes).toHaveLength(3);
		const a = r.nodes[0] as Record<string, unknown>;
		expect(a.id).toBe("a");
		expect(a.label).toBe("角色卡｜李长安");
		expect(a.kind).toBe("image");
		expect(a.productionLayer).toBe("anchors");
		expect(a.hasMedia).toBe(true);
		expect("prompt" in a).toBe(false);
		expect("imageUrl" in a).toBe(false);
		expect((r.nodes[2] as Record<string, unknown>).hasMedia).toBe(false);
		// 精简后体积应远小于原始（治每轮 47 万 token）
		expect(JSON.stringify(r.nodes).length).toBeLessThan(JSON.stringify(nodes).length / 5);
	});

	it("slim 摘要带 status/taskId：状态检查无需再拉完整节点", () => {
		const withState = [
			{ id: "s1", data: { kind: "image", label: "第3镜", status: "running", taskId: "task-abc" } },
			{ id: "s2", data: { kind: "image", label: "第4镜", status: "success", imageUrl: "https://x/4.png" } },
			{ id: "s3", data: { kind: "text", label: "剧本" } },
		];
		const r = selectFlowNodesForTool(withState as never);
		const [a, b, c] = r.nodes as Record<string, unknown>[];
		// queued/running + taskId → 应该 wait，而不是重复提交（重复提交=双份扣积分）。
		expect(a.status).toBe("running");
		expect(a.taskId).toBe("task-abc");
		expect(b.status).toBe("success");
		expect(b.hasMedia).toBe(true);
		// 无状态字段的节点不应凭空多出 status/taskId 键。
		expect("status" in c).toBe(false);
		expect("taskId" in c).toBe(false);
	});

	it("传单个 nodeId 默认只返回执行事实，不隐式注入长 prompt", () => {
		const r = selectFlowNodesForTool(nodes as never, ["b"]);
		expect(r.mode).toBe("full");
		expect(r.nodes).toHaveLength(1);
		const b = r.nodes[0] as { id: string; data: Record<string, unknown> };
		expect(b.id).toBe("b");
		expect(b.data.prompt).toBeUndefined();
		expect(b.data.videoUrl).toBe("https://x/c.mp4");
	});

	it("传图片 nodeId 时只返回名称/节点 ID/资产 ID，不返回图片 URL", () => {
		const r = selectFlowNodesForTool(nodes as never, ["a"]);
		const a = r.nodes[0] as { id: string; data: Record<string, unknown> };
		expect(a.data.imageUrl).toBeUndefined();
		expect(a.data.hasImage).toBe(true);
		expect(a.data.mediaReferences).toEqual([
			expect.objectContaining({
				referenceId: "node:a",
				nodeId: "a",
				name: "角色卡｜李长安",
			}),
		]);
		expect(JSON.stringify(a)).not.toContain("https://x/li.png");
	});

	it("nodeIds 空数组 = 回退精简；多 id 取多节点", () => {
		expect(selectFlowNodesForTool(nodes as never, []).mode).toBe("slim");
		expect(selectFlowNodesForTool(nodes as never, ["a", "c"]).nodes).toHaveLength(2);
	});

	it("【C】slim 模式按 kind 过滤 + 带 total/shown", () => {
		const r = selectFlowNodesForTool(nodes as never, { filter: { kind: "image" } });
		expect(r.mode).toBe("slim");
		expect(r.nodes).toHaveLength(1);
		expect((r.nodes[0] as Record<string, unknown>).id).toBe("a");
		expect(r.total).toBe(1);
		expect(r.shown).toBe(1);
	});

	it("【C】slim 模式 limit/offset 分页 + total 为过滤前/分页前总数", () => {
		const r = selectFlowNodesForTool(nodes as never, { limit: 1, offset: 1 });
		expect(r.nodes).toHaveLength(1);
		expect((r.nodes[0] as Record<string, unknown>).id).toBe("b");
		expect(r.total).toBe(3);
		expect(r.offset).toBe(1);
	});

	it("【C】full 模式 fields 裁剪：只留 prompt(+恒含 kind/label/层)，省 token", () => {
		const r = selectFlowNodesForTool(nodes as never, { nodeIds: ["b"], fields: ["prompt"] });
		expect(r.mode).toBe("full");
		const b = r.nodes[0] as { data: Record<string, unknown> };
		expect(b.data.prompt).toBeTruthy();
		expect(b.data.kind).toBe("video"); // 恒留
		expect("videoUrl" in b.data).toBe(false); // 未请求 → 不返回
	});
});

describe("【A】nodeMatchesFilter / searchFlowNodes（画布 grep）", () => {
	const nodes = [
		{ id: "a", data: { kind: "image", label: "角色卡｜李长安", productionLayer: "anchors", imageUrl: "https://x/li.png" } },
		{ id: "b", data: { kind: "video", label: "段1·杀人立威", status: "empty", prompt: "镜头表 谢双瑶 杀人立威" } },
		{ id: "c", data: { kind: "video", label: "段2·登台", status: "success", videoUrl: "https://x/c.mp4" } },
		{ id: "d", data: { kind: "text", label: "剧本", prompt: "第1章 军入城 谢双瑶" } },
	];

	it("q 子串匹配 label+prompt（命中镜头表内容/角色名）", () => {
		expect(nodeMatchesFilter(nodes[1] as never, { q: "杀人立威" })).toBe(true);
		expect(nodeMatchesFilter(nodes[3] as never, { q: "谢双瑶" })).toBe(true); // prompt 命中
		expect(nodeMatchesFilter(nodes[0] as never, { q: "杀人立威" })).toBe(false);
	});

	it("kind + status=empty 找未出片的 video 节点", () => {
		const r = searchFlowNodes(nodes as never, { kind: "video", status: "empty" });
		expect(r.total).toBe(1);
		expect(r.nodes[0]!.id).toBe("b");
		// 命中字段是 slim（无 prompt/imageUrl 大字段）
		expect("prompt" in (r.nodes[0] as Record<string, unknown>)).toBe(false);
	});

	it("hasMedia=false 只要未出图/片的", () => {
		const r = searchFlowNodes(nodes as never, { hasMedia: false });
		const ids = r.nodes.map((n) => n.id).sort();
		expect(ids).toEqual(["b", "d"]); // a/c 有 media
	});

	it("分页 total/shown/offset + overage 可算", () => {
		const r = searchFlowNodes(nodes as never, { kind: "video" }, { limit: 1, offset: 0 });
		expect(r.total).toBe(2);
		expect(r.shown).toBe(1);
		expect(r.offset).toBe(0);
	});

	it("无过滤 = 列全部(等价旧默认)", () => {
		expect(searchFlowNodes(nodes as never, {}).total).toBe(4);
	});
});

describe("【⑤】applyAnchoredTextEdits（节点内锚定增量编辑·codex apply_patch 类比）", () => {
	it("唯一命中 → 替换；多 edit 按序应用", () => {
		const r = applyAnchoredTextEdits("镜头1：女主走进咖啡馆。镜头2：她坐下。", [
			{ find: "女主走进咖啡馆", replace: "女主推门进入古书店" },
			{ find: "她坐下", replace: "她在窗边落座" },
		]);
		expect(r.applied).toBe(2);
		expect(r.failed).toEqual([]);
		expect(r.text).toBe("镜头1：女主推门进入古书店。镜头2：她在窗边落座。");
		expect(r.changed).toBe(true);
	});
	it("0 次命中 = not_found，不影响其余 edit（部分成功可恢复）", () => {
		const r = applyAnchoredTextEdits("abc def", [
			{ find: "xyz", replace: "Q" },
			{ find: "def", replace: "DEF" },
		]);
		expect(r.applied).toBe(1);
		expect(r.text).toBe("abc DEF");
		expect(r.failed).toEqual([{ find: "xyz", reason: "not_found" }]);
	});
	it("多处命中 = ambiguous（拒绝误改，要求更长唯一锚）", () => {
		const r = applyAnchoredTextEdits("光 光 光", [{ find: "光", replace: "影" }]);
		expect(r.applied).toBe(0);
		expect(r.failed[0]!.reason).toBe("ambiguous");
		expect(r.text).toBe("光 光 光"); // 未改
	});
	it("空 find = empty_find；replace 为空 = 删除片段", () => {
		const r = applyAnchoredTextEdits("hello world", [
			{ find: "", replace: "x" },
			{ find: " world", replace: "" },
		]);
		expect(r.failed[0]!.reason).toBe("empty_find");
		expect(r.text).toBe("hello");
	});
	it("前一个 edit 改出的新文本，后一个 edit 在其上锚定", () => {
		const r = applyAnchoredTextEdits("AAA", [
			{ find: "AAA", replace: "BBB" },
			{ find: "BBB", replace: "CCC" },
		]);
		expect(r.applied).toBe(2);
		expect(r.text).toBe("CCC");
	});
});
