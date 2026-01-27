import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../team/team.service";
import {
	ModelCatalogImportResultSchema,
	ModelCatalogMappingSchema,
	ModelCatalogModelSchema,
	ModelCatalogVendorAuthTypeSchema,
	ModelCatalogVendorSchema,
	type ModelCatalogImportPackage,
	type ModelCatalogImportResult,
	type ModelCatalogMappingDto,
	type ModelCatalogModelDto,
	type ModelCatalogVendorDto,
} from "./model-catalog.schemas";
import {
	deleteCatalogMappingRow,
	deleteCatalogModelRow,
	deleteCatalogVendorApiKeyRow,
	deleteCatalogVendorCascade,
	listCatalogModelsByModelKey,
	getCatalogModelByVendorKindAndAlias,
	getCatalogVendorApiKeyByVendorKey,
	getCatalogVendorByKey,
	listCatalogMappings,
	listCatalogModels,
	listCatalogVendorApiKeys,
	listCatalogVendors,
	upsertCatalogVendorApiKeyRow,
	upsertCatalogMappingRow,
	upsertCatalogModelRow,
	upsertCatalogVendorRow,
} from "./model-catalog.repo";

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function safeJsonParse(value: string | null): unknown | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function normalizeKey(value: string): string {
	return String(value || "").trim().toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function mapVendor(row: any): ModelCatalogVendorDto {
	const authTypeRaw = typeof row?.auth_type === "string" ? row.auth_type : null;
	const authType = (() => {
		const parsed = ModelCatalogVendorAuthTypeSchema.safeParse(authTypeRaw);
		return parsed.success ? parsed.data : "bearer";
	})();

	return ModelCatalogVendorSchema.parse({
		key: row.key,
		name: row.name,
		enabled: Number(row.enabled ?? 1) !== 0,
		hasApiKey:
			typeof row.hasApiKey === "boolean"
				? row.hasApiKey
				: typeof row.has_api_key === "number"
					? row.has_api_key !== 0
					: undefined,
		baseUrlHint: row.base_url_hint ?? null,
		authType,
		authHeader: row.auth_header ?? null,
		authQueryParam: row.auth_query_param ?? null,
		meta: safeJsonParse(row.meta ?? null),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function mapModel(row: any): ModelCatalogModelDto {
	return ModelCatalogModelSchema.parse({
		modelKey: row.model_key,
		vendorKey: row.vendor_key,
		modelAlias: normalizeOptionalString(row.model_alias ?? null),
		labelZh: row.label_zh,
		kind: row.kind,
		enabled: Number(row.enabled ?? 1) !== 0,
		meta: safeJsonParse(row.meta ?? null),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function mapMapping(row: any): ModelCatalogMappingDto {
	return ModelCatalogMappingSchema.parse({
		id: row.id,
		vendorKey: row.vendor_key,
		taskKind: row.task_kind,
		name: row.name,
		enabled: Number(row.enabled ?? 1) !== 0,
		requestMapping: safeJsonParse(row.request_mapping ?? null),
		responseMapping: safeJsonParse(row.response_mapping ?? null),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

export async function listModelCatalogVendors(
	c: AppContext,
): Promise<ModelCatalogVendorDto[]> {
	requireAdmin(c);
	const rows = await listCatalogVendors(c.env.DB);
	let keyRows: Array<{ vendor_key: string; enabled: number }> = [];
	try {
		keyRows = await listCatalogVendorApiKeys(c.env.DB);
	} catch {
		keyRows = [];
	}
	const enabledKeySet = new Set(
		(keyRows || [])
			.filter((r: any) => (r?.enabled ?? 1) !== 0 && typeof r?.vendor_key === "string")
			.map((r: any) => String(r.vendor_key).trim().toLowerCase())
			.filter(Boolean),
	);
	return rows.map((r) =>
		mapVendor({
			...r,
			hasApiKey: enabledKeySet.has(String(r.key || "").trim().toLowerCase()),
		}),
	);
}

export async function upsertModelCatalogVendor(
	c: AppContext,
	input: {
		key: string;
		name: string;
		enabled?: boolean;
		baseUrlHint?: string | null;
		authType?: string;
		authHeader?: string | null;
		authQueryParam?: string | null;
		meta?: unknown;
	},
): Promise<ModelCatalogVendorDto> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const key = normalizeKey(input.key);
	const name = String(input.name || "").trim();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : true;

	const authType = (() => {
		const parsed = ModelCatalogVendorAuthTypeSchema.safeParse(input.authType);
		return parsed.success ? parsed.data : "bearer";
	})();

	const row = await upsertCatalogVendorRow(
		c.env.DB,
		{
			key,
			name,
			enabled,
			baseUrlHint: normalizeOptionalString(input.baseUrlHint ?? null),
			authType,
			authHeader: normalizeOptionalString(input.authHeader ?? null),
			authQueryParam: normalizeOptionalString(input.authQueryParam ?? null),
			meta:
				typeof input.meta === "undefined"
					? null
					: JSON.stringify(input.meta),
		},
		nowIso,
	);
	return mapVendor(row);
}

export async function deleteModelCatalogVendor(
	c: AppContext,
	key: string,
): Promise<void> {
	requireAdmin(c);
	const k = normalizeKey(key);
	if (!k) return;
	try {
		await deleteCatalogVendorCascade(c.env.DB, k);
	} catch (err: any) {
		throw new AppError("delete vendor failed", {
			status: 500,
			code: "delete_failed",
			details: { message: err?.message ?? String(err) },
		});
	}
}

export async function listModelCatalogModels(
	c: AppContext,
	filter?: { vendorKey?: string; kind?: string; enabled?: boolean },
): Promise<ModelCatalogModelDto[]> {
	requireAdmin(c);
	const rows = await listCatalogModels(c.env.DB, {
		vendorKey: filter?.vendorKey ? normalizeKey(filter.vendorKey) : undefined,
		kind: filter?.kind ? String(filter.kind).trim() : undefined,
		enabled: filter?.enabled,
	});
	return rows.map(mapModel);
}

export async function upsertModelCatalogModel(
	c: AppContext,
	input: {
		modelKey: string;
		vendorKey: string;
		modelAlias?: string | null;
		labelZh: string;
		kind: string;
		enabled?: boolean;
		meta?: unknown;
	},
): Promise<ModelCatalogModelDto> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const modelKey = String(input.modelKey || "").trim();
	const vendorKey = normalizeKey(input.vendorKey);
	const modelAlias = normalizeOptionalString(input.modelAlias ?? null);
	const labelZh = String(input.labelZh || "").trim();
	const kind = String(input.kind || "").trim();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : true;

	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 400,
			code: "vendor_not_found",
			details: { vendorKey },
		});
	}

	if (modelAlias) {
		const existing = await getCatalogModelByVendorKindAndAlias(c.env.DB, {
			vendorKey,
			kind,
			modelAlias,
		});
		const existingKey =
			typeof (existing as any)?.model_key === "string"
				? (existing as any).model_key.trim()
				: "";
		if (existing && existingKey && existingKey !== modelKey) {
			throw new AppError("modelAlias already exists for this vendor/kind", {
				status: 400,
				code: "model_alias_conflict",
				details: { vendorKey, kind, modelAlias, modelKey, existingModelKey: existingKey },
			});
		}
	}

	const row = await upsertCatalogModelRow(
		c.env.DB,
		{
			modelKey,
			vendorKey,
			modelAlias,
			labelZh,
			kind,
			enabled,
			meta:
				typeof input.meta === "undefined"
					? null
					: JSON.stringify(input.meta),
		},
		nowIso,
	);
	return mapModel(row);
}

export async function deleteModelCatalogModel(
	c: AppContext,
	input: { modelKey: string; vendorKey?: string | null },
): Promise<void> {
	requireAdmin(c);
	const mk = String(input.modelKey || "").trim();
	if (!mk) return;
	const vendorKey = typeof input.vendorKey === "string" ? normalizeKey(input.vendorKey) : "";
	if (vendorKey) {
		await deleteCatalogModelRow(c.env.DB, { vendorKey, modelKey: mk });
		return;
	}

	const candidates = await listCatalogModelsByModelKey(c.env.DB, mk);
	if (!candidates.length) return;
	if (candidates.length > 1) {
		throw new AppError("vendorKey is required for non-unique modelKey", {
			status: 400,
			code: "vendor_required",
			details: {
				modelKey: mk,
				vendors: candidates
					.map((c: any) =>
						typeof c?.vendor_key === "string" ? c.vendor_key.trim() : "",
					)
					.filter(Boolean),
			},
		});
	}
	const onlyVendorKey =
		typeof candidates[0]?.vendor_key === "string"
			? candidates[0].vendor_key.trim()
			: "";
	if (!onlyVendorKey) return;
	await deleteCatalogModelRow(c.env.DB, { vendorKey: onlyVendorKey, modelKey: mk });
}

export async function listModelCatalogMappings(
	c: AppContext,
	filter?: { vendorKey?: string; taskKind?: string; enabled?: boolean },
): Promise<ModelCatalogMappingDto[]> {
	requireAdmin(c);
	const rows = await listCatalogMappings(c.env.DB, {
		vendorKey: filter?.vendorKey ? normalizeKey(filter.vendorKey) : undefined,
		taskKind: filter?.taskKind ? String(filter.taskKind).trim() : undefined,
		enabled: filter?.enabled,
	});
	return rows.map(mapMapping);
}

export async function exportModelCatalogPackage(
	c: AppContext,
	options?: { includeApiKeys?: boolean },
): Promise<ModelCatalogImportPackage> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const includeApiKeys = options?.includeApiKeys === true;

	const [vendorRows, modelRows, mappingRows, apiKeyRows] =
		await Promise.all([
			listCatalogVendors(c.env.DB),
			listCatalogModels(c.env.DB),
			listCatalogMappings(c.env.DB),
			includeApiKeys ? listCatalogVendorApiKeys(c.env.DB) : Promise.resolve([]),
		]);

	if (!vendorRows.length) {
		throw new AppError("No vendors to export", {
			status: 400,
			code: "empty_export",
		});
	}

	const modelsByVendor = (modelRows || []).reduce<Record<string, any[]>>(
		(acc, row) => {
			const vendorKey = normalizeKey(row.vendor_key);
			if (!vendorKey) return acc;
			(acc[vendorKey] ||= []).push(row);
			return acc;
		},
		{},
	);

	const mappingsByVendor = (mappingRows || []).reduce<Record<string, any[]>>(
		(acc, row) => {
			const vendorKey = normalizeKey(row.vendor_key);
			if (!vendorKey) return acc;
			(acc[vendorKey] ||= []).push(row);
			return acc;
		},
		{},
	);

	const apiKeyByVendor = (apiKeyRows || []).reduce<
		Record<string, { apiKey: string; enabled: boolean }>
	>((acc, row: any) => {
		const vendorKey = normalizeKey(row.vendor_key);
		if (!vendorKey) return acc;
		const apiKey = typeof row.api_key === "string" ? row.api_key.trim() : "";
		if (!apiKey) return acc;
		acc[vendorKey] = {
			apiKey,
			enabled: Number(row.enabled ?? 1) !== 0,
		};
		return acc;
	}, {});

	const vendors = vendorRows.map((row) => {
		const vendorKey = normalizeKey(row.key);
		const authTypeRaw = typeof row.auth_type === "string" ? row.auth_type : null;
		const authType = (() => {
			const parsed = ModelCatalogVendorAuthTypeSchema.safeParse(authTypeRaw);
			return parsed.success ? parsed.data : "bearer";
		})();

		const keyBundle = includeApiKeys ? apiKeyByVendor[vendorKey] : undefined;
		const bundleModels = (modelsByVendor[vendorKey] || []).map((m) => ({
			modelKey: String(m.model_key || "").trim(),
			vendorKey,
			modelAlias: normalizeOptionalString((m as any).model_alias ?? null),
			labelZh: String(m.label_zh || "").trim(),
			kind: String(m.kind || "").trim(),
			enabled: Number(m.enabled ?? 1) !== 0,
			meta: safeJsonParse(m.meta ?? null),
		}));

		const bundleMappings = (mappingsByVendor[vendorKey] || []).map((mp) => ({
			taskKind: String(mp.task_kind || "").trim(),
			name: String(mp.name || "").trim(),
			enabled: Number(mp.enabled ?? 1) !== 0,
			requestMapping: safeJsonParse(mp.request_mapping ?? null),
			responseMapping: safeJsonParse(mp.response_mapping ?? null),
		}));

		return {
			vendor: {
				key: vendorKey,
				name: String(row.name || "").trim(),
				enabled: Number(row.enabled ?? 1) !== 0,
				baseUrlHint: row.base_url_hint ?? null,
				authType,
				authHeader: row.auth_header ?? null,
				authQueryParam: row.auth_query_param ?? null,
				meta: safeJsonParse(row.meta ?? null),
			},
			...(keyBundle ? { apiKey: { ...keyBundle } } : {}),
			models: bundleModels,
			mappings: bundleMappings,
		};
	});

	return {
		version: "v1",
		exportedAt: nowIso,
		vendors,
	};
}

export async function upsertModelCatalogMapping(
	c: AppContext,
	input: {
		id?: string;
		vendorKey: string;
		taskKind: string;
		name: string;
		enabled?: boolean;
		requestMapping?: unknown;
		responseMapping?: unknown;
	},
): Promise<ModelCatalogMappingDto> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const vendorKey = normalizeKey(input.vendorKey);
	const taskKind = String(input.taskKind || "").trim();
	const name = String(input.name || "").trim();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : true;

	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 400,
			code: "vendor_not_found",
			details: { vendorKey },
		});
	}

	const row = await upsertCatalogMappingRow(
		c.env.DB,
		{
			id: input.id,
			vendorKey,
			taskKind,
			name,
			enabled,
			requestMapping:
				typeof input.requestMapping === "undefined"
					? null
					: JSON.stringify(input.requestMapping),
			responseMapping:
				typeof input.responseMapping === "undefined"
					? null
					: JSON.stringify(input.responseMapping),
		},
		nowIso,
	);
	return mapMapping(row);
}

export async function deleteModelCatalogMapping(
	c: AppContext,
	id: string,
): Promise<void> {
	requireAdmin(c);
	const rowId = String(id || "").trim();
	if (!rowId) return;
	await deleteCatalogMappingRow(c.env.DB, rowId);
}

export async function importModelCatalogPackage(
	c: AppContext,
	pkg: ModelCatalogImportPackage,
): Promise<ModelCatalogImportResult> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();

	const result: ModelCatalogImportResult = {
		imported: { vendors: 0, models: 0, mappings: 0 },
		errors: [],
	};

	for (const bundle of pkg.vendors) {
		try {
			const vendorKey = normalizeKey(bundle.vendor.key);
			const vendorRow = await upsertCatalogVendorRow(
				c.env.DB,
				{
					key: vendorKey,
					name: bundle.vendor.name.trim(),
					enabled:
						typeof bundle.vendor.enabled === "boolean"
							? bundle.vendor.enabled
							: true,
					baseUrlHint: normalizeOptionalString(bundle.vendor.baseUrlHint ?? null),
					authType:
						typeof bundle.vendor.authType === "string" &&
						ModelCatalogVendorAuthTypeSchema.safeParse(bundle.vendor.authType)
							.success
							? bundle.vendor.authType
							: "bearer",
					authHeader: normalizeOptionalString(bundle.vendor.authHeader ?? null),
					authQueryParam: normalizeOptionalString(bundle.vendor.authQueryParam ?? null),
					meta:
						typeof bundle.vendor.meta === "undefined"
							? null
							: JSON.stringify(bundle.vendor.meta),
				},
				nowIso,
			);
			if (vendorRow) result.imported.vendors += 1;

			if (bundle.apiKey?.apiKey) {
				try {
					await upsertCatalogVendorApiKeyRow(
						c.env.DB,
						{
							vendorKey,
							apiKey: String(bundle.apiKey.apiKey || "").trim(),
							enabled:
								typeof bundle.apiKey.enabled === "boolean"
									? bundle.apiKey.enabled
									: true,
						},
						nowIso,
					);
				} catch (err: any) {
					result.errors.push(
						`Failed to import vendor api key "${vendorKey}": ${err?.message ?? String(err)}`,
					);
				}
			}

			for (const m of bundle.models || []) {
				try {
					const modelVendorKey = normalizeKey(
						(typeof (m as any)?.vendorKey === "string" &&
							(m as any).vendorKey) ||
							vendorKey,
					);
					await upsertCatalogModelRow(
						c.env.DB,
						{
							modelKey: String(m.modelKey || "").trim(),
							vendorKey: modelVendorKey,
							modelAlias: normalizeOptionalString((m as any).modelAlias ?? null),
							labelZh: String(m.labelZh || "").trim(),
							kind: String(m.kind || "").trim(),
							enabled: typeof m.enabled === "boolean" ? m.enabled : true,
							meta: typeof m.meta === "undefined" ? null : JSON.stringify(m.meta),
						},
						nowIso,
					);
					result.imported.models += 1;
				} catch (err: any) {
					result.errors.push(
						`Failed to import model "${m.modelKey}": ${err?.message ?? String(err)}`,
					);
				}
			}

			for (const mapping of bundle.mappings || []) {
				try {
					await upsertCatalogMappingRow(
						c.env.DB,
						{
							vendorKey,
							taskKind: String(mapping.taskKind || "").trim(),
							name: String(mapping.name || "").trim(),
							enabled:
								typeof mapping.enabled === "boolean" ? mapping.enabled : true,
							requestMapping:
								typeof mapping.requestMapping === "undefined"
									? null
									: JSON.stringify(mapping.requestMapping),
							responseMapping:
								typeof mapping.responseMapping === "undefined"
									? null
									: JSON.stringify(mapping.responseMapping),
						},
						nowIso,
					);
					result.imported.mappings += 1;
				} catch (err: any) {
					result.errors.push(
						`Failed to import mapping "${vendorKey}:${mapping.taskKind}:${mapping.name}": ${err?.message ?? String(err)}`,
					);
				}
			}
		} catch (err: any) {
			result.errors.push(
				`Failed to import vendor "${bundle.vendor.key}": ${err?.message ?? String(err)}`,
			);
		}
	}

	return ModelCatalogImportResultSchema.parse(result);
}

export async function upsertModelCatalogVendorApiKey(
	c: AppContext,
	input: { vendorKey: string; apiKey: string; enabled?: boolean },
) {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const vendorKey = normalizeKey(input.vendorKey);
	const apiKey = String(input.apiKey || "").trim();
	if (!vendorKey) {
		throw new AppError("vendorKey is required", {
			status: 400,
			code: "invalid_request",
		});
	}
	if (!apiKey) {
		throw new AppError("apiKey is required", {
			status: 400,
			code: "invalid_request",
		});
	}
	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 404,
			code: "vendor_not_found",
		});
	}
	const row = await upsertCatalogVendorApiKeyRow(
		c.env.DB,
		{
			vendorKey,
			apiKey,
			enabled: typeof input.enabled === "boolean" ? input.enabled : true,
		},
		nowIso,
	);
	return {
		vendorKey,
		hasApiKey: true,
		enabled: Number(row.enabled ?? 1) !== 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function clearModelCatalogVendorApiKey(
	c: AppContext,
	vendorKey: string,
) {
	requireAdmin(c);
	const key = normalizeKey(vendorKey);
	if (!key) return { vendorKey: key, hasApiKey: false };
	try {
		const existing = await getCatalogVendorApiKeyByVendorKey(c.env.DB, key);
		if (!existing) {
			return { vendorKey: key, hasApiKey: false };
		}
		await deleteCatalogVendorApiKeyRow(c.env.DB, key);
		return { vendorKey: key, hasApiKey: false };
	} catch {
		return { vendorKey: key, hasApiKey: false };
	}
}
