import { describe, it, expect } from "vitest";
import {
	buildClipPlaceholderNodes,
	rebuildStoryPlanFromCanvasNodes,
} from "./video-orchestrator.placeholder-nodes";

const TEST_GENERATION_CONTRACT = {
	videoModel: "doubao-seedance-2-0-260128",
	durationOptions: [5, 10, 15],
	maxDurationSeconds: 15,
	referenceImagePolicy: {
		countUnit: "unique_url" as const,
		maximumTotalImages: 9,
		maximumBusinessImages: 9,
	},
	referenceAudioPolicy: {
		minimumDurationSeconds: 1.8,
		maximumDurationSeconds: 30.2,
	},
};

const characterContract = (name: string, nodeId: string) => ({
	kind: "character" as const,
	name,
	referenceImageNodeIds: [nodeId],
	referenceRole: "identity" as const,
	forbiddenTransfer: "不迁移背景与姿势",
	identityInvariant: `${name}身份不变`,
	startState: "站定",
	spatialRelation: "画面中央",
	scale: "人物中景",
	driver: "主动动作",
	stateChange: "完成本镜动作",
	endState: "动作后站定",
});

const basePlan = {
	runId: "run-1",
	videoModel: "doubao-seedance-2-0-260128",
	generationContract: TEST_GENERATION_CONTRACT,
	aspect: "16:9",
	parentGroupId: "g2",
	clips: [
		{
			clipPrompt: "镜0 李长安进甬道",
			storyboardPrompt: "sb0",
			characterRoleNames: ["李长安"],
			videoReferenceNodeIds: ["role-li", "scene-01"],
			assetObjectContracts: [characterContract("李长安", "role-li")],
			storyboardImageNodeId: "board-0",
			lastFrameImageNodeId: "tail-0",
			continuityMode: "editorial_cut" as const,
		},
		{
			clipPrompt: "镜1 尸佛登场",
			characterRoleNames: ["尸佛"],
			videoReferenceNodeIds: ["role-fo"],
			assetObjectContracts: [characterContract("尸佛", "role-fo")],
			storyboardImageNodeId: "tail-0",
			continuityMode: "bridge_frames" as const,
		},
	],
};

const clipPlan = [
	{ clipIndex: 0, durationSeconds: 15, nodeId: "vclip-a", clipId: "run-1:clip:0", expectedPrevClipIndex: null },
	{ clipIndex: 1, durationSeconds: 15, nodeId: "vclip-b", clipId: "run-1:clip:1", expectedPrevClipIndex: null },
];

describe("buildClipPlaceholderNodes", () => {
	it("每段产出一个 planned video 节点，带 prompt/绑定/续写依赖/slot id", () => {
		const specs = buildClipPlaceholderNodes({ plan: basePlan, clipPlan });
		expect(specs).toHaveLength(2);

		const c0 = specs[0]!;
		expect(c0.id).toBe("vclip-a");
		expect(c0.type).toBe("taskNode");
		expect(c0.parentId).toBe("g2");
			expect(c0.data).toMatchObject({
			kind: "video",
			status: "planned",
			clipRunId: "run-1",
			clipIndex: 0,
			clipId: "run-1:clip:0",
			durationSeconds: 15,
			videoModel: "doubao-seedance-2-0-260128",
			generationContract: TEST_GENERATION_CONTRACT,
			videoAspect: "16:9",
			aspectRatio: "16:9",
			prompt: "镜0 李长安进甬道",
			storyboardPrompt: "sb0",
			characterRoleNames: ["李长安"],
			videoReferenceNodeIds: ["role-li", "scene-01"],
			assetObjectContracts: [characterContract("李长安", "role-li")],
		});
		// clip0 无续写依赖（expectedPrevClipIndex=null）→ 字段不出现
		expect("expectedPrevClipIndex" in c0.data).toBe(false);
		// 故事板关键帧 / 目标尾帧节点 id 随占位节点落盘（供后续 drive 接首/尾帧）
		expect(c0.data.storyboardImageNodeId).toBe("board-0");
		expect(c0.data.lastFrameImageNodeId).toBe("tail-0");
		expect(c0.data.continuityMode).toBe("editorial_cut");
		// clip1 以 clip0 的尾帧作为同一个桥接首帧。
		expect(specs[1]!.data.storyboardImageNodeId).toBe("tail-0");
		expect("lastFrameImageNodeId" in specs[1]!.data).toBe(false);
		expect(specs[1]!.data.continuityMode).toBe("bridge_frames");
	});

	it("只有 reference_video clip 持久化 expectedPrevClipIndex", () => {
		const referencePlan = {
			...basePlan,
			clips: [
				{ ...basePlan.clips[0], lastFrameImageNodeId: undefined },
				{
					...basePlan.clips[1],
					storyboardImageNodeId: undefined,
					continuityMode: "reference_video" as const,
				},
			],
		};
		const referenceClipPlan = [
			clipPlan[0]!,
			{ ...clipPlan[1]!, expectedPrevClipIndex: 0 },
		];
		const specs = buildClipPlaceholderNodes({ plan: referencePlan, clipPlan: referenceClipPlan });
		expect(specs[0]!.data.expectedPrevClipIndex).toBeUndefined();
		expect(specs[1]!.data.expectedPrevClipIndex).toBe(0);
	});

	it("clipPlan 与冻结 clips 数量不一致时显式失败", () => {
		expect(() =>
			buildClipPlaceholderNodes({
				plan: basePlan,
				clipPlan: [
					...clipPlan,
					{ clipIndex: 2, durationSeconds: 5, nodeId: "vclip-c", clipId: "run-1:clip:2", expectedPrevClipIndex: null },
				],
			}),
		).toThrow("video_placeholder_topology_mismatch");
	});

	it("节点 id 用稳定 slot（幂等去重的依据），横向按 index 错位", () => {
		const specs = buildClipPlaceholderNodes({ plan: basePlan, clipPlan });
		expect(specs.map((s) => s.id)).toEqual(["vclip-a", "vclip-b"]);
		expect(specs.map((s) => s.position.x)).toEqual([0, 360]);
	});

	it("空 runId / 空 clipPlan → 返回空数组（防御）", () => {
		expect(buildClipPlaceholderNodes({ plan: { ...basePlan, runId: "" }, clipPlan })).toEqual([]);
		expect(buildClipPlaceholderNodes({ plan: basePlan, clipPlan: [] })).toEqual([]);
	});

	it("无 parentGroupId / 无 aspect 时不写对应字段", () => {
		const generationContract = {
			videoModel: "m",
			durationOptions: [5],
			maxDurationSeconds: 5,
			referenceImagePolicy: {
				countUnit: "unique_url" as const,
				maximumTotalImages: 9,
				maximumBusinessImages: 9,
			},
			referenceAudioPolicy: {
				minimumDurationSeconds: 1.8,
				maximumDurationSeconds: 30.2,
			},
		};
		const specs = buildClipPlaceholderNodes({
			plan: { runId: "r", videoModel: "m", generationContract, clips: [{ clipPrompt: "p", videoReferenceNodeIds: [], continuityMode: "editorial_cut", assetObjectContracts: [] }] },
			clipPlan: [{ clipIndex: 0, durationSeconds: 5, nodeId: "n", clipId: "r:clip:0", expectedPrevClipIndex: null }],
		});
		expect(specs[0]!.parentId).toBeUndefined();
		expect("videoAspect" in specs[0]!.data).toBe(false);
	});
});

describe("rebuildStoryPlanFromCanvasNodes", () => {
	it("build→rebuild round-trip 还原 runId/videoModel/aspect/parentGroupId/总时长/clips", () => {
		const specs = buildClipPlaceholderNodes({ plan: basePlan, clipPlan });
		// 模拟画布节点（build 出来的 spec 即节点形态）
		const nodes = specs.map((s) => ({ id: s.id, parentId: s.parentId, data: s.data }));
		const plan = rebuildStoryPlanFromCanvasNodes(nodes, "run-1");
		expect(plan).not.toBeNull();
		expect(plan!.runId).toBe("run-1");
		expect(plan!.videoModel).toBe("doubao-seedance-2-0-260128");
		expect(plan!.generationContract).toEqual(TEST_GENERATION_CONTRACT);
		expect(plan!.aspect).toBe("16:9");
		expect(plan!.parentGroupId).toBe("g2");
		expect(plan!.targetDurationSeconds).toBe(15 + 15);
		expect(plan!.clips).toHaveLength(2);
		expect(plan!.clips[0]).toMatchObject({
			clipPrompt: "镜0 李长安进甬道",
			storyboardPrompt: "sb0",
			characterRoleNames: ["李长安"],
			videoReferenceNodeIds: ["role-li", "scene-01"],
			assetObjectContracts: [characterContract("李长安", "role-li")],
			storyboardImageNodeId: "board-0",
			lastFrameImageNodeId: "tail-0",
			continuityMode: "editorial_cut",
		});
		// clip1 仍保留与上一镜闭合的桥接首帧。
		expect(plan!.clips[1]!.storyboardImageNodeId).toBe("tail-0");
		expect("lastFrameImageNodeId" in plan!.clips[1]!).toBe(false);
	});

	it("忽略其它 run / 非 video 节点", () => {
		const nodes = [
			{ id: "a", data: { kind: "video", clipRunId: "run-1", clipIndex: 0, prompt: "p0", videoModel: "m", generationContract: { ...TEST_GENERATION_CONTRACT, videoModel: "m", durationOptions: [5], maxDurationSeconds: 5 }, durationSeconds: 5, videoReferenceNodeIds: [], continuityMode: "editorial_cut", assetObjectContracts: [] } },
			{ id: "b", data: { kind: "video", clipRunId: "OTHER", clipIndex: 0, prompt: "x", videoModel: "m", durationSeconds: 9 } },
			{ id: "c", data: { kind: "image", clipRunId: "run-1", clipIndex: 1, prompt: "y" } },
		];
		const plan = rebuildStoryPlanFromCanvasNodes(nodes, "run-1");
		expect(plan!.clips).toHaveLength(1);
		expect(plan!.targetDurationSeconds).toBe(5);
		expect(plan!.clips[0]!.clipPrompt).toBe("p0");
	});

	it("动作迁移字段 videoReferType/sourceVideoUrl/keepOriginalSound 显式给则透传、缺省则不出现", () => {
		const nodes = [
			{
				id: "mt",
				data: {
					kind: "video",
					clipRunId: "run-1",
					clipIndex: 0,
					prompt: "新角色复演舞步",
					videoModel: "kling-v3-omni",
					generationContract: { ...TEST_GENERATION_CONTRACT, videoModel: "kling-v3-omni", durationOptions: [5], maxDurationSeconds: 5 },
					durationSeconds: 5,
					videoReferenceNodeIds: [],
					continuityMode: "editorial_cut",
					assetObjectContracts: [],
					videoReferType: "feature",
					sourceVideoUrl: "https://x/dance-demo.mp4",
					keepOriginalSound: "yes",
				},
			},
			// clip1 未声明动作迁移 → 不应出现这些键（零回归）
			{ id: "plain", data: { kind: "video", clipRunId: "run-1", clipIndex: 1, prompt: "普通续写镜", videoModel: "kling-v3-omni", generationContract: { ...TEST_GENERATION_CONTRACT, videoModel: "kling-v3-omni", durationOptions: [5], maxDurationSeconds: 5 }, durationSeconds: 5, videoReferenceNodeIds: [], continuityMode: "editorial_cut", assetObjectContracts: [] } },
		];
		const plan = rebuildStoryPlanFromCanvasNodes(nodes, "run-1");
		expect(plan!.clips[0]).toMatchObject({
			videoReferType: "feature",
			sourceVideoUrl: "https://x/dance-demo.mp4",
			keepOriginalSound: "yes",
		});
		expect("videoReferType" in plan!.clips[1]!).toBe(false);
		expect("sourceVideoUrl" in plan!.clips[1]!).toBe(false);
		expect("keepOriginalSound" in plan!.clips[1]!).toBe(false);
	});

	it("缺 videoModel、generationContract 或总时长<=0 / 无节点 → 返回 null（调用方跳过）", () => {
		expect(rebuildStoryPlanFromCanvasNodes([], "run-1")).toBeNull();
		expect(
			rebuildStoryPlanFromCanvasNodes(
				[{ id: "a", data: { kind: "video", clipRunId: "run-1", clipIndex: 0, durationSeconds: 5, videoReferenceNodeIds: [], continuityMode: "editorial_cut", assetObjectContracts: [] } }],
				"run-1",
			),
		).toBeNull(); // 缺 videoModel
		expect(
			rebuildStoryPlanFromCanvasNodes(
				[{ id: "a", data: { kind: "video", clipRunId: "run-1", clipIndex: 0, videoModel: "m", durationSeconds: 5, videoReferenceNodeIds: [], continuityMode: "editorial_cut", assetObjectContracts: [] } }],
				"run-1",
			),
		).toBeNull(); // 缺 generationContract
		expect(
			rebuildStoryPlanFromCanvasNodes(
				[{ id: "a", data: { kind: "video", clipRunId: "run-1", clipIndex: 0, videoModel: "m", generationContract: TEST_GENERATION_CONTRACT, durationSeconds: 0, videoReferenceNodeIds: [], continuityMode: "editorial_cut", assetObjectContracts: [] } }],
				"run-1",
			),
		).toBeNull(); // 总时长 0
	});

	it("旧引用字段或缺失连续性合同会显式报错，禁止 headless 空引用续跑", () => {
		expect(() =>
			rebuildStoryPlanFromCanvasNodes(
				[{ id: "legacy", data: { kind: "video", clipRunId: "run-1", clipIndex: 0, referenceImageNodeIds: ["role"], videoReferenceNodeIds: [], continuityMode: "editorial_cut" } }],
				"run-1",
			),
		).toThrow("仍使用已移除的 referenceImageNodeIds");
		expect(() =>
			rebuildStoryPlanFromCanvasNodes(
				[{ id: "missing", data: { kind: "video", clipRunId: "run-1", clipIndex: 0, videoReferenceNodeIds: [] } }],
				"run-1",
			),
		).toThrow("缺少合法 continuityMode");
	});
});
