import type { D1Database } from "../../types";
import { queryAll, queryOne, execute } from "../../db/db";
import type { FlowDto } from "./flow.schemas";

export type FlowRow = {
	id: string;
	name: string;
	data: string;
	owner_id: string | null;
	project_id: string | null;
	created_at: string;
	updated_at: string;
};

export type FlowVersionRow = {
	id: string;
	flow_id: string;
	name: string;
	data: string;
	user_id: string | null;
	created_at: string;
};

export function mapFlowRowToDto(row: FlowRow): FlowDto {
	let data: unknown = null;
	try {
		data = JSON.parse(row.data);
	} catch {
		data = null;
	}
	return {
		id: row.id,
		name: row.name,
		data,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function listFlowsByOwner(
	db: D1Database,
	ownerId: string,
	projectId?: string,
): Promise<FlowRow[]> {
	const params: unknown[] = [ownerId];
	let sql =
		"SELECT id, name, data, owner_id, project_id, created_at, updated_at FROM flows WHERE owner_id = ?";
	if (projectId) {
		sql += " AND project_id = ?";
		params.push(projectId);
	}
	sql += " ORDER BY updated_at DESC";

	return queryAll<FlowRow>(db, sql, params);
}

export async function listFlowsByProject(
	db: D1Database,
	projectId: string,
): Promise<FlowRow[]> {
	return queryAll<FlowRow>(
		db,
		`SELECT id, name, data, owner_id, project_id, created_at, updated_at
     FROM flows
     WHERE project_id = ?
     ORDER BY updated_at DESC`,
		[projectId],
	);
}

export async function getFlowForOwner(
	db: D1Database,
	id: string,
	ownerId: string,
): Promise<FlowRow | null> {
	return queryOne<FlowRow>(
		db,
		`SELECT id, name, data, owner_id, project_id, created_at, updated_at
     FROM flows
     WHERE id = ? AND owner_id = ?`,
		[id, ownerId],
	);
}

export async function createFlow(
	db: D1Database,
	params: {
		id: string;
		name: string;
		data: string;
		ownerId: string;
		projectId?: string | null;
		nowIso: string;
	},
): Promise<FlowRow> {
	const { id, name, data, ownerId, projectId, nowIso } = params;
	await execute(
		db,
		`INSERT INTO flows (id, name, data, owner_id, project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[id, name, data, ownerId, projectId ?? null, nowIso, nowIso],
	);
	const row = await getFlowForOwner(db, id, ownerId);
	if (!row) {
		throw new Error("Failed to load created flow");
	}
	return row;
}

export async function updateFlow(
	db: D1Database,
	params: {
		id: string;
		name: string;
		data: string;
		ownerId: string;
		projectId?: string | null;
		nowIso: string;
	},
): Promise<FlowRow | null> {
	const { id, name, data, ownerId, projectId, nowIso } = params;
	await execute(
		db,
		`UPDATE flows
     SET name = ?, data = ?, owner_id = ?, project_id = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
		[
			name,
			data,
			ownerId,
			projectId ?? null,
			nowIso,
			id,
			ownerId,
		],
	);
	return getFlowForOwner(db, id, ownerId);
}

export async function deleteFlowById(
	db: D1Database,
	id: string,
	ownerId: string,
): Promise<void> {
	await execute(
		db,
		`DELETE FROM flow_versions WHERE flow_id = ?`,
		[id],
	);
	await execute(
		db,
		`DELETE FROM flows WHERE id = ? AND owner_id = ?`,
		[id, ownerId],
	);
}

export async function createFlowVersion(
	db: D1Database,
	params: {
		id: string;
		flowId: string;
		name: string;
		data: string;
		userId: string;
		nowIso: string;
	},
): Promise<void> {
	const { id, flowId, name, data, userId, nowIso } = params;
	await execute(
		db,
		`INSERT INTO flow_versions (id, flow_id, name, data, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
		[id, flowId, name, data, userId, nowIso],
	);
}

export async function listFlowVersions(
	db: D1Database,
	flowId: string,
): Promise<FlowVersionRow[]> {
	return queryAll<FlowVersionRow>(
		db,
		`SELECT id, flow_id, name, data, user_id, created_at
     FROM flow_versions
     WHERE flow_id = ?
     ORDER BY created_at DESC`,
		[flowId],
	);
}

export async function getFlowVersion(
	db: D1Database,
	versionId: string,
	flowId: string,
): Promise<FlowVersionRow | null> {
	return queryOne<FlowVersionRow>(
		db,
		`SELECT id, flow_id, name, data, user_id, created_at
     FROM flow_versions
     WHERE id = ? AND flow_id = ?`,
		[versionId, flowId],
	);
}

