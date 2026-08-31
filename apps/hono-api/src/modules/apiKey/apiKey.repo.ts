import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type ApiKeyRow = {
	id: string;
	owner_id: string;
	label: string;
	key_prefix: string;
	key_hash: string;
	allowed_origins: string;
	enabled: number;
	kind: string;
	billing_team_id: string | null;
	scopes: string;
	expires_at: string | null;
	revoked_at: string | null;
	rotated_from_id: string | null;
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
};

export async function listApiKeysForOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<ApiKeyRow[]> {
	void db;
	const rows = await getPrismaClient().api_keys.findMany({
		where: { owner_id: ownerId, kind: "user" },
		orderBy: { created_at: "desc" },
	});
	return rows;
}

export async function getInternalApiKeyForOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<ApiKeyRow | null> {
	void db;
	const row = await getPrismaClient().api_keys.findFirst({
		where: { owner_id: ownerId, kind: "internal_system" },
	});
	return row ?? null;
}

export async function getApiKeyByIdForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<ApiKeyRow | null> {
	void db;
	const row = await getPrismaClient().api_keys.findFirst({
		where: { id, owner_id: ownerId },
	});
	return row ?? null;
}

export async function getApiKeyByHash(
	db: PrismaClient,
	keyHash: string,
) {
	void db;
	return getPrismaClient().api_keys.findUnique({
		where: { key_hash: keyHash },
	});
}

export async function insertApiKeyRow(
	db: PrismaClient,
	row: ApiKeyRow,
): Promise<void> {
	void db;
	await getPrismaClient().api_keys.create({
		data: {
			id: row.id,
			owner_id: row.owner_id,
			label: row.label,
			key_prefix: row.key_prefix,
			key_hash: row.key_hash,
			allowed_origins: row.allowed_origins,
			enabled: row.enabled,
			kind: row.kind ?? "user",
			billing_team_id: row.billing_team_id ?? null,
			scopes: row.scopes,
			expires_at: row.expires_at,
			revoked_at: row.revoked_at,
			rotated_from_id: row.rotated_from_id,
			last_used_at: row.last_used_at,
			created_at: row.created_at,
			updated_at: row.updated_at,
		},
	});
}

export async function updateApiKeyRow(
	db: PrismaClient,
	ownerId: string,
	id: string,
	input: {
		label: string;
		allowedOriginsJson: string;
		enabled: boolean;
		billingTeamId: string | null;
		scopesJson: string;
		expiresAt: string | null;
	},
	nowIso: string,
): Promise<ApiKeyRow> {
	void db;
	const prisma = getPrismaClient();
	const existing = await getApiKeyByIdForOwner(db, id, ownerId);
	if (!existing) {
		throw new Error("api key not found or unauthorized");
	}

	await prisma.api_keys.update({
		where: { id },
		data: {
			label: input.label,
			allowed_origins: input.allowedOriginsJson,
			enabled: input.enabled ? 1 : 0,
			billing_team_id: input.billingTeamId,
			scopes: input.scopesJson,
			expires_at: input.expiresAt,
			updated_at: nowIso,
		},
	});

	const row = await getApiKeyByIdForOwner(db, id, ownerId);
	if (!row) throw new Error("api key update failed");
	return row;
}

export async function rotateApiKeyRow(
	db: PrismaClient,
	ownerId: string,
	oldId: string,
	replacement: ApiKeyRow,
	nowIso: string,
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	await prisma.$transaction(async (transaction) => {
		const existing = await transaction.api_keys.findFirst({
			where: { id: oldId, owner_id: ownerId, kind: "user" },
		});
		if (!existing || existing.enabled !== 1 || existing.revoked_at) {
			throw new Error("api key not found, unauthorized, or inactive");
		}
		await transaction.api_keys.create({ data: replacement });
		await transaction.api_keys.update({
			where: { id: oldId },
			data: { enabled: 0, revoked_at: nowIso, updated_at: nowIso },
		});
	});
}

export async function deleteApiKeyRow(
	db: PrismaClient,
	ownerId: string,
	id: string,
): Promise<void> {
	void db;
	const existing = await getApiKeyByIdForOwner(db, id, ownerId);
	if (!existing) {
		throw new Error("api key not found or unauthorized");
	}
	const nowIso = new Date().toISOString();
	await getPrismaClient().api_keys.update({
		where: { id },
		data: { enabled: 0, revoked_at: nowIso, updated_at: nowIso },
	});
}

export async function touchApiKeyLastUsedAt(
	db: PrismaClient,
	id: string,
	nowIso: string,
): Promise<void> {
	void db;
	await getPrismaClient().api_keys.update({
		where: { id },
		data: { last_used_at: nowIso },
	});
}
