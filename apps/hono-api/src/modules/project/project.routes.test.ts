import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";

const {
	apiKeyAuthMiddleware,
	listPublicProjectDtos,
	getPublicProjectFlow,
	getPublicProjectFlows,
	getPublicProjectConversation,
	listUserProjects,
	upsertProjectForUser,
	toggleProjectPublicForUser,
	updateProjectTemplateForUser,
	cloneProjectForUser,
	deleteProjectForUser,
	listProjectChaptersForUser,
	createChapterForUser,
	getProjectDefaultEntryForUser,
	upsertUserFlow,
} = vi.hoisted(() => ({
	apiKeyAuthMiddleware: vi.fn(async (c: AppContext, next: () => Promise<void>) => {
		c.set("userId", "user-from-api-key");
		await next();
	}),
	listPublicProjectDtos: vi.fn(),
	getPublicProjectFlow: vi.fn(),
	getPublicProjectFlows: vi.fn(),
	getPublicProjectConversation: vi.fn(),
	listUserProjects: vi.fn(),
	upsertProjectForUser: vi.fn(),
	toggleProjectPublicForUser: vi.fn(),
	updateProjectTemplateForUser: vi.fn(),
	cloneProjectForUser: vi.fn(),
	deleteProjectForUser: vi.fn(),
	listProjectChaptersForUser: vi.fn(),
	createChapterForUser: vi.fn(),
	getProjectDefaultEntryForUser: vi.fn(),
	upsertUserFlow: vi.fn(),
}));

vi.mock("../apiKey/apiKey.middleware", () => ({
	apiKeyAuthMiddleware,
}));

vi.mock("./project.service", () => ({
	listPublicProjectDtos,
	getPublicProjectFlow,
	getPublicProjectFlows,
	getPublicProjectConversation,
	listUserProjects,
	upsertProjectForUser,
	toggleProjectPublicForUser,
	updateProjectTemplateForUser,
	cloneProjectForUser,
	deleteProjectForUser,
}));

vi.mock("../chapter/chapter.service", () => ({
	listProjectChaptersForUser,
	createChapterForUser,
	getProjectDefaultEntryForUser,
}));

vi.mock("../flow/flow.service", () => ({ upsertUserFlow }));

import { projectRouter } from "./project.routes";

function createApp() {
	const app = new Hono<AppEnv>();
	app.route("/projects", projectRouter);
	return app;
}

describe("projectRouter auth wiring", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("accepts protected project listing through apiKeyAuthMiddleware", async () => {
		listUserProjects.mockResolvedValue([
			{
				id: "project-1",
				name: "七十二变",
				createdAt: "2026-04-11T14:56:18.271Z",
				updatedAt: "2026-04-11T14:56:18.271Z",
				isPublic: false,
				owner: "phone_1273",
				ownerName: "phone_1273",
				templateTitle: "七十二变",
			},
		]);

		const res = await createApp().request("/projects", {
			method: "GET",
			headers: {
				Authorization: "Bearer tc_sk_example",
			},
		});

		expect(res.status).toBe(200);
		expect(apiKeyAuthMiddleware).toHaveBeenCalledOnce();
		expect(listUserProjects).toHaveBeenCalledWith(expect.anything(), "user-from-api-key");
		expect(await res.json()).toEqual([
			expect.objectContaining({
				id: "project-1",
				name: "七十二变",
			}),
		]);
	});

	it("creates a project and its initial canvas in one request", async () => {
		upsertProjectForUser.mockResolvedValue({
			id: "project-1",
			name: "灵感项目",
			createdAt: "2026-08-25T00:00:00.000Z",
			updatedAt: "2026-08-25T00:00:00.000Z",
		});
		upsertUserFlow.mockResolvedValue({
			id: "flow-1",
			name: "灵感项目",
			data: { nodes: [], edges: [] },
			ownerType: "project",
			ownerId: "project-1",
			canvasRevision: 0,
			createdAt: "2026-08-25T00:00:00.000Z",
			updatedAt: "2026-08-25T00:00:00.000Z",
		});

		const response = await createApp().request("/projects/bootstrap", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "灵感项目",
				flow: { name: "灵感项目", data: { nodes: [], edges: [] } },
			}),
		});

		expect(response.status).toBe(201);
		expect(upsertProjectForUser).toHaveBeenCalledWith(expect.anything(), "user-from-api-key", {
			name: "灵感项目",
			teamId: undefined,
		});
		expect(upsertUserFlow).toHaveBeenCalledWith(expect.anything(), "user-from-api-key", expect.objectContaining({
			projectId: "project-1",
			ownerType: "project",
			ownerId: "project-1",
		}));
		expect(await response.json()).toMatchObject({ status: "complete", project: { id: "project-1" }, flow: { id: "flow-1" } });
	});

	it("serves public project flows without api key auth", async () => {
		getPublicProjectFlows.mockResolvedValue([
			{
				id: "flow-1",
				name: "公开工作流",
				data: { nodes: [{ id: "node-1", type: "taskNode", position: { x: 0, y: 0 }, data: {} }], edges: [] },
				createdAt: "2026-05-05T00:00:00.000Z",
				updatedAt: "2026-05-05T00:00:00.000Z",
			},
		]);

		const res = await createApp().request("/projects/project-1/flows", {
			method: "GET",
		});

		expect(res.status).toBe(200);
		expect(apiKeyAuthMiddleware).not.toHaveBeenCalled();
		expect(getPublicProjectFlows).toHaveBeenCalledWith(expect.anything(), "project-1");
		expect(await res.json()).toEqual([
			expect.objectContaining({
				id: "flow-1",
				name: "公开工作流",
				data: expect.objectContaining({
					nodes: expect.arrayContaining([expect.objectContaining({ id: "node-1" })]),
				}),
			}),
		]);
	});

	it("forwards a chapter scope to the public project flow service", async () => {
		getPublicProjectFlows.mockResolvedValue([]);

		const res = await createApp().request(
			"/projects/project-1/flows?ownerType=chapter&ownerId=chapter-30",
			{ method: "GET" },
		);

		expect(res.status).toBe(200);
		expect(getPublicProjectFlows).toHaveBeenCalledWith(
			expect.anything(),
			"project-1",
			{ ownerType: "chapter", ownerId: "chapter-30" },
		);
	});

	it("rejects incomplete public project flow scopes", async () => {
		const res = await createApp().request(
			"/projects/project-1/flows?ownerType=chapter",
			{ method: "GET" },
		);

		expect(res.status).toBe(400);
		expect(getPublicProjectFlows).not.toHaveBeenCalled();
	});

	it("forwards a chapter scope to the public project conversation service", async () => {
		getPublicProjectConversation.mockResolvedValue([]);

		const res = await createApp().request(
			"/projects/project-1/conversation?ownerType=chapter&ownerId=chapter-30",
			{ method: "GET" },
		);

		expect(res.status).toBe(200);
		expect(getPublicProjectConversation).toHaveBeenCalledWith(
			expect.anything(),
			"project-1",
			{ ownerType: "chapter", ownerId: "chapter-30" },
		);
	});

	it.each([
		"ownerType=chapter",
		"ownerId=chapter-30",
		"ownerType=project&ownerId=project-1",
	])("rejects invalid public project conversation scope: %s", async (query) => {
		const res = await createApp().request(
			`/projects/project-1/conversation?${query}`,
			{ method: "GET" },
		);

		expect(res.status).toBe(400);
		expect(getPublicProjectConversation).not.toHaveBeenCalled();
	});

	it("serves public flow details without api key auth", async () => {
		getPublicProjectFlow.mockResolvedValue({
			id: "flow-1",
			name: "公开工作流",
			data: { nodes: [{ id: "node-1", type: "taskNode", position: { x: 0, y: 0 }, data: {} }], edges: [] },
			createdAt: "2026-05-05T00:00:00.000Z",
			updatedAt: "2026-05-05T00:00:00.000Z",
		});

		const res = await createApp().request("/projects/public/flows/flow-1", {
			method: "GET",
		});

		expect(res.status).toBe(200);
		expect(apiKeyAuthMiddleware).not.toHaveBeenCalled();
		expect(getPublicProjectFlow).toHaveBeenCalledWith(expect.anything(), "flow-1");
		expect(await res.json()).toEqual(
			expect.objectContaining({
				id: "flow-1",
				data: expect.objectContaining({
					nodes: expect.arrayContaining([expect.objectContaining({ id: "node-1" })]),
				}),
			}),
		);
	});
});
