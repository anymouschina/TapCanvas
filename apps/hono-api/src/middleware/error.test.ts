import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../types";
import { AppError, honoErrorHandler } from "./error";

describe("honoErrorHandler", () => {
	it("preserves an explicitly non-terminal business rejection", async () => {
		const json = vi.fn((body: unknown, status: number) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const context = { json } as unknown as AppContext;
		const response = honoErrorHandler(
			new AppError("前置资产缺失", {
				status: 409,
				code: "required_asset_missing",
				terminal: false,
				details: { kind: "scene_floor_plan" },
			}),
			context,
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			code: "required_asset_missing",
			terminal: false,
			details: { kind: "scene_floor_plan" },
		});
	});

	it("marks ordinary application errors explicitly non-terminal by default", async () => {
		const json = vi.fn((body: unknown, status: number) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const context = { json } as unknown as AppContext;
		const response = honoErrorHandler(
			new AppError("权限不足", { status: 403, code: "forbidden" }),
			context,
		);

		expect(await response.json()).toMatchObject({ terminal: false });
	});

	it("preserves an explicit terminal failure", async () => {
		const json = vi.fn((body: unknown, status: number) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const context = { json } as unknown as AppContext;
		const response = honoErrorHandler(
			new AppError("上游任务已不可逆终止", {
				status: 409,
				code: "upstream_terminal_failure",
				terminal: true,
			}),
			context,
		);

		expect(await response.json()).toMatchObject({
			code: "upstream_terminal_failure",
			terminal: true,
		});
	});

	it("does not expose unhandled exception details to clients", async () => {
		const json = vi.fn((body: unknown, status: number) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const context = {
			json,
			get: vi.fn((key: string) => key === "requestId" ? "trace-safe-1" : undefined),
		} as unknown as AppContext;
		const response = honoErrorHandler(
			new Error("private minified source and database diagnostics"),
			context,
		);
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body).toMatchObject({
			message: "服务内部错误",
			error: "服务内部错误",
			code: "internal_error",
			details: { requestId: "trace-safe-1" },
		});
		expect(JSON.stringify(body)).not.toContain("private minified source");
	});
});
