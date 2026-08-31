import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

const { mockedGetProjectForOwner } = vi.hoisted(() => ({
	mockedGetProjectForOwner: vi.fn(),
}));

vi.mock("../project/project.repo", async () => {
	const actual = await vi.importActual<typeof import("../project/project.repo")>("../project/project.repo");
	return {
		...actual,
		getProjectForOwner: mockedGetProjectForOwner,
	};
});

import { ensureProjectWorkspaceContextFiles } from "./project-context.service";
import { commitStoryFacts } from "./story-facts.store";

function buildBookIndexPath(ownerId: string, projectId: string, bookId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(),
		"project-data",
		"users",
		ownerId,
		"projects",
		projectId,
		"books",
		bookId,
		"index.json",
	);
}

function buildStoryStatePath(ownerId: string, projectId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(),
		"project-data",
		"users",
		ownerId,
		"projects",
		projectId,
		".tapcanvas",
		"context",
		"STORY_STATE.md",
	);
}

describe("ensureProjectWorkspaceContextFiles", () => {
	it("renders latest character states and recent semantic assets from book metadata", async () => {
		const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		const ownerId = `test-owner-project-context-${runId}`;
		const projectId = `test-project-project-context-${runId}`;
		const bookId = `test-book-project-context-${runId}`;
		const indexPath = buildBookIndexPath(ownerId, projectId, bookId);
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		await fs.writeFile(
			indexPath,
			JSON.stringify(
				{
					bookId,
					projectId,
					title: "蛊真人",
					chapterCount: 2,
					chapters: [
						{
							chapter: 2,
							title: "重返青茅山",
						},
					],
					assets: {
						semanticAssets: [
							{
								semanticId: "ch1-shot3",
								mediaKind: "image",
								status: "generated",
								chapter: 1,
								shotNo: 3,
								stateDescription: "断右臂，浑身血迹，强撑站立。",
								imageUrl: "https://example.com/fangyuan-broken-arm.png",
								anchorBindings: [
									{
										kind: "character",
										label: "方源",
										refId: "role-fangyuan-broken-arm",
										imageUrl: "https://example.com/fangyuan-broken-arm.png",
									},
									{
										kind: "scene",
										label: "古月山寨夜色",
										refId: "scene-night",
										imageUrl: "https://example.com/night-scene.png",
									},
								],
								updatedAt: "2026-04-03T00:10:00.000Z",
								createdAt: "2026-04-03T00:10:00.000Z",
								createdBy: ownerId,
								updatedBy: ownerId,
							},
							{
								semanticId: "ch1-shot1",
								mediaKind: "image",
								status: "generated",
								chapter: 1,
								shotNo: 1,
								stateDescription: "刚醒来时衣着完整。",
								imageUrl: "https://example.com/fangyuan-awake.png",
								anchorBindings: [
									{
										kind: "character",
										label: "方源",
										refId: "role-fangyuan-awake",
										imageUrl: "https://example.com/fangyuan-awake.png",
									},
								],
								updatedAt: "2026-04-03T00:01:00.000Z",
								createdAt: "2026-04-03T00:01:00.000Z",
								createdBy: ownerId,
								updatedBy: ownerId,
							},
						],
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await commitStoryFacts({
			filePath: path.join(path.dirname(indexPath), "story-facts.json"),
			projectId,
			bookId,
			actorId: ownerId,
			commitId: "project-context-story-facts",
			expectedRevision: 0,
			source: {
				kind: "book_chapter",
				projectId,
				bookId,
				chapter: 1,
				fileName: "raw.md",
				contentSha256: "b".repeat(64),
				contentChars: 100,
				capturedAt: "2026-04-03T00:11:00.000Z",
			},
			operations: [
				{
					type: "add",
					factId: "fangyuan-right-arm-lost",
					subject: { kind: "character", key: "character:fangyuan", name: "方源" },
					predicate: "右臂状态",
					value: "断失",
					status: "confirmed",
					validFrom: { chapter: 1, sequence: 30, label: "战斗退出态" },
					disclosure: { mode: "immediate", revealAt: null },
				},
				{
					type: "add",
					factId: "fangyuan-hidden-lineage",
					subject: {
						kind: "identity",
						key: "identity:fangyuan-hidden-lineage",
						name: "方源隐藏血统",
					},
					predicate: "真实血统",
					value: "古月一代直系后裔",
					status: "confirmed",
					validFrom: { chapter: 1, sequence: 0 },
					disclosure: {
						mode: "gated",
						revealAt: { chapter: 5, sequence: 0 },
					},
				},
			],
		});

		mockedGetProjectForOwner.mockResolvedValueOnce({
			id: projectId,
			name: "蛊真人项目",
		});

		const context = {
			env: {
				DB: {},
			},
		} as AppContext;

		await ensureProjectWorkspaceContextFiles({
			c: context,
			ownerId,
			projectId,
			bookId,
			chapter: 2,
		});

		const storyState = await fs.readFile(buildStoryStatePath(ownerId, projectId), "utf8");
		expect(storyState).toContain("## Latest Character States");
		expect(storyState).toContain("## Authoritative Story Facts");
		expect(storyState).toContain("ledgerRevision: 1");
		expect(storyState).toContain("[confirmed] 方源 (character:fangyuan) | 右臂状态 | 断失");
		expect(storyState).toContain(
			"[confirmed] [hidden] category=identity | revealAt=ch5:0 | factId=fangyuan-hidden-lineage",
		);
		expect(storyState).not.toContain("方源隐藏血统");
		expect(storyState).not.toContain("真实血统");
		expect(storyState).not.toContain("古月一代直系后裔");
		expect(storyState).toContain("方源 | chapter=1 | shot=3 | state=断右臂，浑身血迹，强撑站立。");
		expect(storyState).toContain("## Recent Semantic Assets");
		expect(storyState).toContain("ch1-shot3 | image | chapter=1 | shot=3");
		expect(storyState).toContain("anchors=方源(character)、古月山寨夜色(scene)");
	});
});
