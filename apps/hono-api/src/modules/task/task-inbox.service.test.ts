import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../types";
import { listDurablePendingTaskSnapshots, listTaskInbox } from "./task-inbox.service";

const mocks = vi.hoisted(() => ({
	taskResults: {
		findMany: vi.fn(),
	},
	userNotifications: {
		findMany: vi.fn(),
	},
	vendorCallLogs: {
		findMany: vi.fn(),
	},
}));

function createDb(): PrismaClient {
	return {
		task_results: mocks.taskResults,
		user_notifications: mocks.userNotifications,
		vendor_api_call_logs: mocks.vendorCallLogs,
	} as unknown as PrismaClient;
}

const persistedRow = {
	user_id: "user-1",
	task_id: "task-1",
	vendor: "newapi",
	kind: "text_to_image",
	status: "succeeded",
	result: JSON.stringify({
		id: "task-1",
		kind: "text_to_image",
		status: "succeeded",
		assets: [{ type: "image", url: "https://assets.example.com/result.png" }],
	}),
	created_at: "2026-08-14T00:00:00.000Z",
	updated_at: "2026-08-14T00:01:00.000Z",
	completed_at: "2026-08-14T00:01:00.000Z",
	chapter_id: "chapter-1",
	node_id: "node-1",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.userNotifications.findMany.mockResolvedValue([]);
	mocks.vendorCallLogs.findMany.mockResolvedValue([]);
});

describe("listTaskInbox", () => {
	it("joins durable task facts with persisted notification read state", async () => {
		mocks.taskResults.findMany.mockResolvedValue([persistedRow]);
		mocks.userNotifications.findMany.mockResolvedValue([{
			id: "task-result:user-1:task-1",
			read_at: null,
		}]);
		mocks.vendorCallLogs.findMany.mockResolvedValue([{
			vendor: "newapi",
			task_id: "task-1",
			request_json: JSON.stringify({ request: { prompt: "一只站在月球上的猫" } }),
			error_message: null,
			updated_at: "2026-08-14T00:01:00.000Z",
		}]);

		await expect(listTaskInbox(createDb(), { userId: "user-1", limit: 20 })).resolves.toEqual({
			items: [{
				taskId: "task-1",
				vendor: "newapi",
				kind: "text_to_image",
				status: "succeeded",
				assetCount: 1,
				assets: [{ type: "image", url: "https://assets.example.com/result.png" }],
				prompt: "一只站在月球上的猫",
				errorMessage: null,
				nodeId: "node-1",
				chapterId: "chapter-1",
				createdAt: "2026-08-14T00:00:00.000Z",
				updatedAt: "2026-08-14T00:01:00.000Z",
				completedAt: "2026-08-14T00:01:00.000Z",
				notificationId: "task-result:user-1:task-1",
				readAt: null,
			}],
			nextCursor: null,
			unreadCount: 1,
		});
	});

	it("returns the single creative task stream across active and terminal states", async () => {
		mocks.taskResults.findMany.mockResolvedValue([]);
		await listTaskInbox(createDb(), { userId: "user-1", limit: 20 });
		expect(mocks.taskResults.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				user_id: "user-1",
				status: { in: ["queued", "claimed", "running", "succeeded", "failed"] },
				kind: { in: [
					"chat",
					"prompt_refine",
					"text_to_image",
					"image_to_prompt",
					"image_to_video",
					"text_to_video",
					"image_edit",
					"image_to_3d",
			"video_enhance",
			"video_edit",
			"image_remove_bg",
				] },
			},
		}));
	});

	it("projects queued and claimed tasks without inventing completion facts", async () => {
		mocks.taskResults.findMany.mockResolvedValue([{
			...persistedRow,
			status: "claimed",
			result: JSON.stringify({
				id: "task-1",
				kind: "text_to_image",
				status: "running",
				assets: [],
			}),
			completed_at: null,
		}]);

		const result = await listTaskInbox(createDb(), { userId: "user-1", limit: 20 });
		expect(result.items[0]).toMatchObject({
			status: "running",
			assetCount: 0,
			assets: [],
			completedAt: null,
			notificationId: null,
			readAt: null,
		});
	});

	it("returns the persisted prompt and failure reason for failed generation logs", async () => {
		mocks.taskResults.findMany.mockResolvedValue([{
			...persistedRow,
			status: "failed",
			result: JSON.stringify({
				id: "task-1",
				kind: "text_to_image",
				status: "failed",
				assets: [],
				raw: { failureReason: "provider rejected request" },
			}),
		}]);
		mocks.vendorCallLogs.findMany.mockResolvedValue([{
			vendor: "newapi",
			task_id: "task-1",
			request_json: JSON.stringify({ request: { prompt: "a red paper boat" } }),
			error_message: "provider rejected request",
			updated_at: "2026-08-14T00:01:00.000Z",
		}]);

		const result = await listTaskInbox(createDb(), { userId: "user-1", limit: 20 });
		expect(result.items[0]).toMatchObject({
			status: "failed",
			prompt: "a red paper boat",
			errorMessage: "provider rejected request",
			assets: [],
		});
	});

	it("fails explicitly when a persisted task result is corrupted", async () => {
		mocks.taskResults.findMany.mockResolvedValue([{ ...persistedRow, result: "{broken" }]);
		await expect(listTaskInbox(createDb(), { userId: "user-1", limit: 20 })).rejects.toMatchObject({
			code: "task_result_invalid_json",
		});
	});
});

describe("listDurablePendingTaskSnapshots", () => {
	it("normalizes claimed rows to running and returns their persisted payload", async () => {
		mocks.taskResults.findMany.mockResolvedValue([{ ...persistedRow, status: "claimed", completed_at: null }]);

		await expect(listDurablePendingTaskSnapshots(createDb(), { userId: "user-1" })).resolves.toEqual([{
			taskId: "task-1",
			nodeId: "node-1",
			taskKind: "text_to_image",
			vendor: "newapi",
			status: "running",
			assets: [{ type: "image", url: "https://assets.example.com/result.png" }],
			raw: expect.objectContaining({ id: "task-1" }),
			timestamp: Date.parse("2026-08-14T00:01:00.000Z"),
		}]);
	});
});
