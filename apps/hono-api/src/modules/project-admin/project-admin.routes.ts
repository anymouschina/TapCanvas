import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	AdminProjectSchema,
	AdminUpdateProjectRequestSchema,
	ListAdminProjectsQuerySchema,
} from "./project-admin.schemas";
import {
	deleteAdminProject,
	listAdminProjects,
	updateAdminProject,
} from "./project-admin.service";

export const projectAdminRouter = new Hono<AppEnv>();

projectAdminRouter.use("*", authMiddleware);

projectAdminRouter.get("/", async (c) => {
	const parsed = ListAdminProjectsQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid query", issues: parsed.error.issues },
			400,
		);
	}

	const isPublic = (() => {
		const raw = parsed.data.isPublic;
		if (!raw) return undefined;
		const v = raw.trim().toLowerCase();
		if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
		if (v === "0" || v === "false" || v === "no" || v === "off") return false;
		return undefined;
	})();

	const items = await listAdminProjects(c as any, {
		q: parsed.data.q,
		ownerId: parsed.data.ownerId,
		isPublic,
		limit: parsed.data.limit,
	});

	return c.json(items.map((it) => AdminProjectSchema.parse(it)));
});

projectAdminRouter.patch("/:projectId", async (c) => {
	const projectId = c.req.param("projectId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = AdminUpdateProjectRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const updated = await updateAdminProject(c as any, { projectId, ...parsed.data });
	return c.json(AdminProjectSchema.parse(updated));
});

projectAdminRouter.delete("/:projectId", async (c) => {
	const projectId = c.req.param("projectId");
	await deleteAdminProject(c as any, { projectId });
	return c.body(null, 204);
});

