import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const {
	mockedGetTaskResultByTaskId,
	mockedUpsertTaskResult,
	mockedGetVendorTaskRefByTaskId,
	mockedFetchApimartTaskResult,
	mockedFetchAsyncDataTaskResult,
	mockedFetchGrsaiDrawTaskResult,
	mockedFetchMappedTaskResultForVendor,
	mockedFetchTuziTaskResult,
} = vi.hoisted(() => ({
	mockedGetTaskResultByTaskId: vi.fn(),
	mockedUpsertTaskResult: vi.fn(),
	mockedGetVendorTaskRefByTaskId: vi.fn(),
	mockedFetchApimartTaskResult: vi.fn(),
	mockedFetchAsyncDataTaskResult: vi.fn(),
	mockedFetchGrsaiDrawTaskResult: vi.fn(),
	mockedFetchMappedTaskResultForVendor: vi.fn(),
	mockedFetchTuziTaskResult: vi.fn(),
}));

vi.mock("./task-result.repo", () => ({
	getTaskResultByTaskId: mockedGetTaskResultByTaskId,
	upsertTaskResult: mockedUpsertTaskResult,
}));

vi.mock("./vendor-task-refs.repo", () => ({
	getVendorTaskRefByTaskId: mockedGetVendorTaskRefByTaskId,
}));

vi.mock("./task.service", () => ({
	fetchApimartTaskResult: mockedFetchApimartTaskResult,
	fetchAsyncDataTaskResult: mockedFetchAsyncDataTaskResult,
	fetchGrsaiDrawTaskResult: mockedFetchGrsaiDrawTaskResult,
	fetchMappedTaskResultForVendor: mockedFetchMappedTaskResultForVendor,
	fetchTuziTaskResult: mockedFetchTuziTaskResult,
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
	it("does not short-circuit running task_store results and continues mapped polling", async () => {
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
		mockedFetchMappedTaskResultForVendor.mockResolvedValueOnce({
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

		expect(mockedFetchMappedTaskResultForVendor).toHaveBeenCalledTimes(1);
		expect(mockedFetchMappedTaskResultForVendor).toHaveBeenCalledWith(
			c,
			"user-1",
			"yunwu",
			expect.objectContaining({
				taskId: "task-1",
				taskKind: "text_to_video",
				kindHint: "video",
			}),
		);
		expect(outcome).toMatchObject({
			ok: true,
			vendor: "yunwu",
			result: {
				id: "task-1",
				status: "succeeded",
			},
		});
	});
});
