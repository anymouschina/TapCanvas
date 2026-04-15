import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

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

function buildBookIndexPath(ownerId: string, projectId: string, bookId: string): string {
	return path.join(
		process.cwd(),
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
		process.cwd(),
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
		const ownerId = "test-owner-project-context";
		const projectId = "test-project-project-context";
		const bookId = "test-book-project-context";
		const indexPath = buildBookIndexPath(ownerId, projectId, bookId);
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		await fs.writeFile(
			indexPath,
			JSON.stringify(
				{
					bookId,
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
		expect(storyState).toContain("方源 | chapter=1 | shot=3 | state=断右臂，浑身血迹，强撑站立。");
		expect(storyState).toContain("## Recent Semantic Assets");
		expect(storyState).toContain("ch1-shot3 | image | chapter=1 | shot=3");
		expect(storyState).toContain("anchors=方源(character)、古月山寨夜色(scene)");
	});
});
