import { describe, expect, it } from "vitest";

import { buildGeneratedAssetRowInput } from "./asset.hosting";

describe("generation asset persistence contract", () => {
	it("writes the canonical media shape and project provenance to the asset row", () => {
		const row = buildGeneratedAssetRowInput({
			type: "video",
			url: "https://assets.example.com/video.mp4",
			thumbnailUrl: "https://assets.example.com/poster.jpg",
			vendor: "newapi",
			taskKind: "image_to_video",
			prompt: "海边日落",
			modelKey: "seedance-2",
			taskId: "task-1",
			sourceUrl: "https://provider.example.com/video.mp4",
			generationContext: {
				projectId: "project-1",
				chapterId: "chapter-1",
				nodeId: "node-1",
				workflowExecutionId: "execution-1",
			},
		});

		expect(row.projectId).toBe("project-1");
		expect(row.data).toMatchObject({
			kind: "generation",
			type: "video",
			url: "https://assets.example.com/video.mp4",
			thumbnailUrl: "https://assets.example.com/poster.jpg",
			projectId: "project-1",
			chapterId: "chapter-1",
			nodeId: "node-1",
			workflowExecutionId: "execution-1",
			taskId: "task-1",
		});
	});

	it("keeps projectless API generations explicitly unassigned", () => {
		const row = buildGeneratedAssetRowInput({
			type: "image",
			url: "https://assets.example.com/image.png",
		});

		expect(row.projectId).toBeNull();
		expect(row.data).not.toHaveProperty("projectId");
	});

	it("stores generated audio with duration and canvas provenance", () => {
		const row = buildGeneratedAssetRowInput({
			type: "audio",
			url: "https://assets.example.com/voice.mp3",
			sourceUrl: "https://assets.example.com/voice.mp3",
			vendor: "doubao",
			taskKind: "text_to_audio",
			prompt: "角色对白",
			modelKey: "seed-tts",
			durationSec: 12.5,
			generationContext: {
				projectId: "project-audio",
				flowId: "flow-audio",
				nodeId: "node-audio",
			},
		});

		expect(row.projectId).toBe("project-audio");
		expect(row.data).toMatchObject({
			kind: "generation",
			type: "audio",
			url: "https://assets.example.com/voice.mp3",
			durationSec: 12.5,
			projectId: "project-audio",
			flowId: "flow-audio",
			nodeId: "node-audio",
			taskKind: "text_to_audio",
		});
	});
});
