import { describe, it, expect, beforeEach, vi } from "vitest";

const { projectFindFirst } = vi.hoisted(() => ({
	projectFindFirst: vi.fn(async () => null),
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		projects: { findFirst: projectFindFirst },
	}),
}));

import {
	getChapterCanvasFlow,
	putChapterCanvasFlow,
	CanvasFlowRevisionConflictError,
	CanvasFlowNotFoundError,
	CanvasFlowCorruptedError,
} from "./chapter.canvas-flow.service";
import { makeCtx, type FakeChapter } from "./chapter.canvas-flow.test-helpers";

describe("chapter.canvas-flow.service", () => {
	let chapters: Map<string, FakeChapter>;
	beforeEach(() => {
		chapters = new Map();
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: null,
			canvas_flow_revision: 0,
		});
	});

	it("getChapterCanvasFlow 返回 null flow + revision 0（首次加载）", async () => {
		const ctx = makeCtx(chapters);
		const result = await getChapterCanvasFlow(ctx, "u1", "c1");
		expect(result).toEqual({ chapterId: "c1", revision: 0, flow: null });
	});

	it("getChapterCanvasFlow 章节不存在抛 CanvasFlowNotFoundError", async () => {
		const ctx = makeCtx(chapters);
		await expect(getChapterCanvasFlow(ctx, "u1", "no-such")).rejects.toThrow(
			CanvasFlowNotFoundError,
		);
	});

	it("getChapterCanvasFlow 章节非本人抛 CanvasFlowNotFoundError", async () => {
		const ctx = makeCtx(chapters);
		await expect(getChapterCanvasFlow(ctx, "other", "c1")).rejects.toThrow(
			CanvasFlowNotFoundError,
		);
	});

	it("getChapterCanvasFlow canvas_flow 为损坏 JSON 抛 CanvasFlowCorruptedError", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: "{not-valid-json",
			canvas_flow_revision: 3,
		});
		const ctx = makeCtx(chapters);
		await expect(getChapterCanvasFlow(ctx, "u1", "c1")).rejects.toThrow(
			CanvasFlowCorruptedError,
		);
	});

	it("章节画布只向 admin 返回受保护的工作流节点", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					{ id: "source", data: { kind: "text" } },
					{ id: "trigger", data: { kind: "workflowTrigger", adminWorkflow: true } },
					{ id: "stage", data: { kind: "workflowStage", adminWorkflow: true } },
				],
				edges: [{ id: "protected-edge", source: "trigger", target: "stage" }],
			}),
			canvas_flow_revision: 4,
		});

		const memberResult = await getChapterCanvasFlow(makeCtx(chapters), "u1", "c1");
		expect(memberResult.flow?.nodes).toEqual([{ id: "source", data: { kind: "text" } }]);
		expect(memberResult.flow?.edges).toEqual([]);

		const adminResult = await getChapterCanvasFlow(makeCtx(chapters, [], "admin"), "u1", "c1");
		expect(adminResult.flow?.nodes.map((node) => node.id)).toEqual(["source", "trigger", "stage"]);
	});

	it("非 admin 保存章节画布时保留既有编排并丢弃伪造节点", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					{ id: "source", data: { kind: "text", text: "old" } },
					{ id: "trigger", data: { kind: "workflowTrigger", adminWorkflow: true } },
					{ id: "stage", data: { kind: "workflowStage", adminWorkflow: true } },
				],
				edges: [{ id: "protected-edge", source: "trigger", target: "stage" }],
			}),
			canvas_flow_revision: 4,
		});

		await putChapterCanvasFlow(makeCtx(chapters), "u1", "c1", {
			expectedRevision: 4,
			flow: {
				nodes: [
					{ id: "source", data: { kind: "text", text: "edited" } },
					{ id: "forged", data: { kind: "workflowStage" } },
				],
				edges: [{ id: "forged-edge", source: "source", target: "forged" }],
			},
		});

		const saved = JSON.parse(chapters.get("c1")?.canvas_flow ?? "{}") as {
			nodes: Array<{ id: string }>;
			edges: Array<{ id: string }>;
		};
		expect(saved.nodes.map((node) => node.id)).toEqual(["source", "trigger", "stage"]);
		expect(saved.edges.map((edge) => edge.id)).toEqual(["protected-edge"]);
	});

	it("普通整图保存不得删除或降级章节唯一真源种子的隐藏合同", async () => {
		const canonicalSeed = {
			id: "chapter-seed-c1",
			type: "taskNode",
			position: { x: 0, y: 0 },
			data: {
				kind: "text",
				locked: true,
				readOnly: true,
				prompt: "【第一章】\n\n完整剧情",
				sourceChapterRevision: 7,
				sourceHash: "hash-7",
				storyPreviewContract: {
					schemaVersion: "story-preview-contract/v1",
					storyDurationSeconds: 60,
					previewWindow: { startSeconds: 0, endSeconds: 15 },
					frameIntervalSeconds: 1,
					requiredReferences: [{
						nodeId: "ajiao",
						role: "identity",
						entityKind: "character",
						entityName: "阿乔",
					}],
				},
			},
		};
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({ nodes: [canonicalSeed, { id: "note", data: { kind: "text" } }], edges: [] }),
			canvas_flow_revision: 7,
		});

		await putChapterCanvasFlow(makeCtx(chapters), "u1", "c1", {
			expectedRevision: 7,
			flow: {
				nodes: [
					{ id: "chapter-seed-c1", data: { kind: "text", prompt: "旧浏览器可见正文，但隐藏合同已丢" } },
					{ id: "note", data: { kind: "text", text: "edited" } },
				],
				edges: [],
			},
		});

		const saved = JSON.parse(chapters.get("c1")?.canvas_flow ?? "{}") as {
			nodes: Array<{ id: string; data: Record<string, unknown> }>;
		};
		expect(saved.nodes.find((node) => node.id === "chapter-seed-c1")).toEqual(canonicalSeed);
		expect(saved.nodes.find((node) => node.id === "note")?.data.text).toBe("edited");
	});

	it("putChapterCanvasFlow 首次写入：expectedRevision=0 成功 → revision=1", async () => {
		const ctx = makeCtx(chapters);
		const flow = { nodes: [], edges: [] };
		const r = await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 0,
			flow,
		});
		expect(r.revision).toBe(1);
		expect(r.authoritativeFlow).toBeUndefined();
		expect(JSON.parse(chapters.get("c1")!.canvas_flow!)).toEqual(flow);
	});

	it("putChapterCanvasFlow revision 不匹配 → 拒绝 stale 整图快照", async () => {
		const ctx = makeCtx(chapters);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 0,
			flow: { nodes: [], edges: [] },
		}); // → revision 1
		await expect(putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 0,
			flow: { nodes: [{ id: "x" }], edges: [] },
		})).rejects.toBeInstanceOf(CanvasFlowRevisionConflictError);
		expect(chapters.get("c1")?.canvas_flow_revision).toBe(1);
		expect(JSON.parse(chapters.get("c1")?.canvas_flow ?? "{}").nodes).toEqual([]);
	});

	it("putChapterCanvasFlow 连续两次正确 revision 成功叠加", async () => {
		const ctx = makeCtx(chapters);
		const r1 = await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 0,
			flow: { nodes: [], edges: [] },
		});
		const r2 = await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: r1.revision,
			flow: { nodes: [{ id: "x" }], edges: [] },
		});
		expect(r2.revision).toBe(2);
	});

	it("空闲期 stale 整图只补回精确 bookBibleType 节点，不按显示标签猜测", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					{
						id: "typed-bible",
						data: { kind: "text", bookBibleType: "world", label: "随意显示名", prompt: "世界规则" },
					},
					{
						id: "label-only",
						data: { kind: "text", label: "世界观圣经", prompt: "不能凭标签成为世界书" },
					},
				],
				edges: [],
			}),
			canvas_flow_revision: 3,
		});

		await putChapterCanvasFlow(makeCtx(chapters), "u1", "c1", {
			expectedRevision: 3,
			flow: { nodes: [], edges: [] },
		});

		const saved = JSON.parse(chapters.get("c1")?.canvas_flow ?? "{}") as {
			nodes: Array<{ id: string }>;
		};
		expect(saved.nodes.map((node) => node.id)).toEqual(["typed-bible"]);
	});

	// —— 视频节点写保护（active run 期间，整图 autosave 不得回退 worker 写好的成片节点）——
	const successClip = (id: string) => ({
		id,
		type: "taskNode",
		data: {
			kind: "video",
			status: "success",
			videoUrl: `https://cdn/${id}.mp4`,
			clipIndex: 2,
			clipRunId: "run1",
		},
	});

	it("活跃 run 时：整图 PUT 把 success 视频节点降级回 running → 被护栏挡回 success", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({ nodes: [successClip("vclip-a")], edges: [] }),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "video_running" },
		]);
		// 前端整图 autosave 带着旧状态（running、丢了 videoUrl）回写
		const result = await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: {
				nodes: [{ id: "vclip-a", type: "taskNode", data: { kind: "video", status: "running" } }],
				edges: [],
			},
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes[0].data.status).toBe("success");
		expect(saved.nodes[0].data.videoUrl).toBe("https://cdn/vclip-a.mp4");
		expect(result.authoritativeFlow?.nodes[0]).toMatchObject({
			id: "vclip-a",
			data: {
				status: "success",
				videoUrl: "https://cdn/vclip-a.mp4",
			},
		});
	});

	it("活跃 run 时：整图漏带已完成视频节点 → 按 DB 版本补回", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({ nodes: [successClip("vclip-a")], edges: [] }),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "video_running" },
		]);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [{ id: "other" }], edges: [] },
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		const ids = saved.nodes.map((n: any) => n.id).sort();
		expect(ids).toEqual(["other", "vclip-a"]);
	});

	it("活跃 run 时：墓碑删除同 runId 的已完成旧成片 → 尊重删除不复活（2026-07-17 用户指令至上）", async () => {
		// 实证场景：runId 被复用重新出片（活跃），用户删上一轮生成的 success 旧成片节点，
		// 旧逻辑把它当"当前在跑 run 的视频"无条件护住复活。墓碑=显式删除，必须赢。
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({ nodes: [successClip("vclip-old")], edges: [] }),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "video_running" },
		]);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [], edges: [] },
			deletedNodeIds: ["vclip-old"],
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes).toEqual([]);
	});

	it("run 终态(concatenated)时：显式墓碑删除已完成视频照常落盘", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({ nodes: [successClip("vclip-a")], edges: [] }),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "concatenated" },
		]);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [], edges: [] },
			deletedNodeIds: ["vclip-a"],
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes).toEqual([]);
	});

	it("run 终态后：无墓碑漏带已完成视频（stale 快照整图 PUT）→ 服务端补回不丢片", async () => {
		// 2026-07-04 ch3 实测：run concatenated 后原保护全关，陈旧标签页整图 PUT 把 23 段成片
		// 静默抹掉。新契约：空闲期删除已完成视频必须带 deletedNodeIds 墓碑，漏带一律按 DB 补回。
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({ nodes: [successClip("vclip-a")], edges: [] }),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "concatenated" },
		]);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [], edges: [] },
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes.map((n: { id: string }) => n.id)).toEqual(["vclip-a"]);
	});

	it("run 终态后：同 id stale 快照不得把已完成成片降级或抹掉持久 URL", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					{
						id: "film-run1",
						type: "taskNode",
						data: {
							kind: "composeVideo",
							status: "success",
							productionState: "concatenated",
							videoUrl: "https://cdn/final.mp4",
							videoResults: [{ title: "合成视频", url: "https://cdn/final.mp4" }],
							videoPrimaryIndex: 0,
							clipRunId: "run1",
						},
					},
				],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "concatenated" },
		]);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: {
				nodes: [
					{
						id: "film-run1",
						type: "taskNode",
						data: { kind: "composeVideo", status: "clips_ready", clipRunId: "run1" },
					},
				],
				edges: [],
			},
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!) as {
			nodes: Array<{ data: Record<string, unknown> }>;
		};
		expect(saved.nodes[0]?.data).toMatchObject({
			status: "success",
			productionState: "concatenated",
			videoUrl: "https://cdn/final.mp4",
			videoResults: [{ title: "合成视频", url: "https://cdn/final.mp4" }],
			videoPrimaryIndex: 0,
		});
	});

	it("活跃 run 时：videoCompose 拼写的成片节点同样受保护（前端规范化拼写）", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					{
						id: "film-x",
						type: "taskNode",
						data: {
							kind: "videoCompose",
							status: "success",
							videoUrl: "https://cdn/film-x.mp4",
							clipRunId: "run1",
						},
					},
				],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "video_running" },
		]);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: {
				nodes: [{ id: "film-x", type: "taskNode", data: { kind: "videoCompose", status: "running" } }],
				edges: [],
			},
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes[0].data.status).toBe("success");
		expect(saved.nodes[0].data.videoUrl).toBe("https://cdn/film-x.mp4");
	});

	it("活跃 run 时：旧/别的(终态 run)视频被用户删除 → 不补回（治删了又恢复）", async () => {
		// run1 在跑；vclip-old 属于已 concatenated 的 runOld（旧成片的段）。用户删 vclip-old 应生效。
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					{
						id: "vclip-old",
						type: "taskNode",
						data: { kind: "video", status: "success", videoUrl: "https://cdn/old.mp4", clipRunId: "runOld" },
					},
				],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "video_running" },
			{ id: "runOld", chapter_id: "c1", state: "concatenated" },
		]);
		// 前端删掉旧视频后整图回写（不含 vclip-old）
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [], edges: [] },
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes).toEqual([]);
	});

	it("无任何 run 时：护栏空转，整图 PUT 原样落库（逐字等价）", async () => {
		const ctx = makeCtx(chapters); // 无 video_runs
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 0,
			flow: { nodes: [{ id: "x" }], edges: [] },
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes).toEqual([{ id: "x" }]);
	});

	// —— 图片资产写保护（出锚点/分镜板阶段：无 video_run，但画布有在飞节点即触发保护）——
	const successImage = (id: string) => ({
		id,
		type: "taskNode",
		data: { kind: "image", status: "success", imageUrl: `https://cdn/${id}.png` },
	});

	it("无 run 但有 running 在飞节点时：整图漏带已出图锚点 → 按 DB 补回", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					successImage("anchor-a"),
					{ id: "board-b", type: "taskNode", data: { kind: "storyboardimage", status: "running" } },
				],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters); // 无 video_runs，靠 running 节点触发保护
		// 前端 autosave 拿 stale 快照只带了 user 文本节点，漏了 agent 刚出的锚点和板
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [{ id: "note" }], edges: [] },
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		const ids = saved.nodes.map((n: any) => n.id).sort();
		expect(ids).toEqual(["anchor-a", "board-b", "note"]);
	});

	it("活跃期：前端把已出图锚点抹掉 imageUrl/降级 → 按 DB 终值回填", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					successImage("anchor-a"),
					{ id: "board-b", type: "taskNode", data: { kind: "image", status: "running" } },
				],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: {
				nodes: [
					{ id: "anchor-a", type: "taskNode", data: { kind: "image", status: "queued" } },
					{ id: "board-b", type: "taskNode", data: { kind: "image", status: "running" } },
				],
				edges: [],
			},
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		const a = saved.nodes.find((n: any) => n.id === "anchor-a");
		expect(a.data.imageUrl).toBe("https://cdn/anchor-a.png");
		expect(a.data.status).toBe("success");
	});

	it("空闲期(无 run + 无在飞节点)：用户删除图片节点照常生效，不误锁", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({ nodes: [successImage("anchor-a")], edges: [] }),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters); // 无 run，DB 内无 running/queued
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [], edges: [] },
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes).toEqual([]);
	});

	// —— 删除墓碑 + 删 hasDesignBoards 保护信号（2026-06-30 根治：分镜板工作流已废） ——
	// 此前 design_board 在场让 underActiveGeneration 永久为真 → 保护常开 → 母板/分镜板删了被无脑复活、
	// 陈旧节点反复注入小T。现已删该信号：空闲章节(无 run、无在飞节点)护栏不活跃 → 整图 PUT 权威、删除立即落盘。
	const designBoard = (id: string) => ({
		id,
		type: "taskNode",
		data: {
			kind: "storyboardimage",
			productionLayer: "design_board",
			status: "success",
			imageUrl: `https://cdn/${id}.png`,
		},
	});

	it("设计板在场但无 run：护栏不活跃，删除母板直接落盘（即使没带墓碑·根治不再复活）", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [designBoard("board-x"), successImage("master-y")],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters); // 无 run、无在飞节点；design_board 不再触发 underActiveGeneration
		// 删了 master-y 整图回写：空闲章节护栏不活跃 → 前端权威 → master-y 直接删掉，不再被复活。
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [designBoard("board-x")], edges: [] },
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes.map((n: any) => n.id)).toEqual(["board-x"]);
	});

	it("设计板在场(护栏活跃)+带墓碑：显式删除母板真正落盘（根因修复）", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [designBoard("board-x"), successImage("master-y")],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters);
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [designBoard("board-x")], edges: [] },
			deletedNodeIds: ["master-y"],
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes.map((n: any) => n.id)).toEqual(["board-x"]);
	});

	it("带墓碑：设计板自身也能被删（解死锁——板在场不再让它自己永久不可删）", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [designBoard("board-x"), successImage("master-y")],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters);
		// 用户把母板和分镜板全删了，只剩文本节点
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [{ id: "note", type: "taskNode", data: { kind: "text" } }], edges: [] },
			deletedNodeIds: ["board-x", "master-y"],
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes.map((n: any) => n.id)).toEqual(["note"]);
	});

	it("活跃 run 时墓碑不破坏 stale-drop 保护：未列入墓碑的漏带资产仍按 DB 补回", async () => {
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [designBoard("board-x"), successImage("anchor-a")],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		// 有活跃 run → 护栏活跃（不再靠 design_board 触发）；stale-drop 保护对图片资产仍生效。
		const ctx = makeCtx(chapters, [{ id: "run1", chapter_id: "c1", state: "video_running" }]);
		// stale autosave 只带了 note，漏了 board-x 和 anchor-a，且墓碑只声明删了 board-x
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [{ id: "note", type: "taskNode", data: { kind: "text" } }], edges: [] },
			deletedNodeIds: ["board-x"],
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		const ids = saved.nodes.map((n: any) => n.id).sort();
		// board-x 在墓碑→真删；anchor-a 不在墓碑→视为 stale 漏带，按 DB 补回
		expect(ids).toEqual(["anchor-a", "note"]);
	});

	it("活跃 run 时：墓碑不能删真在飞(running) clip（worker 回写竞态保护优先·2026-07-17 收窄到非 success）", async () => {
		// 旧版此测试用 success 节点断言"墓碑删不掉"——该语义已被用户指令至上拍板推翻
		//（已完成节点墓碑必胜）；worker 回写竞态保护只对真在飞(running/queued)的 clip 成立。
		chapters.set("c1", {
			id: "c1",
			owner_id: "u1",
			canvas_flow: JSON.stringify({
				nodes: [
					{
						id: "vclip-a",
						type: "taskNode",
						data: { kind: "video", status: "running", clipIndex: 2, clipRunId: "run1" },
					},
				],
				edges: [],
			}),
			canvas_flow_revision: 5,
		});
		const ctx = makeCtx(chapters, [
			{ id: "run1", chapter_id: "c1", state: "video_running" },
		]);
		// 即便前端声明删了在飞 clip，也不放行（防把 worker 正在写的段抹掉；真要删=取消 run）
		await putChapterCanvasFlow(ctx, "u1", "c1", {
			expectedRevision: 5,
			flow: { nodes: [], edges: [] },
			deletedNodeIds: ["vclip-a"],
		});
		const saved = JSON.parse(chapters.get("c1")!.canvas_flow!);
		expect(saved.nodes.map((n: any) => n.id)).toEqual(["vclip-a"]);
	});
});
