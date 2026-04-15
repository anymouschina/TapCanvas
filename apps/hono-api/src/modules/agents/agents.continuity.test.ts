import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { getStoryboardContinuityEvidence } from "./agents.service";

function buildBookIndexPath(ownerId: string, projectId: string, bookId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(process.cwd()),
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

describe("getStoryboardContinuityEvidence", () => {
	it("resolves previous tail frame and chapter anchors from book metadata", async () => {
		const ownerId = "test-owner-continuity";
		const projectId = "test-project-continuity";
		const bookId = "test-book-continuity";
		const indexPath = buildBookIndexPath(ownerId, projectId, bookId);
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		await fs.writeFile(
			indexPath,
			JSON.stringify(
				{
					bookId,
					title: "测试小说",
					chapters: [
						{
							chapter: 2,
							characters: [{ name: "方源" }],
							scenes: [{ name: "山巅" }],
							props: [{ name: "血袍" }],
						},
					],
					assets: {
						storyboardChunks: [
							{
								chunkId: "chunk-0",
								chapter: 2,
								groupSize: 4,
								chunkIndex: 0,
								shotStart: 1,
								shotEnd: 4,
								shotPrompts: ["镜头一"],
								frameUrls: ["https://example.com/frame-0-1.jpg"],
								tailFrameUrl: "https://example.com/tail-0.jpg",
								createdAt: "2026-03-25T00:00:00.000Z",
								updatedAt: "2026-03-25T00:00:00.000Z",
							},
							{
								chunkId: "chunk-1",
								chapter: 2,
								groupSize: 4,
								chunkIndex: 1,
								shotStart: 5,
								shotEnd: 8,
								shotPrompts: ["镜头二"],
								frameUrls: ["https://example.com/frame-1-1.jpg"],
								tailFrameUrl: "https://example.com/tail-1.jpg",
								createdAt: "2026-03-25T00:10:00.000Z",
								updatedAt: "2026-03-25T00:10:00.000Z",
							},
						],
						roleCards: [
							{
								cardId: "role-fangyuan",
								roleName: "方源",
								imageUrl: "https://example.com/fangyuan-card.jpg",
								referenceKind: "single_character",
								promptSchemaVersion: "storyboard_reference_v2",
								confirmedAt: "2026-03-25T00:00:00.000Z",
								updatedAt: "2026-03-25T00:00:00.000Z",
								chapter: 2,
							},
						],
						visualRefs: [
							{
								refId: "scene-peak",
								category: "scene_prop",
								name: "山巅",
								imageUrl: "https://example.com/peak-scene.jpg",
								status: "generated",
								referenceKind: "scene",
								promptSchemaVersion: "storyboard_reference_v2",
								confirmedAt: "2026-03-25T00:00:00.000Z",
								updatedAt: "2026-03-25T00:00:00.000Z",
								chapter: 2,
							},
						],
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const evidence = await getStoryboardContinuityEvidence(
			{
				projectId,
				bookId,
				chapter: 2,
				groupSize: 4,
				chunkIndex: 1,
				shotPrompts: ["方源在山巅停步，继续上一组尾帧的对峙关系"],
			},
			ownerId,
		);

		expect(evidence.prevTailFrameUrl).toBe("https://example.com/tail-0.jpg");
		expect(evidence.currentChunk?.chunkId).toBe("chunk-1");
		expect(evidence.previousChunk?.chunkId).toBe("chunk-0");
		expect(evidence.chapterChunks).toHaveLength(2);
		expect(evidence.roleReferenceEntries).toEqual([
			{
				cardId: "role-fangyuan",
				roleName: "方源",
				imageUrl: "https://example.com/fangyuan-card.jpg",
				chapter: 2,
			},
		]);
		expect(evidence.scenePropReference).toEqual({
			refId: "scene-peak",
			label: "山巅",
			imageUrl: "https://example.com/peak-scene.jpg",
		});
		expect(evidence.chapterRoleNames).toContain("方源");
	});
});
