import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { AppError } from "../../middleware/error";
import {
	getFlowForOwner,
	updateFlow,
	createFlowVersion,
	mapFlowRowToDto,
	getFlowByIdUnsafe,
	updateFlowByIdUnsafe,
	listFlowsByProject,
	listFlowsByOwner,
} from "./flow.repo";
import { sanitizeFlowDataForStorage } from "./flow.service";
import {
	PublicFlowGraphSchema,
	PublicFlowGetResponseSchema,
	PublicFlowPatchRequestSchema,
	PublicFlowPatchResponseSchema,
	PublicProjectFlowsResponseSchema,
} from "./flow.public.schemas";
import { applyPublicFlowGraphPatch } from "./flow.public.service";

function requireUserId(c: any): string {
	const userId = c.get("userId");
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}
	return String(userId);
}

function isDevBypassEnabled(c: any): boolean {
	return Boolean(c.get("devPublicBypass"));
}

function resolveFlowVersionUserId(input: { devBypass: boolean; requestUserId: string; flowOwnerId: string | null }): string {
	if (!input.devBypass) return input.requestUserId;
	const ownerId = String(input.flowOwnerId || "").trim();
	if (!ownerId) {
		throw new AppError("Flow owner missing", {
			status: 500,
			code: "flow_owner_missing",
		});
	}
	return ownerId;
}

const PublicFlowGetRoute = createRoute({
	method: "get",
	path: "/flows/{id}",
	tags: ["Public API"],
	request: {
		params: z.object({
			id: z.string().min(1),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PublicFlowGetResponseSchema,
				},
			},
			description: "flow graph payload",
		},
	},
});

const PublicFlowPatchRoute = createRoute({
	method: "post",
	path: "/flows/{id}/patch",
	tags: ["Public API"],
	request: {
		params: z.object({
			id: z.string().min(1),
		}),
		body: {
			content: {
				"application/json": {
					schema: PublicFlowPatchRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PublicFlowPatchResponseSchema,
				},
			},
			description: "patched flow data",
		},
	},
});

const PublicProjectFlowsRoute = createRoute({
	method: "get",
	path: "/projects/{projectId}/flows",
	tags: ["Public API"],
	summary: "Dev-only: list project flows",
	description:
		"列出 project 下的 flow。dev bypass 下为全量列举；非 dev bypass 下按当前用户 owner_id 过滤。",
	request: {
		params: z.object({
			projectId: z.string().min(1),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PublicProjectFlowsResponseSchema,
				},
			},
			description: "OK",
		},
	},
});

export function registerPublicFlowRoutes(publicApiRouter: OpenAPIHono<AppEnv>) {
	publicApiRouter.openapi(PublicProjectFlowsRoute, async (c) => {
		const devBypass = isDevBypassEnabled(c);
		const userId = requireUserId(c);
		const projectId = c.req.param("projectId");
		const rows = devBypass
			? await listFlowsByProject(c.env.DB, projectId)
			: await listFlowsByOwner(c.env.DB, userId, projectId);
		return c.json(
			PublicProjectFlowsResponseSchema.parse({
				items: rows.map((r) => ({
					id: r.id,
					name: r.name,
					updatedAt: r.updated_at,
				})),
			}),
		);
	});

	publicApiRouter.openapi(PublicFlowGetRoute, async (c) => {
		const id = c.req.param("id");
		const devBypass = isDevBypassEnabled(c);
		const userId = requireUserId(c);
		const row = devBypass
			? await getFlowByIdUnsafe(c.env.DB, id)
			: await getFlowForOwner(c.env.DB, id, userId);
		if (!row) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		const dto = mapFlowRowToDto(row);
		const data = sanitizeFlowDataForStorage(dto.data ?? {});
		const parsed = PublicFlowGraphSchema.safeParse(data);
		if (!parsed.success) {
			throw new AppError("Flow data invalid", {
				status: 500,
				code: "flow_data_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		return c.json(PublicFlowGetResponseSchema.parse({ ...dto, data: parsed.data }));
	});

	publicApiRouter.openapi(PublicFlowPatchRoute, async (c) => {
		const id = c.req.param("id");
		const devBypass = isDevBypassEnabled(c);
		const requestUserId = requireUserId(c);
		const body = await c.req.json();
		const parsed = PublicFlowPatchRequestSchema.safeParse(body);
		if (!parsed.success) {
			throw new AppError("Invalid request body", {
				status: 400,
				code: "invalid_request_body",
				details: { issues: parsed.error.issues },
			});
		}
		const row = devBypass
			? await getFlowByIdUnsafe(c.env.DB, id)
			: await getFlowForOwner(c.env.DB, id, requestUserId);
		if (!row) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		const dto = mapFlowRowToDto(row);
		const current = sanitizeFlowDataForStorage(dto.data ?? {});
		const applied = applyPublicFlowGraphPatch({ current, patch: parsed.data });

		const nowIso = new Date().toISOString();
		const sanitizedNext = sanitizeFlowDataForStorage(applied.data);
		const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
		if (!nextParsed.success) {
			throw new AppError("Flow patch produced invalid data", {
				status: 500,
				code: "flow_patch_invalid",
				details: { issues: nextParsed.error.issues },
			});
		}
		const nextJson = JSON.stringify(sanitizedNext ?? {});
		const updated = devBypass
			? await updateFlowByIdUnsafe(c.env.DB, {
					id,
					name: row.name,
					data: nextJson,
					nowIso,
				})
			: await updateFlow(c.env.DB, {
					id,
					name: row.name,
					data: nextJson,
					ownerId: requestUserId,
					projectId: row.project_id,
					nowIso,
				});
		if (!updated) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		const versionUserId = resolveFlowVersionUserId({
			devBypass,
			requestUserId,
			flowOwnerId: row.owner_id,
		});
		await createFlowVersion(c.env.DB, {
			id: crypto.randomUUID(),
			flowId: updated.id,
			name: updated.name,
			data: updated.data,
			userId: versionUserId,
			nowIso,
		});

		return c.json(
			PublicFlowPatchResponseSchema.parse({
				ok: true,
				flowId: updated.id,
				updatedAt: updated.updated_at,
				stats: applied.stats,
				data: nextParsed.data,
			}),
		);
	});
}
