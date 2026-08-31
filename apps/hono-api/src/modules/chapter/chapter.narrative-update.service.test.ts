import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { ChapterRow } from "./chapter.repo";

const mocks = vi.hoisted(() => ({
	getChapterById: vi.fn(),
	getChapterByIdForOwner: vi.fn(),
	getProjectForUserAccess: vi.fn(),
	touchProjectActivity: vi.fn(),
	broadcastPatch: vi.fn(),
}));

vi.mock("./chapter.repo", async () => {
	const actual = await vi.importActual<typeof import("./chapter.repo")>("./chapter.repo");
	return {
		...actual,
		getChapterById: mocks.getChapterById,
		getChapterByIdForOwner: mocks.getChapterByIdForOwner,
	};
});

vi.mock("../project/project.repo", async () => {
	const actual = await vi.importActual<typeof import("../project/project.repo")>("../project/project.repo");
	return { ...actual, getProjectForUserAccess: mocks.getProjectForUserAccess };
});

vi.mock("../project/project-activity.repo", () => ({
	touchProjectActivity: mocks.touchProjectActivity,
}));

vi.mock("./canvas-sse.manager", () => ({ broadcastPatch: mocks.broadcastPatch }));

import { updateChapterNarrativeForUser } from "./chapter.service";

const chapterRow: ChapterRow = {
	id: "chapter-1",
	owner_id: "owner-1",
	project_id: "project-1",
	chapter_index: 1,
	title: "旧标题",
	summary: "旧剧情",
	status: "draft",
	sort_order: 10,
	cover_asset_id: null,
	continuity_context: null,
	style_profile_override: null,
	legacy_chunk_index: null,
	source_book_id: null,
	source_book_chapter: null,
	last_worked_at: null,
	created_at: "2026-08-19T00:00:00.000Z",
	updated_at: "2026-08-19T00:00:00.000Z",
};

describe("updateChapterNarrativeForUser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getChapterById.mockResolvedValue(chapterRow);
		mocks.getChapterByIdForOwner.mockResolvedValue({
			...chapterRow,
			title: "新标题",
			summary: "登录方舟后，现实机房折叠为游戏甲板。",
		});
		mocks.getProjectForUserAccess.mockResolvedValue({
			id: "project-1",
			owner_id: "owner-1",
		});
	});

	it("atomically updates metadata and the canonical seed under one canvas revision", async () => {
		const chapters = {
			findFirst: vi.fn().mockResolvedValue({
				id: "chapter-1",
				title: "旧标题",
				summary: "旧剧情",
				canvas_flow: JSON.stringify({
					nodes: [
						{ id: "chapter-seed-chapter-1", type: "taskNode", position: { x: 22, y: 33 }, data: { kind: "text", chapterText: "旧剧情" } },
						{ id: "role-card-1", type: "taskNode", data: { kind: "image" } },
					],
					edges: [],
				}),
				canvas_flow_revision: 74,
			}),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		};
		const c = { env: { DB: { chapters } } } as unknown as AppContext;

		const result = await updateChapterNarrativeForUser(c, "owner-1", "chapter-1", {
			expectedCanvasRevision: 74,
			title: "新标题",
			summary: "登录方舟后，现实机房折叠为游戏甲板。",
		});

		expect(result.canvasRevision).toBe(75);
		expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
		expect(chapters.updateMany).toHaveBeenCalledTimes(1);
		const update = chapters.updateMany.mock.calls[0]?.[0] as {
			where: Record<string, unknown>;
			data: { canvas_flow: string; title: string; summary: string };
		};
		expect(update.where).toMatchObject({ canvas_flow_revision: 74 });
		const flow = JSON.parse(update.data.canvas_flow) as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
		expect(flow.nodes).toHaveLength(2);
		expect(flow.nodes[0]).toMatchObject({
			id: "chapter-seed-chapter-1",
			data: {
				chapterTitle: "新标题",
				chapterText: "登录方舟后，现实机房折叠为游戏甲板。",
				content: "登录方舟后，现实机房折叠为游戏甲板。",
				sourceChapterRevision: 75,
				sourceHash: result.sourceHash,
			},
		});
		expect(flow.nodes[1]?.id).toBe("role-card-1");
		expect(mocks.broadcastPatch).toHaveBeenCalledWith(
			"chapter-1",
			expect.objectContaining({ revision: 75 }),
			"",
		);
	});

	it("rejects a stale revision without mutating chapter data", async () => {
		const chapters = {
			findFirst: vi.fn().mockResolvedValue({
				id: "chapter-1",
				title: "旧标题",
				summary: "旧剧情",
				canvas_flow: null,
				canvas_flow_revision: 75,
			}),
			updateMany: vi.fn(),
		};
		const c = { env: { DB: { chapters } } } as unknown as AppContext;

		await expect(updateChapterNarrativeForUser(c, "owner-1", "chapter-1", {
			expectedCanvasRevision: 74,
			summary: "新剧情",
		})).rejects.toMatchObject({ code: "chapter_narrative_revision_conflict" });
		expect(chapters.updateMany).not.toHaveBeenCalled();
	});

	it("persists the story duration, preview window, and complete reference manifest with the seed", async () => {
		const chapters = {
			findFirst: vi.fn().mockResolvedValue({
				id: "chapter-1",
				title: "旧标题",
				summary: "旧剧情",
				canvas_flow: JSON.stringify({ nodes: [], edges: [] }),
				canvas_flow_revision: 74,
			}),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
		};
		const c = { env: { DB: { chapters } } } as unknown as AppContext;
		const storyPreviewContract = {
			schemaVersion: "story-preview-contract/v1" as const,
			storyDurationSeconds: 60,
			previewScope: "user_window" as const,
			previewWindow: { startSeconds: 0, endSeconds: 15 },
			frameIntervalSeconds: 1,
			requiredReferences: [
				{ nodeId: "ajiao", role: "identity" as const, entityKind: "character" as const, entityName: "阿乔" },
				{ nodeId: "youhun", role: "identity" as const, entityKind: "character" as const, entityName: "幽魂" },
				{ nodeId: "scene", role: "layout" as const, entityKind: "scene" as const, entityName: "战场" },
			],
		};

		const result = await updateChapterNarrativeForUser(c, "owner-1", "chapter-1", {
			expectedCanvasRevision: 74,
			storyPreviewContract,
		});

		const update = chapters.updateMany.mock.calls[0]?.[0] as { data: { canvas_flow: string } };
		const flow = JSON.parse(update.data.canvas_flow) as {
			nodes: Array<{ data: Record<string, unknown> }>;
		};
		expect(flow.nodes[0]?.data.storyPreviewContract).toEqual(storyPreviewContract);
		expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
	});
});
