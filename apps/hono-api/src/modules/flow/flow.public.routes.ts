import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { AppError } from "../../middleware/error";
import {
	getFlowForOwner,
	updateFlow,
	createFlow,
	mapFlowRowToDto,
	getFlowByIdUnsafe,
	updateFlowByIdUnsafe,
	listFlowsByProject,
	listFlowsByOwner,
	replaceFlowDataIfUnchanged,
} from "./flow.repo";
import { sanitizeFlowDataForStorage } from "./flow.service";
import {
	PublicFlowGraphSchema,
	PublicFlowGetResponseSchema,
	PublicFlowPatchRequestSchema,
	PublicFlowPatchResponseSchema,
	PublicProjectFlowScopeRepairRequestSchema,
	PublicProjectFlowScopeRepairResponseSchema,
	PublicProjectFlowsResponseSchema,
} from "./flow.public.schemas";
import { applyPublicFlowGraphPatch, buildCanvasSyncPatch } from "./flow.public.service";
import { syncCanvasBookFromFlow } from "./flow.canvas-book-sync";
import { broadcastPatch, subscribeToChapter } from "../chapter/canvas-sse.manager";
import { applyPatchToFlowYDoc } from "../realtime/yjs-realtime";
import { prepareProjectFlowScopeRepair } from "./flow.project-scope-repair";
import { isAdminRequest } from "../team/team.service";
import {
	preserveAdminWorkflowGraphForNonAdmin,
	projectWorkflowGraphForViewer,
} from "@tapcanvas/workflow-kernel-protocol";

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

const PublicProjectFlowScopeRepairRoute = createRoute({
	method: "post",
	path: "/projects/{projectId}/flows/{id}/scope/repair",
	tags: ["Public API"],
	summary: "Repair missing project-flow ownership metadata",
	description:
		"仅在 flow 的项目归属元数据缺失或同项目部分缺失时补写 project scope；要求更新时间与图节点/边数量全部匹配，不允许覆盖冲突归属。",
	request: {
		params: z.object({
			projectId: z.string().min(1),
			id: z.string().min(1),
		}),
		body: {
			content: {
				"application/json": {
					schema: PublicProjectFlowScopeRepairRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: PublicProjectFlowScopeRepairResponseSchema,
				},
			},
			description: "Project flow scope repaired",
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

	publicApiRouter.openapi(PublicProjectFlowScopeRepairRoute, async (c) => {
		const devBypass = isDevBypassEnabled(c);
		const requestUserId = requireUserId(c);
		const projectId = c.req.param("projectId");
		const id = c.req.param("id");
		const body = await c.req.json();
		const parsed = PublicProjectFlowScopeRepairRequestSchema.safeParse(body);
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
		if (!row || row.project_id !== projectId) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}

		const prepared = prepareProjectFlowScopeRepair(row, {
			projectId,
			expectedUpdatedAt: parsed.data.expectedUpdatedAt,
			expectedNodeCount: parsed.data.expectedNodeCount,
			expectedEdgeCount: parsed.data.expectedEdgeCount,
		});
		const nowIso = new Date().toISOString();
		const updated = await replaceFlowDataIfUnchanged(c.env.DB, {
			id,
			projectId,
			expectedData: prepared.expectedData,
			expectedUpdatedAt: parsed.data.expectedUpdatedAt,
			nextData: prepared.nextData,
			nowIso,
		});
		if (!updated) {
			throw new AppError("Flow changed while scope repair was being applied", {
				status: 409,
				code: "flow_scope_repair_concurrent_change",
			});
		}

		const versionUserId = resolveFlowVersionUserId({
			devBypass,
			requestUserId,
			flowOwnerId: row.owner_id,
		});
		console.info("[flow-scope-repair] project scope restored", {
			flowId: updated.id,
			projectId,
			nodeCount: prepared.nodeCount,
			edgeCount: prepared.edgeCount,
			updatedAt: updated.updated_at,
		});

		return c.json(
			PublicProjectFlowScopeRepairResponseSchema.parse({
				ok: true,
				flowId: updated.id,
				projectId,
				ownerType: "project",
				ownerId: projectId,
				updatedAt: updated.updated_at,
				nodeCount: prepared.nodeCount,
				edgeCount: prepared.edgeCount,
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
		const canManageAdminWorkflow = isAdminRequest(c);
		const data = projectWorkflowGraphForViewer(
			sanitizeFlowDataForStorage(dto.data ?? {}),
			canManageAdminWorkflow,
		);
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
		const canManageAdminWorkflow = isAdminRequest(c);
		const current = sanitizeFlowDataForStorage(dto.data ?? {});
		const visibleCurrent = projectWorkflowGraphForViewer(current, canManageAdminWorkflow);
		const applied = applyPublicFlowGraphPatch({ current: visibleCurrent, patch: parsed.data });

		const nowIso = new Date().toISOString();
		const sanitizedNext = sanitizeFlowDataForStorage(
			canManageAdminWorkflow
				? applied.data
				: preserveAdminWorkflowGraphForNonAdmin({
					existing: current,
					incoming: applied.data,
				}),
		);
		const visibleNext = projectWorkflowGraphForViewer(sanitizedNext, canManageAdminWorkflow);
		const nextParsed = PublicFlowGraphSchema.safeParse(visibleNext);
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
		// 画布文本节点 → 书籍章节文件同步（fire-and-forget，不阻塞响应）
		if (row.project_id) {
			syncCanvasBookFromFlow({
				projectId: row.project_id,
				userId: versionUserId,
				flowData: sanitizedNext,
				nowIso,
			}).catch((err) => console.error("[canvas-book-sync] flow.public.routes:", err));

			// 广播节点/边变更到项目 SSE 频道，浏览器实时刷新画布。
			// 必须用 buildCanvasSyncPatch（按 applied.createdNodeIds 反查）：agent 的
			// createNodes 普遍不带 id，按请求 id 反查会恒空、写库成功但画布收不到推送。
			const syncPatch = buildCanvasSyncPatch({
				applied,
				patch: parsed.data,
				data: nextParsed.data,
			});
			if (syncPatch) {
				broadcastPatch(row.project_id, syncPatch, "");
				applyPatchToFlowYDoc(row.id, syncPatch);
			}
		}

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

	// ── ⑥ 会话/画布 fork（创意分支：从当前画布岔开试 B 方案，原画布不动）──────────────
	// POST /public/flows/:id/fork → 把当前 flow 的画布(nodes/edges)整体复制成同项目下一个【新分支 flow】，
	// 返回新 flowId；前端导航过去即可在分支上自由试，原 flow 保持原样。利用现有「一个项目多个 flow」模型。
	publicApiRouter.post("/flows/:id/fork", async (c) => {
		const userId = requireUserId(c);
		const devBypass = isDevBypassEnabled(c);
		const id = c.req.param("id");
		const source = devBypass
			? await getFlowByIdUnsafe(c.env.DB, id)
			: await getFlowForOwner(c.env.DB, id, userId);
		if (!source) {
			throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
		}
		const ownerId = resolveFlowVersionUserId({
			devBypass,
			requestUserId: userId,
			flowOwnerId: source.owner_id,
		});
		let body: { name?: unknown } = {};
		try {
			body = (await c.req.json()) as { name?: unknown };
		} catch {
			body = {};
		}
		const baseName = (source.name && String(source.name).trim()) || "画布";
		// 去掉已有的「· 分支」「· 分支N」后缀再加，避免「A · 分支 · 分支」无限叠。
		const root = baseName.replace(/\s*·\s*分支\d*$/u, "");
		const forkName =
			typeof body.name === "string" && body.name.trim()
				? body.name.trim().slice(0, 120)
				: `${root} · 分支`;
		const newId = `flow-fork-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
		const created = await createFlow(c.env.DB, {
			id: newId,
			name: forkName,
			data: JSON.stringify(projectWorkflowGraphForViewer(
				sanitizeFlowDataForStorage(mapFlowRowToDto(source).data ?? {}),
				false,
			)),
			ownerId,
			projectId: source.project_id ?? null,
			nowIso: new Date().toISOString(),
		});
		return c.json({
			ok: true,
			id: created.id,
			name: created.name,
			projectId: created.project_id ?? null,
			forkedFrom: id,
		});
	});

	// ── Public SSE subscription for agents-cli ───────────────────────────────
	// GET /public/flows/:id/events
	// 允许 API key 持有者实时订阅画布节点变更（同 project canvas-events 频道）
	publicApiRouter.get("/flows/:id/events", async (c) => {
		const userId = requireUserId(c);
		const devBypass = isDevBypassEnabled(c);
		const id = c.req.param("id");
		const row = devBypass
			? await getFlowByIdUnsafe(c.env.DB, id)
			: await getFlowForOwner(c.env.DB, id, userId);
		if (!row) {
			return c.json({ error: "Flow not found" }, 404);
		}
		const channelId = row.project_id ?? id;
		const enc = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				const { connId, unsubscribe } = subscribeToChapter(channelId, userId, controller);
				try {
					controller.enqueue(enc.encode(`event: conn-id\ndata: ${connId}\n\n`));
					controller.enqueue(enc.encode(`event: subscribed\ndata: ${JSON.stringify({ flowId: id, channelId })}\n\n`));
				} catch { /* already closed */ }
				c.req.raw.signal.addEventListener("abort", () => {
					unsubscribe();
					try { controller.close(); } catch { /* already closed */ }
				});
			},
		});
		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-store",
				"Connection": "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	});
}
