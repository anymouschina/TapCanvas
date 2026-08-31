import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	FlowSchema,
	FlowSaveReceiptSchema,
	FlowVersionPageSchema,
	FlowVersionSchema,
	UpsertFlowSchema,
} from "./flow.schemas";
import {
	deleteUserFlow,
	createUserFlowVersion,
	getUserFlow,
	listUserFlows,
	listUserFlowVersions,
	rollbackUserFlow,
	upsertUserFlow,
} from "./flow.service";
import { FlowRevisionConflictError } from "./flow.repo";

export const flowRouter = new Hono<AppEnv>();

const AUTHORING_SNAPSHOT_KEYS = ["nodes", "edges", "viewport", "sceneCreationProgress"] as const;

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function projectAuthoringSnapshot(value: unknown): Record<string, unknown> {
	const record = readRecord(value);
	const projected: Record<string, unknown> = {};
	for (const key of AUTHORING_SNAPSHOT_KEYS) {
		if (Object.prototype.hasOwnProperty.call(record, key)) projected[key] = record[key];
	}
	return projected;
}

function wasAuthoringSnapshotAdjusted(requested: unknown, saved: unknown): boolean {
	return JSON.stringify(projectAuthoringSnapshot(requested)) !== JSON.stringify(projectAuthoringSnapshot(saved));
}

flowRouter.use("*", authMiddleware);

flowRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const projectId = c.req.query("projectId") || undefined;
	const ownerTypeRaw = c.req.query("ownerType") || undefined;
	const ownerId = c.req.query("ownerId") || undefined;
	const ownerType =
		ownerTypeRaw === "project" || ownerTypeRaw === "chapter" || ownerTypeRaw === "shot"
			? ownerTypeRaw
			: undefined;
	const flows = await listUserFlows(c, userId, projectId, { ownerType, ownerId });
	return c.json(FlowSchema.array().parse(flows));
});

flowRouter.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const flow = await getUserFlow(c, id, userId);
	return c.json(FlowSchema.parse(flow));
});

flowRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertFlowSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	try {
		const flow = await upsertUserFlow(c, userId, {
			id: parsed.data.id,
			name: parsed.data.name,
			data: parsed.data.data,
			projectId: parsed.data.projectId,
			ownerType: parsed.data.ownerType,
			ownerId: parsed.data.ownerId,
			expectedRevision: parsed.data.expectedRevision,
			source: parsed.data.source,
		});
		const parsedFlow = FlowSchema.parse(flow);
		return c.json(FlowSaveReceiptSchema.parse({
			id: parsedFlow.id,
			name: parsedFlow.name,
			ownerType: parsedFlow.ownerType,
			ownerId: parsedFlow.ownerId,
			canvasRevision: parsedFlow.canvasRevision,
			createdAt: parsedFlow.createdAt,
			updatedAt: parsedFlow.updatedAt,
			dataAdjusted: wasAuthoringSnapshotAdjusted(parsed.data.data, parsedFlow.data),
		}));
	} catch (err) {
		if (err instanceof FlowRevisionConflictError) {
			return c.json(
				{
					error: "Revision conflict",
					code: "flow_revision_conflict",
					expected: err.expected,
					actual: err.actual,
				},
				409,
			);
		}
		throw err;
	}
});

flowRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteUserFlow(c, id, userId);
	return c.body(null, 204);
});

flowRouter.get("/:id/versions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const requestedLimit = Number(c.req.query("limit") || 40);
	const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 40;
	const cursor = (c.req.query("cursor") || "").trim();
	const page = await listUserFlowVersions(c, id, userId, {
		limit,
		...(cursor ? { cursor } : {}),
	});
	return c.json(FlowVersionPageSchema.parse(page));
});

flowRouter.post("/:id/versions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const version = await createUserFlowVersion(c, c.req.param("id"), userId);
	return c.json(FlowVersionSchema.parse(version), 201);
});

flowRouter.post("/:id/rollback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const versionId = typeof body.versionId === "string" ? body.versionId : "";
	if (!versionId) {
		return c.json(
			{ error: "Invalid request body", issues: ["versionId is required"] },
			400,
		);
	}
	const flow = await rollbackUserFlow(c, id, versionId, userId);
	return c.json(FlowSchema.parse(flow));
});
