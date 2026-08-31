import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../types";

const {
	apiKeyAuthMiddleware,
	isValidWorkflow,
	VALID_WORKFLOWS,
	updateProjectWorkflow,
	getProjectForUserAccess,
	getPrismaClient,
} = vi.hoisted(() => ({
	apiKeyAuthMiddleware: vi.fn(async (c: any, next: any) => {
		c.set("userId", "user1");
		await next();
	}),
	isValidWorkflow: vi.fn((v: string) => ["free_canvas", "story_film"].includes(v)),
	VALID_WORKFLOWS: ["free_canvas", "story_film"],
	updateProjectWorkflow: vi.fn(async () => ({ active_workflow: "story_film" })),
	getProjectForUserAccess: vi.fn(async () => ({ id: "proj1" })),
	getPrismaClient: vi.fn(() => ({})),
}));

vi.mock("../apiKey/apiKey.middleware", () => ({ apiKeyAuthMiddleware }));
vi.mock("./project.repo", () => ({
	isValidWorkflow,
	VALID_WORKFLOWS,
	updateProjectWorkflow,
	getProjectForUserAccess,
}));
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient }));
vi.mock("./project.service", () => ({
	listUserProjects: vi.fn(async () => []),
	upsertProjectForUser: vi.fn(async () => ({ id: "proj1" })),
	listUserProjectsPaginated: vi.fn(async () => ({ items: [], nextCursor: null })),
	listPublicProjectDtos: vi.fn(async () => []),
	getPublicProjectFlow: vi.fn(async () => null),
	getPublicProjectFlows: vi.fn(async () => []),
	toggleProjectPublicForUser: vi.fn(async () => ({})),
	updateProjectTemplateForUser: vi.fn(async () => ({})),
	cloneProjectForUser: vi.fn(async () => ({})),
	deleteProjectForUser: vi.fn(async () => undefined),
}));
vi.mock("../chapter/chapter.service", () => ({
	createChapterForUser: vi.fn(async () => ({ id: "ch1" })),
	listProjectChaptersForUser: vi.fn(async () => []),
	getProjectDefaultEntryForUser: vi.fn(async () => null),
}));
vi.mock("../chapter/canvas-sse.manager", () => ({
	subscribeToChapter: vi.fn(),
	broadcastPatch: vi.fn(),
	broadcastRunStatus: vi.fn(),
}));

import { projectRouter } from "./project.routes";

function makeApp() {
	const app = new Hono<AppEnv>();
	app.route("/projects", projectRouter);
	return app;
}

describe("PATCH /projects/:id/workflow", () => {
	it("接受合法 workflow 并返回更新后的值", async () => {
		const res = await makeApp().request("/projects/proj1/workflow", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ workflow: "story_film" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.workflow).toBe("story_film");
	});

	it("拒绝非法 workflow", async () => {
		const res = await makeApp().request("/projects/proj1/workflow", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ workflow: "invalid_wf" }),
		});
		expect(res.status).toBe(400);
	});
});
