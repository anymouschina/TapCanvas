import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type ModelProfileRow = {
	id: string;
	owner_id: string;
	provider_id: string;
	name: string;
	kind: string;
	model_key: string;
	settings: string | null;
	created_at: string;
	updated_at: string;
};

export type ModelProfileWithProviderRow = ModelProfileRow & {
	provider_name: string;
	provider_vendor: string;
};

export async function listProfilesForUser(
	db: PrismaClient,
	userId: string,
	filter?: { providerId?: string; kinds?: string[] },
): Promise<ModelProfileWithProviderRow[]> {
	void db;
	const rows = await getPrismaClient().model_profiles.findMany({
		where: {
			owner_id: userId,
			...(filter?.providerId ? { provider_id: filter.providerId } : {}),
			...(filter?.kinds && filter.kinds.length > 0
				? { kind: { in: filter.kinds } }
				: {}),
		},
		include: {
			model_providers: {
				select: { name: true, vendor: true },
			},
		},
		orderBy: { created_at: "asc" },
	});

	return rows.map((row) => ({
		id: row.id,
		owner_id: row.owner_id,
		provider_id: row.provider_id,
		name: row.name,
		kind: row.kind,
		model_key: row.model_key,
		settings: row.settings,
		created_at: row.created_at,
		updated_at: row.updated_at,
		provider_name: row.model_providers.name,
		provider_vendor: row.model_providers.vendor,
	}));
}

export async function getProfileByIdForUser(
	db: PrismaClient,
	id: string,
	userId: string,
): Promise<ModelProfileRow | null> {
	void db;
	return getPrismaClient().model_profiles.findFirst({
		where: { id, owner_id: userId },
	});
}

export async function upsertProfileRow(
	db: PrismaClient,
	userId: string,
	input: {
		id?: string;
		providerId: string;
		name: string;
		kind: string;
		modelKey: string;
		settings?: unknown;
	},
	nowIso: string,
): Promise<ModelProfileRow> {
	void db;
	const prisma = getPrismaClient();
	const normalizedName = input.name.trim() || input.modelKey.trim();
	const normalizedModelKey = input.modelKey.trim();
	const settingsJson =
		typeof input.settings === "undefined"
			? null
			: JSON.stringify(input.settings ?? null);

	if (input.id) {
		const existing = await getProfileByIdForUser(db, input.id, userId);
		if (!existing) {
			throw new Error("profile not found or unauthorized");
		}
		await prisma.model_profiles.update({
			where: { id: input.id },
			data: {
				name: normalizedName,
				kind: input.kind,
				model_key: normalizedModelKey,
				settings: settingsJson,
				updated_at: nowIso,
			},
		});
		const row = await getProfileByIdForUser(db, input.id, userId);
		if (!row) {
			throw new Error("profile update failed");
		}
		return row;
	}

	const id = crypto.randomUUID();
	await prisma.model_profiles.create({
		data: {
			id,
			owner_id: userId,
			provider_id: input.providerId,
			name: normalizedName,
			kind: input.kind,
			model_key: normalizedModelKey,
			settings: settingsJson,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getProfileByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("profile create failed");
	}
	return row;
}

export async function deleteProfileRow(
	db: PrismaClient,
	id: string,
	userId: string,
): Promise<void> {
	void db;
	const existing = await getProfileByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("profile not found or unauthorized");
	}
	await getPrismaClient().model_profiles.delete({ where: { id } });
}
