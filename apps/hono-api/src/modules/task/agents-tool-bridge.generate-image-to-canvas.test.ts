import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import type { AppContext } from "../../types";

const {
  mockedRunPublicTask,
  mockedFetchTaskResultForPolling,
  mockedUpdateFlow,
  mockedUpdateFlowByIdUnsafe,
  mockedCreateFlowVersion,
  mockedResolveExecutionImageReferences,
  mockedListProjectNodeAssetsForOwner,
  mockedUserFindUnique,
  mockedAssetFindMany,
} = vi.hoisted(() => ({
  mockedRunPublicTask: vi.fn(),
  mockedFetchTaskResultForPolling: vi.fn(),
  mockedUpdateFlow: vi.fn(),
  mockedUpdateFlowByIdUnsafe: vi.fn(),
  mockedCreateFlowVersion: vi.fn(),
  mockedResolveExecutionImageReferences: vi.fn(),
  mockedListProjectNodeAssetsForOwner: vi.fn(),
  mockedUserFindUnique: vi.fn(),
  mockedAssetFindMany: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    users: {
      findUnique: mockedUserFindUnique,
    },
    assets: {
      findMany: mockedAssetFindMany,
    },
  }),
}));

vi.mock("../apiKey/apiKey.routes", () => ({
  runPublicTask: mockedRunPublicTask,
}));

vi.mock("./task.polling", () => ({
  fetchTaskResultForPolling: mockedFetchTaskResultForPolling,
}));

vi.mock("./agents-tool-bridge.image-reference-ids", () => ({
  resolveExecutionImageReferences: mockedResolveExecutionImageReferences,
}));

vi.mock("../material/material.project-node-assets.service", () => ({
  listProjectNodeAssetsForOwner: mockedListProjectNodeAssetsForOwner,
}));

vi.mock("../flow/flow.repo", async () => {
  const actual = await vi.importActual<typeof import("../flow/flow.repo")>("../flow/flow.repo");
  return {
    ...actual,
    updateFlow: mockedUpdateFlow,
    updateFlowByIdUnsafe: mockedUpdateFlowByIdUnsafe,
    createFlowVersion: mockedCreateFlowVersion,
  };
});

import {
	assertChapterStoryPreviewContract,
	buildStoryPreviewNodeFromCompactBoard,
  ensureImageNodeShape,
	findReusableStoryPreviewBoard,
  generateImageToCanvas,
	inspectStoryPreviewRunSnapshot,
	isChapterStoryPreviewGenericImageRequest,
  makeProgressCounter,
	PublicAgentsImageGenerateToCanvasArgsSchema,
	selectDeclaredStoryPreviewReferences,
} from "./agents-tool-bridge.generate-image-to-canvas";

function buildPreviewCell(input: {
	cellIndex: number;
	startSeconds: number;
	endSeconds: number;
	subjectRefIds?: string[];
}) {
	return {
		cellIndex: input.cellIndex,
		startSeconds: input.startSeconds,
		endSeconds: input.endSeconds,
		timeRange: `${input.startSeconds}-${input.endSeconds}s`,
		narrativeFunction: "escalation",
		frameDescription: "阿乔左前景举枪对准右后景幽魂，双方视线锁定，枪口与狼牙棒形成对角线",
		visibleAction: "阿乔向右滑步举枪，幽魂向左踏步抬起狼牙棒",
		stateBefore: "阿乔在左侧低姿戒备，幽魂在右侧持棒压近",
		stateAfter: "阿乔完成一步侧移并锁定枪线，幽魂将棒头抬至肩高",
		causeFromPrevious: "上一秒双方已经建立对峙轴线",
		transitionToNext: "阿乔扣动扳机，幽魂继续下压狼牙棒",
		blocking: "阿乔左前景朝右，幽魂右后景朝左，战场纵深位于两者之间",
		cameraState: "35mm 中全景平视，摄影机沿对峙轴线侧移，焦点落在枪口与棒头之间",
		motionTransition: "阿乔重心沿左脚到右脚转移并抬枪，幽魂肩肘联动抬棒，摄影机同步侧移",
		physicalFeedback: "双方尚未接触，枪口热浪与棒头风压在中线对冲",
		environmentChange: "地面尘土沿中线卷起，竹叶向画面后方散开",
		subjectRefIds: input.subjectRefIds ?? ["node:ajiao", "node:youhun", "node:scene"],
	};
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedResolveExecutionImageReferences.mockResolvedValue([]);
  mockedListProjectNodeAssetsForOwner.mockResolvedValue([]);
  mockedUserFindUnique.mockResolvedValue({ generation_prefs: null });
  mockedAssetFindMany.mockResolvedValue([]);
});

describe("ensureImageNodeShape", () => {
  it("forces newly generated assets to require real user confirmation", () => {
    const shaped = ensureImageNodeShape({
      type: "taskNode",
      position: { x: 0, y: 0 },
      data: { kind: "image", prompt: "scene", approvalStatus: "approved" },
    }) as { data: Record<string, unknown> };

    expect(shaped.data.approvalStatus).toBe("needs_confirmation");
  });

	it("keeps chapter story preview boards outside the production design-board layer", () => {
    const shaped = ensureImageNodeShape({
      data: {
        kind: "storyboardImage",
        prompt: "九格章节剧情预览",
        assetUsage: "preview_only",
        previewSeriesId: "chapter-1-r75",
        previewBoardIndex: 0,
        previewBoardCount: 1,
        previewShotCount: 9,
      },
    }) as { data: Record<string, unknown> };

    expect(shaped.data).toMatchObject({
      assetUsage: "preview_only",
      assetPurpose: "story_preview",
      productionEligible: false,
      productionLayer: "preview",
      creationStage: "story_preview",
      previewShotCount: 9,
    });
		expect(shaped.data.productionLayer).not.toBe("design_board");
	});

	it("does not fabricate semantic fields for a legacy compact preview node", () => {
		const shaped = ensureImageNodeShape({
			data: {
				kind: "storyboardImage",
				prompt: "逐秒预览",
				storyPreviewCells: [{
					cellIndex: 1,
					startSeconds: 0,
					endSeconds: 1,
					timeRange: "0-1s",
					frameDescription: "阿乔持枪落地",
					stateBefore: "阿乔在半空",
					stateAfter: "阿乔屈膝落地",
					cameraState: "中景跟随",
					motionTransition: "半空下落到屈膝落地",
					physicalFeedback: "尘土扬起",
					environmentChange: "竹叶晃动",
					subjectRefIds: ["node:ajiao"],
				}],
			},
		}) as { data: { storyPreviewCells: Array<Record<string, unknown>> } };

		expect(shaped.data.storyPreviewCells[0]).not.toHaveProperty("narrativeFunction");
		expect(shaped.data.storyPreviewCells[0]).not.toHaveProperty("visibleAction");
		expect(shaped.data.storyPreviewCells[0]).not.toHaveProperty("causeFromPrevious");
		expect(shaped.data.storyPreviewCells[0]).not.toHaveProperty("transitionToNext");
		expect(shaped.data.storyPreviewCells[0]).not.toHaveProperty("blocking");
	});

  it("keeps storyboard production defaults while removing fabricated approval", () => {
    const shaped = ensureImageNodeShape({
      data: { kind: "storyboardImage", prompt: "shots", approvalStatus: "approved" },
    }) as { type: string; position: { x: number; y: number }; data: Record<string, unknown> };

    expect(shaped.type).toBe("taskNode");
    expect(shaped.position).toEqual({ x: 0, y: 0 });
    expect(shaped.data.productionLayer).toBe("design_board");
    expect(shaped.data.approvalStatus).toBe("needs_confirmation");
  });
});

describe("compact story preview board", () => {
	const contract = {
		schemaVersion: "story-preview-contract/v1",
		storyDurationSeconds: 60,
		previewScope: "user_window",
		previewWindow: { startSeconds: 0, endSeconds: 15 },
		frameIntervalSeconds: 1,
		requiredReferences: [
			{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
			{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂" },
			{ nodeId: "scene", role: "layout", entityKind: "scene", entityName: "黑风山" },
			{ nodeId: "club", role: "content", entityKind: "prop", entityName: "狼牙棒" },
			{ nodeId: "gun", role: "content", entityKind: "prop", entityName: "现代火器" },
		],
	} as const;
	const row: FlowRow = {
		id: "chapter-flow-compact",
		name: "Chapter",
		data: JSON.stringify({ nodes: [{
			id: "chapter-seed-chapter-compact",
			data: {
				prompt: "【0-10s】阿乔持现代火器落地观察。\n【10-15s】幽魂持狼牙棒现身逼近，停在对峙。",
				sourceChapterRevision: 469,
				sourceHash: "hash-469",
				storyPreviewContract: contract,
			},
		}], edges: [] }),
		owner_id: "user-1",
		project_id: "project-1",
		created_at: "2026-08-20T00:00:00.000Z",
		updated_at: "2026-08-20T00:00:00.000Z",
	};
	const compactCell = (second: number) => ({
		frame: `阿乔持枪保持第${second}秒的连续戒备构图`,
		mid: `阿乔在${second + 0.5}秒完成半步观察动作`,
		end: `阿乔在${second + 1}秒稳定枪口与重心`,
		camera: "35mm中景沿行动方向平稳跟随",
		feedback: "枪带与衣摆受惯性轻摆，无接触打击",
		environment: "薄雾随脚步向后分开，地面落叶轻移",
		subjectRefIds: ["node:ajiao", "node:youhun", "node:scene", "node:club", "node:gun"],
	});

	it("expands a 9-cell board from the frozen timeline and all five references", () => {
		const node = buildStoryPreviewNodeFromCompactBoard({
			row,
			chapterId: "chapter-compact",
			board: {
				seriesId: "preview-469",
				boardIndex: 0,
				openingState: "阿乔持现代火器从画面上方进入",
				cells: Array.from({ length: 9 }, (_, index) => compactCell(index)),
			},
		}) as { data: Record<string, unknown> };

		assertChapterStoryPreviewContract({ row, chapterId: "chapter-compact", node });
		const cells = node.data.storyPreviewCells as Array<Record<string, unknown>>;
		expect(node.data).toMatchObject({
			previewBoardIndex: 0,
			previewBoardCount: 2,
			previewShotCount: 9,
			referenceImageNodeIds: ["ajiao", "youhun", "scene", "club", "gun"],
			sourceChapterRevision: 469,
			sourceHash: "hash-469",
		});
		expect(cells[0]).toMatchObject({ cellIndex: 1, startSeconds: 0, endSeconds: 1, timeRange: "0-1s" });
		expect(cells[8]).toMatchObject({ cellIndex: 9, startSeconds: 8, endSeconds: 9, timeRange: "8-9s" });
		expect(cells[1]?.stateBefore).toBe(cells[0]?.stateAfter);
		expect(String(cells[0]?.motionTransition)).toContain("0.5秒承接");
		expect(String(node.data.prompt)).toContain("完整故事总长 60s；本板只覆盖 0-9s");
	});

	it("rejects an undeclared per-cell reference before paid generation", () => {
		const node = buildStoryPreviewNodeFromCompactBoard({
			row,
			chapterId: "chapter-compact",
			board: {
				seriesId: "preview-469",
				boardIndex: 0,
				openingState: "阿乔持现代火器从画面上方进入",
				cells: Array.from({ length: 9 }, (_, index) => ({
					...compactCell(index),
					subjectRefIds: index === 0 ? ["node:not-frozen"] : ["node:ajiao"],
				})),
			},
		});

		expect(() => assertChapterStoryPreviewContract({
			row,
			chapterId: "chapter-compact",
			node,
		})).toThrow(/缺少完整的时间窗、参考清单或逐格状态数据/u);
		expect(mockedRunPublicTask).not.toHaveBeenCalled();
	});

	it("rejects a compact board with a wrong derived cell count before paid generation", () => {
		expect(() => buildStoryPreviewNodeFromCompactBoard({
			row,
			chapterId: "chapter-compact",
			board: {
				seriesId: "preview-469",
				boardIndex: 1,
				openingState: "阿乔在9秒末完成戒备",
				cells: Array.from({ length: 5 }, (_, index) => compactCell(index + 9)),
			},
		})).toThrow(/数量必须与服务端时间轴完全一致/);
		expect(mockedRunPublicTask).not.toHaveBeenCalled();
	});

	it("derives seven nine-cell pages for a full 60-second one-second preview", () => {
		const fullStoryContract = {
			...contract,
			previewScope: "full_story" as const,
			previewWindow: { startSeconds: 0, endSeconds: 60 },
		};
		const fullStoryRow: FlowRow = {
			...row,
			data: JSON.stringify({
				nodes: [{
					id: "chapter-seed-chapter-compact",
					data: {
						prompt: "【0-60s】完整剧情",
						sourceChapterRevision: 470,
						sourceHash: "hash-470",
						storyPreviewContract: fullStoryContract,
					},
				}],
				edges: [],
			}),
		};
		const lastBoard = buildStoryPreviewNodeFromCompactBoard({
			row: fullStoryRow,
			chapterId: "chapter-compact",
			board: {
				seriesId: "preview-470",
				boardIndex: 6,
				openingState: "第54秒开始时双方仍在同一战场",
				cells: Array.from({ length: 6 }, (_, index) => compactCell(index + 54)),
			},
		}) as { data: Record<string, unknown> };
		const cells = lastBoard.data.storyPreviewCells as Array<Record<string, unknown>>;

		expect(lastBoard.data).toMatchObject({
			previewBoardIndex: 6,
			previewBoardCount: 7,
			previewShotCount: 6,
			productionLayer: "preview",
		});
		expect(cells[0]).toMatchObject({ startSeconds: 54, endSeconds: 55, timeRange: "54-55s" });
		expect(cells[5]).toMatchObject({ startSeconds: 59, endSeconds: 60, timeRange: "59-60s" });
	});

	it("uses the exact per-cell reference declarations without reading prose or adding a protagonist", () => {
		const references = [
			{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
			{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂大头佛" },
			{ nodeId: "battle-scene", role: "layout", entityKind: "scene", entityName: "黑风山幽魂战场" },
			{ nodeId: "battle-plan", role: "content", entityKind: "content", entityName: "幽魂Boss对战动作规划" },
		] as const;
		const tailCells = Array.from({ length: 6 }, (_, index) => ({
			...buildPreviewCell({
				cellIndex: index + 1,
				startSeconds: 54 + index,
				endSeconds: 55 + index,
				subjectRefIds: ["node:ajiao"],
			}),
			frameDescription: "现实形态阿乔离开游戏屏幕，进入赛博街景与存档界面",
			visibleAction: "镜头从显示器拉开，键盘和现实空间逐步显露",
			stateBefore: "黑风山战场只存在于显示器内部",
			stateAfter: "现实阿乔与赛博街景成为当前物理空间",
		}));
		const active = selectDeclaredStoryPreviewReferences({
				contract: {
					schemaVersion: "story-preview-contract/v1",
					storyDurationSeconds: 60,
					previewScope: "full_story",
					previewWindow: { startSeconds: 0, endSeconds: 60 },
					frameIntervalSeconds: 1,
					requiredReferences: references,
				},
				referenceManifest: references,
				cells: tailCells,
				previewSeriesId: "series",
				previewBoardIndex: 6,
				previewBoardCount: 7,
		});

		expect(active.map((reference) => reference.nodeId)).toEqual(["ajiao"]);
	});

	it("keeps source fidelity in the agent chain while enforcing exact declared reference IDs", () => {
		const fullContract = {
			...contract,
			previewScope: "full_story" as const,
			previewWindow: { startSeconds: 0, endSeconds: 60 },
		};
		const sourceNarrative = `■【30-50s】中段攻坚\n阿乔凌厉追击，就在即将击杀关头，残血幽魂凝聚力量释放全屏大招。\n■【50-60s】终局反转·拉出游戏·赛博收束\n极致秒杀金光吞没战场。镜头陡然拉开，战场缩进屏幕，键盘与现实阿乔出现。赛博街景中继续游戏与存档点亮，胜负未定下回续战。`;
		const fullRow: FlowRow = {
			...row,
			data: JSON.stringify({ nodes: [{
				id: "chapter-seed-chapter-compact",
				data: {
					prompt: sourceNarrative,
					sourceChapterRevision: 472,
					sourceHash: "hash-472",
					storyPreviewContract: fullContract,
				},
			}], edges: [] }),
		};
		const wrongCell = {
			frame: "阿乔扛着火铳站在恢复安宁的黑风山战场",
			mid: "阿乔迎着暖金色朝阳沿碎石道路向前行走",
			end: "黑风山战场在晨光中淡出并恢复彻底平静",
			camera: "远景缓慢后拉并抬向朝阳天空",
			feedback: "脚步踩过碎石带起轻微尘土",
			environment: "暖金色晨光覆盖旧战场",
			subjectRefIds: ["node:ajiao"],
		};
		const wrongNode = buildStoryPreviewNodeFromCompactBoard({
			row: fullRow,
			chapterId: "chapter-compact",
			board: {
				seriesId: "series-472",
				boardIndex: 6,
				openingState: "黑风山战斗结束后阿乔仍站在碎石战场",
				cells: Array.from({ length: 6 }, () => wrongCell),
			},
		});

		expect(() => assertChapterStoryPreviewContract({
			row: fullRow,
			chapterId: "chapter-compact",
			node: wrongNode,
		})).not.toThrow();

		const correctTexts = [
			"战场金光被显示器边框包围，游戏画面开始缩进屏幕",
			"镜头退出显示器，键盘和敲击键帽的手进入现实空间",
			"现实形态阿乔靠回椅背，屏幕余光照亮他的脸",
			"赛博街景广角展开，霓虹灯在现实空间逐层点亮",
			"黑风山游戏图标与继续游戏按钮在显示器上发光",
			"存档点亮并定格，阿乔说明天再续，胜负未定",
		];
		const correctNode = buildStoryPreviewNodeFromCompactBoard({
			row: fullRow,
			chapterId: "chapter-compact",
			board: {
				seriesId: "series-472",
				boardIndex: 6,
				openingState: "游戏战场正在被全屏金光吞没",
				cells: correctTexts.map((text) => ({
					frame: `${text}，主体位置和空间边界清晰可见`,
					mid: `${text}，半程变化沿镜头运动连续发生`,
					end: `${text}，形成下一秒可以继承的明确状态`,
					camera: "镜头沿游戏屏幕到现实空间的方向连续后拉",
					feedback: "屏幕金光与现实环境光发生可见明暗交接",
					environment: "旧战场只保留在屏幕内部，现实赛博空间逐步建立",
					subjectRefIds: ["node:ajiao"],
				})),
			},
		}) as { data: Record<string, unknown> };
		assertChapterStoryPreviewContract({ row: fullRow, chapterId: "chapter-compact", node: correctNode });

		expect(correctNode.data.referenceImageNodeIds).toEqual(["ajiao"]);
		expect(correctNode.data.activeReferenceManifest).toEqual([
			expect.objectContaining({ nodeId: "ajiao", entityName: "阿乔" }),
		]);
		expect(String(correctNode.data.prompt)).toContain("subjectRefIds");
		expect(mockedRunPublicTask).not.toHaveBeenCalled();
	});

	it("recovers the first missing board from persisted running and success checkpoints", () => {
		const fullStoryContract = {
			...contract,
			previewScope: "full_story" as const,
			previewWindow: { startSeconds: 0, endSeconds: 60 },
		};
		const baseCheckpointRow: FlowRow = {
			...row,
			data: JSON.stringify({
				nodes: [{
						id: "chapter-seed-chapter-compact",
						data: {
							prompt: "【0-60s】完整剧情",
							sourceChapterRevision: 471,
							sourceHash: "hash-471",
							storyPreviewContract: fullStoryContract,
						},
					}],
				edges: [],
			}),
		};
		const validBoard0 = buildStoryPreviewNodeFromCompactBoard({
			row: baseCheckpointRow,
			chapterId: "chapter-compact",
			board: {
				seriesId: "checkpoint-series",
				boardIndex: 0,
				openingState: "阿乔持现代火器进入完整剧情起始空间",
				cells: Array.from({ length: 9 }, (_, index) => compactCell(index)),
			},
		}) as { data: Record<string, unknown> };
		assertChapterStoryPreviewContract({ row: baseCheckpointRow, chapterId: "chapter-compact", node: validBoard0 });
		const checkpointedRow: FlowRow = {
			...baseCheckpointRow,
			data: JSON.stringify({
				nodes: [
					...(JSON.parse(baseCheckpointRow.data) as { nodes: unknown[] }).nodes,
					{
						id: "board-0",
						data: {
							...validBoard0.data,
							status: "success",
							imageUrl: "https://example.com/board-0.png",
							taskId: "task-0",
						},
					},
					{
						id: "board-1",
						data: {
							previewBoardIndex: 1,
							sourceChapterRevision: 471,
							sourceHash: "hash-471",
							status: "running",
							taskId: "task-1",
						},
					},
				],
				edges: [],
			}),
		};

		const snapshot = inspectStoryPreviewRunSnapshot({
			row: checkpointedRow,
			chapterId: "chapter-compact",
		});

		expect(snapshot.boardCount).toBe(7);
		expect(snapshot.boards[0]).toMatchObject({ status: "success", nodeId: "board-0" });
		expect(snapshot.boards[1]).toMatchObject({ status: "running", nodeId: "board-1" });
		expect(snapshot.boards[6]).toMatchObject({ expectedCellCount: 6, status: "missing" });
		expect(snapshot.nextBoardIndex).toBe(2);
	});

	it("rejects a story-preview nodes fallback before any paid image task starts", async () => {
		expect(isChapterStoryPreviewGenericImageRequest({
			productionLayer: "preview",
			creationStage: "story_preview",
			nodes: [{
				label: "故事预览 0-5s",
				data: { kind: "storyboardImage", prompt: "一张独立动作图" },
			}],
		})).toBe(true);
		expect(isChapterStoryPreviewGenericImageRequest({
			node: {
				data: {
					kind: "storyboardImage",
					storyPreviewContract: { schemaVersion: "story-preview-contract/v1" },
					referenceManifest: [],
					storyPreviewCells: [],
				},
			},
		})).toBe(true);

		await expect(generateImageToCanvas({
			c: { env: { DB: {} } } as AppContext,
			requestUserId: "user-1",
			devBypass: false,
			flowId: "chapter-compact",
			chapterId: "chapter-compact",
			row,
			bodyArgs: {
				productionLayer: "preview",
				creationStage: "story_preview",
				nodes: Array.from({ length: 6 }, (_, index) => ({
					label: `故事预览 ${index * 5}-${index * 5 + 5}s`,
					data: {
						kind: "storyboardImage",
						prompt: `第${index + 1}张独立动作图`,
					},
				})),
			},
		})).rejects.toMatchObject({
			code: "chapter_story_preview_requires_compact_board",
		});
		expect(mockedRunPublicTask).not.toHaveBeenCalled();
	});

	it("reuses the same frozen board even when a continuation invents a different seriesId", () => {
		const validBoard = buildStoryPreviewNodeFromCompactBoard({
			row,
			chapterId: "chapter-compact",
			board: {
				seriesId: "first-agent-series",
				boardIndex: 0,
				openingState: "阿乔持现代火器从画面上方进入",
				cells: Array.from({ length: 9 }, (_, index) => compactCell(index)),
			},
		}) as { data: Record<string, unknown> };
		assertChapterStoryPreviewContract({ row, chapterId: "chapter-compact", node: validBoard });
		const persistedRow: FlowRow = {
			...row,
			data: JSON.stringify({
				nodes: [
					...(JSON.parse(row.data) as { nodes: unknown[] }).nodes,
					{
						id: "board-success",
						data: {
							...validBoard.data,
							status: "success",
							imageUrl: "https://example.com/board-0.png",
							taskId: "task-board-0",
							vendor: "newapi",
						},
					},
				],
				edges: [],
			}),
		};

		expect(findReusableStoryPreviewBoard({
			row: persistedRow,
			chapterId: "chapter-compact",
			boardIndex: 0,
		})).toEqual({
			nodeId: "board-success",
			imageUrl: "https://example.com/board-0.png",
			vendor: "newapi",
			taskId: "task-board-0",
			status: "success",
		});
	});

	it("reuses a structurally valid persisted board without reinterpreting its authored prose", () => {
		const endingContract = {
			...contract,
			previewScope: "full_story" as const,
			previewWindow: { startSeconds: 0, endSeconds: 60 },
		};
		const endingRow: FlowRow = {
			...row,
			data: JSON.stringify({
				nodes: [{
					id: "chapter-seed-chapter-compact",
					data: {
						prompt: "【0-50s】阿乔在黑风山战场与幽魂持续攻防。\n【50-60s】金光吞没战场，镜头拉出游戏屏幕，现实阿乔靠回椅背，赛博街景中存档点亮。",
						sourceChapterRevision: 473,
						sourceHash: "hash-473",
						storyPreviewContract: endingContract,
					},
				}],
				edges: [],
			}),
		};
		const wrongNode = buildStoryPreviewNodeFromCompactBoard({
			row: endingRow,
			chapterId: "chapter-compact",
			board: {
				seriesId: "series-473",
				boardIndex: 6,
				openingState: "阿乔仍在黑风山战场",
				cells: Array.from({ length: 6 }, () => ({
					frame: "阿乔扛着火铳站在恢复安宁的黑风山战场",
					mid: "阿乔迎着暖金色朝阳沿碎石道路向前行走",
					end: "黑风山战场在晨光中淡出并恢复彻底平静",
					camera: "远景缓慢后拉并抬向朝阳天空",
					feedback: "脚步踩过碎石带起轻微尘土",
					environment: "暖金色晨光覆盖旧战场",
					subjectRefIds: ["node:ajiao"],
				})),
			},
		}) as { data: Record<string, unknown> };
		assertChapterStoryPreviewContract({ row: endingRow, chapterId: "chapter-compact", node: wrongNode });
		const persistedWrongRow: FlowRow = {
			...endingRow,
			data: JSON.stringify({
				nodes: [
					...(JSON.parse(endingRow.data) as { nodes: unknown[] }).nodes,
					{
						id: "wrong-success-board",
						data: {
							...wrongNode.data,
							status: "success",
							imageUrl: "https://example.com/wrong-ending.png",
							taskId: "task-wrong-ending",
						},
					},
				],
				edges: [],
			}),
		};

		expect(findReusableStoryPreviewBoard({
			row: persistedWrongRow,
			chapterId: "chapter-compact",
			boardIndex: 6,
		})).toMatchObject({ nodeId: "wrong-success-board", status: "success" });
		expect(inspectStoryPreviewRunSnapshot({
			row: persistedWrongRow,
			chapterId: "chapter-compact",
		}).boards[6]).toMatchObject({ status: "success" });
	});

	it("rejects previewBoard on the public generic image contract", () => {
		expect(PublicAgentsImageGenerateToCanvasArgsSchema.safeParse({
			previewBoard: {
				boardIndex: 0,
				openingState: "start",
				cells: [compactCell(0)],
			},
		}).success).toBe(false);
	});

	it("does not reuse a failed board or one from an older frozen source", () => {
		const persistedRow: FlowRow = {
			...row,
			data: JSON.stringify({
				nodes: [
					...(JSON.parse(row.data) as { nodes: unknown[] }).nodes,
					{
						id: "board-failed",
						data: {
							previewBoardIndex: 1,
							sourceChapterRevision: 469,
							sourceHash: "hash-469",
							status: "error",
							taskId: "task-failed",
						},
					},
					{
						id: "board-stale",
						data: {
							previewBoardIndex: 1,
							sourceChapterRevision: 468,
							sourceHash: "hash-468",
							status: "success",
							imageUrl: "https://example.com/stale.png",
						},
					},
				],
				edges: [],
			}),
		};

		expect(findReusableStoryPreviewBoard({
			row: persistedRow,
			chapterId: "chapter-compact",
			boardIndex: 1,
		})).toBeNull();
	});
});

describe("makeProgressCounter", () => {
  it("每次 resolve 递增 completed，failed 累计，触发 onProgress", () => {
    const calls: Array<{ c: number; t: number; f: number }> = [];
    const bump = makeProgressCounter(3, (c, t, f) => calls.push({ c, t, f }));
    bump(true); // 成功
    bump(false); // 失败
    bump(true); // 成功
    expect(calls).toEqual([
      { c: 1, t: 3, f: 0 },
      { c: 2, t: 3, f: 1 },
      { c: 3, t: 3, f: 1 },
    ]);
  });

  it("onProgress 抛错不冒泡（进度上报绝不拖垮出图）", () => {
    const bump = makeProgressCounter(1, () => {
      throw new Error("boom");
    });
    expect(() => bump(true)).not.toThrow();
  });

  it("无 onProgress 时也不抛", () => {
    const bump = makeProgressCounter(2);
    expect(() => {
      bump(true);
      bump(false);
    }).not.toThrow();
  });
});

describe("generateImageToCanvas", () => {
	it("故事板未绑定项目锚时记录非阻塞候选诊断并继续提交", async () => {
		mockedListProjectNodeAssetsForOwner.mockResolvedValueOnce([
			{
				id: "project-node:chapter:chapter-1:ajiao",
				projectId: "project-1",
				kind: "character",
				name: "阿乔",
				updatedAt: "2026-08-19T00:00:00.000Z",
				latestVersion: { data: { imageUrl: "https://example.com/ajiao.png" } },
			},
		]);
		const row: FlowRow = {
			id: "flow-1",
			name: "Flow",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-03-26T00:00:00.000Z",
			updated_at: "2026-03-26T00:00:00.000Z",
		};
		mockedRunPublicTask.mockResolvedValueOnce({
			vendor: "apimart",
			result: {
				id: "task-storyboard-anchor-diagnostic",
				status: "succeeded",
				assets: [{ type: "image", url: "https://example.com/storyboard-result.png" }],
			},
		});
		mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
			id: input.id,
			name: input.name,
			data: input.data,
			owner_id: "user-1",
			project_id: "project-1",
			created_at: row.created_at,
			updated_at: input.nowIso,
		}));
		mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

		await expect(generateImageToCanvas({
			c: { env: { DB: {} } } as AppContext,
			requestUserId: "user-1",
			devBypass: false,
			flowId: "flow-1",
			row,
			bodyArgs: {
				node: {
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "storyboardImage", prompt: "0-15 秒故事板" },
				},
			},
		})).resolves.toMatchObject({ ok: true });
		expect(mockedListProjectNodeAssetsForOwner).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			{ projectId: "project-1" },
		);
		expect(mockedRunPublicTask).toHaveBeenCalledTimes(1);
		const persistedFlow = JSON.parse(String(mockedUpdateFlow.mock.calls[0]?.[1]?.data ?? "{}")) as {
			nodes?: Array<{ data?: Record<string, unknown> }>;
		};
		expect(persistedFlow.nodes?.[0]?.data?.storyboardAnchorDiagnostic).toMatchObject({
			version: 1,
			code: "storyboard_anchor_candidates_available",
			blocking: false,
			projectId: "project-1",
			candidates: [expect.objectContaining({ assetId: "project-node:chapter:chapter-1:ajiao" })],
		});
	});

	it("injects every frozen chapter reference even when the agent omits one from its execution list", () => {
		const contract = {
			schemaVersion: "story-preview-contract/v1",
			storyDurationSeconds: 60,
			previewScope: "user_window",
			previewWindow: { startSeconds: 0, endSeconds: 1 },
			frameIntervalSeconds: 1,
			requiredReferences: [
				{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
				{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂" },
				{ nodeId: "scene", role: "layout", entityKind: "scene", entityName: "战场" },
			],
		} as const;
		const row: FlowRow = {
			id: "chapter-flow-1",
			name: "Chapter",
			data: JSON.stringify({
				nodes: [{
					id: "chapter-seed-chapter-1",
					data: {
						kind: "text",
						sourceChapterRevision: 75,
						sourceHash: "source-hash",
						storyPreviewContract: contract,
					},
				}],
				edges: [],
			}),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-03-26T00:00:00.000Z",
			updated_at: "2026-03-26T00:00:00.000Z",
		};
		const node = {
			type: "taskNode",
			position: { x: 0, y: 0 },
		data: {
			kind: "storyboardImage",
			prompt: "完整故事预览",
			assetUsage: "preview_only",
			previewSeriesId: "chapter-1-r75-preview",
			previewBoardIndex: 0,
			previewBoardCount: 1,
			previewShotCount: 1,
				sourceChapterRevision: 75,
				sourceHash: "source-hash",
				storyPreviewContract: contract,
				referenceManifest: contract.requiredReferences,
				referenceImageNodeIds: ["ajiao", "youhun"],
			storyPreviewCells: [buildPreviewCell({ cellIndex: 1, startSeconds: 0, endSeconds: 1 })],
		},
	};

		assertChapterStoryPreviewContract({ row, chapterId: "chapter-1", node });
		const canonicalData = node.data as Record<string, unknown>;
		expect(canonicalData.referenceImageNodeIds).toEqual(["ajiao", "youhun", "scene"]);
		expect(canonicalData.referenceAssetIds).toEqual([]);
		expect(canonicalData.storyPreviewContract).toEqual(contract);
		expect(canonicalData.referenceManifest).toEqual(contract.requiredReferences);
		expect(mockedRunPublicTask).not.toHaveBeenCalled();
	});

	it("canonicalizes paraphrased reference metadata without rewriting the chapter contract", () => {
		const contract = {
			schemaVersion: "story-preview-contract/v1",
			storyDurationSeconds: 60,
			previewScope: "user_window",
			previewWindow: { startSeconds: 0, endSeconds: 1 },
			frameIntervalSeconds: 1,
			requiredReferences: [
				{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
				{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂·狼牙棒巨首态" },
				{ nodeId: "scene", role: "layout", entityKind: "scene", entityName: "黑风山九视图" },
			],
		} as const;
		const row: FlowRow = {
			id: "chapter-flow-1",
			name: "Chapter",
			data: JSON.stringify({
				nodes: [{
					id: "chapter-seed-chapter-1",
					data: {
						kind: "text",
						sourceChapterRevision: 75,
						sourceHash: "source-hash",
						storyPreviewContract: contract,
					},
				}],
				edges: [],
			}),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-03-26T00:00:00.000Z",
			updated_at: "2026-03-26T00:00:00.000Z",
		};
		const requestedContract = {
			...contract,
			requiredReferences: [
				{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "枪炮师阿乔" },
				{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂大头佛老僧·狼牙棒" },
				{ nodeId: "scene", role: "content", entityKind: "scene", entityName: "明亮黑风山正面景" },
			],
		} as const;
		const node = {
			data: {
				kind: "storyboardImage",
				prompt: "0-1秒故事预览",
				assetUsage: "preview_only",
				previewSeriesId: "chapter-1-r75-preview",
				previewBoardIndex: 0,
				previewBoardCount: 1,
				previewShotCount: 1,
				storyPreviewContract: requestedContract,
				referenceManifest: requestedContract.requiredReferences,
				storyPreviewCells: [buildPreviewCell({ cellIndex: 1, startSeconds: 0, endSeconds: 1 })],
			},
		};

		assertChapterStoryPreviewContract({ row, chapterId: "chapter-1", node });

		const canonicalData = node.data as Record<string, unknown>;
		expect(canonicalData.storyPreviewContract).toEqual(contract);
		expect(canonicalData.referenceManifest).toEqual(contract.requiredReferences);
		expect(canonicalData.sourceChapterRevision).toBe(75);
		expect(canonicalData.sourceHash).toBe("source-hash");
		expect(canonicalData.referenceImageNodeIds).toEqual(["ajiao", "youhun", "scene"]);
	});

	it("ignores stale immutable preview copies and always uses the current chapter unique truth", () => {
		const contract = {
			schemaVersion: "story-preview-contract/v1",
			storyDurationSeconds: 60,
			previewScope: "user_window",
			previewWindow: { startSeconds: 0, endSeconds: 1 },
			frameIntervalSeconds: 1,
			requiredReferences: [
				{ nodeId: "ajiao-current", role: "identity", entityKind: "character", entityName: "阿乔" },
				{ nodeId: "scene-current", role: "layout", entityKind: "scene", entityName: "当前场景" },
			],
		} as const;
		const row: FlowRow = {
			id: "chapter-flow-1",
			name: "Chapter",
			data: JSON.stringify({ nodes: [{
				id: "chapter-seed-chapter-1",
				data: {
					prompt: "【0-1s】阿乔持枪落地。",
					sourceChapterRevision: 88,
					sourceHash: "current-hash",
					storyPreviewContract: contract,
				},
			}], edges: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-03-26T00:00:00.000Z",
			updated_at: "2026-03-26T00:00:00.000Z",
		};
		const node = {
			data: {
				kind: "storyboardImage",
				prompt: "旧会话错误提示词",
				assetUsage: "preview_only",
				previewSeriesId: "preview-current",
				previewBoardIndex: 0,
				previewBoardCount: 1,
				previewShotCount: 1,
				sourceChapterRevision: 465,
				sourceHash: "stale-hash",
				storyPreviewContract: {
					...contract,
					requiredReferences: [{ nodeId: "wrong-character", role: "identity", entityKind: "character", entityName: "错误角色" }],
				},
				referenceManifest: [{ nodeId: "wrong-character", role: "identity", entityKind: "character", entityName: "错误角色" }],
				storyPreviewCells: [buildPreviewCell({
					cellIndex: 1,
					startSeconds: 0,
					endSeconds: 1,
					subjectRefIds: ["node:ajiao-current", "node:scene-current"],
				})],
			},
		};

		assertChapterStoryPreviewContract({ row, chapterId: "chapter-1", node });

		const data = node.data as Record<string, unknown>;
		expect(data.storyPreviewContract).toEqual(contract);
		expect(data.referenceManifest).toEqual(contract.requiredReferences);
		expect(data.sourceChapterRevision).toBe(88);
		expect(data.sourceHash).toBe("current-hash");
		expect(data.prompt).toContain("章节故事预览｜服务端唯一真源提示词");
		expect(data.prompt).not.toContain("旧会话错误提示词");
		expect(JSON.stringify(data.storyPreviewCells)).toContain("阿乔重心沿左脚到右脚转移并抬枪");
		expect(JSON.stringify(data.storyPreviewCells)).not.toContain("0.5秒承接");
	});

	it("does not infer a character reference from authored prose", () => {
		const contract = {
			schemaVersion: "story-preview-contract/v1",
			storyDurationSeconds: 60,
			previewScope: "user_window",
			previewWindow: { startSeconds: 0, endSeconds: 2 },
			frameIntervalSeconds: 1,
			requiredReferences: [
				{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
				{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂·狼牙棒巨首态" },
			],
		} as const;
		const row: FlowRow = {
			id: "chapter-flow-1",
			name: "Chapter",
			data: JSON.stringify({ nodes: [{
				id: "chapter-seed-chapter-1",
				data: {
					prompt: "总览：0-50s游戏 + 50-60s现实，角色阿乔与幽魂。\n【0-1s】阿乔持枪落地戒备。\n【1-2s】幽魂手持狼牙棒从竹林现身。",
					sourceChapterRevision: 9,
					sourceHash: "hash-9",
					storyPreviewContract: contract,
				},
			}], edges: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-03-26T00:00:00.000Z",
			updated_at: "2026-03-26T00:00:00.000Z",
		};
		const first = buildPreviewCell({ cellIndex: 1, startSeconds: 0, endSeconds: 1, subjectRefIds: ["node:ajiao"] });
		const second = buildPreviewCell({ cellIndex: 2, startSeconds: 1, endSeconds: 2, subjectRefIds: ["node:ajiao"] });
		const node = {
			data: {
				kind: "storyboardImage",
				prompt: "错误地提前展示幽魂",
				assetUsage: "preview_only",
				previewSeriesId: "preview-early",
				previewBoardIndex: 0,
				previewBoardCount: 1,
				previewShotCount: 2,
				storyPreviewCells: [
					{ ...first, frameDescription: "阿乔落地时幽魂已经站在其身后" },
					{ ...second, frameDescription: "幽魂持狼牙棒逼近" },
				],
			},
		};

		expect(() => assertChapterStoryPreviewContract({ row, chapterId: "chapter-1", node }))
			.not.toThrow();
		expect((node.data as Record<string, unknown>).referenceImageNodeIds).toEqual(["ajiao"]);
	});

	it("hydrates an intentionally compact chapter preview node from the chapter unique truth", () => {
		const contract = {
			schemaVersion: "story-preview-contract/v1",
			storyDurationSeconds: 60,
			previewScope: "user_window",
			previewWindow: { startSeconds: 0, endSeconds: 1 },
			frameIntervalSeconds: 1,
			requiredReferences: [
				{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
				{ nodeId: "scene", role: "layout", entityKind: "scene", entityName: "战场" },
			],
		} as const;
		const row: FlowRow = {
			id: "chapter-flow-1",
			name: "Chapter",
			data: JSON.stringify({ nodes: [{
				id: "chapter-seed-chapter-1",
				data: { sourceChapterRevision: 9, sourceHash: "hash-9", storyPreviewContract: contract },
			}], edges: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-03-26T00:00:00.000Z",
			updated_at: "2026-03-26T00:00:00.000Z",
		};
		const fullCell = buildPreviewCell({ cellIndex: 1, startSeconds: 0, endSeconds: 1, subjectRefIds: ["node:ajiao", "node:scene"] });
		const node = {
			data: {
				kind: "storyboardImage",
				prompt: "0-1秒：起始→0.5秒承接→结束",
				assetUsage: "preview_only",
				previewSeriesId: "compact-preview",
				previewBoardIndex: 0,
				previewBoardCount: 1,
				previewShotCount: 1,
				storyPreviewCells: [{
					cellIndex: fullCell.cellIndex,
					startSeconds: fullCell.startSeconds,
					endSeconds: fullCell.endSeconds,
					timeRange: fullCell.timeRange,
					frameDescription: fullCell.frameDescription,
					stateBefore: fullCell.stateBefore,
					stateAfter: fullCell.stateAfter,
					cameraState: fullCell.cameraState,
					motionTransition: fullCell.motionTransition,
					physicalFeedback: fullCell.physicalFeedback,
					environmentChange: fullCell.environmentChange,
					subjectRefIds: fullCell.subjectRefIds,
				}],
			},
		};

		expect(() => assertChapterStoryPreviewContract({ row, chapterId: "chapter-1", node }))
			.toThrow(/缺少完整的时间窗、参考清单或逐格状态数据/u);

		const canonicalData = node.data as Record<string, unknown>;
		expect(canonicalData.storyPreviewContract).toEqual(contract);
		expect(canonicalData.referenceImageNodeIds).toBeUndefined();
	});

	it("rejects a multi-second summary cell against the persisted preview interval", () => {
		const contract = {
			schemaVersion: "story-preview-contract/v1",
			storyDurationSeconds: 60,
			previewScope: "user_window",
			previewWindow: { startSeconds: 0, endSeconds: 15 },
			frameIntervalSeconds: 1,
			requiredReferences: [
				{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
				{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂" },
				{ nodeId: "scene", role: "layout", entityKind: "scene", entityName: "战场" },
			],
		} as const;
		const row: FlowRow = {
			id: "chapter-flow-1",
			name: "Chapter",
			data: JSON.stringify({
				nodes: [{
					id: "chapter-seed-chapter-1",
					data: {
						kind: "text",
						sourceChapterRevision: 75,
						sourceHash: "source-hash",
						storyPreviewContract: contract,
					},
				}],
				edges: [],
			}),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-03-26T00:00:00.000Z",
			updated_at: "2026-03-26T00:00:00.000Z",
		};
		const node = {
			type: "taskNode",
			position: { x: 0, y: 0 },
			data: {
				kind: "storyboardImage",
				prompt: "一张图总结完整十五秒",
				assetUsage: "preview_only",
				previewSeriesId: "chapter-1-r75-preview",
				previewBoardIndex: 0,
				previewBoardCount: 1,
				previewShotCount: 1,
				sourceChapterRevision: 75,
				sourceHash: "source-hash",
				storyPreviewContract: contract,
				referenceManifest: contract.requiredReferences,
				referenceImageNodeIds: ["ajiao", "youhun", "scene"],
				storyPreviewCells: [buildPreviewCell({ cellIndex: 1, startSeconds: 0, endSeconds: 15 })],
			},
		};

		expect(() => assertChapterStoryPreviewContract({
			row,
			chapterId: "chapter-1",
			node,
		})).toThrow(/缺少完整的时间窗、参考清单或逐格状态数据/u);
		expect(mockedRunPublicTask).not.toHaveBeenCalled();
	});

	it("keeps layout and style asset bindings separate and forwards the explicit seed", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedResolveExecutionImageReferences
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          referenceId: "asset:layout-1",
          source: "asset",
          nodeId: null,
          assetId: "layout-1",
          assetRefId: null,
          name: "布局",
          url: "https://example.com/layout.png",
        },
        {
          referenceId: "asset:style-1",
          source: "asset",
          nodeId: null,
          assetId: "style-1",
          assetRefId: null,
          name: "风格",
          url: "https://example.com/style.png",
        },
      ]);
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "apimart",
      result: {
        id: "task-role-aware",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/result.png" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          id: "result-role-aware",
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "imageEdit",
            label: "角色分离结果",
            prompt: "严格保持布局，仅迁移画风",
            modelAlias: "gpt-image-2",
            seed: 88421,
            referenceAssetBindings: [
              { assetId: "layout-1", role: "layout", strength: 0.8 },
              { assetId: "style-1", role: "style", strength: 0.55 },
            ],
          },
        },
      },
    });

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          kind: "image_edit",
          seed: 88421,
          extras: expect.objectContaining({
            referenceImages: ["https://example.com/layout.png"],
            generationContext: {
              projectId: "project-1",
              flowId: "flow-1",
              nodeId: "result-role-aware",
            },
            assetInputs: [
              expect.objectContaining({
                assetId: "style-1",
                role: "style",
                weight: 0.55,
                url: "https://example.com/style.png",
              }),
            ],
          }),
        }),
      }),
    );
  });

  it("does not use chapter metadata as a semantic gate in an ordinary project flow", async () => {
    const runCallCount = mockedRunPublicTask.mock.calls.length;
    mockedRunPublicTask.mockRejectedValueOnce(new Error("provider unavailable"));
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };

    await expect(
      generateImageToCanvas({
        c: { env: { DB: {} } } as AppContext,
        requestUserId: "user-1",
        devBypass: false,
        flowId: "flow-1",
        row,
        bodyArgs: {
          node: {
            type: "taskNode",
            position: { x: 0, y: 0 },
            data: {
              kind: "image",
              prompt: "a small cat",
              productionMetadata: {
                chapterGrounded: true,
                lockedAnchors: {
                  character: [],
                  scene: [],
                  shot: [],
                  continuity: [],
                  missing: [],
                },
                authorityBaseFrame: {
                  status: "planned",
                  source: "chapter_context",
                  reason: "No confirmed base frame.",
                },
              },
            },
          },
        },
      }),
    ).rejects.toThrow("provider unavailable");
    expect(mockedRunPublicTask).toHaveBeenCalledTimes(runCallCount + 1);
    expect(mockedRunPublicTask).toHaveBeenLastCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          extras: expect.objectContaining({
            modelAlias: "gpt-image-2",
            imageSize: "1K",
          }),
        }),
      }),
    );
  });

  it("does not reject a batch solely because chapter production metadata is absent", async () => {
    const runCallCount = mockedRunPublicTask.mock.calls.length;
    mockedRunPublicTask.mockRejectedValue(new Error("provider unavailable"));
    const row: FlowRow = {
      id: "chapter-1",
      name: "Chapter",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };

    const result = await generateImageToCanvas({
        c: { env: { DB: {} } } as AppContext,
        requestUserId: "user-1",
        devBypass: false,
        flowId: "flow-1",
        chapterId: "chapter-1",
        row,
        bodyArgs: {
          nodes: [
            {
              type: "taskNode",
              position: { x: 0, y: 0 },
              data: { kind: "image", prompt: "chapter frame 1" },
            },
            {
              type: "taskNode",
              position: { x: 360, y: 0 },
              data: { kind: "image", prompt: "chapter frame 2" },
            },
          ],
        },
      });
    expect(result).toMatchObject({
      ok: true,
      batch: true,
      count: 2,
      succeeded: 0,
      results: [
        { index: 0, ok: false, error: expect.stringContaining("provider unavailable") },
        { index: 1, ok: false, error: expect.stringContaining("provider unavailable") },
      ],
    });
    expect(mockedRunPublicTask).toHaveBeenCalledTimes(runCallCount + 2);
    for (const call of mockedRunPublicTask.mock.calls.slice(runCallCount)) {
      expect(call[2]).toEqual(
        expect.objectContaining({
          request: expect.objectContaining({
            extras: expect.objectContaining({
              modelAlias: "gpt-image-2",
              imageSize: "1K",
            }),
          }),
        }),
      );
    }
  });

  it("passes a sourceRecipeId prompt through unchanged and writes the generated image", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "apimart",
      result: {
        id: "task-1",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/generated.jpg" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    const result = await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "image",
            label: "第一帧",
            prompt: "一栋老屋被新楼盘包围",
            sourceRecipeId: "storyboard-grid-4",
            negativePrompt: "blurry",
            showSystemPrompt: true,
            systemPrompt: "legacy hidden instruction",
            modelAlias: "nano-banana-pro",
            aspect: "16:9",
          },
        },
      },
    });

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          kind: "text_to_image",
          prompt: "一栋老屋被新楼盘包围",
          negativePrompt: "blurry",
          extras: expect.objectContaining({
            modelAlias: "nano-banana-pro",
            aspectRatio: "16:9",
            persistAssets: true,
          }),
        }),
      }),
    );
    expect(mockedFetchTaskResultForPolling).not.toHaveBeenCalled();
    const submittedRequest = mockedRunPublicTask.mock.calls[0]?.[2]?.request as {
      extras?: Record<string, unknown>;
    };
    expect(submittedRequest.extras).not.toHaveProperty("systemPrompt");
    if ("batch" in result) throw new Error("single-node request returned a batch result");
    expect(result.imageUrl).toBe("https://example.com/generated.jpg");
    expect(result.vendor).toBe("apimart");
    expect(result.taskId).toBe("task-1");
    expect(mockedUpdateFlow).toHaveBeenCalledTimes(1);
    const updateArgs = mockedUpdateFlow.mock.calls[0]?.[1] as {
      data: string;
    };
    const nextFlow = JSON.parse(updateArgs.data) as {
      nodes: Array<{ data?: Record<string, unknown> }>;
    };
    expect(nextFlow.nodes).toHaveLength(1);
    expect(nextFlow.nodes[0]?.data).toMatchObject({
      kind: "image",
      label: "第一帧",
      status: "success",
      imageUrl: "https://example.com/generated.jpg",
      imagePrimaryIndex: 0,
      taskId: "task-1",
      vendor: "apimart",
      imageModel: "nano-banana-pro",
    });
  });

	it("ends the parent delivery boundary after persisting an accepted image task", async () => {
		const row: FlowRow = {
			id: "flow-async-image",
			name: "Flow",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-26T00:00:00.000Z",
			updated_at: "2026-08-26T00:00:00.000Z",
		};
		mockedRunPublicTask.mockResolvedValueOnce({
			vendor: "apimart",
			result: {
				id: "task-async-image",
				status: "running",
				assets: [],
			},
		});
		mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
			id: input.id,
			name: input.name,
			data: input.data,
			owner_id: "user-1",
			project_id: "project-1",
			created_at: row.created_at,
			updated_at: input.nowIso,
		}));
		mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

		const result = await generateImageToCanvas({
			c: { env: { DB: {} } } as AppContext,
			requestUserId: "user-1",
			devBypass: false,
			flowId: row.id,
			row,
			bodyArgs: {
				node: {
					id: "image-node-async",
					type: "taskNode",
					position: { x: 120, y: 64 },
					data: {
						kind: "image",
						label: "异步生图",
						prompt: "一座雨夜中的未来城市",
					},
				},
			},
		});

		expect(result).toMatchObject({
			ok: true,
			nodeId: "image-node-async",
			taskId: "task-async-image",
			status: "running",
			completionBoundary: "submission",
		});
		expect(mockedFetchTaskResultForPolling).not.toHaveBeenCalled();
		const updateArgs = mockedUpdateFlow.mock.calls.at(-1)?.[1] as { data: string };
		const nextFlow = JSON.parse(updateArgs.data) as {
			nodes: Array<{ id: string; data: Record<string, unknown> }>;
		};
		expect(nextFlow.nodes[0]).toMatchObject({
			id: "image-node-async",
			data: {
				status: "running",
				taskId: "task-async-image",
				imageTaskId: "task-async-image",
			},
		});
	});

  it("defaults a missing canvas position instead of rejecting the request", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "apimart",
      result: {
        id: "task-pos",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/no-position.jpg" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    // Agent payload omits both `position` and `type` (a common omission, esp. in batch mode).
    const result = await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          data: {
            kind: "image",
            label: "设计板｜火海缠斗",
            prompt: "Film storyboard table",
            modelAlias: "nano-banana-pro",
          },
        },
      },
    });

    // Deterministic via this test's mockResolvedValueOnce — proves the request passed
    // schema validation (no "Invalid image generate to canvas request") despite the
    // omitted position, and reached the task runner + flow write.
    expect("imageUrl" in result && result.imageUrl).toBe("https://example.com/no-position.jpg");
    const updateArgs = mockedUpdateFlow.mock.calls.at(-1)?.[1] as { data: string };
    const nextFlow = JSON.parse(updateArgs.data) as {
      nodes: Array<{ type?: string; position?: { x: number; y: number } }>;
    };
    expect(nextFlow.nodes).toHaveLength(1);
    expect(nextFlow.nodes[0]?.type).toBe("taskNode");
    expect(nextFlow.nodes[0]?.position).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  it("uses the fixed new-account model and size when a node omits both", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "yunwu",
      result: {
        id: "task-2",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/defaulted.jpg" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    const result = await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "image",
            label: "第一帧",
            prompt: "一栋老屋被新楼盘包围",
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      imageUrl: "https://example.com/defaulted.jpg",
    });
    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          extras: expect.objectContaining({
            modelAlias: "gpt-image-2",
            imageSize: "1K",
          }),
        }),
      }),
    );
  });

  it("uses the account's most recently selected image model and size", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      generation_prefs: JSON.stringify({
        imageModel: "account-image-model",
        imageSize: "2K",
      }),
    });
    mockedRunPublicTask.mockRejectedValueOnce(new Error("stop after request capture"));
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };

    await expect(
      generateImageToCanvas({
        c: { env: { DB: {} } } as AppContext,
        requestUserId: "user-1",
        devBypass: false,
        flowId: "flow-1",
        row,
        bodyArgs: {
          node: {
            type: "taskNode",
            position: { x: 0, y: 0 },
            data: { kind: "image", prompt: "account preference" },
          },
        },
      }),
    ).rejects.toThrow("stop after request capture");

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          extras: expect.objectContaining({
            modelAlias: "account-image-model",
            imageSize: "2K",
          }),
        }),
      }),
    );
  });

  it("appends camera and lighting controls into the executable prompt when provided", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "yunwu",
      result: {
        id: "task-3",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/camera-light.jpg" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "imageEdit",
            label: "镜头编辑",
            prompt: "保留人物和场景的连续性",
            modelAlias: "nano-banana-pro",
            referenceImages: ["https://example.com/source.jpg"],
            imageCameraControl: {
              enabled: true,
              azimuthDeg: 90,
              elevationDeg: 18,
              distance: 3.2,
            },
            imageLightingRig: {
              main: {
                enabled: true,
                azimuthDeg: 45,
                elevationDeg: 16,
                intensity: 50,
                colorHex: "#FFFFFF",
              },
            },
          },
        },
      },
    });

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          kind: "image_edit",
          prompt: expect.stringContaining("Camera control: right side view"),
        }),
      }),
    );
    const requestPrompt = mockedRunPublicTask.mock.calls.at(-1)?.[2]?.request?.prompt as string;
    expect(requestPrompt).toContain("Lighting control:");
    expect(requestPrompt).toContain("Main key light:");
  });

  it("forwards imageSize into extras when provided", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "apimart",
      result: {
        id: "task-2k",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/2k.jpg" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "image",
            label: "2K帧",
            prompt: "宏大的山河全景",
            modelAlias: "nano-banana-pro",
            imageSize: "2K",
            aspect: "16:9",
          },
        },
      },
    });

    expect(mockedRunPublicTask).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      expect.objectContaining({
        request: expect.objectContaining({
          extras: expect.objectContaining({
            imageSize: "2K",
          }),
        }),
      }),
    );
  });

  it("auto-connects matched reference nodes when image_edit is written into the flow", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Flow",
      data: JSON.stringify({
        nodes: [
          {
            id: "ref-1",
            type: "taskNode",
            position: { x: 0, y: 0 },
            data: {
              kind: "image",
              label: "参考图",
              imageUrl: "https://example.com/assets/ref-image.jpg?token=abc",
            },
          },
        ],
        edges: [],
      }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    };
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "apimart",
      result: {
        id: "task-3",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/generated-edit.jpg" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: row.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);

    await generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row,
      bodyArgs: {
        node: {
          id: "frame-1",
          type: "taskNode",
          position: { x: 120, y: 64 },
          data: {
            kind: "image",
            label: "关键帧",
            prompt: "少年方源在夜雨窗前沉思",
            modelAlias: "nano-banana-pro",
            referenceImages: ["https://example.com/assets/ref-image.jpg?token=xyz"],
          },
        },
      },
    });

    const updateArgs = mockedUpdateFlow.mock.calls.at(-1)?.[1] as {
      data: string;
    };
    const nextFlow = JSON.parse(updateArgs.data) as {
      nodes: Array<{ id?: string; data?: Record<string, unknown> }>;
      edges: Array<Record<string, unknown>>;
    };
    const targetNode = nextFlow.nodes.find((node) => node.id === "frame-1");

    expect(nextFlow.edges).toEqual([
      expect.objectContaining({
        source: "ref-1",
        target: "frame-1",
        sourceHandle: "out-image",
        targetHandle: "in-image",
      }),
    ]);
    expect(targetNode?.data?.upstreamReferenceOrder).toEqual(["ref-1"]);
  });
});

describe("图片规格优先级", () => {
  const baseRow: FlowRow = {
    id: "flow-1",
    name: "Flow",
    data: JSON.stringify({ nodes: [], edges: [] }),
    owner_id: "user-1",
    project_id: "project-1",
    created_at: "2026-03-26T00:00:00.000Z",
    updated_at: "2026-03-26T00:00:00.000Z",
  };
  const succeed = () => {
    mockedRunPublicTask.mockResolvedValueOnce({
      vendor: "apimart",
      result: {
        id: "task-x",
        status: "succeeded",
        assets: [{ type: "image", url: "https://example.com/x.jpg" }],
      },
    });
    mockedUpdateFlow.mockImplementationOnce(async (_db, input) => ({
      id: input.id,
      name: input.name,
      data: input.data,
      owner_id: "user-1",
      project_id: "project-1",
      created_at: baseRow.created_at,
      updated_at: input.nowIso,
    }));
    mockedCreateFlowVersion.mockResolvedValueOnce(undefined);
  };
  const gen = (data: Record<string, unknown>) =>
    generateImageToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: "flow-1",
      row: baseRow,
      bodyArgs: {
        node: {
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: { kind: "image", prompt: "p", modelAlias: "nano-banana-pro", ...data },
        },
      },
    });

  it("anchors 层节点默认 imageSize=1K", async () => {
    succeed();
    await gen({ label: "姿态图｜某角色·某动作", productionLayer: "anchors" });
    const req = mockedRunPublicTask.mock.calls.at(-1)?.[2]?.request;
    expect(req.extras.imageSize).toBe("1K");
  });

  it("可入库 character-card/v3 即便没标 anchors 也使用账号 1K", async () => {
    succeed();
    await gen({
      label: "角色卡｜张三",
      referenceType: "character",
      roleName: "张三",
      characterProfileVersion: "character-card/v3",
    });
    const req = mockedRunPublicTask.mock.calls.at(-1)?.[2]?.request;
    expect(req.extras.imageSize).toBe("1K");
  });

  it("显式 imageSize 最高优先（资产卡也可点名 2K）", async () => {
    succeed();
    await gen({
      label: "角色卡｜张三",
      referenceType: "character",
      roleName: "张三",
      characterProfileVersion: "character-card/v3",
      imageSize: "2K",
    });
    const req = mockedRunPublicTask.mock.calls.at(-1)?.[2]?.request;
    expect(req.extras.imageSize).toBe("2K");
  });

  it("普通图片节点使用新账号默认 1K", async () => {
    succeed();
    await gen({ label: "第一帧" });
    const req = mockedRunPublicTask.mock.calls.at(-1)?.[2]?.request;
    expect(req.extras.imageSize).toBe("1K");
  });
});
