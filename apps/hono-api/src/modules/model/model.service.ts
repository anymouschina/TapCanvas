import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	getEndpointById,
	getProxyConfigRow,
	getProviderByIdForUser,
	getTokenById,
	listEndpointsForProvider,
	listProvidersForUser,
	listTokensForProvider,
	upsertEndpointRow,
	upsertProviderRow,
	upsertProxyConfigRow,
	upsertTokenRow,
	deleteTokenRow,
	type ProviderRow,
	type TokenRow,
	type EndpointRow,
	type ProxyProviderRow,
} from "./model.repo";
import {
	ModelEndpointSchema,
	ModelProviderSchema,
	ModelTokenSchema,
	ProxyConfigSchema,
	ModelProfileSchema,
	AvailableModelSchema,
	ModelExportDataSchema,
	type ModelExportData,
} from "./model.schemas";
import {
	deleteProfileRow,
	listProfilesForUser,
	upsertProfileRow,
} from "./model-profiles.repo";

function mapProvider(row: ProviderRow) {
	return ModelProviderSchema.parse({
		id: row.id,
		name: row.name,
		vendor: row.vendor,
		baseUrl: row.base_url,
		sharedBaseUrl: row.shared_base_url === 1,
	});
}

function mapToken(row: TokenRow) {
	return ModelTokenSchema.parse({
		id: row.id,
		providerId: row.provider_id,
		label: row.label,
		secretToken: row.secret_token,
		userAgent: row.user_agent,
		enabled: row.enabled === 1,
		shared: row.shared === 1,
	});
}

function mapEndpoint(row: EndpointRow) {
	return ModelEndpointSchema.parse({
		id: row.id,
		providerId: row.provider_id,
		key: row.key,
		label: row.label,
		baseUrl: row.base_url,
		shared: row.shared === 1,
	});
}

function mapProxy(row: ProxyProviderRow) {
	let enabledVendors: string[] = [];
	if (row.enabled_vendors) {
		try {
			const parsed = JSON.parse(row.enabled_vendors);
			if (Array.isArray(parsed)) {
				enabledVendors = parsed.filter(
					(v) => typeof v === "string",
				) as string[];
			}
		} catch {
			enabledVendors = [];
		}
	}
	return ProxyConfigSchema.parse({
		id: row.id,
		name: row.name,
		vendor: row.vendor,
		baseUrl: row.base_url || "",
		enabled: row.enabled === 1,
		enabledVendors,
		hasApiKey: !!row.api_key,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

export async function listModelProviders(c: AppContext, userId: string) {
	const rows = await listProvidersForUser(c.env.DB, userId);
	return rows.map(mapProvider);
}

export async function upsertModelProvider(
	c: AppContext,
	userId: string,
	input: {
		id?: string;
		name: string;
		vendor: string;
		baseUrl?: string | null;
		sharedBaseUrl?: boolean;
	},
) {
	const nowIso = new Date().toISOString();
	const row = await upsertProviderRow(c.env.DB, userId, input, nowIso);
	return mapProvider(row);
}

export async function listModelTokens(
	c: AppContext,
	providerId: string,
	userId: string,
) {
	const provider = await getProviderByIdForUser(c.env.DB, providerId, userId);
	if (!provider) {
		throw new AppError("provider not found or unauthorized", {
			status: 404,
			code: "provider_not_found",
		});
	}
	const rows = await listTokensForProvider(c.env.DB, providerId, userId);
	return rows.map(mapToken);
}

export async function upsertModelToken(
	c: AppContext,
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
) {
	const nowIso = new Date().toISOString();
	const row = await upsertTokenRow(c.env.DB, userId, input, nowIso);
	return mapToken(row);
}

export async function deleteModelTokenForUser(
	c: AppContext,
	id: string,
	userId: string,
) {
	await deleteTokenRow(c.env.DB, id, userId);
}

export async function listModelEndpoints(
	c: AppContext,
	providerId: string,
	userId: string,
) {
	const provider = await getProviderByIdForUser(c.env.DB, providerId, userId);
	if (!provider) {
		throw new AppError("provider not found or unauthorized", {
			status: 404,
			code: "provider_not_found",
		});
	}
	const rows = await listEndpointsForProvider(c.env.DB, providerId, userId);
	return rows.map(mapEndpoint);
}

export async function upsertModelEndpoint(
	c: AppContext,
	userId: string,
	input: {
		id?: string;
		providerId: string;
		key: string;
		label: string;
		baseUrl: string;
		shared?: boolean;
	},
) {
	const nowIso = new Date().toISOString();
	// Ensure provider belongs to user
	const provider = await getProviderByIdForUser(
		c.env.DB,
		input.providerId,
		userId,
	);
	if (!provider) {
		throw new AppError("provider not found or unauthorized", {
			status: 404,
			code: "provider_not_found",
		});
	}
	const row = await upsertEndpointRow(c.env.DB, input, nowIso);
	return mapEndpoint(row);
}

export async function getProxyConfigForUser(
	c: AppContext,
	userId: string,
	vendor: string,
) {
	const row = await getProxyConfigRow(c.env.DB, userId, vendor);
	if (!row) return null;
	return mapProxy(row);
}

export async function upsertProxyConfigForUser(
	c: AppContext,
	userId: string,
	input: {
		vendor: string;
		name?: string;
		baseUrl?: string;
		apiKey?: string | null;
		enabled?: boolean;
		enabledVendors?: string[];
	},
) {
	const nowIso = new Date().toISOString();
	const row = await upsertProxyConfigRow(c.env.DB, userId, input, nowIso);
	return mapProxy(row);
}

export async function fetchProxyCredits(
	c: AppContext,
	userId: string,
	vendor: string,
) {
	const cfg = await getProxyConfigRow(c.env.DB, userId, vendor);
	if (!cfg || cfg.enabled === 0) {
		throw new AppError("未启用 grsai 代理，无法获取积分", {
			status: 400,
			code: "proxy_not_enabled",
		});
	}
	const apiKey = (cfg.api_key || "").trim();
	const baseUrlRaw = (cfg.base_url || "").trim();
	if (!apiKey || !baseUrlRaw) {
		throw new AppError("grsai 代理未配置 Host 或 API Key", {
			status: 400,
			code: "proxy_misconfigured",
		});
	}
	const baseUrl = baseUrlRaw.replace(/\/+$/, "");
	const url = new URL(`${baseUrl}/client/common/getCredits`);
	url.searchParams.set("apikey", apiKey);

	let res: Response;
	let data: any = null;
	try {
		res = await fetchWithHttpDebugLog(
			c,
			url.toString(),
			{
			method: "GET",
			},
			{ tag: "proxy:getCredits" },
		);
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("获取积分失败", {
			status: 502,
			code: "proxy_credits_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (!res.ok || data?.code !== 0) {
		const msg =
			(data && (data.msg || data.message || data.error)) ||
			`获取积分失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "proxy_credits_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const credits = Number(data?.data?.credits ?? 0);
	return { credits };
}

export async function fetchProxyModelStatus(
	c: AppContext,
	userId: string,
	vendor: string,
	model: string,
) {
	const cfg = await getProxyConfigRow(c.env.DB, userId, vendor);
	if (!cfg || cfg.enabled === 0) {
		throw new AppError("未启用 grsai 代理，无法获取模型状态", {
			status: 400,
			code: "proxy_not_enabled",
		});
	}
	const baseUrlRaw = (cfg.base_url || "").trim();
	if (!baseUrlRaw) {
		throw new AppError("grsai 代理未配置 Host", {
			status: 400,
			code: "proxy_misconfigured",
		});
	}
	const baseUrl = baseUrlRaw.replace(/\/+$/, "");
	const endpoint = `${baseUrl}/client/common/getModelStatus`;

	let res: Response;
	let data: any = null;
	try {
		const url = new URL(endpoint);
		url.searchParams.set("model", model);
		res = await fetchWithHttpDebugLog(
			c,
			url.toString(),
			{
			method: "GET",
			},
			{ tag: "proxy:getModelStatus" },
		);
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("获取模型状态失败", {
			status: 502,
			code: "proxy_model_status_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (!res.ok || data?.code !== 0) {
		const msg =
			(data && (data.msg || data.message || data.error)) ||
			`获取模型状态失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "proxy_model_status_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const payload = data?.data || {};
	return {
		status: Boolean(payload.status),
		error:
			typeof payload.error === "string" ? (payload.error as string) : "",
	};
}

export async function listProfiles(
	c: AppContext,
	userId: string,
	input?: { providerId?: string; kinds?: string[] },
) {
	const rows = await listProfilesForUser(c.env.DB, userId, {
		providerId: input?.providerId,
		kinds: input?.kinds,
	});

	return rows.map((row) =>
		ModelProfileSchema.parse({
			id: row.id,
			ownerId: row.owner_id,
			providerId: row.provider_id,
			name: row.name,
			kind: row.kind,
			modelKey: row.model_key,
			settings: row.settings ? JSON.parse(row.settings) : undefined,
			provider: {
				id: row.provider_id,
				name: row.provider_name,
				vendor: row.provider_vendor,
			},
		}),
	);
}

export async function upsertProfile(
	c: AppContext,
	userId: string,
	input: {
		id?: string;
		providerId: string;
		name: string;
		kind: string;
		modelKey: string;
		settings?: unknown;
	},
) {
	const provider = await getProviderByIdForUser(
		c.env.DB,
		input.providerId,
		userId,
	);
	if (!provider) {
		throw new AppError("provider not found or unauthorized", {
			status: 404,
			code: "provider_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	const row = await upsertProfileRow(c.env.DB, userId, input, nowIso);

	return ModelProfileSchema.parse({
		id: row.id,
		ownerId: row.owner_id,
		providerId: row.provider_id,
		name: row.name,
		kind: row.kind,
		modelKey: row.model_key,
		settings: row.settings ? JSON.parse(row.settings) : undefined,
	});
}

export async function deleteProfile(
	c: AppContext,
	userId: string,
	id: string,
) {
	await deleteProfileRow(c.env.DB, id, userId);
	return { success: true };
}

// ---- Export / Import model configuration ----

export async function exportModelConfig(
	c: AppContext,
	userId: string,
): Promise<ModelExportData> {
	const providers = await listProvidersForUser(c.env.DB, userId);
	const resultProviders = [];

	for (const provider of providers) {
		const tokens = await listTokensForProvider(c.env.DB, provider.id, userId);
		const endpoints = await listEndpointsForProvider(
			c.env.DB,
			provider.id,
			userId,
		);

		resultProviders.push({
			id: provider.id,
			name: provider.name,
			vendor: provider.vendor,
			baseUrl: provider.base_url,
			sharedBaseUrl: provider.shared_base_url === 1,
			tokens: tokens.map((t) => ({
				id: t.id,
				label: t.label,
				secretToken: t.secret_token,
				enabled: t.enabled === 1,
				userAgent: t.user_agent,
				shared: t.shared === 1,
			})),
			endpoints: endpoints.map((e) => ({
				id: e.id,
				key: e.key,
				label: e.label,
				baseUrl: e.base_url,
				shared: e.shared === 1,
			})),
		});
	}

	const payload: ModelExportData = {
		version: "1.0.0",
		exportedAt: new Date().toISOString(),
		providers: resultProviders,
	};

	return ModelExportDataSchema.parse(payload);
}

export async function importModelConfig(
	c: AppContext,
	userId: string,
	input: unknown,
) {
	const data = ModelExportDataSchema.parse(input);

	const result = {
		imported: { providers: 0, tokens: 0, endpoints: 0 },
		skipped: { providers: 0, tokens: 0, endpoints: 0 },
		errors: [] as string[],
	};

	const prisma = getPrismaClient();

	for (const providerData of data.providers) {
		try {
			const name = (providerData.name || "").trim();
			const vendor = (providerData.vendor || "").trim();
			if (!name || !vendor) {
				result.errors.push(
					`Invalid provider entry: missing name or vendor`,
				);
				continue;
			}

			const existing = await prisma.model_providers.findFirst({
				where: {
					owner_id: userId,
					name,
					vendor,
				},
			});

			let providerId: string;
			const nowIso = new Date().toISOString();
			const nextBase = providerData.baseUrl ?? null;
			const nextShared = providerData.sharedBaseUrl ?? false;

			if (existing) {
				if (
					existing.base_url !== nextBase ||
					(existing.shared_base_url === 1) !== nextShared
				) {
					await prisma.model_providers.update({
						where: { id: existing.id },
						data: {
							base_url: nextBase,
							shared_base_url: nextShared ? 1 : 0,
							updated_at: nowIso,
						},
					});
					result.imported.providers += 1;
				} else {
					result.skipped.providers += 1;
				}
				providerId = existing.id;
			} else {
				const id = crypto.randomUUID();
				await prisma.model_providers.create({
					data: {
						id,
						name,
						vendor,
						base_url: nextBase,
						shared_base_url: nextShared ? 1 : 0,
						owner_id: userId,
						created_at: nowIso,
						updated_at: nowIso,
					},
				});
				providerId = id;
				result.imported.providers += 1;
			}

			// Import tokens
			for (const tokenData of providerData.tokens) {
				try {
					const existingToken = await prisma.model_tokens.findFirst({
						where: {
							provider_id: providerId,
							user_id: userId,
							label: tokenData.label,
						},
					});

					if (!existingToken) {
						const tokenNow = new Date().toISOString();
						await prisma.model_tokens.create({
							data: {
								id: crypto.randomUUID(),
								provider_id: providerId,
								label: tokenData.label,
								secret_token: tokenData.secretToken,
								user_agent: tokenData.userAgent ?? null,
								user_id: userId,
								enabled: tokenData.enabled ? 1 : 0,
								shared: tokenData.shared ? 1 : 0,
								shared_failure_count: 0,
								shared_last_failure_at: null,
								shared_disabled_until: null,
								created_at: tokenNow,
								updated_at: tokenNow,
							},
						});
						result.imported.tokens += 1;
					} else {
						result.skipped.tokens += 1;
					}
				} catch (error: any) {
					result.errors.push(
						`Failed to import token "${tokenData.label}": ${
							error?.message ?? String(error)
						}`,
					);
				}
			}

			// Import endpoints
			for (const endpointData of providerData.endpoints) {
				try {
					const existingEndpoint = await prisma.model_endpoints.findFirst({
						where: {
							provider_id: providerId,
							key: endpointData.key,
						},
					});

					const endpointNow = new Date().toISOString();
					const input = {
						id: existingEndpoint?.id,
						providerId,
						key: endpointData.key,
						label: endpointData.label,
						baseUrl: endpointData.baseUrl,
						shared: endpointData.shared,
					};
					await upsertEndpointRow(c.env.DB, input, endpointNow);
					result.imported.endpoints += 1;
				} catch (error: any) {
					result.errors.push(
						`Failed to import endpoint "${endpointData.key}": ${
							error?.message ?? String(error)
						}`,
					);
				}
			}
		} catch (error: any) {
			result.errors.push(
				`Failed to import provider "${providerData.name}": ${
					error?.message ?? String(error)
				}`,
			);
		}
	}

	return result;
}

export async function listAvailableModels(
	c: AppContext,
	userId: string,
	input?: { vendor?: string },
) {
	const vendor = input?.vendor
		? String(input.vendor).trim().toLowerCase()
		: undefined;
	const targetVendors = vendor ? [vendor] : ["openai", "anthropic"];

	const prisma = getPrismaClient();
	const providers = await prisma.model_providers.findMany({
		where: {
			owner_id: userId,
			vendor: { in: targetVendors },
		},
		orderBy: { created_at: "asc" },
	});

	const contexts: Array<{ provider: ProviderRow; apiKey: string }> = [];

	const findBestTokenForProvider = async (
		providerId: string,
	): Promise<TokenRow | null> => {
		const owned = await prisma.model_tokens.findFirst({
			where: { provider_id: providerId, user_id: userId, enabled: 1 },
			orderBy: { created_at: "asc" },
		});
		if (owned) return owned;

		const nowIso = new Date().toISOString();
		const shared = await prisma.model_tokens.findFirst({
			where: {
				provider_id: providerId,
				shared: 1,
				enabled: 1,
				OR: [
					{ shared_disabled_until: null },
					{ shared_disabled_until: { lt: nowIso } },
				],
			},
			orderBy: { updated_at: "asc" },
		});
		return shared ?? null;
	};

	for (const provider of providers) {
		const token = await findBestTokenForProvider(provider.id);
		const secret = token?.secret_token?.trim();
		if (!secret) continue;
		contexts.push({ provider, apiKey: secret });
	}

	if (!contexts.length) {
		return { models: [] };
	}

	const sharedBaseCache = new Map<string, string | null>();
	const resolveSharedBaseUrl = async (vend: string): Promise<string | null> => {
		if (sharedBaseCache.has(vend)) {
			return sharedBaseCache.get(vend) ?? null;
		}
		const row = await prisma.model_providers.findFirst({
			where: {
				vendor: vend,
				shared_base_url: 1,
				base_url: { not: null },
			},
			orderBy: { updated_at: "desc" },
			select: { base_url: true },
		});
		const base = row?.base_url ?? null;
		sharedBaseCache.set(vend, base);
		return base;
	};

	const results = new Map<
		string,
		{ value: string; label: string; vendor: string }
	>();

	for (const context of contexts) {
		const provider = context.provider;
		const vendorName = provider.vendor.toLowerCase();
		const baseUrl =
			provider.base_url ||
			(await resolveSharedBaseUrl(vendorName)) ||
			null;

		let url: string | null = null;
		if (vendorName === "openai") {
			const base = (baseUrl || "https://api.openai.com").trim().replace(
				/\/+$/,
				"",
			);
			if (/\/v\d+\/models$/i.test(base)) url = base;
			else if (/\/v\d+$/i.test(base)) url = `${base}/models`;
			else url = `${base}/v1/models`;
		} else if (vendorName === "anthropic") {
			const base = (baseUrl || "https://api.anthropic.com").trim().replace(
				/\/+$/,
				"",
			);
			if (/\/v\d+\/models$/i.test(base)) url = base;
			else if (/\/v\d+$/i.test(base)) url = `${base}/models`;
			else url = `${base}/v1/models`;
		} else {
			continue;
		}

		if (!url) continue;

		let resp: Response;
		let data: unknown = null;
		try {
			const headers: Record<string, string> = {
				Authorization: `Bearer ${context.apiKey}`,
			};
			if (vendorName === "anthropic") {
				headers["x-api-key"] = context.apiKey;
				headers["anthropic-version"] = "2023-06-01";
			}
			resp = await fetchWithHttpDebugLog(
				c,
				url,
				{
				method: "GET",
				headers,
				},
				{ tag: `models:${vendorName}` },
			);
			try {
				data = await resp.json();
			} catch {
				data = null;
			}
		} catch {
			continue;
		}

		if (!resp.ok) {
			continue;
		}

		const dataObject: { data?: unknown } | null =
			typeof data === "object" && data !== null
				? (data as { data?: unknown })
				: null;
		const items: unknown[] = Array.isArray(dataObject?.data)
			? dataObject.data
			: Array.isArray(data)
				? data
				: [];

		for (const item of items) {
			if (!item || typeof item !== "object") continue;
			const modelRecord = item as { id?: unknown; display_name?: unknown };
			if (typeof modelRecord.id !== "string") continue;
			if (results.has(modelRecord.id)) continue;
			const label =
				typeof modelRecord.display_name === "string" &&
				modelRecord.display_name.trim()
					? modelRecord.display_name.trim()
					: modelRecord.id;
			results.set(modelRecord.id, {
				value: modelRecord.id,
				label,
				vendor: vendorName,
			});
		}
	}

	return { models: Array.from(results.values()) };
}
