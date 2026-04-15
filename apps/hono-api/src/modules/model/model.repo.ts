import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type ProviderRow = {
	id: string;
	name: string;
	vendor: string;
	base_url: string | null;
	shared_base_url: number;
	owner_id: string;
	created_at: string;
	updated_at: string;
};

export type TokenRow = {
	id: string;
	provider_id: string;
	label: string;
	secret_token: string;
	user_agent: string | null;
	user_id: string;
	enabled: number;
	shared: number;
	shared_failure_count: number;
	shared_last_failure_at: string | null;
	shared_disabled_until: string | null;
	created_at: string;
	updated_at: string;
};

export type EndpointRow = {
	id: string;
	provider_id: string;
	key: string;
	label: string;
	base_url: string;
	shared: number;
	created_at: string;
	updated_at: string;
};

export type ProxyProviderRow = {
	id: string;
	owner_id: string;
	name: string;
	vendor: string;
	base_url: string | null;
	api_key: string | null;
	enabled: number;
	enabled_vendors: string | null;
	settings: string | null;
	created_at: string;
	updated_at: string;
};

export async function listProvidersForUser(
	db: PrismaClient,
	userId: string,
): Promise<ProviderRow[]> {
	void db;
	return getPrismaClient().model_providers.findMany({
		where: { owner_id: userId },
		orderBy: { created_at: "asc" },
	});
}

export async function getProviderByIdForUser(
	db: PrismaClient,
	id: string,
	userId: string,
): Promise<ProviderRow | null> {
	void db;
	return getPrismaClient().model_providers.findFirst({
		where: { id, owner_id: userId },
	});
}

export async function upsertProviderRow(
	db: PrismaClient,
	userId: string,
	input: {
		id?: string;
		name: string;
		vendor: string;
		baseUrl?: string | null;
		sharedBaseUrl?: boolean;
	},
	nowIso: string,
): Promise<ProviderRow> {
	void db;
	const prisma = getPrismaClient();

	if (input.id) {
		const existing = await getProviderByIdForUser(db, input.id, userId);
		if (!existing) {
			throw new Error("provider not found or unauthorized");
		}
		await prisma.model_providers.update({
			where: { id: input.id },
			data: {
				name: input.name,
				vendor: input.vendor,
				base_url: input.baseUrl ?? null,
				shared_base_url: input.sharedBaseUrl ? 1 : 0,
				updated_at: nowIso,
			},
		});
		const row = await prisma.model_providers.findUnique({
			where: { id: input.id },
		});
		if (!row) throw new Error("provider update failed");
		return row;
	}

	const id = crypto.randomUUID();
	await prisma.model_providers.create({
		data: {
			id,
			name: input.name,
			vendor: input.vendor,
			base_url: input.baseUrl ?? null,
			shared_base_url: input.sharedBaseUrl ? 1 : 0,
			owner_id: userId,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await prisma.model_providers.findUnique({ where: { id } });
	if (!row) throw new Error("provider create failed");
	return row;
}

export async function listTokensForProvider(
	db: PrismaClient,
	providerId: string,
	userId: string,
): Promise<TokenRow[]> {
	void db;
	return getPrismaClient().model_tokens.findMany({
		where: { provider_id: providerId, user_id: userId },
		orderBy: { created_at: "asc" },
	});
}

export async function getTokenById(
	db: PrismaClient,
	id: string,
): Promise<TokenRow | null> {
	void db;
	return getPrismaClient().model_tokens.findUnique({ where: { id } });
}

export async function upsertTokenRow(
	db: PrismaClient,
	userId: string,
	input: {
		id?: string;
		providerId: string;
		label: string;
		secretToken: string;
		userAgent?: string | null;
		enabled?: boolean;
		shared?: boolean;
	},
	nowIso: string,
): Promise<TokenRow> {
	void db;
	const prisma = getPrismaClient();

	if (input.id) {
		const existing = await getTokenById(db, input.id);
		if (!existing || existing.user_id !== userId) {
			throw new Error("token not found or unauthorized");
		}
		await prisma.model_tokens.update({
			where: { id: input.id },
			data: {
				label: input.label,
				secret_token: input.secretToken,
				user_agent: input.userAgent ?? null,
				enabled: input.enabled ?? true ? 1 : 0,
				shared: input.shared ?? false ? 1 : 0,
				updated_at: nowIso,
			},
		});
		const row = await prisma.model_tokens.findUnique({ where: { id: input.id } });
		if (!row) throw new Error("token update failed");
		return row;
	}

	const id = crypto.randomUUID();
	await prisma.model_tokens.create({
		data: {
			id,
			provider_id: input.providerId,
			label: input.label,
			secret_token: input.secretToken,
			user_agent: input.userAgent ?? null,
			user_id: userId,
			enabled: input.enabled ?? true ? 1 : 0,
			shared: input.shared ?? false ? 1 : 0,
			shared_failure_count: 0,
			shared_last_failure_at: null,
			shared_disabled_until: null,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await prisma.model_tokens.findUnique({ where: { id } });
	if (!row) throw new Error("token create failed");
	return row;
}

export async function deleteTokenRow(
	db: PrismaClient,
	id: string,
	userId: string,
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	const existing = await prisma.model_tokens.findUnique({ where: { id } });
	if (!existing || existing.user_id !== userId) {
		throw new Error("token not found or unauthorized");
	}
	await prisma.$transaction([
		prisma.task_token_mappings.deleteMany({ where: { token_id: id } }),
		prisma.model_tokens.delete({ where: { id } }),
	]);
}

export async function listEndpointsForProvider(
	db: PrismaClient,
	providerId: string,
	userId: string,
): Promise<EndpointRow[]> {
	void db;
	return getPrismaClient().model_endpoints.findMany({
		where: {
			provider_id: providerId,
			model_providers: { owner_id: userId },
		},
		orderBy: { created_at: "asc" },
	});
}

export async function getEndpointById(
	db: PrismaClient,
	id: string,
): Promise<EndpointRow | null> {
	void db;
	return getPrismaClient().model_endpoints.findUnique({
		where: { id },
	});
}

export async function upsertEndpointRow(
	db: PrismaClient,
	input: {
		id?: string;
		providerId: string;
		key: string;
		label: string;
		baseUrl: string;
		shared?: boolean;
	},
	nowIso: string,
): Promise<EndpointRow> {
	void db;
	const prisma = getPrismaClient();

	if (input.id) {
		const existing = await getEndpointById(db, input.id);
		if (!existing) {
			throw new Error("endpoint not found");
		}
		await prisma.model_endpoints.update({
			where: { id: input.id },
			data: {
				label: input.label,
				base_url: input.baseUrl,
				shared: input.shared ?? false ? 1 : 0,
				updated_at: nowIso,
			},
		});
		const row = await prisma.model_endpoints.findUnique({
			where: { id: input.id },
		});
		if (!row) throw new Error("endpoint update failed");
		return row;
	}

	const id = crypto.randomUUID();
	await prisma.model_endpoints.create({
		data: {
			id,
			provider_id: input.providerId,
			key: input.key,
			label: input.label,
			base_url: input.baseUrl,
			shared: input.shared ?? false ? 1 : 0,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await prisma.model_endpoints.findUnique({ where: { id } });
	if (!row) throw new Error("endpoint create failed");
	return row;
}

export async function getProxyConfigRow(
	db: PrismaClient,
	userId: string,
	vendor: string,
): Promise<ProxyProviderRow | null> {
	void db;
	return getPrismaClient().proxy_providers.findUnique({
		where: {
			owner_id_vendor: {
				owner_id: userId,
				vendor: vendor.toLowerCase(),
			},
		},
	});
}

export async function upsertProxyConfigRow(
	db: PrismaClient,
	userId: string,
	input: {
		vendor: string;
		name?: string;
		baseUrl?: string | null;
		apiKey?: string | null;
		enabled?: boolean;
		enabledVendors?: string[];
	},
	nowIso: string,
): Promise<ProxyProviderRow> {
	void db;
	const prisma = getPrismaClient();
	const vendor = input.vendor.trim().toLowerCase();
	const existing = await getProxyConfigRow(db, userId, vendor);
	const name = input.name?.trim() || vendor.toUpperCase();
	const baseUrl = input.baseUrl?.trim() || null;
	const enabled = input.enabled ?? true;
	const enabledVendorsJson = JSON.stringify(
		Array.isArray(input.enabledVendors)
			? Array.from(new Set(input.enabledVendors))
			: [],
	);

	if (existing) {
		const apiKey =
			typeof input.apiKey === "string"
				? input.apiKey.trim() || null
				: existing.api_key;
		await prisma.proxy_providers.update({
			where: { id: existing.id },
			data: {
				name,
				base_url: baseUrl,
				api_key: apiKey,
				enabled: enabled ? 1 : 0,
				enabled_vendors: enabledVendorsJson,
				updated_at: nowIso,
			},
		});
		const row = await getProxyConfigRow(db, userId, vendor);
		if (!row) throw new Error("proxy update failed");
		return row;
	}

	const id = crypto.randomUUID();
	const apiKey =
		typeof input.apiKey === "string"
			? input.apiKey.trim() || null
			: null;
	await prisma.proxy_providers.create({
		data: {
			id,
			owner_id: userId,
			name,
			vendor,
			base_url: baseUrl,
			api_key: apiKey,
			enabled: enabled ? 1 : 0,
			enabled_vendors: enabledVendorsJson,
			settings: null,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getProxyConfigRow(db, userId, vendor);
	if (!row) throw new Error("proxy create failed");
	return row;
}
