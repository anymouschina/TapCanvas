import type { D1Database } from "../../types";
import { queryAll, queryOne, execute } from "../../db/db";

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
	db: D1Database,
	userId: string,
): Promise<ProviderRow[]> {
	return queryAll<ProviderRow>(
		db,
		`SELECT * FROM model_providers WHERE owner_id = ? ORDER BY created_at ASC`,
		[userId],
	);
}

export async function getProviderByIdForUser(
	db: D1Database,
	id: string,
	userId: string,
): Promise<ProviderRow | null> {
	return queryOne<ProviderRow>(
		db,
		`SELECT * FROM model_providers WHERE id = ? AND owner_id = ?`,
		[id, userId],
	);
}

export async function upsertProviderRow(
	db: D1Database,
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
	if (input.id) {
		const existing = await getProviderByIdForUser(db, input.id, userId);
		if (!existing) {
			throw new Error("provider not found or unauthorized");
		}
		await execute(
			db,
			`UPDATE model_providers
       SET name = ?, vendor = ?, base_url = ?, shared_base_url = ?, updated_at = ?
       WHERE id = ?`,
			[
				input.name,
				input.vendor,
				input.baseUrl ?? null,
				input.sharedBaseUrl ? 1 : 0,
				nowIso,
				input.id,
			],
		);
		const row = await queryOne<ProviderRow>(
			db,
			`SELECT * FROM model_providers WHERE id = ?`,
			[input.id],
		);
		if (!row) throw new Error("provider update failed");
		return row;
	}

	const id = crypto.randomUUID();
	await execute(
		db,
		`INSERT INTO model_providers
       (id, name, vendor, base_url, shared_base_url, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.name,
			input.vendor,
			input.baseUrl ?? null,
			input.sharedBaseUrl ? 1 : 0,
			userId,
			nowIso,
			nowIso,
		],
	);
	const row = await queryOne<ProviderRow>(
		db,
		`SELECT * FROM model_providers WHERE id = ?`,
		[id],
	);
	if (!row) throw new Error("provider create failed");
	return row;
}

export async function listTokensForProvider(
	db: D1Database,
	providerId: string,
	userId: string,
): Promise<TokenRow[]> {
	return queryAll<TokenRow>(
		db,
		`SELECT * FROM model_tokens WHERE provider_id = ? AND user_id = ? ORDER BY created_at ASC`,
		[providerId, userId],
	);
}

export async function getTokenById(
	db: D1Database,
	id: string,
): Promise<TokenRow | null> {
	return queryOne<TokenRow>(
		db,
		`SELECT * FROM model_tokens WHERE id = ?`,
		[id],
	);
}

export async function upsertTokenRow(
	db: D1Database,
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
	if (input.id) {
		const existing = await getTokenById(db, input.id);
		if (!existing || existing.user_id !== userId) {
			throw new Error("token not found or unauthorized");
		}
		await execute(
			db,
			`UPDATE model_tokens
       SET label = ?, secret_token = ?, user_agent = ?, enabled = ?, shared = ?, updated_at = ?
       WHERE id = ?`,
			[
				input.label,
				input.secretToken,
				input.userAgent ?? null,
				input.enabled ?? true ? 1 : 0,
				input.shared ?? false ? 1 : 0,
				nowIso,
				input.id,
			],
		);
		const row = await getTokenById(db, input.id);
		if (!row) throw new Error("token update failed");
		return row;
	}

	const id = crypto.randomUUID();
	await execute(
		db,
		`INSERT INTO model_tokens
       (id, provider_id, label, secret_token, user_agent, user_id, enabled, shared,
        shared_failure_count, shared_last_failure_at, shared_disabled_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
		[
			id,
			input.providerId,
			input.label,
			input.secretToken,
			input.userAgent ?? null,
			userId,
			input.enabled ?? true ? 1 : 0,
			input.shared ?? false ? 1 : 0,
			nowIso,
			nowIso,
		],
	);
	const row = await getTokenById(db, id);
	if (!row) throw new Error("token create failed");
	return row;
}

export async function deleteTokenRow(
	db: D1Database,
	id: string,
	userId: string,
): Promise<void> {
	const existing = await getTokenById(db, id);
	if (!existing || existing.user_id !== userId) {
		throw new Error("token not found or unauthorized");
	}
	await execute(
		db,
		`DELETE FROM task_token_mappings WHERE token_id = ?`,
		[id],
	);
	await execute(db, `DELETE FROM model_tokens WHERE id = ?`, [id]);
}

export async function listEndpointsForProvider(
	db: D1Database,
	providerId: string,
	userId: string,
): Promise<EndpointRow[]> {
	return queryAll<EndpointRow>(
		db,
		`SELECT e.*
       FROM model_endpoints e
       JOIN model_providers p ON p.id = e.provider_id
       WHERE e.provider_id = ? AND p.owner_id = ?
       ORDER BY e.created_at ASC`,
		[providerId, userId],
	);
}

export async function getEndpointById(
	db: D1Database,
	id: string,
): Promise<EndpointRow | null> {
	return queryOne<EndpointRow>(
		db,
		`SELECT * FROM model_endpoints WHERE id = ?`,
		[id],
	);
}

export async function upsertEndpointRow(
	db: D1Database,
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
	if (input.id) {
		const existing = await getEndpointById(db, input.id);
		if (!existing) {
			throw new Error("endpoint not found");
		}
		await execute(
			db,
			`UPDATE model_endpoints
       SET label = ?, base_url = ?, shared = ?, updated_at = ?
       WHERE id = ?`,
			[
				input.label,
				input.baseUrl,
				input.shared ?? false ? 1 : 0,
				nowIso,
				input.id,
			],
		);
		const row = await getEndpointById(db, input.id);
		if (!row) throw new Error("endpoint update failed");
		return row;
	}

	const id = crypto.randomUUID();
	await execute(
		db,
		`INSERT INTO model_endpoints
       (id, provider_id, key, label, base_url, shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.providerId,
			input.key,
			input.label,
			input.baseUrl,
			input.shared ?? false ? 1 : 0,
			nowIso,
			nowIso,
		],
	);
	const row = await getEndpointById(db, id);
	if (!row) throw new Error("endpoint create failed");
	return row;
}

export async function getProxyConfigRow(
	db: D1Database,
	userId: string,
	vendor: string,
): Promise<ProxyProviderRow | null> {
	return queryOne<ProxyProviderRow>(
		db,
		`SELECT * FROM proxy_providers WHERE owner_id = ? AND vendor = ?`,
		[userId, vendor.toLowerCase()],
	);
}

export async function upsertProxyConfigRow(
	db: D1Database,
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
		await execute(
			db,
			`UPDATE proxy_providers
       SET name = ?, base_url = ?, api_key = ?, enabled = ?, enabled_vendors = ?, updated_at = ?
       WHERE id = ?`,
			[
				name,
				baseUrl,
				apiKey,
				enabled ? 1 : 0,
				enabledVendorsJson,
				nowIso,
				existing.id,
			],
		);
		const row = await getProxyConfigRow(db, userId, vendor);
		if (!row) throw new Error("proxy update failed");
		return row;
	}

	const id = crypto.randomUUID();
	const apiKey =
		typeof input.apiKey === "string"
			? input.apiKey.trim() || null
			: null;
	await execute(
		db,
		`INSERT INTO proxy_providers
       (id, owner_id, name, vendor, base_url, api_key, enabled, enabled_vendors, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
		[
			id,
			userId,
			name,
			vendor,
			baseUrl,
			apiKey,
			enabled ? 1 : 0,
			enabledVendorsJson,
			nowIso,
			nowIso,
		],
	);
	const row = await getProxyConfigRow(db, userId, vendor);
	if (!row) throw new Error("proxy create failed");
	return row;
}

