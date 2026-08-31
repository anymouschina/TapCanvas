import { describe, expect, it } from "vitest";
import { buildClipInputEdges } from "./video-orchestrator.input-edges";

function node(id: string, data: Record<string, unknown>) {
	return { id, type: "taskNode", data };
}

const CLIP = "vclip-run1-0";

describe("buildClipInputEdges", () => {
	it("按 URL 反查参考图节点并连边（image → out-image/in-any）", () => {
		const current = {
			nodes: [
				node("card-a", { kind: "image", imageUrl: "https://file.beqlee.icu/gen/images/u1/20260704/aaa.png" }),
				node(CLIP, { kind: "video" }),
			],
			edges: [],
		};
		const edges = buildClipInputEdges({
			current,
			clipNodeId: CLIP,
			referenceImageUrls: ["https://file.beqlee.icu/gen/images/u1/20260704/aaa.png"],
		});
		expect(edges).toEqual([
			{
				id: `e-in-card-a-${CLIP}`,
				source: "card-a",
				target: CLIP,
				sourceHandle: "out-image",
				targetHandle: "in-any",
			},
		]);
	});

	it("ARK presigned URL（host/query 全变）仍按对象 key 尾部匹配到原节点", () => {
		const current = {
			nodes: [
				node("card-a", { kind: "image", imageUrl: "https://file.beqlee.icu/gen/images/u1/20260704/aaa.png" }),
				node(CLIP, { kind: "video" }),
			],
			edges: [],
		};
		const edges = buildClipInputEdges({
			current,
			clipNodeId: CLIP,
			referenceImageUrls: [
				"https://acc.r2.cloudflarestorage.com/bucket/gen/images/u1/20260704/aaa.png?X-Amz-Signature=xyz",
			],
		});
		expect(edges.map((e) => e.source)).toEqual(["card-a"]);
	});

	it("sourceNodeIds 直连（分镜板/站位图），幻觉 id 与自环被剔除", () => {
		const current = {
			nodes: [node("sb-1", { kind: "storyboardImage" }), node(CLIP, { kind: "video" })],
			edges: [],
		};
		const edges = buildClipInputEdges({
			current,
			clipNodeId: CLIP,
			sourceNodeIds: ["sb-1", "ghost-node", CLIP, "", "sb-1"],
		});
		expect(edges.map((e) => e.source)).toEqual(["sb-1"]);
	});

	it("续写链上一镜按 videoUrl 反查，sourceHandle=out-video", () => {
		const current = {
			nodes: [
				node("vclip-run1-prev", { kind: "video", videoUrl: "https://file.beqlee.icu/gen/videos/u1/20260704/prev.mp4" }),
				node(CLIP, { kind: "video" }),
			],
			edges: [],
		};
		const edges = buildClipInputEdges({
			current,
			clipNodeId: CLIP,
			referenceImageUrls: ["https://file.beqlee.icu/gen/videos/u1/20260704/prev.mp4"],
		});
		expect(edges).toEqual([
			{
				id: `e-in-vclip-run1-prev-${CLIP}`,
				source: "vclip-run1-prev",
				target: CLIP,
				sourceHandle: "out-video",
				targetHandle: "in-any",
			},
		]);
	});

	it("幂等：现存边按 id 或 source+target 对去重", () => {
		const current = {
			nodes: [
				node("card-a", { kind: "image", imageUrl: "https://x.com/gen/images/d/a.png" }),
				node("card-b", { kind: "image", imageUrl: "https://x.com/gen/images/d/b.png" }),
				node(CLIP, { kind: "video" }),
			],
			edges: [
				{ id: `e-in-card-a-${CLIP}`, source: "card-a", target: CLIP },
				// card-b 已有一条手工命名的边（id 不同、source+target 相同）
				{ id: "manual-edge", source: "card-b", target: CLIP },
			],
		};
		const edges = buildClipInputEdges({
			current,
			clipNodeId: CLIP,
			referenceImageUrls: ["https://x.com/gen/images/d/a.png", "https://x.com/gen/images/d/b.png"],
		});
		expect(edges).toEqual([]);
	});

	it("目标节点不在图上 → 不产边（本 patch 之外禁悬空边）", () => {
		const current = {
			nodes: [node("card-a", { kind: "image", imageUrl: "https://x.com/gen/images/d/a.png" })],
			edges: [],
		};
		const edges = buildClipInputEdges({
			current,
			clipNodeId: CLIP,
			referenceImageUrls: ["https://x.com/gen/images/d/a.png"],
		});
		expect(edges).toEqual([]);
	});

	it("targetWillBeCreated=true：目标由同一 patch createNodes 创建时照常产边", () => {
		const current = {
			nodes: [node("card-a", { kind: "image", imageUrl: "https://x.com/gen/images/d/a.png" })],
			edges: [],
		};
		const edges = buildClipInputEdges({
			current,
			clipNodeId: CLIP,
			referenceImageUrls: ["https://x.com/gen/images/d/a.png"],
			targetWillBeCreated: true,
		});
		expect(edges.map((e) => e.source)).toEqual(["card-a"]);
	});

	it("非法输入（空 graph / 空 clipNodeId / 非 http URL）零抛错", () => {
		expect(buildClipInputEdges({ current: null, clipNodeId: CLIP })).toEqual([]);
		expect(buildClipInputEdges({ current: {}, clipNodeId: "" })).toEqual([]);
		expect(
			buildClipInputEdges({
				current: { nodes: [node(CLIP, { kind: "video" })], edges: [] },
				clipNodeId: CLIP,
				referenceImageUrls: ["asset://abc", "not-a-url", ""],
			}),
		).toEqual([]);
	});
});
