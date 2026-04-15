import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

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
	project_name: string | null;
};

function jsonStringLiteral(value: string): string {
	return JSON.stringify(value);
}

export async function findGeneratedAssetBySourceUrl(
	db: PrismaClient,
	userId: string,
	sourceUrl: string,
): Promise<AssetRow | null> {
	void db;
	const trimmed = sourceUrl.trim();
	if (!trimmed) return null;

	const marker = `"sourceUrl":${jsonStringLiteral(trimmed)}`;
	return getPrismaClient().assets.findFirst({
		where: {
			owner_id: userId,
			data: {
				contains: `"kind":"generation"`,
			},
			AND: {
				data: {
					contains: marker,
				},
			},
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
	const kind = params?.kind ? String(params.kind).trim() : null;

	return getPrismaClient().assets.findMany({
		where: {
			owner_id: userId,
			...(projectId ? { project_id: projectId } : {}),
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
	void db;
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
	return row;
}

export async function updateAssetDataRow(
	db: PrismaClient,
	userId: string,
	id: string,
	data: unknown,
	nowIso: string,
): Promise<void> {
	void db;
	await getPrismaClient().assets.updateMany({
		where: { id, owner_id: userId },
		data: { data: JSON.stringify(data ?? null), updated_at: nowIso },
	});
}

export async function renameAssetRow(
	db: PrismaClient,
	userId: string,
	id: string,
	name: string,
	nowIso: string,
): Promise<AssetRow> {
	void db;
	const existing = await getAssetByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("asset not found or unauthorized");
	}
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
			users: { select: { login: true, name: true } },
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
		project_name: row.projects?.name ?? null,
	}));
}
