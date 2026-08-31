import { describe, expect, it } from "vitest";
import {
	deriveCaptureId,
	deriveImageNodeId,
	parseCaptureScene,
	buildResultJson,
	readResultJson,
	BROWSER_CAPTURE_VENDOR,
} from "./director-capture.shared";

const SCENE = {
	characters: [
		{ id: "c1", name: "角色1", modelId: "male", position: [0, 0, 0] },
		{ id: "c2", name: "角色2", modelId: "female", position: [1.2, 0, 0] },
	],
	camera: { position: [6, 4.5, 13], lookAtMode: "manual", lookAt: [0, 1, 0], fovDeg: 45 },
	aspect: "16:9",
};

describe("deriveCaptureId", () => {
	it("同 nodeId+requestId 稳定，换任一变量则变", () => {
		const a = deriveCaptureId("node-1", "req-1");
		expect(a).toBe(deriveCaptureId("node-1", "req-1"));
		expect(a).not.toBe(deriveCaptureId("node-1", "req-2"));
		expect(a).not.toBe(deriveCaptureId("node-2", "req-1"));
		expect(a).toMatch(/^dcap_[0-9a-f]{32}$/);
	});
});

describe("parseCaptureScene", () => {
	it("接受合法场景并补全默认值", () => {
		const r = parseCaptureScene(SCENE);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.scene.characters[0].rotation).toEqual([0, 0, 0]);
		expect(r.scene.characters[0].uniformScale).toBe(1);
		expect(r.scene.aspect).toBe("16:9");
	});
	it("拒绝未知 modelId 并给出合法列表", () => {
		const r = parseCaptureScene({ ...SCENE, characters: [{ id: "c1", name: "x", modelId: "alien", position: [0, 0, 0] }] });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.message).toContain("male");
	});
	it("拒绝非有限坐标", () => {
		const r = parseCaptureScene({ ...SCENE, camera: { ...SCENE.camera, position: [0, Number.NaN, 0] } });
		expect(r.ok).toBe(false);
	});
});

describe("deriveImageNodeId", () => {
	it("确定性，且幂等重试得到同一 image node id", () => {
		const cid = deriveCaptureId("dir-1", "req-1");
		expect(deriveImageNodeId("dir-1", cid)).toBe(deriveImageNodeId("dir-1", cid));
		expect(deriveImageNodeId("dir-1", cid)).toBe(`dir-1-shot-${cid.slice(5, 13)}`);
	});
});

describe("result json", () => {
	it("round-trips（含 scene 透传）", () => {
		const sceneParsed = parseCaptureScene(SCENE);
		if (!sceneParsed.ok) throw new Error("scene should parse");
		const json = buildResultJson({ phase: "queued", projectId: "p", flowId: "f", nodeId: "n", requestId: "r", aspect: "16:9", scene: sceneParsed.scene });
		const read = readResultJson(json);
		expect(read.provider).toBe("task_store");
		expect(read.phase).toBe("queued");
		expect(read.nodeId).toBe("n");
		expect(read.scene?.characters.length).toBe(2);
	});
	it("BROWSER_CAPTURE_VENDOR 常量稳定", () => {
		expect(BROWSER_CAPTURE_VENDOR).toBe("browser-director-capture");
	});
});

// ── 道具白名单同步 + 构图校验闸（ch3 实测翻车后加固） ─────────────────────────

describe("家具道具白名单（与 web FURNITURE_TYPES 同步）", () => {
	it("prop-sofa / prop-low-table 等家具 id 合法", () => {
		const r = parseCaptureScene({
			characters: [
				{ id: "sofa", name: "沙发", modelId: "prop-sofa", position: [0.6, 0, -0.2] },
				{ id: "xia", name: "夏繁星", modelId: "female", position: [0.6, 0, 0.3], posePresetId: "sit" },
			],
			camera: { position: [-1.8, 1.5, 3.0], lookAtMode: "manual", lookAt: [0.3, 0.9, 0.1], fovDeg: 45 },
			aspect: "9:16",
		});
		expect(r.ok).toBe(true);
	});
});

describe("validateSceneComposition（构图校验闸）", () => {
	const cam9x16 = { position: [0, 1.4, 3.2] as [number, number, number], lookAtMode: "manual", lookAt: [0, 1.0, 0] as [number, number, number], fovDeg: 45 };

	it("正常双人+侧后方家具 → 通过", () => {
		const r = parseCaptureScene({
			characters: [
				{ id: "a", name: "甲", modelId: "female", position: [-0.5, 0, 0.3] },
				{ id: "b", name: "乙", modelId: "female", position: [0.5, 0, 0] },
				{ id: "sofa", name: "沙发", modelId: "prop-sofa", position: [0.6, 0, -0.8] },
			],
			camera: cam9x16,
			aspect: "9:16",
		});
		expect(r.ok).toBe(true);
	});

	it("巨型 box 怼在镜头与人物之间（实测翻车场景）→ 拒绝并点名遮挡", () => {
		const r = parseCaptureScene({
			characters: [
				{ id: "wall", name: "沙发(box硬拼)", modelId: "prop-box", position: [0, 0, 1.5], uniformScale: 2.5 },
				{ id: "a", name: "甲", modelId: "female", position: [-0.3, 0, 0] },
			],
			camera: cam9x16,
			aspect: "9:16",
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain("完全遮挡");
	});

	it("道具 uniformScale 超上限 → 拒绝", () => {
		const r = parseCaptureScene({
			characters: [
				{ id: "wall", name: "巨墙", modelId: "prop-box", position: [0, 0, -2], uniformScale: 5 },
				{ id: "a", name: "甲", modelId: "female", position: [0, 0, 0] },
			],
			camera: cam9x16,
			aspect: "9:16",
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain("超上限");
	});

	it("角色摆到视锥外（实测：苏梦出画）→ 拒绝并给修法", () => {
		const r = parseCaptureScene({
			characters: [
				{ id: "a", name: "甲", modelId: "female", position: [0, 0, 0] },
				{ id: "b", name: "乙", modelId: "female", position: [-4.5, 0, 0.5] },
			],
			camera: cam9x16,
			aspect: "9:16",
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain("出画");
	});

	it("角色在镜头后方 → 拒绝", () => {
		const r = parseCaptureScene({
			characters: [{ id: "a", name: "甲", modelId: "female", position: [0, 0, 5] }],
			camera: cam9x16,
			aspect: "9:16",
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain("镜头后方");
	});

	it("家具在人物身后/脚边（坐沙发）→ 不误拦", () => {
		const r = parseCaptureScene({
			characters: [
				{ id: "sofa", name: "沙发", modelId: "prop-sofa", position: [0.6, 0, -0.15] },
				{ id: "table", name: "茶几", modelId: "prop-low-table", position: [0.2, 0, 1.1] },
				{ id: "a", name: "甲", modelId: "female", position: [0.6, 0, 0.25], posePresetId: "sit" },
				{ id: "b", name: "乙", modelId: "female", position: [-0.55, 0, 0.6], posePresetId: "offer" },
			],
			camera: { position: [-1.8, 1.5, 3.0], lookAtMode: "manual", lookAt: [0.1, 0.9, 0.2], fovDeg: 45 },
			aspect: "9:16",
		});
		expect(r.ok).toBe(true);
	});

	it("全景地平线校准只接受确定性的 -45..45 度边界", () => {
		const valid = parseCaptureScene({
			characters: [{ id: "a", name: "甲", modelId: "female", position: [0, 0, 0] }],
			camera: cam9x16,
			aspect: "9:16",
			skyboxPitch: -18,
		});
		expect(valid.ok).toBe(true);

		const invalid = parseCaptureScene({
			characters: [{ id: "a", name: "甲", modelId: "female", position: [0, 0, 0] }],
			camera: cam9x16,
			aspect: "9:16",
			skyboxPitch: 46,
		});
		expect(invalid.ok).toBe(false);
	});
});
