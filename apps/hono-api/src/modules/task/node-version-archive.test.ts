import { describe, expect, it } from "vitest";

import {
	buildMediaVersionArchiveNode,
	isMediaVersionReplacement,
} from "./node-version-archive";
import { buildShotArchiveNode, renderClipArchiveText } from "./video-orchestrator.shot-archive";

// 【重写留痕·2026-07-07 用户拍板】重写/重画/重生成不许无痕替换——
// 覆盖前旧版快照成存档节点；存档节点必须剥掉一切会被系统解析的绑定字段。

describe("isMediaVersionReplacement（何时构成换版本）", () => {
	it("旧新 URL 都非空且不同 → 是换版本", () => {
		expect(
			isMediaVersionReplacement({ videoUrl: "https://a/old.mp4" }, { videoUrl: "https://a/new.mp4" }),
		).toBe(true);
		expect(
			isMediaVersionReplacement({ imageUrl: "https://a/old.png" }, { imageUrl: "https://a/new.png" }),
		).toBe(true);
	});

	it("同 URL 幂等回写 / 新媒体为空 / 旧节点无媒体 → 不留痕", () => {
		expect(
			isMediaVersionReplacement({ videoUrl: "https://a/x.mp4" }, { videoUrl: "https://a/x.mp4" }),
		).toBe(false);
		expect(isMediaVersionReplacement({ videoUrl: "https://a/x.mp4" }, { status: "" })).toBe(false);
		expect(isMediaVersionReplacement({ status: "failed" }, { videoUrl: "https://a/new.mp4" })).toBe(
			false,
		);
	});
});

describe("buildMediaVersionArchiveNode（存档节点绑定字段剥离）", () => {
	const origData = {
		kind: "video",
		label: "镜3·潭边论法",
		videoUrl: "https://a/old.mp4",
		prompt: "旧版镜头表……",
		clipRunId: "ch5-v2",
		clipIndex: 2,
		taskId: "task-123",
		roleName: "孟川",
		referenceType: "ensemble",
		productionLayer: "anchors",
		characterRoleNames: ["孟川", "后土"],
	};

	it("保留可展示内容（媒体/label/prompt），身份字段改名封存", () => {
		const built = buildMediaVersionArchiveNode({
			origNodeId: "vclip-abc",
			origData,
			nowMs: 1_800_000_000_000,
		})!;
		expect(built.nodeData.videoUrl).toBe("https://a/old.mp4");
		expect(built.nodeData.label).toBe("旧版｜镜3·潭边论法");
		expect(built.nodeData.archivedFromNodeId).toBe("vclip-abc");
		expect(built.nodeData.archivedClipRunId).toBe("ch5-v2");
		expect(built.nodeData.archivedClipIndex).toBe(2);
		expect(built.nodeData.archivedRoleName).toBe("孟川");
		expect(built.nodeData.archivedTaskId).toBe("task-123");
	});

	it("⛔绑定字段绝不原样携带（防幂等槽位/按名绑定/reconcile/群像绑定误捡）", () => {
		const built = buildMediaVersionArchiveNode({
			origNodeId: "vclip-abc",
			origData,
			nowMs: 1_800_000_000_000,
		})!;
		for (const forbidden of [
			"clipRunId",
			"clipIndex",
			"roleName",
			"taskId",
			"videoTaskId",
			"referenceType",
			"productionLayer",
			"characterRoleNames",
		]) {
			expect(built.nodeData).not.toHaveProperty(forbidden);
		}
	});

	it("无媒体的节点返回 null（没东西可留痕）", () => {
		expect(
			buildMediaVersionArchiveNode({
				origNodeId: "n1",
				origData: { status: "failed" },
				nowMs: 1,
			}),
		).toBeNull();
	});

	it("图片节点走 imageUrl 分支（角色卡重画留痕）", () => {
		const built = buildMediaVersionArchiveNode({
			origNodeId: "role-mengchuan-ch5",
			origData: { kind: "image", label: "角色卡｜孟川", imageUrl: "https://a/old.png", roleName: "孟川" },
			nowMs: 2,
		})!;
		expect(built.nodeData.kind).toBe("image");
		expect(built.nodeData.imageUrl).toBe("https://a/old.png");
		expect(built.nodeData.archivedRoleName).toBe("孟川");
	});
});

describe("镜头表存档（replace/reset 留痕）", () => {
	const clip = {
		durationSeconds: 15,
		logline: "断枪易手",
		characterRoleNames: ["孟川", "后土"],
		shots: [
			{ shotNo: 1, framing: "中景", cameraMove: "缓推", action: "后土抛出断枪", dialogue: "@后土（平淡）：「接著。」" },
			{ shotNo: 2, framing: "特写", cameraMove: "固定", action: "孟川伸手接住，指节泛白" },
		],
	};

	it("渲染包含段号/时长/logline/逐镜行", () => {
		const text = renderClipArchiveText(clip, 0);
		expect(text).toContain("段1（15s）");
		expect(text).toContain("logline：断枪易手");
		expect(text).toContain("镜1｜中景/缓推｜后土抛出断枪");
		expect(text).toContain("镜2｜特写/固定");
	});

	it("replace 存档节点：label 带段号，data 无绑定字段", () => {
		const built = buildShotArchiveNode({
			runId: "ch5-v2",
			reason: "replace",
			entries: [[3, clip]],
			nowMs: 3,
		});
		expect(String(built.nodeData.label)).toContain("段4·替换前");
		expect(built.nodeData.kind).toBe("text");
		expect(built.nodeData).not.toHaveProperty("clipRunId");
		expect(built.nodeData).not.toHaveProperty("clipIndex");
	});

	it("reset 存档节点：多段合并一个存档", () => {
		const built = buildShotArchiveNode({
			runId: "ch5-v2",
			reason: "reset",
			entries: [
				[0, clip],
				[1, clip],
			],
			nowMs: 4,
		});
		expect(String(built.nodeData.label)).toContain("reset前2段");
		expect(String(built.nodeData.prompt)).toContain("## 段1");
		expect(String(built.nodeData.prompt)).toContain("## 段2");
	});
});
