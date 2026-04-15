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
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
};

export async function listApiKeysForOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<ApiKeyRow[]> {
	void db;
	return getPrismaClient().api_keys.findMany({
		where: { owner_id: ownerId },
		orderBy: { created_at: "desc" },
	});
}

export async function getApiKeyByIdForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<ApiKeyRow | null> {
	void db;
	return getPrismaClient().api_keys.findFirst({
		where: { id, owner_id: ownerId },
	});
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
			updated_at: nowIso,
		},
	});

	const row = await getApiKeyByIdForOwner(db, id, ownerId);
	if (!row) throw new Error("api key update failed");
	return row;
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
	await getPrismaClient().api_keys.delete({ where: { id } });
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
