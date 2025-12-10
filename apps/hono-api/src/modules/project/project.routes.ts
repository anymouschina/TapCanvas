import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CloneProjectSchema,
	ProjectSchema,
	TogglePublicSchema,
	UpsertProjectSchema,
} from "./project.schemas";
import {
	cloneProjectForUser,
	deleteProjectForUser,
	getPublicProjectFlows,
	listPublicProjectDtos,
	listUserProjects,
	toggleProjectPublicForUser,
	upsertProjectForUser,
} from "./project.service";

export const projectRouter = new Hono<AppEnv>();

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

// Public routes
projectRouter.get("/public", async (c) => {
	const projects = await listPublicProjectDtos(c);
	return c.json(ProjectSchema.array().parse(projects));
});

projectRouter.get("/:id/flows", async (c) => {
	const id = c.req.param("id");
	const flows = await getPublicProjectFlows(c, id);
	return c.json(flows);
});

