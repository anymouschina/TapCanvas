import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, WorkerEnv } from "../../types";
import { TaskResultSchema } from "./task.schemas";

const mocks = vi.hoisted(() => ({
	releaseTeamCreditsOnFailure: vi.fn(),
	resolveTeamCreditsCostForTask: vi.fn(),
	settleTeamCreditsOnSuccess: vi.fn(),
	upsertVendorCallLogFinal: vi.fn(),
	upsertVendorCallLogPayloads: vi.fn(),
	upsertVendorCallLogStarted: vi.fn(),
}));

vi.mock("../billing/billing.service", () => ({
	resolveTeamCreditsCostForTask: mocks.resolveTeamCreditsCostForTask,
}));
vi.mock("../team/team.service", () => ({
	releaseTeamCreditsOnFailure: mocks.releaseTeamCreditsOnFailure,
	settleTeamCreditsOnSuccess: mocks.settleTeamCreditsOnSuccess,
}));
vi.mock("./vendor-call-logs.repo", () => ({
	upsertVendorCallLogFinal: mocks.upsertVendorCallLogFinal,
	upsertVendorCallLogPayloads: mocks.upsertVendorCallLogPayloads,
	upsertVendorCallLogStarted: mocks.upsertVendorCallLogStarted,
}));

import {
	recordVendorCallFromTaskResult,
	recordVendorCallLogFromTaskResult,
} from "./task.vendor-call-utils";

const env = { DB: {}, JWT_SECRET: "test-secret" } as unknown as WorkerEnv;
const context = { env } as unknown as AppContext;

describe("task vendor-call billing identity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.releaseTeamCreditsOnFailure.mockResolvedValue(undefined);
		mocks.resolveTeamCreditsCostForTask.mockResolvedValue(171);
		mocks.settleTeamCreditsOnSuccess.mockResolvedValue(undefined);
		mocks.upsertVendorCallLogFinal.mockResolvedValue(undefined);
	});

	it("releases a failed task without repricing or replacing its primary error", async () => {
		const result = TaskResultSchema.parse({
			id: "failed-video-task",
			kind: "text_to_video",
			status: "failed",
			assets: [],
			raw: {
				error: "模型规格积分价格未配置",
				details: {
					modelKey: "doubao-seedance-2-0-260128",
					specKey: "video:720p:10s",
				},
			},
		});

		await expect(recordVendorCallFromTaskResult(context, {
			userId: "user-1",
			vendor: "newapi:ark",
			taskKind: "text_to_video",
			result,
		})).resolves.toBeUndefined();

		expect(mocks.resolveTeamCreditsCostForTask).not.toHaveBeenCalled();
		expect(mocks.releaseTeamCreditsOnFailure).toHaveBeenCalledWith(
			context,
			"user-1",
			expect.objectContaining({
				taskId: "failed-video-task",
				modelKey: "doubao-seedance-2-0-260128",
				specKey: "video:720p:10s",
			}),
		);
		expect(mocks.upsertVendorCallLogFinal).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ errorMessage: "模型规格积分价格未配置" }),
		);
	});

	it("uses call-site model and spec when a successful upstream result omits them", async () => {
		const result = TaskResultSchema.parse({
			id: "success-video-task",
			kind: "text_to_video",
			status: "succeeded",
			assets: [{ type: "video", url: "https://assets.example/video.mp4" }],
			raw: { response: { status: "succeeded" } },
		});

		await recordVendorCallFromTaskResult(context, {
			userId: "user-1",
			vendor: "newapi:ark",
			taskKind: "text_to_video",
			modelKey: "doubao-seedance-2-0-260128",
			specKey: "video:720p:10s",
			result,
		});

		expect(mocks.resolveTeamCreditsCostForTask).toHaveBeenCalledWith(context, {
			taskKind: "text_to_video",
			modelKey: "doubao-seedance-2-0-260128",
			specKey: "video:720p:10s",
		});
		expect(mocks.settleTeamCreditsOnSuccess).toHaveBeenCalledWith(
			context,
			"user-1",
			expect.objectContaining({ amount: 171 }),
		);
	});

	it("records one supplier terminal row for a NewAPI channel identity", async () => {
		const result = TaskResultSchema.parse({
			id: "canonical-video-task",
			kind: "image_to_video",
			status: "failed",
			assets: [],
			raw: { error: "provider rejected" },
		});

		await recordVendorCallFromTaskResult(context, {
			userId: "user-1",
			vendor: "newapi:ark",
			taskKind: "image_to_video",
			result,
		});

		expect(mocks.upsertVendorCallLogFinal).toHaveBeenCalledTimes(1);
		expect(mocks.upsertVendorCallLogFinal).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ vendor: "newapi:ark", taskId: "canonical-video-task" }),
		);
	});

	it("polling terminal sync updates logs without finalizing credits again", async () => {
		const result = TaskResultSchema.parse({
			id: "polled-video-task",
			kind: "image_to_video",
			status: "succeeded",
			assets: [{ type: "video", url: "https://assets.example/video.mp4" }],
			raw: {},
		});

		await recordVendorCallLogFromTaskResult(context, {
			userId: "user-1",
			vendor: "newapi:newapi",
			taskKind: "image_to_video",
			result,
		});

		expect(mocks.upsertVendorCallLogFinal).toHaveBeenCalledTimes(1);
		expect(mocks.resolveTeamCreditsCostForTask).not.toHaveBeenCalled();
		expect(mocks.settleTeamCreditsOnSuccess).not.toHaveBeenCalled();
		expect(mocks.releaseTeamCreditsOnFailure).not.toHaveBeenCalled();
	});
});
