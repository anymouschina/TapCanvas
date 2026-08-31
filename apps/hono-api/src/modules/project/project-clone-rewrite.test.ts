import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	rewriteClonedBookIndexes,
	rewriteClonedChapterCanvasFlow,
} from "./project-clone-rewrite";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("project clone scoped identity rewriting", () => {
	it("rebases chapter canvas identities while preserving persistent media URLs", () => {
		const mediaUrl = "https://oss.example/video/source-project/chapter-source.mp4";
		const rewritten = rewriteClonedChapterCanvasFlow({
			rawFlow: JSON.stringify({
				nodes: [{
					id: "chapter-seed-chapter-source",
					data: {
						sourceProjectId: "source-project",
						sourceChapterId: "chapter-source",
						referenceAssetIds: [
							"project-node:chapter:chapter-source:image-1",
						],
						videoUrl: mediaUrl,
					},
				}],
				edges: [],
			}),
			sourceProjectId: "source-project",
			targetProjectId: "target-project",
			sourceChapterId: "chapter-source",
			targetChapterId: "chapter-target",
		});

		expect(rewritten).not.toBeNull();
		const parsed = JSON.parse(rewritten ?? "{}") as {
			__tapcanvasFlowOwner: { ownerType: string; ownerId: string };
			nodes: Array<{
				id: string;
				data: {
					sourceProjectId: string;
					sourceChapterId: string;
					referenceAssetIds: string[];
					videoUrl: string;
				};
			}>;
		};
		expect(parsed.__tapcanvasFlowOwner).toEqual({
			ownerType: "chapter",
			ownerId: "chapter-target",
		});
		expect(parsed.nodes[0]).toMatchObject({
			id: "chapter-seed-chapter-target",
			data: {
				sourceProjectId: "target-project",
				sourceChapterId: "chapter-target",
				referenceAssetIds: ["project-node:chapter:chapter-target:image-1"],
				videoUrl: mediaUrl,
			},
		});
	});

	it("rewrites copied book ownership and local file paths to the target project", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-clone-book-"));
		temporaryRoots.push(root);
		const bookDir = path.join(root, "book-1");
		await fs.mkdir(bookDir, { recursive: true });
		await fs.mkdir(path.join(root, ".uploads"), { recursive: true });
		await fs.writeFile(
			path.join(bookDir, "index.json"),
			JSON.stringify({
				projectId: "ancestor-project",
				bookId: "book-1",
				chapters: [{ chapter: 1, content: "第一章正文" }],
				rawPath: "project-data/users/source-user/projects/source-project/books/book-1/raw.md",
				assets: {
					rawTextChunks: [{
						filePath: "project-data/users/source-user/projects/source-project/books/book-1/raw-chunks/chunk-0001.md",
					}],
				},
			}),
			"utf8",
		);

		await expect(rewriteClonedBookIndexes({
			targetBooksRoot: root,
			sourceOwnerId: "source-user",
			targetOwnerId: "target-user",
			sourceProjectId: "source-project",
			targetProjectId: "target-project",
		})).resolves.toBe(1);

		const parsed = JSON.parse(
			await fs.readFile(path.join(bookDir, "index.json"), "utf8"),
		) as {
			projectId: string;
			rawPath: string;
			assets: { rawTextChunks: Array<{ filePath: string }> };
		};
		expect(parsed.projectId).toBe("target-project");
		expect(parsed.rawPath).toContain("users/target-user/projects/target-project/");
		expect(parsed.assets.rawTextChunks[0]?.filePath)
			.toContain("users/target-user/projects/target-project/");
	});
});
