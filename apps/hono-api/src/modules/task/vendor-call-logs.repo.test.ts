import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
	vendor_api_call_logs: {
		count: vi.fn(),
		findMany: vi.fn(),
		findUnique: vi.fn(),
		upsert: vi.fn(),
	},
	$queryRaw: vi.fn(),
};

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));

import {
	listVendorCallLogs,
	listVendorCallLogsPage,
	normalizeVendorCallLogKey,
	stringifyLogJson,
	upsertVendorCallLogFinal,
} from "./vendor-call-logs.repo";

describe("vendor-call-logs sanitize", () => {
	it("preserves previewDataUrl for inline image base64 payloads", () => {
		const rawBase64 = "QUJD".repeat(64);
		const json = stringifyLogJson({
			jsonBody: {
				contents: [
					{
						parts: [
							{
								inlineData: {
									mimeType: "image/png",
									data: rawBase64,
								},
							},
						],
					},
				],
			},
		});

		expect(json).toBeTruthy();
		const parsed = JSON.parse(String(json)) as {
			jsonBody?: {
				contents?: Array<{
					parts?: Array<{
						inlineData?: {
							mimeType?: string;
							data?: string;
							previewDataUrl?: string;
						};
					}>;
				}>;
			};
		};
		const inlineData =
			parsed.jsonBody?.contents?.[0]?.parts?.[0]?.inlineData ?? null;

		expect(inlineData?.mimeType).toBe("image/png");
		expect(inlineData?.data).toBe(`[inline-image-base64 len=${rawBase64.length}]`);
		expect(inlineData?.previewDataUrl).toBe(
			`data:image/png;base64,${rawBase64}`,
		);
	});
});

describe("listVendorCallLogs taskId filter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prisma.vendor_api_call_logs.findMany.mockResolvedValue([]);
	});

	it("includes task_id in where clause when taskId is provided", async () => {
		await listVendorCallLogs({} as never, { userId: "u1", taskId: "t-A" });
		expect(prisma.vendor_api_call_logs.findMany).toHaveBeenCalledTimes(1);
		const args = prisma.vendor_api_call_logs.findMany.mock.calls[0]?.[0] as {
			where?: Record<string, unknown>;
		};
		expect(args?.where).toMatchObject({ user_id: "u1", task_id: "t-A" });
	});

	it("trims taskId and ignores empty/whitespace values", async () => {
		await listVendorCallLogs({} as never, { userId: "u1", taskId: "  " });
		const args = prisma.vendor_api_call_logs.findMany.mock.calls[0]?.[0] as {
			where?: Record<string, unknown>;
		};
		expect(args?.where).not.toHaveProperty("task_id");
	});

	it("omits task_id from where clause when taskId is not provided", async () => {
		await listVendorCallLogs({} as never, { userId: "u1" });
		const args = prisma.vendor_api_call_logs.findMany.mock.calls[0]?.[0] as {
			where?: Record<string, unknown>;
		};
		expect(args?.where).not.toHaveProperty("task_id");
	});
});

describe("listVendorCallLogsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prisma.$queryRaw
			.mockResolvedValueOnce([{ total: 1n }])
			.mockResolvedValueOnce([{
				row_id: 0,
				user_id: "user-1",
				user_login: "phone_1273",
				user_name: null,
				vendor: "newapi",
				task_id: "task-9",
				task_kind: "image_to_video",
				status: "succeeded",
				started_at: "2026-07-01T00:00:00.000Z",
				finished_at: "2026-07-01T00:01:00.000Z",
				duration_ms: 60_000,
				error_message: null,
				request_json: null,
				response_json: null,
				created_at: "2026-07-01T00:00:00.000Z",
				updated_at: "2026-07-01T00:01:00.000Z",
			}]);
	});

	it("returns the canonical task projection and its projected count", async () => {
		const result = await listVendorCallLogsPage({} as never, {
			page: 3,
			pageSize: 20,
			userId: " user-1 ",
			vendor: " NewAPI ",
			status: "failed",
			taskKind: "text_to_video",
			taskId: "task-9",
			createdFrom: "2026-07-01T00:00:00.000Z",
			createdTo: "2026-07-22T00:00:00.000Z",
		});

		expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
		const projectedQuery = prisma.$queryRaw.mock.calls[1]?.[0] as { strings?: readonly string[] };
		expect(projectedQuery.strings?.join(" ")).toContain("double precision");
		expect(result.total).toBe(1);
		expect(result.rows).toEqual([
			expect.objectContaining({
				vendor: "newapi",
				task_id: "task-9",
				task_kind: "image_to_video",
				status: "succeeded",
			}),
		]);
	});
});

describe("canonical vendor-call identity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prisma.vendor_api_call_logs.findUnique.mockResolvedValue({
			started_at: "2026-08-12T14:52:40.000Z",
		});
		prisma.vendor_api_call_logs.upsert.mockResolvedValue(undefined);
	});

	it("collapses all NewAPI channel aliases to one supplier identity", () => {
		expect(normalizeVendorCallLogKey(" NewAPI:newapi ")).toBe("newapi");
		expect(normalizeVendorCallLogKey("newapi:ark")).toBe("newapi");
		expect(normalizeVendorCallLogKey("fal")).toBe("fal");
	});

	it("infers terminal duration from the canonical started row", async () => {
		await upsertVendorCallLogFinal({} as never, {
			userId: "user-1",
			vendor: "newapi:newapi",
			taskId: "task-1",
			taskKind: "image_to_video",
			status: "succeeded",
			nowIso: "2026-08-12T14:53:40.000Z",
		});

		expect(prisma.vendor_api_call_logs.findUnique).toHaveBeenCalledWith({
			where: {
				user_id_vendor_task_id: {
					user_id: "user-1",
					vendor: "newapi",
					task_id: "task-1",
				},
			},
		});
		expect(prisma.vendor_api_call_logs.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				update: expect.objectContaining({ duration_ms: 60_000 }),
			}),
		);
	});
});
