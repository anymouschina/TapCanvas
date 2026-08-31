import type { PrismaClient } from "../../types";
import { queryAll } from "../../db/db";
import { getPrismaClient } from "../../platform/node/prisma";
import { deleteProjectGraph } from "./project-delete";
import {
	getTeamProjectShareForUser,
	listTeamProjectSharesForUser,
	type TeamProjectShareRow,
} from "../team/team.repo";

export type ProjectRow = {
	id: string;
	name: string;
	is_public: number;
	owner_id: string | null;
	clone_count?: number | null;
	sort_weight?: number | null;
	created_at: string;
	updated_at: string;
	owner_login?: string | null;
	owner_name?: string | null;
	template_title?: string | null;
	template_description?: string | null;
	template_cover_url?: string | null;
	team_id?: string | null;
	team_shared?: boolean;
	access?: "owner" | "team_edit";
	active_workflow?: string | null;
	project_kind?: "creative" | "ai_workflow" | null;
};

export type ProjectAccessSummary = {
	id: string;
	name: string;
	owner_id: string | null;
	project_kind: "creative" | "ai_workflow";
	updated_at: string;
	team_id: string | null;
	team_shared: boolean;
	access: "owner" | "team_edit";
};

type TemplateMeta = {
	title: string | null;
	description: string | null;
	coverUrl: string | null;
};

type PaginatedProjectDbRow = {
	id: string;
	name: string;
	is_public: number;
	owner_id: string | null;
	clone_count: number | null;
	sort_weight: number | null;
	created_at: string;
	updated_at: string;
	active_workflow: string | null;
	project_kind: string | null;
	owner_login: string | null;
	owner_name: string | null;
	team_id: string | null;
};

type ProjectPageParams = {
	limit: number;
	cursor?: string;
};

type ProjectCursor = {
	updatedAt: string;
	id: string;
};

function parseProjectCursor(cursor?: string): ProjectCursor | null {
	if (!cursor) return null;
	const separatorIndex = cursor.lastIndexOf("__");
	if (separatorIndex <= 0 || separatorIndex >= cursor.length - 2) return null;
	return {
		updatedAt: cursor.slice(0, separatorIndex),
		id: cursor.slice(separatorIndex + 2),
	};
}

function createProjectCursor(row: Pick<ProjectRow, "updated_at" | "id">): string {
	return `${row.updated_at}__${row.id}`;
}

function normalizeNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function resolveFlowNodePrimaryImageUrl(node: unknown): string | null {
	if (!node || typeof node !== "object") return null;
	const typedNode = node as {
		type?: unknown;
		data?: unknown;
	};
	if (typedNode.type !== "taskNode") return null;
	if (!typedNode.data || typeof typedNode.data !== "object") return null;
	const data = typedNode.data as {
		imageResults?: unknown;
		imagePrimaryIndex?: unknown;
		imageUrl?: unknown;
	};

	const imageResults = Array.isArray(data.imageResults) ? data.imageResults : [];
	const imagePrimaryIndexRaw =
		typeof data.imagePrimaryIndex === "number"
			? data.imagePrimaryIndex
			: Number(data.imagePrimaryIndex);
	const imagePrimaryIndex = Number.isFinite(imagePrimaryIndexRaw)
		? Math.max(0, Math.floor(imagePrimaryIndexRaw))
		: 0;

	const preferredResult = imageResults[imagePrimaryIndex];
	if (preferredResult && typeof preferredResult === "object") {
		const preferredUrl = normalizeNonEmptyString(
			(preferredResult as { url?: unknown }).url,
		);
		if (preferredUrl) return preferredUrl;
	}

	for (const result of imageResults) {
		if (!result || typeof result !== "object") continue;
		const url = normalizeNonEmptyString((result as { url?: unknown }).url);
		if (url) return url;
	}

	return normalizeNonEmptyString(data.imageUrl);
}

function resolveTemplateCoverUrlFromFlowData(data: string): string | null {
	try {
		const parsed = JSON.parse(data) as { nodes?: unknown };
		const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
		for (const node of nodes) {
			const imageUrl = resolveFlowNodePrimaryImageUrl(node);
			if (imageUrl) return imageUrl;
		}
		return null;
	} catch {
		return null;
	}
}

function parseTemplateMeta(data: string | null): TemplateMeta {
	if (!data) return { title: null, description: null, coverUrl: null };
	try {
		const parsed = JSON.parse(data) as {
			kind?: unknown;
			title?: unknown;
			description?: unknown;
			coverUrl?: unknown;
		};
		if (parsed.kind !== "workflowTemplateMeta") {
			return { title: null, description: null, coverUrl: null };
		}
		return {
			title: typeof parsed.title === "string" ? parsed.title : null,
			description:
				typeof parsed.description === "string" ? parsed.description : null,
			coverUrl: typeof parsed.coverUrl === "string" ? parsed.coverUrl : null,
		};
	} catch {
		return { title: null, description: null, coverUrl: null };
	}
}

async function loadTemplateMetaMap(
	projectIds: string[],
): Promise<Map<string, TemplateMeta>> {
	const metaMap = new Map<string, TemplateMeta>();
	if (projectIds.length === 0) return metaMap;
	const rows = await getPrismaClient().assets.findMany({
		where: {
			project_id: { in: projectIds },
			data: { contains: `"kind":"workflowTemplateMeta"` },
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		select: {
			project_id: true,
			data: true,
		},
	});
	for (const row of rows) {
		if (!row.project_id || metaMap.has(row.project_id)) continue;
		metaMap.set(row.project_id, parseTemplateMeta(row.data));
	}
	return metaMap;
}

async function loadDerivedTemplateCoverMap(
	projectIds: string[],
): Promise<Map<string, string>> {
	const coverMap = new Map<string, string>();
	if (projectIds.length === 0) return coverMap;
	const rows = await getPrismaClient().flows.findMany({
		where: {
			project_id: { in: projectIds },
		},
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		select: {
			project_id: true,
			data: true,
		},
	});
	for (const row of rows) {
		if (!row.project_id || coverMap.has(row.project_id)) continue;
		const coverUrl = resolveTemplateCoverUrlFromFlowData(row.data);
		if (coverUrl) {
			coverMap.set(row.project_id, coverUrl);
		}
	}
	return coverMap;
}

function mapProjectRow(
	row: {
		id: string;
		name: string;
		is_public: number;
		owner_id: string | null;
		clone_count?: number | null;
		sort_weight?: number | null;
		created_at: string;
		updated_at: string;
		active_workflow?: string | null;
		project_kind?: string | null;
		users?: { login: string | null; name: string | null } | null;
	},
	metaMap: Map<string, TemplateMeta>,
	derivedCoverMap: Map<string, string>,
): ProjectRow {
	const meta = metaMap.get(row.id) ?? {
		title: null,
		description: null,
		coverUrl: null,
	};
	return {
		id: row.id,
		name: row.name,
		is_public: row.is_public,
		owner_id: row.owner_id,
		clone_count: row.clone_count ?? 0,
		sort_weight: row.sort_weight ?? 0,
		created_at: row.created_at,
		updated_at: row.updated_at,
		owner_login: row.users?.login ?? null,
		owner_name: row.users?.name ?? null,
		template_title: meta.title,
		template_description: meta.description,
		template_cover_url: meta.coverUrl ?? derivedCoverMap.get(row.id) ?? null,
		active_workflow: row.active_workflow ?? "free_canvas",
		project_kind: row.project_kind === "ai_workflow" ? "ai_workflow" : "creative",
	};
}

export async function listProjectsByOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<ProjectRow[]> {
	void db;
	const projects = await getPrismaClient().projects.findMany({
		where: { owner_id: ownerId },
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	const metaMap = await loadTemplateMetaMap(projects.map((p) => p.id));
	const derivedCoverMap = await loadDerivedTemplateCoverMap(
		projects.map((p) => p.id),
	);
	return projects.map((row) => mapProjectRow(row, metaMap, derivedCoverMap));
}

function attachAccess(row: ProjectRow, access: {
	teamId?: string | null;
	teamShared?: boolean;
	access?: "owner" | "team_edit";
}): ProjectRow {
	return {
		...row,
		team_id: access.teamId ?? null,
		team_shared: Boolean(access.teamShared),
		access: access.access ?? "owner",
	};
}

function mapProjectAccessSummary(
	row: Readonly<{
		id: string;
		name: string;
		owner_id: string | null;
		project_kind: string | null;
		updated_at: string;
	}>,
	access: Readonly<{
		teamId?: string | null;
		teamShared?: boolean;
		kind: "owner" | "team_edit";
	}>,
): ProjectAccessSummary {
	return {
		id: row.id,
		name: row.name,
		owner_id: row.owner_id,
		project_kind: row.project_kind === "ai_workflow" ? "ai_workflow" : "creative",
		updated_at: row.updated_at,
		team_id: access.teamId ?? null,
		team_shared: Boolean(access.teamShared),
		access: access.kind,
	};
}

/**
 * Capability management only needs project identity, classification and access.
 * Keep this path independent from the presentation-oriented project loader,
 * which derives covers by downloading and parsing every flow JSON document.
 */
export async function listProjectAccessSummaries(
	db: PrismaClient,
	userId: string,
): Promise<ProjectAccessSummary[]> {
	const [ownedRows, shares] = await Promise.all([
		db.projects.findMany({
			where: { owner_id: userId },
			select: {
				id: true,
				name: true,
				owner_id: true,
				project_kind: true,
				updated_at: true,
			},
		}),
		listTeamProjectSharesForUser(db, userId),
	]);
	const shareByProjectId = new Map(shares.map((share) => [share.project_id, share] as const));
	const ownedIds = new Set(ownedRows.map((row) => row.id));
	const sharedOnlyIds = shares
		.map((share) => share.project_id)
		.filter((projectId) => !ownedIds.has(projectId));
	const sharedRows = sharedOnlyIds.length === 0
		? []
		: await db.projects.findMany({
			where: { id: { in: [...new Set(sharedOnlyIds)] } },
			select: {
				id: true,
				name: true,
				owner_id: true,
				project_kind: true,
				updated_at: true,
			},
		});
	return [
		...ownedRows.map((row) => {
			const share = shareByProjectId.get(row.id);
			return mapProjectAccessSummary(row, {
				kind: "owner",
				teamId: share?.team_id,
				teamShared: Boolean(share),
			});
		}),
		...sharedRows.map((row) => mapProjectAccessSummary(row, {
			kind: "team_edit",
			teamId: shareByProjectId.get(row.id)?.team_id,
			teamShared: true,
		})),
	].sort((left, right) => {
		const timestampDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
		return (Number.isFinite(timestampDifference) ? timestampDifference : 0)
			|| right.id.localeCompare(left.id);
	});
}

export async function getProjectAccessSummary(
	db: PrismaClient,
	projectId: string,
	userId: string,
): Promise<ProjectAccessSummary | null> {
	const row = await db.projects.findFirst({
		where: { id: projectId },
		select: {
			id: true,
			name: true,
			owner_id: true,
			project_kind: true,
			updated_at: true,
		},
	});
	if (!row) return null;
	if (row.owner_id === userId) {
		return mapProjectAccessSummary(row, { kind: "owner" });
	}
	const share = await getTeamProjectShareForUser(db, { projectId, userId });
	if (!share) return null;
	return mapProjectAccessSummary(row, {
		kind: "team_edit",
		teamId: share.team_id,
		teamShared: true,
	});
}

async function mapSharedProjectRows(
	projectIds: string[],
	shareByProjectId: Map<string, TeamProjectShareRow>,
): Promise<ProjectRow[]> {
	if (projectIds.length === 0) return [];
	const projects = await getPrismaClient().projects.findMany({
		where: { id: { in: projectIds } },
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	const metaMap = await loadTemplateMetaMap(projects.map((p) => p.id));
	const derivedCoverMap = await loadDerivedTemplateCoverMap(
		projects.map((p) => p.id),
	);
	return projects.map((row) => {
		const share = shareByProjectId.get(row.id);
		return attachAccess(
			mapProjectRow(row, metaMap, derivedCoverMap),
			{ teamId: share?.team_id ?? null, teamShared: true, access: "team_edit" },
		);
	});
}

export async function listProjectsAccessibleByUser(
	db: PrismaClient,
	userId: string,
): Promise<ProjectRow[]> {
	const ownedRaw = await listProjectsByOwner(db, userId);
	const shares = await listTeamProjectSharesForUser(db, userId);
	const shareByProjectId = new Map<string, TeamProjectShareRow>();
	for (const share of shares) shareByProjectId.set(share.project_id, share);
	const ownedIds = new Set(ownedRaw.map((project) => project.id));
	const owned = ownedRaw.map((row) => {
		const share = shareByProjectId.get(row.id);
		return attachAccess(row, {
			access: "owner",
			teamShared: !!share,
			teamId: share?.team_id ?? null,
		});
	});
	const sharedOnlyIds: string[] = [];
	const sharedOnlyMap = new Map<string, TeamProjectShareRow>();
	for (const [projectId, share] of shareByProjectId) {
		if (ownedIds.has(projectId)) continue;
		sharedOnlyIds.push(projectId);
		sharedOnlyMap.set(projectId, share);
	}
	const shared = await mapSharedProjectRows(sharedOnlyIds, sharedOnlyMap);
	return [...owned, ...shared].sort((left, right) => {
		const rt = Date.parse(right.updated_at);
		const lt = Date.parse(left.updated_at);
		const timestampDifference =
			(Number.isFinite(rt) ? rt : 0) - (Number.isFinite(lt) ? lt : 0);
		return timestampDifference || right.id.localeCompare(left.id);
	});
}

export async function listProjectsByOwnerPaginated(
	db: PrismaClient,
	ownerId: string,
	params: { limit: number; cursor?: string },
): Promise<{ items: ProjectRow[]; nextCursor: string | null }> {
	void db;
	const { limit, cursor } = params;

	let cursorWhere: object | undefined;
	if (cursor) {
		const sep = cursor.lastIndexOf("__");
		if (sep !== -1) {
			const cursorUpdatedAt = cursor.slice(0, sep);
			const cursorId = cursor.slice(sep + 2);
			cursorWhere = {
				OR: [
					{ updated_at: { lt: cursorUpdatedAt } },
					{ updated_at: cursorUpdatedAt, id: { lt: cursorId } },
				],
			};
		}
	}

	const rows = await getPrismaClient().projects.findMany({
		where: { owner_id: ownerId, ...(cursorWhere ?? {}) },
		orderBy: [{ updated_at: "desc" }, { id: "desc" }],
		take: limit + 1,
		include: { users: { select: { login: true, name: true } } },
	});

	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const nextCursor =
		hasMore && items.length > 0
			? `${items[items.length - 1].updated_at}__${items[items.length - 1].id}`
			: null;

	const ids = items.map((p) => p.id);
	const [metaMap, derivedCoverMap] = await Promise.all([
		loadTemplateMetaMap(ids),
		loadDerivedTemplateCoverMap(ids),
	]);
	return {
		items: items.map((row) => mapProjectRow(row, metaMap, derivedCoverMap)),
		nextCursor,
	};
}

function buildProjectPageCursorSql(
	params: ProjectPageParams,
	bindings: unknown[],
): string {
	const cursor = parseProjectCursor(params.cursor);
	if (!cursor) return "";
	bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
	return `
		AND (
			p.updated_at < ?
			OR (p.updated_at = ? AND p.id < ?)
		)`;
}

async function hydrateProjectPage(
	rows: PaginatedProjectDbRow[],
	userId: string,
	limit: number,
): Promise<{ items: ProjectRow[]; nextCursor: string | null }> {
	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const projectIds = pageRows.map((row) => row.id);
	const [metaMap, derivedCoverMap] = await Promise.all([
		loadTemplateMetaMap(projectIds),
		loadDerivedTemplateCoverMap(projectIds),
	]);
	const items = pageRows.map((row) =>
		attachAccess(
			mapProjectRow(
				{
					...row,
					users: { login: row.owner_login, name: row.owner_name },
				},
				metaMap,
				derivedCoverMap,
			),
			{
				teamId: row.team_id,
				teamShared: Boolean(row.team_id),
				access: row.owner_id === userId ? "owner" : "team_edit",
			},
		),
	);
	return {
		items,
		nextCursor: hasMore && items.length > 0
			? createProjectCursor(items[items.length - 1])
			: null,
	};
}

async function queryAccessibleProjectPage(
	db: PrismaClient,
	userId: string,
	params: ProjectPageParams,
): Promise<PaginatedProjectDbRow[]> {
	const bindings: unknown[] = [userId, userId];
	const cursorSql = buildProjectPageCursorSql(params, bindings);
	bindings.push(params.limit + 1);
	return queryAll<PaginatedProjectDbRow>(
		db,
		`WITH accessible_shares AS (
			SELECT DISTINCT ON (s.project_id)
				s.project_id,
				s.team_id
			FROM team_project_shares s
			JOIN team_memberships m ON m.team_id = s.team_id
			WHERE m.user_id = ?
			ORDER BY s.project_id, s.updated_at ASC, s.team_id ASC
		)
		SELECT
			p.id,
			p.name,
			p.is_public,
			p.owner_id,
			p.clone_count,
			p.sort_weight,
			p.created_at,
			p.updated_at,
			p.active_workflow,
			p.project_kind,
			u.login AS owner_login,
			u.name AS owner_name,
			s.team_id
		FROM projects p
		LEFT JOIN users u ON u.id = p.owner_id
		LEFT JOIN accessible_shares s ON s.project_id = p.id
		WHERE (p.owner_id = ? OR s.project_id IS NOT NULL)
		${cursorSql}
		ORDER BY p.updated_at DESC, p.id DESC
		LIMIT ?`,
		bindings,
	);
}

async function queryTeamProjectPage(
	db: PrismaClient,
	userId: string,
	teamId: string,
	params: ProjectPageParams,
): Promise<PaginatedProjectDbRow[]> {
	const bindings: unknown[] = [userId, teamId];
	const cursorSql = buildProjectPageCursorSql(params, bindings);
	bindings.push(params.limit + 1);
	return queryAll<PaginatedProjectDbRow>(
		db,
		`SELECT
			p.id,
			p.name,
			p.is_public,
			p.owner_id,
			p.clone_count,
			p.sort_weight,
			p.created_at,
			p.updated_at,
			p.active_workflow,
			p.project_kind,
			u.login AS owner_login,
			u.name AS owner_name,
			s.team_id
		FROM team_project_shares s
		JOIN team_memberships m
			ON m.team_id = s.team_id
			AND m.user_id = ?
		JOIN projects p ON p.id = s.project_id
		LEFT JOIN users u ON u.id = p.owner_id
		WHERE s.team_id = ?
		${cursorSql}
		ORDER BY p.updated_at DESC, p.id DESC
		LIMIT ?`,
		bindings,
	);
}

export async function listProjectsAccessibleByUserPaginated(
	db: PrismaClient,
	userId: string,
	params: ProjectPageParams,
): Promise<{ items: ProjectRow[]; nextCursor: string | null }> {
	const rows = await queryAccessibleProjectPage(db, userId, params);
	return hydrateProjectPage(rows, userId, params.limit);
}

export async function listProjectsForTeamPaginated(
	db: PrismaClient,
	userId: string,
	teamId: string,
	params: ProjectPageParams,
): Promise<{ items: ProjectRow[]; nextCursor: string | null }> {
	const rows = await queryTeamProjectPage(db, userId, teamId, params);
	return hydrateProjectPage(rows, userId, params.limit);
}

export async function listPublicProjects(db: PrismaClient): Promise<ProjectRow[]> {
	void db;
	const projects = await getPrismaClient().projects.findMany({
		where: { is_public: 1 },
		orderBy: [{ sort_weight: "desc" }, { clone_count: "desc" }, { updated_at: "desc" }],
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	const metaMap = await loadTemplateMetaMap(projects.map((p) => p.id));
	const derivedCoverMap = await loadDerivedTemplateCoverMap(
		projects.map((p) => p.id),
	);
	return projects.map((row) => mapProjectRow(row, metaMap, derivedCoverMap));
}

export async function getProjectById(
	db: PrismaClient,
	projectId: string,
): Promise<ProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findUnique({
		where: { id: projectId },
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	if (!row) return null;
	const metaMap = await loadTemplateMetaMap([row.id]);
	const derivedCoverMap = await loadDerivedTemplateCoverMap([row.id]);
	return mapProjectRow(row, metaMap, derivedCoverMap);
}

export async function getProjectForOwner(
	db: PrismaClient,
	projectId: string,
	ownerId: string,
): Promise<ProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findFirst({
		where: { id: projectId, owner_id: ownerId },
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	if (!row) return null;
	const metaMap = await loadTemplateMetaMap([row.id]);
	const derivedCoverMap = await loadDerivedTemplateCoverMap([row.id]);
	return mapProjectRow(row, metaMap, derivedCoverMap);
}

export async function getProjectForUserAccess(
	db: PrismaClient,
	projectId: string,
	userId: string,
): Promise<ProjectRow | null> {
	const owned = await getProjectForOwner(db, projectId, userId);
	if (owned) {
		const share = await getTeamProjectShareForUser(db, { projectId, userId });
		return attachAccess(owned, {
			access: "owner",
			teamShared: !!share,
			teamId: share?.team_id ?? null,
		});
	}
	const share = await getTeamProjectShareForUser(db, { projectId, userId });
	if (!share) return null;
	const row = await getProjectById(db, projectId);
	if (!row) return null;
	return attachAccess(row, {
		teamId: share.team_id,
		teamShared: true,
		access: "team_edit",
	});
}

export async function findLatestProjectForOwnerByNamePrefix(
	db: PrismaClient,
	input: {
		ownerId: string;
		namePrefix: string;
		excludeProjectId?: string;
	},
): Promise<ProjectRow | null> {
	void db;
	const row = await getPrismaClient().projects.findFirst({
		where: {
			owner_id: input.ownerId,
			name: { startsWith: input.namePrefix },
			...(input.excludeProjectId
				? { id: { not: input.excludeProjectId } }
				: {}),
		},
		orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
		include: {
			users: { select: { login: true, name: true } },
		},
	});
	if (!row) return null;
	const metaMap = await loadTemplateMetaMap([row.id]);
	const derivedCoverMap = await loadDerivedTemplateCoverMap([row.id]);
	return mapProjectRow(row, metaMap, derivedCoverMap);
}

export async function createProject(
	db: PrismaClient,
	params: { id: string; name: string; ownerId: string; nowIso: string },
): Promise<ProjectRow> {
	void db;
	const { id, name, ownerId, nowIso } = params;
	await getPrismaClient().projects.create({
		data: {
			id,
			name,
			is_public: 0,
			owner_id: ownerId,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getProjectById(db, id);
	if (!row) {
		throw new Error("Failed to load created project");
	}
	return row;
}

export async function updateProjectName(
	db: PrismaClient,
	params: { id: string; name: string; nowIso: string },
): Promise<ProjectRow | null> {
	void db;
	await getPrismaClient().projects.update({
		where: { id: params.id },
		data: { name: params.name, updated_at: params.nowIso },
	});
	return getProjectById(db, params.id);
}

export async function updateProjectPublic(
	db: PrismaClient,
	params: { id: string; isPublic: boolean; nowIso: string },
): Promise<ProjectRow | null> {
	void db;
	await getPrismaClient().projects.update({
		where: { id: params.id },
		data: { is_public: params.isPublic ? 1 : 0, updated_at: params.nowIso },
	});
	return getProjectById(db, params.id);
}

export async function incrementProjectCloneCount(projectId: string): Promise<void> {
	await getPrismaClient().projects.update({
		where: { id: projectId },
		data: { clone_count: { increment: 1 } },
	});
}

export async function updateProjectSortWeight(
	projectId: string,
	sortWeight: number,
): Promise<void> {
	await getPrismaClient().projects.update({
		where: { id: projectId },
		data: { sort_weight: sortWeight },
	});
}

export async function deleteProjectById(
	db: PrismaClient,
	projectId: string,
): Promise<void> {
	void db;
	await deleteProjectGraph(projectId);
}

export const VALID_WORKFLOWS = [
	"free_canvas",
	"story_film",
	"character_creation",
	"scene_creation",
	"ip_creation",
	"quick_image",
	"quick_video",
	"music_video",
] as const;

export type ActiveWorkflow = (typeof VALID_WORKFLOWS)[number];

export function isValidWorkflow(value: unknown): value is ActiveWorkflow {
	return typeof value === "string" && (VALID_WORKFLOWS as readonly string[]).includes(value);
}

export async function updateProjectWorkflow(
	projectId: string,
	workflow: ActiveWorkflow,
): Promise<ProjectRow | null> {
	await getPrismaClient().projects.update({
		where: { id: projectId },
		data: { active_workflow: workflow },
	});
	return getProjectById(getPrismaClient(), projectId);
}
