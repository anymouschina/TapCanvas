import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import type { FlowRow } from "../flow/flow.repo";
import type { AppContext } from "../../types";

const { mockedGetFlowForOwner } = vi.hoisted(() => ({
	mockedGetFlowForOwner: vi.fn(),
}));

vi.mock("../flow/flow.repo", async () => {
	const actual = await vi.importActual<typeof import("../flow/flow.repo")>("../flow/flow.repo");
	return {
		...actual,
		getFlowForOwner: mockedGetFlowForOwner,
	};
});

import { getStoryboardSourceBundle } from "./agents.service";

function buildScopedRepoBookRoot(ownerId: string, projectId: string, bookId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(process.cwd()),
		"project-data",
		"users",
		ownerId,
		"projects",
		projectId,
		"books",
		bookId,
	);
}

function buildScopedContextRoot(ownerId: string, projectId: string): string {
	return path.join(
		process.cwd(),
		"project-data",
		"users",
		ownerId,
		"projects",
		projectId,
		".tapcanvas",
		"context",
	);
}

describe("getStoryboardSourceBundle", () => {
	it("aggregates chapter正文, project context, and current flow summaries", async () => {
		const ownerId = "test-owner-source-bundle";
		const projectId = "test-project-source-bundle";
		const flowId = "flow-source-bundle";
		const bookId = "book-source-bundle";
		const repoBookRoot = buildScopedRepoBookRoot(ownerId, projectId, bookId);
		const contextRoot = buildScopedContextRoot(ownerId, projectId);
		await fs.mkdir(repoBookRoot, { recursive: true });
		await fs.mkdir(contextRoot, { recursive: true });
		const rawContent = ["第1章 开场", "旧内容", "第2章 山门夜雨", "韩立抬头看向远处山门，风声压过人群低语。", "雨线切开灯火。"].join("\n");
		const chapterStart = rawContent.indexOf("第2章 山门夜雨");
		const chapterEnd = rawContent.length;
		await fs.writeFile(
			path.join(repoBookRoot, "index.json"),
			JSON.stringify(
				{
					bookId,
					title: "凡人修仙传",
					chapters: [
						{
							chapter: 2,
							title: "山门夜雨",
							startOffset: chapterStart,
							endOffset: chapterEnd,
							summary: "韩立抵达山门前夜雨中的关键段落。",
							keywords: ["韩立", "山门", "夜雨"],
							coreConflict: "是否立刻进入山门",
							characters: [{ name: "韩立", summary: "主角" }],
							scenes: [{ name: "山门", summary: "雨夜入口" }],
						},
					],
					assets: {
						storyboardChunks: [
							{
								chunkId: "chunk-1",
								chapter: 2,
								groupSize: 4,
								chunkIndex: 1,
								shotStart: 5,
								shotEnd: 8,
								shotPrompts: ["镜头二"],
								frameUrls: ["https://example.com/frame-1.jpg"],
								tailFrameUrl: "https://example.com/tail-1.jpg",
								createdAt: "2026-03-25T00:10:00.000Z",
								updatedAt: "2026-03-25T00:10:00.000Z",
							},
						],
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await fs.writeFile(path.join(repoBookRoot, "raw.md"), rawContent, "utf8");
		await fs.writeFile(path.join(contextRoot, "PROJECT.md"), "# project\n", "utf8");
		await fs.writeFile(path.join(contextRoot, "RULES.md"), "# rules\n", "utf8");
		await fs.writeFile(path.join(contextRoot, "CHARACTERS.md"), "# characters\n", "utf8");
		await fs.writeFile(path.join(contextRoot, "STORY_STATE.md"), "# story state\n", "utf8");

		mockedGetFlowForOwner.mockResolvedValueOnce({
			id: flowId,
			name: "当前画布",
			data: JSON.stringify({
				nodes: [
					{
						id: "node-script",
						type: "taskNode",
						position: { x: 10, y: 20 },
						data: {
							kind: "storyboardScript",
							label: "分镜脚本",
							content: "韩立抬头看向山门。",
						},
					},
					{
						id: "node-video",
						type: "taskNode",
						position: { x: 120, y: 20 },
						data: {
							kind: "composeVideo",
							label: "单视频",
							prompt: "夜雨中镜头轻微前推。",
							videoResults: [{ url: "https://example.com/video.mp4" }],
						},
					},
				],
				edges: [{ id: "edge-1", source: "node-script", target: "node-video" }],
			}),
			owner_id: ownerId,
			project_id: projectId,
			created_at: "2026-03-25T00:00:00.000Z",
			updated_at: "2026-03-25T00:20:00.000Z",
		});

		const fakeContext = { env: { DB: {} } } as AppContext;
		const bundle = await getStoryboardSourceBundle({
			c: fakeContext,
			ownerId,
			projectId,
			flowId,
			bookId,
			chapter: 2,
		});

		expect(bundle.bookId).toBe(bookId);
		expect(bundle.chapter).toBe(2);
		expect(bundle.chapterContext?.chapterTitle).toBe("山门夜雨");
		expect(bundle.chapterContext?.content).toContain("韩立抬头看向远处山门");
		expect(bundle.flowSummary.nodeCount).toBe(2);
		expect(bundle.flowSummary.edgeCount).toBe(1);
		expect(bundle.flowSummary.relevantNodes.map((node) => node.nodeId)).toEqual([
			"node-script",
			"node-video",
		]);
		expect(bundle.diagnostics.progress.latestStoryboardChunk?.chunkIndex).toBe(1);
		expect(bundle.diagnostics.recentShots).toEqual([
			{
				nodeId: "node-video",
				kind: "composeVideo",
				label: "单视频",
				imageUrl: null,
				videoUrl: "https://example.com/video.mp4",
			},
		]);
		expect(bundle.diagnostics.chapterContextResolution).toMatchObject({
			resolved: true,
			resolvedFromBookId: bookId,
			finalReason: "resolved",
		});
	});

	it("returns structured chapterContext resolution diagnostics when raw chapter content is missing", async () => {
		const ownerId = "test-owner-source-bundle-missing-raw";
		const projectId = "test-project-source-bundle-missing-raw";
		const flowId = "flow-source-bundle-missing-raw";
		const bookId = "book-source-bundle-missing-raw";
		const repoBookRoot = buildScopedRepoBookRoot(ownerId, projectId, bookId);
		const contextRoot = buildScopedContextRoot(ownerId, projectId);
		await fs.mkdir(repoBookRoot, { recursive: true });
		await fs.mkdir(contextRoot, { recursive: true });
		await fs.writeFile(
			path.join(repoBookRoot, "index.json"),
			JSON.stringify(
				{
					bookId,
					title: "凡人修仙传",
					chapters: [
						{
							chapter: 1,
							title: "开场",
							startOffset: 0,
							endOffset: 10,
						},
					],
				},
				null,
				2,
			),
			"utf8",
		);
		await fs.writeFile(path.join(contextRoot, "PROJECT.md"), "# project\n", "utf8");

		mockedGetFlowForOwner.mockResolvedValueOnce({
			id: flowId,
			name: "当前画布",
			data: JSON.stringify({ nodes: [], edges: [] }),
			owner_id: ownerId,
			project_id: projectId,
			created_at: "2026-03-25T00:00:00.000Z",
			updated_at: "2026-03-25T00:20:00.000Z",
		} as FlowRow);

		const fakeContext = { env: { DB: {} } } as AppContext;
		const bundle = await getStoryboardSourceBundle({
			c: fakeContext,
			ownerId,
			projectId,
			flowId,
			bookId,
			chapter: 1,
		});

		expect(bundle.chapterContext).toBeNull();
		expect(bundle.diagnostics.chapterContextResolution).toMatchObject({
			requestedBookId: bookId,
			requestedChapter: 1,
			resolved: false,
			resolvedFromBookId: null,
			finalReason: "book_raw_missing",
			checks: [{ bookId, reason: "book_raw_missing" }],
		});
	});
});
