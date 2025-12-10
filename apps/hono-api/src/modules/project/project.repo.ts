import type { D1Database } from "../../types";
import { queryAll, queryOne, execute } from "../../db/db";

export type ProjectRow = {
	id: string;
	name: string;
	is_public: number;
	owner_id: string | null;
	created_at: string;
	updated_at: string;
	owner_login?: string | null;
	owner_name?: string | null;
};

export async function listProjectsByOwner(
	db: D1Database,
	ownerId: string,
): Promise<ProjectRow[]> {
	return queryAll<ProjectRow>(
		db,
		`SELECT p.id, p.name, p.is_public, p.owner_id, p.created_at, p.updated_at,
        u.login as owner_login,
        u.name as owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.owner_id = ?
      ORDER BY p.updated_at DESC`,
		[ownerId],
	);
}

export async function listPublicProjects(db: D1Database): Promise<ProjectRow[]> {
	return queryAll<ProjectRow>(
		db,
		`SELECT p.id, p.name, p.is_public, p.owner_id, p.created_at, p.updated_at,
        u.login as owner_login,
        u.name as owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.is_public = 1
      ORDER BY p.updated_at DESC`,
	);
}

export async function getProjectById(
	db: D1Database,
	projectId: string,
): Promise<ProjectRow | null> {
	return queryOne<ProjectRow>(
		db,
		`SELECT p.id, p.name, p.is_public, p.owner_id, p.created_at, p.updated_at,
        u.login as owner_login,
        u.name as owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.id = ?`,
		[projectId],
	);
}

export async function getProjectForOwner(
	db: D1Database,
	projectId: string,
	ownerId: string,
): Promise<ProjectRow | null> {
	return queryOne<ProjectRow>(
		db,
		`SELECT p.id, p.name, p.is_public, p.owner_id, p.created_at, p.updated_at,
        u.login as owner_login,
        u.name as owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.id = ? AND p.owner_id = ?`,
		[projectId, ownerId],
	);
}

export async function createProject(
	db: D1Database,
	params: { id: string; name: string; ownerId: string; nowIso: string },
): Promise<ProjectRow> {
	const { id, name, ownerId, nowIso } = params;
	await execute(
		db,
		`INSERT INTO projects (id, name, is_public, owner_id, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?, ?)`,
		[id, name, ownerId, nowIso, nowIso],
	);
	const row = await getProjectById(db, id);
	if (!row) {
		throw new Error("Failed to load created project");
	}
	return row;
}

export async function updateProjectName(
	db: D1Database,
	params: { id: string; name: string; nowIso: string },
): Promise<ProjectRow | null> {
	const { id, name, nowIso } = params;
	await execute(
		db,
		`UPDATE projects
     SET name = ?, updated_at = ?
     WHERE id = ?`,
		[name, nowIso, id],
	);
	return getProjectById(db, id);
}

export async function updateProjectPublic(
	db: D1Database,
	params: { id: string; isPublic: boolean; nowIso: string },
): Promise<ProjectRow | null> {
	const { id, isPublic, nowIso } = params;
	await execute(
		db,
		`UPDATE projects
     SET is_public = ?, updated_at = ?
     WHERE id = ?`,
		[isPublic ? 1 : 0, nowIso, id],
	);
	return getProjectById(db, id);
}

export async function deleteProjectById(
	db: D1Database,
	projectId: string,
): Promise<void> {
	await execute(db, `DELETE FROM projects WHERE id = ?`, [projectId]);
}

