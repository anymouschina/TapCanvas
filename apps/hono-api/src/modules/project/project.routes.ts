import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CloneProjectSchema,
	ProjectSchema,
	TogglePublicSchema,
	UpdateProjectTemplateSchema,
	UpsertProjectSchema,
} from "./project.schemas";
import { ChapterListResponseSchema, ChapterSchema, CreateChapterSchema, ProjectDefaultEntrySchema } from "../chapter/chapter.schemas";
import {
	cloneProjectForUser,
	deleteProjectForUser,
	getPublicProjectFlows,
	listPublicProjectDtos,
	listUserProjects,
	toggleProjectPublicForUser,
	updateProjectTemplateForUser,
	upsertProjectForUser,
} from "./project.service";
import { createChapterForUser, getProjectDefaultEntryForUser, listProjectChaptersForUser } from "../chapter/chapter.service";

export const projectRouter = new Hono<AppEnv>();

// Public routes (no auth)
projectRouter.get("/public", async (c) => {
	const projects = await listPublicProjectDtos(c);
	return c.json(ProjectSchema.array().parse(projects));
});

projectRouter.get("/:id/flows", async (c) => {
	const id = c.req.param("id");
	const flows = await getPublicProjectFlows(c, id);
	return c.json(flows);
});

// Protected routes
const authed = new Hono<AppEnv>();
authed.use("*", authMiddleware);

authed.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const projects = await listUserProjects(c, userId);
	return c.json(ProjectSchema.array().parse(projects));
});

authed.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProjectSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await upsertProjectForUser(c, userId, parsed.data);
	return c.json(ProjectSchema.parse(project));
});

authed.get("/:id/chapters", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const items = await listProjectChaptersForUser(c, userId, projectId);
	return c.json(
		ChapterListResponseSchema.parse({
			projectId,
			items,
		}),
	);
});

authed.post("/:id/chapters", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateChapterSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const chapter = await createChapterForUser(c, userId, projectId, parsed.data);
	return c.json(ChapterSchema.parse(chapter));
});

authed.get("/:id/default-entry", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.param("id");
	const entry = await getProjectDefaultEntryForUser(c, userId, projectId);
	return c.json(ProjectDefaultEntrySchema.parse(entry));
});

authed.patch("/:id/public", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = TogglePublicSchema.safeParse(body);
	if (!parsed.success) {
	 return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await toggleProjectPublicForUser(
		c,
		userId,
		id,
		parsed.data.isPublic,
	);
	return c.json(ProjectSchema.parse(project));
});

authed.patch("/:id/template", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateProjectTemplateSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await updateProjectTemplateForUser(c, userId, id, parsed.data);
	return c.json(ProjectSchema.parse(project));
});

authed.post("/:id/clone", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CloneProjectSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const project = await cloneProjectForUser(
		c,
		userId,
		id,
		parsed.data.name,
	);
	return c.json(ProjectSchema.parse(project));
});

authed.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	await deleteProjectForUser(c, userId, id);
	return c.body(null, 204);
});

projectRouter.route("/", authed);
