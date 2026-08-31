import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { appendTraceEvent, setTraceStage } from "../../trace";
import {
	createFlow,
	createFlowVersion,
	deleteFlowById,
	getFlowByIdUnsafe,
	getFlowForOwner,
	getFlowVersion,
	listFlowVersionPage,
	listFlowsByOwner,
	listFlowsByProject,
	mapFlowRowToDto,
	updateFlow,
	updateFlowByIdUnsafe,
} from "./flow.repo";
import { getProjectForUserAccess } from "../project/project.repo";
import { filterFlowsByOwnerScope } from "./flow.owner-scope";
import { FlowStorageEnvelopeError, parseFlowStorageRecord } from "./flow.storage-envelope";
import { preserveManagedFlowProjections, readWorkflowExecutionOutputIds } from "./flow.managed-projections";
import {
	hasAdminWorkflowGraphNodes,
	preserveAdminWorkflowGraphForNonAdmin,
	projectWorkflowGraphForViewer,
} from "@tapcanvas/workflow-kernel-protocol";
import { isAdminRequest } from "../team/team.service";
import {
	readDurableCanvasImageUrl,
	sweepRegisterCanvasCards,
} from "../task/material-auto-register";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/**
 * 稳定规范化 JSON 字符串：递归排序对象键后序列化，用于判定两次画布保存内容是否完全一致。
 * 仅用于幂等判定（不写库、不建版本），不参与任何语义判断。
 */
function canonicalFlowDataJson(raw: string): string {
	try {
		const value = JSON.parse(raw || "{}");
		const sortKeys = (input: unknown): unknown => {
			if (Array.isArray(input)) return input.map(sortKeys);
			if (input && typeof input === "object") {
				return Object.fromEntries(
					Object.entries(input as Record<string, unknown>)
						.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
						.map(([key, item]) => [key, sortKeys(item)]),
				);
			}
			return input;
		};
		return JSON.stringify(sortKeys(value));
	} catch {
		return raw;
	}
}

function hasUnregisteredCanvasCard(value: unknown): boolean {
	for (const node of asArray(value)) {
		const nodeRecord = asRecord(node);
		const data = asRecord(nodeRecord?.data);
		if (!data || String(data.status ?? "").trim().toLowerCase() !== "success") continue;
		const imageUrl = readDurableCanvasImageUrl(data);
		if (!/^https?:\/\//i.test(imageUrl)) continue;
		if (typeof data.materialRegisteredImageUrl === "string" && data.materialRegisteredImageUrl.trim() === imageUrl) continue;
		return true;
	}
	return false;
}

function summarizeGraphShape(value: unknown): {
	nodeCount: number;
	edgeCount: number;
	isExplicitGraph: boolean;
} {
	const root = asRecord(value);
	if (!root) {
		return { nodeCount: 0, edgeCount: 0, isExplicitGraph: false };
	}
	const nodes = asArray(root.nodes);
	const edges = asArray(root.edges);
	const hasGraphKeys = Object.prototype.hasOwnProperty.call(root, "nodes")
		|| Object.prototype.hasOwnProperty.call(root, "edges");
	return {
		nodeCount: nodes.length,
		edgeCount: edges.length,
		isExplicitGraph: hasGraphKeys,
	};
}

export function sanitizeFlowDataForStorage(value: unknown): unknown {
	const seen = new WeakSet<object>();
	const looksLikeBase64DataUrl = (raw: string) =>
		/^data:[^;]+;base64,/i.test((raw || "").trim());
	const looksLikeBlobUrl = (raw: string) =>
		(raw || "").trim().toLowerCase().startsWith("blob:");

	const walk = (v: any): any => {
		if (v === null || v === undefined) return v;
		if (typeof v === "string") {
			if (looksLikeBase64DataUrl(v) || looksLikeBlobUrl(v)) return undefined;
			return v;
		}
		if (typeof v !== "object") return v;
		if (seen.has(v)) return undefined;
		seen.add(v);

		if (Array.isArray(v)) {
			const out: any[] = [];
			for (const item of v) {
				const next = walk(item);
				if (next !== undefined) out.push(next);
			}
			return out;
		}

		const out: Record<string, any> = {};
		for (const [key, val] of Object.entries(v)) {
			const next = walk(val);
			if (next !== undefined) out[key] = next;
		}
		return out;
	};

	return walk(value);
}

function attachFlowOwnerMeta(
	value: unknown,
	input: { ownerType?: "project" | "chapter" | "shot"; ownerId?: string | null },
): unknown {
	const root =
		value && typeof value === "object" && !Array.isArray(value)
			? { ...(value as Record<string, unknown>) }
			: {};
	const ownerType = input.ownerType ?? null;
	const ownerId =
		typeof input.ownerId === "string" && input.ownerId.trim()
			? input.ownerId.trim()
			: null;
	if (!ownerType || !ownerId) {
		return root;
	}
	return {
		...root,
		__tapcanvasFlowOwner: {
			ownerType,
			ownerId,
		},
	};
}

export async function listUserFlows(
	c: AppContext,
	userId: string,
	projectId?: string,
	owner?: { ownerType?: "project" | "chapter" | "shot"; ownerId?: string },
) {
	const rows = projectId
		? await (async () => {
			const project = await getProjectForUserAccess(c.env.DB, projectId, userId);
			if (!project) {
				throw new AppError("Project not found", {
					status: 404,
					code: "project_not_found",
					details: { projectId },
				});
			}
			return listFlowsByProject(c.env.DB, projectId);
		})()
		: await listFlowsByOwner(c.env.DB, userId);
	const flows = rows.map((r) => {
		const dto = mapFlowRowToDto(r);
		return {
			...dto,
			data: projectWorkflowGraphForViewer(
				sanitizeFlowDataForStorage(dto.data ?? {}),
				isAdminRequest(c),
			),
		};
	});
	return filterFlowsByOwnerScope(flows, owner);
}

export async function getUserFlow(
	c: AppContext,
	id: string,
	userId: string,
) {
	const row = await getFlowByIdUnsafe(c.env.DB, id);
	if (!row) {
		// align with stricter semantics; frontend treats 4xx as generic error
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	if (row.project_id) {
		const project = await getProjectForUserAccess(c.env.DB, row.project_id, userId);
		if (!project) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
	} else if (row.owner_id !== userId) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const dto = mapFlowRowToDto(row);
	return {
		...dto,
		data: projectWorkflowGraphForViewer(
			sanitizeFlowDataForStorage(dto.data ?? {}),
			isAdminRequest(c),
		),
	};
}

export async function upsertUserFlow(
	c: AppContext,
	userId: string,
	input: {
		id?: string;
		name: string;
		data: unknown;
		projectId?: string | null;
		ownerType?: "project" | "chapter" | "shot";
		ownerId?: string | null;
		// 【画布多 tab 版本号防覆盖·2026-07-15】携带 expectedRevision 时，
		// 透传给 repo 层做乐观锁校验；source 只作调用来源记录，不构成权限边界。
		expectedRevision?: number;
		source?: "user" | "agent";
	},
) {
	const nowIso = new Date().toISOString();
	const normalizedProjectId =
		typeof input.projectId === "string" && input.projectId.trim()
			? input.projectId.trim()
			: null;
	const project = normalizedProjectId
		? await getProjectForUserAccess(c.env.DB, normalizedProjectId, userId)
		: null;
	if (normalizedProjectId) {
		if (!project) {
			setTraceStage(c, "flow:upsert:project_missing", {
				userId,
				flowId: input.id ?? null,
				projectId: normalizedProjectId,
				name: input.name,
			});
			throw new AppError("Project not found", {
				status: 404,
				code: "project_not_found",
				details: {
					projectId: normalizedProjectId,
				},
			});
		}
	}
	let sanitizedData = attachFlowOwnerMeta(
		sanitizeFlowDataForStorage(input.data ?? {}),
		{ ownerType: input.ownerType, ownerId: input.ownerId },
	);
	let dataJson = JSON.stringify(sanitizedData ?? {});
	let nextShape = summarizeGraphShape(sanitizedData);
	setTraceStage(c, "flow:upsert:begin", {
		userId,
		flowId: input.id ?? null,
		projectId: normalizedProjectId,
		name: input.name,
		nextShape,
	});

	if (input.id) {
		const existing = await getFlowByIdUnsafe(c.env.DB, input.id);
		if (!existing) {
			appendTraceEvent(c, "flow:upsert:missing_existing", {
				flowId: input.id,
				projectId: normalizedProjectId,
			});
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		if (existing.project_id) {
			const existingProject = await getProjectForUserAccess(c.env.DB, existing.project_id, userId);
			if (!existingProject) {
				throw new AppError("Flow not found", {
					status: 404,
					code: "flow_not_found",
				});
			}
		} else if (existing.owner_id !== userId) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		const existingShape = summarizeGraphShape(mapFlowRowToDto(existing).data);
		const existingRecord = asRecord(
			sanitizeFlowDataForStorage(mapFlowRowToDto(existing).data ?? {}),
		) ?? {};
		const incomingRecord = asRecord(sanitizedData) ?? {};
		const permissionSafeIncoming = isAdminRequest(c)
			? incomingRecord
			: asRecord(preserveAdminWorkflowGraphForNonAdmin({
				existing: existingRecord,
				incoming: incomingRecord,
			})) ?? {};
		// 终态执行（success/failed/canceled）的工作流产物（成片/逐镜视频节点）不再是
		// 服务端托管投影：查询真实执行状态后只保护仍活跃（queued/running）的产物，
		// 用户可经正常画布保存删除已结束执行的成片节点；查询失败按「全部保护」保守处理。
		const managedExecutionIds = readWorkflowExecutionOutputIds(existingRecord);
		let executionActive: Record<string, boolean> | undefined;
		if (managedExecutionIds.length > 0) {
			try {
				const rows = await c.env.DB.workflow_executions.findMany({
					where: { id: { in: managedExecutionIds } },
					select: { id: true, status: true },
				});
				const activeIds = new Set(
					rows
						.filter((row) => row.status === "queued" || row.status === "running")
						.map((row) => row.id),
				);
				executionActive = Object.fromEntries(
					managedExecutionIds.map((executionId) => [executionId, activeIds.has(executionId)]),
				);
			} catch {
				// 状态查询失败时保留旧行为（全部保护），不允许静默放开托管投影。
				executionActive = undefined;
			}
		}
		sanitizedData = preserveManagedFlowProjections({
			existing: existingRecord,
			incoming: permissionSafeIncoming,
			...(executionActive ? { executionActive } : {}),
		});
		const incomingNodes = asArray(asRecord(sanitizedData)?.nodes);
		if (hasUnregisteredCanvasCard(incomingNodes)) {
			try {
				await sweepRegisterCanvasCards({
					c,
					userId,
					flowId: input.id,
					nodes: incomingNodes as Array<{ id?: unknown; data?: unknown }>,
				});
			} catch (error) {
				// Registration is an index projection. It must never make a valid canvas save fail;
				// the next save or the authoring coverage read can retry from the same ready node.
				console.warn("[material-sweep] flow upsert sweep failed", {
					flowId: input.id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		dataJson = JSON.stringify(sanitizedData);
		nextShape = summarizeGraphShape(sanitizedData);
		appendTraceEvent(c, "flow:upsert:existing_loaded", {
			flowId: input.id,
			projectId: normalizedProjectId,
			existingShape,
			nextShape,
		});
		// 幂等保存守卫：内容与当前持久化数据完全一致且名称未变时，不写库、不创建版本。
		// 常驻画布（如桌面端内嵌浏览器、多标签）会以相同内容反复整图保存；逐次建版本会形成
		// 版本风暴（单 flow 可积累数万条相同快照），并让能力装配（inspect→equip CAS）、
		// 版本比对等版本敏感操作永远命中「检查后版本已变化」。内容相同时最新版本已含该数据，
		// 直接幂等返回当前行即可，不丢失任何已持久化进度。
		if (existing.name === input.name && canonicalFlowDataJson(existing.data) === canonicalFlowDataJson(dataJson)) {
			setTraceStage(c, "flow:upsert:identical_noop", {
				flowId: input.id,
				projectId: normalizedProjectId,
				nextShape,
			});
			const noopDto = mapFlowRowToDto(existing);
			return {
				...noopDto,
				data: projectWorkflowGraphForViewer(noopDto.data, isAdminRequest(c)),
			};
		}
		// 允许用空白画布覆盖已有内容（用户主动清空画布）
		const flowOwnerId = project?.owner_id || existing.owner_id || userId;
		const updated = normalizedProjectId
			? await updateFlowByIdUnsafe(c.env.DB, {
				id: input.id,
				name: input.name,
				data: dataJson,
				nowIso,
				expectedRevision: input.expectedRevision,
				source: input.source,
			})
			: await updateFlow(c.env.DB, {
			id: input.id,
			name: input.name,
			data: dataJson,
			ownerId: flowOwnerId,
			projectId: normalizedProjectId,
			nowIso,
			expectedRevision: input.expectedRevision,
			source: input.source,
		});
		if (!updated) {
			appendTraceEvent(c, "flow:upsert:update_missing", {
				flowId: input.id,
				projectId: normalizedProjectId,
			});
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		// 普通画布保存只更新当前作者态。不可变版本必须由用户显式保存、工作流执行、
		// 能力装载或版本恢复创建；否则每次 autosave 都会复制完整画布并形成版本风暴。
		setTraceStage(c, "flow:upsert:updated", {
			flowId: updated.id,
			projectId: updated.project_id ?? normalizedProjectId,
			nextShape,
		});
		const dto = mapFlowRowToDto(updated);
		return {
			...dto,
			data: projectWorkflowGraphForViewer(dto.data, isAdminRequest(c)),
		};
	}

	// A newly created public flow has no server-owned projections yet. Strip any claimed
	// managed projection instead of trusting the caller-provided source label.
	const permissionSafeCreatedData = isAdminRequest(c)
		? asRecord(sanitizedData) ?? {}
		: asRecord(preserveAdminWorkflowGraphForNonAdmin({
			existing: { nodes: [], edges: [] },
			incoming: sanitizedData,
		})) ?? {};
	sanitizedData = preserveManagedFlowProjections({
		existing: { nodes: [] },
		incoming: permissionSafeCreatedData,
	});
	dataJson = JSON.stringify(sanitizedData);
	nextShape = summarizeGraphShape(sanitizedData);
	const id = crypto.randomUUID();
	const created = await createFlow(c.env.DB, {
		id,
		name: input.name,
		data: dataJson,
		ownerId: project?.owner_id || userId,
		projectId: normalizedProjectId,
		nowIso,
	});
	await createFlowVersion(c.env.DB, {
		id: crypto.randomUUID(),
		flowId: created.id,
		name: created.name,
		data: created.data,
		userId,
		nowIso,
	});
	setTraceStage(c, "flow:upsert:created", {
		flowId: created.id,
		projectId: created.project_id ?? normalizedProjectId,
		nextShape,
	});
	const dto = mapFlowRowToDto(created);
	return {
		...dto,
		data: projectWorkflowGraphForViewer(dto.data, isAdminRequest(c)),
	};
}

export async function deleteUserFlow(
	c: AppContext,
	id: string,
	userId: string,
) {
	const existing = await getFlowByIdUnsafe(c.env.DB, id);
	if (!existing) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	if (existing.project_id) {
		const project = await getProjectForUserAccess(c.env.DB, existing.project_id, userId);
		if (!project) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
		if (!isAdminRequest(c) && hasAdminWorkflowGraphNodes(mapFlowRowToDto(existing).data)) {
			throw new AppError("Administrator permission is required to delete a flow with protected workflows", {
				status: 403,
				code: "admin_workflow_requires_admin",
			});
		}
		await deleteFlowById(c.env.DB, id, existing.owner_id || userId);
		return;
	}
	if (existing.owner_id !== userId) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	await deleteFlowById(c.env.DB, id, userId);
}

export async function listUserFlowVersions(
	c: AppContext,
	flowId: string,
	userId: string,
	options: Readonly<{ limit: number; cursor?: string }>,
) {
	const flow = await getFlowByIdUnsafe(c.env.DB, flowId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	if (flow.project_id) {
		const project = await getProjectForUserAccess(c.env.DB, flow.project_id, userId);
		if (!project) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
	} else if (flow.owner_id !== userId) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const page = await listFlowVersionPage(c.env.DB, flowId, options);
	return {
		items: page.items.map((version) => ({
			id: version.id,
			name: version.name,
			createdAt: version.created_at,
		})),
		nextCursor: page.nextCursor,
	};
}

export async function createUserFlowVersion(
	c: AppContext,
	flowId: string,
	userId: string,
) {
	const flow = await getFlowByIdUnsafe(c.env.DB, flowId);
	if (!flow) {
		throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
	}
	if (flow.project_id) {
		const project = await getProjectForUserAccess(c.env.DB, flow.project_id, userId);
		if (!project) {
			throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
		}
	} else if (flow.owner_id !== userId) {
		throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
	}
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	await createFlowVersion(c.env.DB, {
		id,
		flowId: flow.id,
		name: flow.name,
		data: flow.data,
		userId,
		nowIso: createdAt,
	});
	return { id, name: flow.name, createdAt };
}

export async function rollbackUserFlow(
	c: AppContext,
	flowId: string,
	versionId: string,
	userId: string,
) {
	const flow = await getFlowByIdUnsafe(c.env.DB, flowId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	if (flow.project_id) {
		const project = await getProjectForUserAccess(c.env.DB, flow.project_id, userId);
		if (!project) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
			});
		}
	} else if (flow.owner_id !== userId) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const version = await getFlowVersion(c.env.DB, versionId, flowId);
	if (!version) {
		throw new AppError("version not found", {
			status: 404,
			code: "version_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	let parsedVersionData: Record<string, unknown>;
	try {
		parsedVersionData = parseFlowStorageRecord(version.data, "rollback version data");
	} catch (error) {
		if (error instanceof FlowStorageEnvelopeError) {
			throw new AppError("Flow version data is invalid; rollback was not applied", {
				status: 500,
				code: "flow_version_data_invalid",
				details: { source: error.source, reason: error.reason, versionId },
			});
		}
		throw error;
	}
	const currentData = sanitizeFlowDataForStorage(mapFlowRowToDto(flow).data ?? {});
	const versionData = sanitizeFlowDataForStorage(parsedVersionData);
	const permissionSafeVersionData = isAdminRequest(c)
		? versionData
		: preserveAdminWorkflowGraphForNonAdmin({
			existing: currentData,
			incoming: versionData,
		});
	const sanitizedVersionData = JSON.stringify(permissionSafeVersionData);
	const updated = flow.project_id
		? await updateFlowByIdUnsafe(c.env.DB, {
			id: flowId,
			name: version.name,
			data: sanitizedVersionData,
			nowIso,
		})
		: await updateFlow(c.env.DB, {
			id: flowId,
			name: version.name,
			data: sanitizedVersionData,
			ownerId: userId,
			projectId: flow.project_id,
			nowIso,
		});
	if (!updated) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}

	await createFlowVersion(c.env.DB, {
		id: crypto.randomUUID(),
		flowId,
		name: updated.name,
		data: updated.data,
		userId,
		nowIso,
	});

	const dto = mapFlowRowToDto(updated);
	return {
		...dto,
		data: projectWorkflowGraphForViewer(dto.data, isAdminRequest(c)),
	};
}
