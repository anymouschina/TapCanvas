import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";

// 【画布多 tab 版本号防覆盖·Task 3】POST /flows 路由层：
// - 透传 expectedRevision/source 给 upsertUserFlow
// - upsertUserFlow 抛 FlowRevisionConflictError 时转 409，响应体带 expected/actual 供前端诊断
const { authMiddleware, upsertUserFlow, listUserFlowVersions, createUserFlowVersion } = vi.hoisted(() => ({
	authMiddleware: vi.fn(async (c: AppContext, next: () => Promise<void>) => {
		c.set("userId", "user-1");
		await next();
	}),
	upsertUserFlow: vi.fn(),
	listUserFlowVersions: vi.fn(),
	createUserFlowVersion: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({ authMiddleware }));

vi.mock("./flow.service", () => ({
	upsertUserFlow,
	// 其余路由用到的 service 函数在本测试文件未覆盖，占位即可（未被调用）
	listUserFlows: vi.fn(),
	getUserFlow: vi.fn(),
	deleteUserFlow: vi.fn(),
	listUserFlowVersions,
	createUserFlowVersion,
	rollbackUserFlow: vi.fn(),
}));

import { FlowRevisionConflictError } from "./flow.repo";
import { flowRouter } from "./flow.routes";

function createApp() {
	const app = new Hono<AppEnv>();
	app.route("/flows", flowRouter);
	return app;
}

describe("POST /flows revision handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authMiddleware.mockImplementation(async (c: AppContext, next: () => Promise<void>) => {
			c.set("userId", "user-1");
			await next();
		});
	});

	it("passes expectedRevision/source through to upsertUserFlow", async () => {
		upsertUserFlow.mockResolvedValue({
			id: "f1",
			name: "n",
			data: {},
			ownerType: null,
			ownerId: null,
			canvasRevision: 6,
			createdAt: "t",
			updatedAt: "t2",
		});
		const app = createApp();
		const res = await app.request("/flows", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: "f1", name: "n", data: {}, expectedRevision: 5, source: "user" }),
		});
		expect(res.status).toBe(200);
		expect(upsertUserFlow).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			expect.objectContaining({ expectedRevision: 5, source: "user" }),
		);
		const body = await res.json();
		expect(body.canvasRevision).toBe(6);
		expect(body.dataAdjusted).toBe(false);
		expect(body).not.toHaveProperty("data");
	});

	it("marks the receipt when server-owned canvas data changed the accepted snapshot", async () => {
		upsertUserFlow.mockResolvedValue({
			id: "f1",
			name: "n",
			data: { nodes: [{ id: "managed", data: { productionState: "running" } }], edges: [] },
			ownerType: "project",
			ownerId: "p1",
			canvasRevision: 6,
			createdAt: "t",
			updatedAt: "t2",
		});
		const app = createApp();
		const res = await app.request("/flows", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "n", data: { nodes: [], edges: [] } }),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ dataAdjusted: true, canvasRevision: 6 });
	});

	it("maps FlowRevisionConflictError to 409 with expected/actual", async () => {
		upsertUserFlow.mockRejectedValue(new FlowRevisionConflictError("f1", 3, 5));
		const app = createApp();
		const res = await app.request("/flows", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: "f1", name: "n", data: {}, expectedRevision: 3, source: "user" }),
		});
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body).toMatchObject({ code: "flow_revision_conflict", expected: 3, actual: 5 });
	});
});

describe("flow version history contract", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authMiddleware.mockImplementation(async (c: AppContext, next: () => Promise<void>) => {
			c.set("userId", "user-1");
			await next();
		});
	});

	it("returns a bounded cursor page instead of every stored snapshot", async () => {
		listUserFlowVersions.mockResolvedValue({
			items: [{ id: "version-1", name: "工作流", createdAt: "2026-08-20T00:00:00.000Z" }],
			nextCursor: "version-1",
		});
		const response = await createApp().request("/flows/flow-1/versions?limit=999&cursor=version-0");

		expect(response.status).toBe(200);
		expect(listUserFlowVersions).toHaveBeenCalledWith(
			expect.anything(),
			"flow-1",
			"user-1",
			{ limit: 100, cursor: "version-0" },
		);
		expect(await response.json()).toEqual({
			items: [{ id: "version-1", name: "工作流", createdAt: "2026-08-20T00:00:00.000Z" }],
			nextCursor: "version-1",
		});
	});

	it("creates a snapshot only through the explicit version endpoint", async () => {
		createUserFlowVersion.mockResolvedValue({
			id: "version-2",
			name: "工作流",
			createdAt: "2026-08-20T00:01:00.000Z",
		});
		const response = await createApp().request("/flows/flow-1/versions", { method: "POST" });

		expect(response.status).toBe(201);
		expect(createUserFlowVersion).toHaveBeenCalledWith(expect.anything(), "flow-1", "user-1");
	});
});
