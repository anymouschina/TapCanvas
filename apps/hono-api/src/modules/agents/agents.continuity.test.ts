import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBookStoryboardDirectorV12Fixture } from "../../../../../packages/schemas/storyboard-director-protocol/test-fixtures";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { deriveShotPromptsFromStructuredData, normalizeStoryboardStructuredData } from "../storyboard/storyboard-structure";
import { sha256StoryboardArtifactCanonical } from "../storyboard/storyboard-persistence-contract";
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
		const taskId = "task-continuity";
		const artifact = createBookStoryboardDirectorV12Fixture();
		const storyFactsContext = artifact.storyFactsContext as Record<string, unknown>;
		storyFactsContext.bookId = bookId;
		const structured = normalizeStoryboardStructuredData(artifact);
		if (!structured) throw new Error("expected v1.2 storyboard fixture");
		const shotPrompts = deriveShotPromptsFromStructuredData(structured);
		const artifactSha256 = sha256StoryboardArtifactCanonical(artifact);
		const indexPath = buildBookIndexPath(ownerId, projectId, bookId);
		await fs.mkdir(path.dirname(indexPath), { recursive: true });
		await fs.writeFile(
			indexPath,
			JSON.stringify(
				{
					bookId,
					projectId,
					title: "测试小说",
					chapters: [
						{
							chapter: 5,
							characters: [{ name: "方源" }],
							scenes: [{ name: "山巅" }],
							props: [{ name: "血袍" }],
						},
					],
					assets: {
						storyboardChunks: [
							{
								chunkId: "chunk-0",
								planId: "plan-0",
								taskId,
								chapter: 5,
								groupSize: 4,
								chunkIndex: 0,
								shotStart: 1,
								shotEnd: 4,
								storyboardArtifact: artifact,
								artifactSha256,
								storyboardStructured: structured,
								shotPrompts,
								frameUrls: ["https://example.com/frame-0-1.jpg"],
								tailFrameUrl: "https://example.com/tail-0.jpg",
								createdAt: "2026-03-25T00:00:00.000Z",
								updatedAt: "2026-03-25T00:00:00.000Z",
							},
							{
								chunkId: "chunk-1",
								planId: "plan-1",
								previousChunkId: "chunk-0",
								taskId,
								chapter: 5,
								groupSize: 4,
								chunkIndex: 1,
								shotStart: 5,
								shotEnd: 8,
								storyboardArtifact: artifact,
								artifactSha256,
								storyboardStructured: structured,
								shotPrompts,
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
								chapter: 5,
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
								chapter: 5,
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
				taskId,
				chapter: 5,
				groupSize: 4,
				chunkIndex: 1,
				previousChunkId: "chunk-0",
				requiredRoleNames: ["方源"],
				scenePropRefId: "scene-peak",
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
				chapter: 5,
			},
		]);
		expect(evidence.scenePropReference).toEqual({
			refId: "scene-peak",
			label: "山巅",
			imageUrl: "https://example.com/peak-scene.jpg",
		});
		expect(evidence.chapterRoleNames).toContain("方源");
		expect(evidence.roleRefMatchStrategy).toBe("direct_match");
	});
});
