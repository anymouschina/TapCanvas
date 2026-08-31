import { describe, expect, it, vi } from "vitest";

import type { WorkerEnv } from "../../types";
import { AppError } from "../../middleware/error";
import type { WorkflowVideoConcatRequest } from "./execution.node-executors";
import { concatWorkflowVideos } from "./execution.video-concat-runner";

const mockConcatVideosToCanvas = vi.fn(async () => ({
	ok: true as const,
	videoUrl: "https://assets.example.com/final.mp4",
	key: "gen/videos/final.mp4",
	clipCount: 2,
	bytes: 1024,
	concatPolicy: {
		joinMode: "hard_cut" as const,
		xfadeSeconds: 0,
		colorMatch: false,
	},
}));
const mockRegisterGeneratedMediaAsset = vi.fn(async () => "asset-master-1");

vi.mock("../task/agents-tool-bridge.video-concat", () => ({
	concatVideosToCanvas: (...args: unknown[]) => mockConcatVideosToCanvas(...(args as Parameters<typeof mockConcatVideosToCanvas>)),
}));

vi.mock("../asset/asset.hosting", () => ({
	registerGeneratedMediaAsset: (...args: unknown[]) => mockRegisterGeneratedMediaAsset(...args),
}));

function makeRequest(overrides: Partial<WorkflowVideoConcatRequest> = {}): WorkflowVideoConcatRequest {
	return {
		executionId: "execution-34s",
		runtimeNodeId: "concat-runtime",
		ownerId: "owner-1",
		flowId: "flow-1",
		projectId: "project-1",
		videoUrls: ["https://assets.example.com/clip-1.mp4", "https://assets.example.com/clip-2.mp4"],
		sourceNodeIds: ["video-1", "video-2"],
		aspectRatio: "16:9",
		resolution: "480p",
		targetDurationSeconds: 34,
		...overrides,
	};
}

const env = { INTERNAL_WORKER_TOKEN: "token" } as WorkerEnv;

describe("concatWorkflowVideos", () => {
	it("rejects a concat with no persistent video URLs", async () => {
		await expect(concatWorkflowVideos(env, makeRequest({ videoUrls: [] })))
			.rejects
			.toThrow("requires at least one persistent video URL");
	});

	it("reuses a single clip directly without creating a second canvas movie node", async () => {
		const result = await concatWorkflowVideos(env, makeRequest({
			videoUrls: ["https://assets.example.com/single.mp4"],
		}));

		expect(result).toEqual({
			videoUrl: "https://assets.example.com/single.mp4",
			assetId: "asset-master-1",
			clipCount: 1,
			reusedSingleClip: true,
		});
		expect(mockConcatVideosToCanvas).not.toHaveBeenCalled();
	});

	it("returns the concatenated URL as workflow output without mutating canvas topology", async () => {
		mockConcatVideosToCanvas.mockClear();
		const result = await concatWorkflowVideos(env, makeRequest());

		expect(mockConcatVideosToCanvas).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			videoUrl: "https://assets.example.com/final.mp4",
			assetId: "asset-master-1",
			clipCount: 2,
			concatPolicy: { joinMode: "hard_cut", xfadeSeconds: 0, colorMatch: false },
			reusedSingleClip: false,
		});
	});

	it("registers the final master against the workflow project before delivery", async () => {
		mockRegisterGeneratedMediaAsset.mockClear();
		await concatWorkflowVideos(env, makeRequest());

		expect(mockRegisterGeneratedMediaAsset).toHaveBeenCalledWith(expect.objectContaining({
			userId: "owner-1",
			meta: expect.objectContaining({
				type: "video",
				url: "https://assets.example.com/final.mp4",
				taskId: "execution-34s",
				generationContext: expect.objectContaining({
					projectId: "project-1",
					flowId: "flow-1",
					workflowExecutionId: "execution-34s",
				}),
			}),
		}));
	});

	it("preserves the exact media-worker failure as recovery evidence", async () => {
		mockConcatVideosToCanvas.mockRejectedValueOnce(new AppError("视频拼接失败", {
			status: 502,
			code: "agents_tool_concat_failed",
			details: { message: "media-worker concatVideos RPC 失败：connection refused" },
		}));

		await expect(concatWorkflowVideos(env, makeRequest()))
			.rejects
			.toThrow("agents_tool_concat_failed: media-worker concatVideos RPC 失败：connection refused");
	});
});
