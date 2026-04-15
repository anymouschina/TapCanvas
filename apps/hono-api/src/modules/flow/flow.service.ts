import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { appendTraceEvent, setTraceStage } from "../../trace";
import {
	createFlow,
	createFlowVersion,
	deleteFlowById,
	getFlowForOwner,
	getFlowVersion,
	listFlowVersions,
	listFlowsByOwner,
	mapFlowRowToDto,
	updateFlow,
} from "./flow.repo";
import { getProjectForOwner } from "../project/project.repo";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
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
	const rows = await listFlowsByOwner(c.env.DB, userId, projectId);
	return rows.map((r) => {
		const dto = mapFlowRowToDto(r);
		return {
			...dto,
			data: sanitizeFlowDataForStorage(dto.data ?? {}),
		};
	}).filter((dto) => {
		if (!owner?.ownerType && !owner?.ownerId) return true;
		if (owner?.ownerType && dto.ownerType !== owner.ownerType) return false;
		if (owner?.ownerId && dto.ownerId !== owner.ownerId) return false;
		return true;
	});
}

export async function getUserFlow(
	c: AppContext,
	id: string,
	userId: string,
) {
	const row = await getFlowForOwner(c.env.DB, id, userId);
	if (!row) {
		// align with stricter semantics; frontend treats 4xx as generic error
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const dto = mapFlowRowToDto(row);
	return {
		...dto,
		data: sanitizeFlowDataForStorage(dto.data ?? {}),
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
	},
) {
	const nowIso = new Date().toISOString();
	const normalizedProjectId =
		typeof input.projectId === "string" && input.projectId.trim()
			? input.projectId.trim()
			: null;
	if (normalizedProjectId) {
		const project = await getProjectForOwner(c.env.DB, normalizedProjectId, userId);
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
	const sanitizedData = attachFlowOwnerMeta(
		sanitizeFlowDataForStorage(input.data ?? {}),
		{ ownerType: input.ownerType, ownerId: input.ownerId },
	);
	const dataJson = JSON.stringify(sanitizedData ?? {});
	const nextShape = summarizeGraphShape(sanitizedData);
	setTraceStage(c, "flow:upsert:begin", {
		userId,
		flowId: input.id ?? null,
		projectId: normalizedProjectId,
		name: input.name,
		nextShape,
	});

	if (input.id) {
		const existing = await getFlowForOwner(c.env.DB, input.id, userId);
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
		const existingShape = summarizeGraphShape(mapFlowRowToDto(existing).data);
		appendTraceEvent(c, "flow:upsert:existing_loaded", {
			flowId: input.id,
			projectId: normalizedProjectId,
			existingShape,
			nextShape,
		});
		if (
			nextShape.isExplicitGraph
			&& nextShape.nodeCount === 0
			&& nextShape.edgeCount === 0
			&& existingShape.nodeCount > 0
		) {
			setTraceStage(c, "flow:upsert:blocked_empty_overwrite", {
				flowId: input.id,
				projectId: normalizedProjectId,
				existingShape,
				nextShape,
			});
			throw new AppError("Refusing to overwrite a non-empty flow with an empty graph", {
				status: 409,
				code: "empty_flow_overwrite_blocked",
				details: {
					flowId: input.id,
					existingNodeCount: existingShape.nodeCount,
					existingEdgeCount: existingShape.edgeCount,
				},
			});
		}
		const updated = await updateFlow(c.env.DB, {
			id: input.id,
			name: input.name,
			data: dataJson,
			ownerId: userId,
			projectId: normalizedProjectId,
			nowIso,
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
		await createFlowVersion(c.env.DB, {
			id: crypto.randomUUID(),
			flowId: updated.id,
			name: updated.name,
			data: updated.data,
			userId,
			nowIso,
		});
		setTraceStage(c, "flow:upsert:updated", {
			flowId: updated.id,
			projectId: updated.project_id ?? normalizedProjectId,
			nextShape,
		});
		return mapFlowRowToDto(updated);
	}

	const id = crypto.randomUUID();
	const created = await createFlow(c.env.DB, {
		id,
		name: input.name,
		data: dataJson,
		ownerId: userId,
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
	return mapFlowRowToDto(created);
}

export async function deleteUserFlow(
	c: AppContext,
	id: string,
	userId: string,
) {
	// Ensure it belongs to the user
	const existing = await getFlowForOwner(c.env.DB, id, userId);
	if (!existing) {
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
) {
	// Ensure flow belongs to user
	const flow = await getFlowForOwner(c.env.DB, flowId, userId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const versions = await listFlowVersions(c.env.DB, flowId);
	return versions.map((v) => ({
		id: v.id,
		name: v.name,
		createdAt: v.created_at,
	}));
}

export async function rollbackUserFlow(
	c: AppContext,
	flowId: string,
	versionId: string,
	userId: string,
) {
	const flow = await getFlowForOwner(c.env.DB, flowId, userId);
	if (!flow) {
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
	const sanitizedVersionData = (() => {
		try {
			const parsed = JSON.parse(version.data ?? "{}");
			return JSON.stringify(sanitizeFlowDataForStorage(parsed) ?? {});
		} catch {
			return JSON.stringify({});
		}
	})();
	const updated = await updateFlow(c.env.DB, {
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

	return mapFlowRowToDto(updated);
}
