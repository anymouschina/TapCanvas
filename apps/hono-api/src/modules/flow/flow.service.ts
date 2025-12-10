import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
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

export async function listUserFlows(
	c: AppContext,
	userId: string,
	projectId?: string,
) {
	const rows = await listFlowsByOwner(c.env.DB, userId, projectId);
	return rows.map((r) => mapFlowRowToDto(r));
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
	return mapFlowRowToDto(row);
}

export async function upsertUserFlow(
	c: AppContext,
	userId: string,
	input: { id?: string; name: string; data: unknown; projectId?: string | null },
) {
	const nowIso = new Date().toISOString();
	const dataJson = JSON.stringify(input.data ?? {});

	if (input.id) {
		const updated = await updateFlow(c.env.DB, {
			id: input.id,
			name: input.name,
			data: dataJson,
			ownerId: userId,
			projectId: input.projectId ?? null,
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
			flowId: updated.id,
			name: updated.name,
			data: updated.data,
			userId,
			nowIso,
		});
		return mapFlowRowToDto(updated);
	}

	const id = crypto.randomUUID();
	const created = await createFlow(c.env.DB, {
		id,
		name: input.name,
		data: dataJson,
		ownerId: userId,
		projectId: input.projectId ?? null,
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
	const updated = await updateFlow(c.env.DB, {
		id: flowId,
		name: version.name,
		data: version.data,
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

