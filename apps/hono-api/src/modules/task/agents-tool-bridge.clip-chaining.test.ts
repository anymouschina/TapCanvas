import { describe, expect, it } from "vitest";
import {
	assessFreestyleClipChaining,
	findCompletedVideoPredecessor,
} from "./agents-tool-bridge.generate-video-to-canvas";

// 2026-07-17 用户拍板：散跑（单镜快线）补承接契约。画布上存在「已成片的上游视频镜」连线时，
// 本镜必须带承接锚之一（真首帧 / 上游尾帧参考图 / 提示词承接段 / 显式独立镜声明），
// 否则 422 退回并给修法——治「镜1b 裸文字生成不吃镜1a 尾帧 → 人数/站位脑补走样」。

const UP = { videoUrl: "https://cdn.example.com/1a.mp4", lastFrameUrl: "https://cdn.example.com/1a-last.png" };

describe("assessFreestyleClipChaining", () => {
	it("无上游成片镜 → 直接放行", () => {
		expect(
			assessFreestyleClipChaining({ prompt: "任意", referenceImages: [], nodeData: {}, upstream: null }).ok,
		).toBe(true);
	});

	it("有上游但四种锚全缺 → 拒绝并给修法", () => {
		const r = assessFreestyleClipChaining({
			prompt: "三个青年站在街角说话，镜头缓推。",
			referenceImages: ["https://cdn.example.com/role-anuo.png"],
			nodeData: {},
			upstream: UP,
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain("承接");
	});

	it("参考图含上游尾帧 → 放行", () => {
		expect(
			assessFreestyleClipChaining({
				prompt: "三个青年站在街角说话。",
				referenceImages: ["https://cdn.example.com/role-anuo.png", UP.lastFrameUrl],
				nodeData: {},
				upstream: UP,
			}).ok,
		).toBe(true);
	});

	it("nodeData.firstFrameUrl 真首帧 → 放行", () => {
		expect(
			assessFreestyleClipChaining({
				prompt: "三个青年站在街角说话。",
				referenceImages: [],
				nodeData: { firstFrameUrl: "https://cdn.example.com/first.png" },
				upstream: UP,
			}).ok,
		).toBe(true);
	});

	it("提示词带承接段（【时空】/上镜/前情）→ 放行", () => {
		expect(
			assessFreestyleClipChaining({
				prompt: "【时空】承接上镜退出态：三人仍站原位……画面从该状态向前推进。",
				referenceImages: [],
				nodeData: {},
				upstream: UP,
			}).ok,
		).toBe(true);
	});

	it("显式独立镜声明 standaloneShot → 放行", () => {
		expect(
			assessFreestyleClipChaining({
				prompt: "全新时空的空镜转场。",
				referenceImages: [],
				nodeData: { standaloneShot: true },
				upstream: UP,
			}).ok,
		).toBe(true);
	});
});

describe("findCompletedVideoPredecessor", () => {
	const graph = {
		nodes: [
			{ id: "clip-1a", data: { kind: "video", videoUrl: UP.videoUrl, lastFrameUrl: UP.lastFrameUrl } },
			{ id: "clip-1b", data: { kind: "video" } },
			{ id: "role-card", data: { kind: "image", imageUrl: "x" } },
			{ id: "clip-empty", data: { kind: "video" } },
		],
		edges: [
			{ id: "e1", source: "clip-1a", target: "clip-1b" },
			{ id: "e2", source: "role-card", target: "clip-1b" },
			{ id: "e3", source: "clip-empty", target: "clip-1b" },
		],
	};

	it("找到已成片的视频前驱（忽略图片卡与未成片视频节点）", () => {
		const up = findCompletedVideoPredecessor(graph, "clip-1b");
		expect(up).toEqual({ videoUrl: UP.videoUrl, lastFrameUrl: UP.lastFrameUrl });
	});

	it("目标无前驱 → null", () => {
		expect(findCompletedVideoPredecessor(graph, "clip-1a")).toBeNull();
	});
});
