import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	assertGenericAssetDataAllowed,
	assertGenericAssetRowMutationAllowed,
} from "../project-directory/project-directory.generic-asset-guard";
import { syncProjectAssetMemoryInDb } from "../memory/project-asset-memory";

export type AssetRow = {
	id: string;
	name: string;
	data: string | null;
	owner_id: string;
	project_id: string | null;
	created_at: string;
	updated_at: string;
};

export type PublicAssetRow = AssetRow & {
	owner_login: string | null;
	owner_name: string | null;
	owner_avatar_url: string | null;
	project_name: string | null;
};

function jsonStringLiteral(value: string): string {
	return JSON.stringify(value);
}

export async function findGeneratedAssetBySourceUrl(
	db: PrismaClient,
	userId: string,
	input: {
		sourceUrl: string;
		projectId: string | null;
		taskId?: string | null;
	},
): Promise<AssetRow | null> {
	void db;
	const trimmed = input.sourceUrl.trim();
	if (!trimmed) return null;

	const sourceMarker = `"sourceUrl":${jsonStringLiteral(trimmed)}`;
	const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
	return getPrismaClient().assets.findFirst({
		where: {
			owner_id: userId,
			project_id: input.projectId,
			data: {
				contains: `"kind":"generation"`,
			},
			AND: [
				{ data: { contains: sourceMarker } },
				...(taskId
					? [{ data: { contains: `"taskId":${jsonStringLiteral(taskId)}` } }]
					: []),
			],
		},
		orderBy: { created_at: "desc" },
	});
}

export async function listAssetsForUser(
	db: PrismaClient,
	userId: string,
	params?: {
		limit?: number;
		cursor?: string | null;
		projectId?: string | null;
		projectIds?: string[];
		kind?: string | null;
	},
): Promise<AssetRow[]> {
	void db;
	const rawLimit = params?.limit;
	const normalizedLimit =
		typeof rawLimit === "number" && !Number.isNaN(rawLimit) ? rawLimit : 10;
	const limit = Math.max(1, Math.min(normalizedLimit, 200));
	const cursor = params?.cursor ? String(params.cursor) : null;
	const projectId = params?.projectId ? String(params.projectId) : null;
	const projectIds = Array.from(
		new Set(
			(params?.projectIds || [])
				.map((value) => String(value).trim())
				.filter(Boolean),
		),
	).slice(0, 100);
	const kind = params?.kind ? String(params.kind).trim() : null;

	return getPrismaClient().assets.findMany({
		where: {
			owner_id: userId,
			...(projectIds.length > 0
				? { project_id: { in: projectIds } }
				: projectId
					? { project_id: projectId }
					: {}),
			...(kind
				? {
						data: {
							contains: `"kind":${jsonStringLiteral(kind)}`,
						},
					}
				: {}),
			...(cursor ? { created_at: { lt: cursor } } : {}),
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function listAssetsForUserByKind(
	db: PrismaClient,
	userId: string,
	input: {
		kind: string;
		projectId?: string | null;
		limit?: number;
	},
): Promise<AssetRow[]> {
	void db;
	const kind = String(input.kind || "").trim();
	if (!kind) return [];
	const rawLimit = input.limit;
	const limit =
		typeof rawLimit === "number" && Number.isFinite(rawLimit)
			? Math.max(1, Math.min(Math.trunc(rawLimit), 5000))
			: 2000;
	const projectId = input.projectId ? String(input.projectId) : null;
	return getPrismaClient().assets.findMany({
		where: {
			owner_id: userId,
			...(projectId ? { project_id: projectId } : {}),
			data: {
				contains: `"kind":${jsonStringLiteral(kind)}`,
			},
		},
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function getAssetByIdForUser(
	db: PrismaClient,
	id: string,
	userId: string,
): Promise<AssetRow | null> {
	void db;
	return getPrismaClient().assets.findFirst({
		where: { id, owner_id: userId },
	});
}

export async function createAssetRow(
	db: PrismaClient,
	userId: string,
	input: { name: string; data: unknown; projectId?: string | null },
	nowIso: string,
): Promise<AssetRow> {
	assertGenericAssetDataAllowed(input.data, "create");
	const id = crypto.randomUUID();
	await getPrismaClient().assets.create({
		data: {
			id,
			name: input.name,
			data: JSON.stringify(input.data ?? null),
			owner_id: userId,
			project_id: input.projectId ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getAssetByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("asset create failed");
	}
	await syncProjectAssetMemoryInDb(db, {
		userId,
		projectId: row.project_id,
		assetId: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		updatedAt: row.updated_at,
	});
	return row;
}

export async function updateAssetDataRow(
	db: PrismaClient,
	userId: string,
	id: string,
	data: unknown,
	nowIso: string,
): Promise<void> {
	const existing = await getAssetByIdForUser(db, id, userId);
	if (existing) {
		assertGenericAssetRowMutationAllowed(existing.data, "update_data", id);
		assertGenericAssetDataAllowed(data, "update_data", id);
	}
	await getPrismaClient().assets.updateMany({
		where: { id, owner_id: userId },
		data: { data: JSON.stringify(data ?? null), updated_at: nowIso },
	});
	if (existing) {
		await syncProjectAssetMemoryInDb(db, {
			userId,
			projectId: existing.project_id,
			assetId: existing.id,
			name: existing.name,
			data,
			updatedAt: nowIso,
		});
	}
}

export async function renameAssetRow(
	db: PrismaClient,
	userId: string,
	id: string,
	name: string,
	nowIso: string,
): Promise<AssetRow> {
	const existing = await getAssetByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("asset not found or unauthorized");
	}
	assertGenericAssetRowMutationAllowed(existing.data, "rename", id);
	await getPrismaClient().assets.update({
		where: { id },
		data: {
			name,
			updated_at: nowIso,
		},
	});
	const row = await getAssetByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("asset rename failed");
	}
	await syncProjectAssetMemoryInDb(db, {
		userId,
		projectId: row.project_id,
		assetId: row.id,
		name: row.name,
		data: row.data ? JSON.parse(row.data) : null,
		updatedAt: row.updated_at,
	});
	return row;
}

export async function deleteAssetRow(
	db: PrismaClient,
	userId: string,
	id: string,
): Promise<void> {
	void db;
	const existing = await getAssetByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("asset not found or unauthorized");
	}
	assertGenericAssetRowMutationAllowed(existing.data, "delete", id);
	await getPrismaClient().assets.delete({ where: { id } });
}

export async function deleteBookPointerAssetsForUser(
	db: PrismaClient,
	userId: string,
	projectId: string,
	bookId: string,
): Promise<void> {
	void db;
	await getPrismaClient().assets.deleteMany({
		where: {
			owner_id: userId,
			project_id: projectId,
			data: {
				contains: `"kind":"novelBook"`,
			},
			AND: {
				data: {
					contains: `"bookId":${jsonStringLiteral(bookId)}`,
				},
			},
		},
	});
}

export async function listPublicAssets(
	db: PrismaClient,
	params?: {
		limit?: number;
		scope?: "all" | "public_projects";
	},
): Promise<PublicAssetRow[]> {
	void db;
	const rawLimit = params?.limit;
	const limit =
		typeof rawLimit === "number" && !Number.isNaN(rawLimit)
			? Math.max(1, Math.min(rawLimit, 96))
			: 48;
	const scope = params?.scope === "all" ? "all" : "public_projects";

	const rows = await getPrismaClient().assets.findMany({
		where:
			scope === "all"
				? undefined
				: {
						project_id: { not: null },
						projects: {
							is: {
								is_public: 1,
							},
						},
					},
		orderBy: { created_at: "desc" },
		take: limit,
		include: {
			users: { select: { login: true, name: true, avatar_url: true } },
			projects: { select: { name: true } },
		},
	});

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		data: row.data,
		owner_id: row.owner_id,
		project_id: row.project_id,
		created_at: row.created_at,
		updated_at: row.updated_at,
		owner_login: row.users.login,
		owner_name: row.users.name,
		owner_avatar_url: row.users.avatar_url,
		project_name: row.projects?.name ?? null,
	}));
}

// 发布快照查询：Tv show 只认 publishRecord 本身（发布即公开），
// 不 join 原项目 is_public——原项目改名/转私密/删除都不影响已发布作品。
export async function listPublishRecordAssets(
	params?: { limit?: number },
): Promise<PublicAssetRow[]> {
	const rawLimit = params?.limit;
	const limit =
		typeof rawLimit === "number" && !Number.isNaN(rawLimit)
			? Math.max(1, Math.min(rawLimit, 96))
			: 48;
	const rows = await getPrismaClient().assets.findMany({
		where: { data: { contains: '"kind":"publishRecord"' } },
		orderBy: { created_at: "desc" },
		take: limit,
		include: {
			users: { select: { login: true, name: true, avatar_url: true } },
			projects: { select: { name: true } },
		},
	});
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		data: row.data,
		owner_id: row.owner_id,
		project_id: row.project_id,
		created_at: row.created_at,
		updated_at: row.updated_at,
		owner_login: row.users.login,
		owner_name: row.users.name,
		owner_avatar_url: row.users.avatar_url,
		project_name: row.projects?.name ?? null,
	}));
}

// 发布快照卡片的互动数据来自社区侧源项目。快照与项目仍是脱钩语义：
// 查不到项目时快照照常展示，但不提供项目级互动能力。
export async function listProjectsTvInfo(
	ids: string[],
	viewerId?: string,
): Promise<Array<{
	id: string;
	like_count: number;
	favorite_count: number;
	is_public: number;
	favorited: boolean;
}>> {
	if (!ids.length) return [];
	const db = getPrismaClient();
	const [projects, favorites] = await Promise.all([
		db.projects.findMany({
			where: { id: { in: ids } },
			select: {
				id: true,
				like_count: true,
				favorite_count: true,
				is_public: true,
			},
		}),
		viewerId
			? db.project_favorites.findMany({
				where: { user_id: viewerId, project_id: { in: ids } },
				select: { project_id: true },
			})
			: Promise.resolve([]),
	]);
	const favoriteIds = new Set(favorites.map((favorite) => favorite.project_id));
	return projects.map((project) => ({
		...project,
		favorited: favoriteIds.has(project.id),
	}));
}

export async function getGlobalAssetByName(name: string): Promise<{ id: string; data: string | null } | null> {
	const row = await getPrismaClient().assets.findFirst({
		where: { name },
		orderBy: { created_at: "desc" },
		select: { id: true, data: true },
	});
	return row ?? null;
}
