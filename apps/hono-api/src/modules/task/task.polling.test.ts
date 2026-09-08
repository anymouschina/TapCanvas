import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const {
	mockedGetTaskResultByTaskId,
	mockedUpsertTaskResult,
	mockedGetVendorTaskRefByTaskId,
	mockedFetchNewApiTaskResult,
} = vi.hoisted(() => ({
	mockedGetTaskResultByTaskId: vi.fn(),
	mockedUpsertTaskResult: vi.fn(),
	mockedGetVendorTaskRefByTaskId: vi.fn(),
	mockedFetchNewApiTaskResult: vi.fn(),
}));

vi.mock("./task-result.repo", () => ({
	getTaskResultByTaskId: mockedGetTaskResultByTaskId,
	upsertTaskResult: mockedUpsertTaskResult,
}));

vi.mock("./vendor-task-refs.repo", () => ({
	getVendorTaskRefByTaskId: mockedGetVendorTaskRefByTaskId,
}));

vi.mock("./task.service", () => ({
	fetchNewApiTaskResult: mockedFetchNewApiTaskResult,
}));

import { fetchTaskResultForPolling } from "./task.polling";

function createMockContext(): AppContext {
	const store = new Map<string, unknown>();
	return {
		env: { DB: {} },
		get: (key: string) => store.get(key),
		set: (key: string, value: unknown) => {
			store.set(key, value);
		},
	} as unknown as AppContext;
}

describe("fetchTaskResultForPolling", () => {
	it("does not short-circuit running task_store results and continues New API polling", async () => {
		const c = createMockContext();
		mockedGetTaskResultByTaskId.mockResolvedValueOnce({
			vendor: "yunwu",
			result: JSON.stringify({
				id: "task-1",
				kind: "text_to_video",
				status: "running",
				assets: [],
				raw: {
					provider: "task_store",
					vendor: "yunwu",
				},
			}),
		});
		mockedGetVendorTaskRefByTaskId.mockResolvedValueOnce({
			vendor: "yunwu",
			pid: "upstream-task-1",
		});
		mockedFetchNewApiTaskResult.mockResolvedValueOnce({
			id: "task-1",
			kind: "text_to_video",
			status: "succeeded",
			assets: [{ type: "video", url: "https://example.com/result.mp4" }],
			raw: {
				provider: "mapping",
			},
		});

		const outcome = await fetchTaskResultForPolling(c, "user-1", {
			taskId: "task-1",
			taskKind: "text_to_video",
			mode: "internal",
		});

		expect(mockedFetchNewApiTaskResult).toHaveBeenCalledTimes(1);
		expect(mockedFetchNewApiTaskResult).toHaveBeenCalledWith(
			c,
			"user-1",
			"task-1",
			expect.objectContaining({
				taskKind: "text_to_video",
				vendor: "newapi",
			}),
		);
		expect(outcome).toMatchObject({
			ok: true,
			vendor: "newapi",
			result: {
				id: "task-1",
				status: "succeeded",
			},
		});
	});
});
