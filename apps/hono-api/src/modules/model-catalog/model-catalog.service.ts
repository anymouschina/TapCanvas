import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../team/team.service";
import {
	BillingModelKindSchema,
	ModelCatalogImageOptionsSchema,
	ModelCatalogImportResultSchema,
	ModelCatalogMappingSchema,
	ModelCatalogModelSchema,
	ModelCatalogVideoOptionsSchema,
	ModelCatalogVendorAuthTypeSchema,
	ModelCatalogVendorSchema,
	type ModelCatalogImportPackage,
	type ModelCatalogImportResult,
	type ModelCatalogMappingDto,
	type ModelCatalogModelDto,
	type ModelCatalogVendorDto,
} from "./model-catalog.schemas";
import { TaskKindSchema } from "../task/task.schemas";
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
import {
	deleteModelCreditCost as deleteBillingModelCreditCost,
	listModelCreditCosts as listBillingModelCreditCosts,
	type ModelCreditCostRow,
	upsertModelCreditCost as upsertBillingModelCreditCost,
} from "../billing/billing.repo";
import { normalizeBillingModelKey } from "../billing/billing.models";

type UnknownRecord = Record<string, unknown>;

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

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestProfileV2Like(value: unknown): value is UnknownRecord {
	if (!isRecord(value)) return false;
	if (String(value.version || "").trim() !== "v2") return false;
	return isRecord(value.create) || isRecord(value.query) || isRecord(value.result);
}

function validateModelCatalogModelMeta(
	meta: unknown,
	input: { modelKey: string },
): unknown {
	if (typeof meta === "undefined") return undefined;
	if (!isRecord(meta)) return meta;

	const normalizedMeta: UnknownRecord = { ...meta };

	const videoOptionsValue = (() => {
		if ("videoOptions" in meta) return meta.videoOptions;
		return undefined;
	})();
	if (typeof videoOptionsValue !== "undefined") {
		if (!isRecord(videoOptionsValue)) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: "meta.videoOptions must be an object",
				},
			});
		}

		const parsed = ModelCatalogVideoOptionsSchema.safeParse(videoOptionsValue);
		if (!parsed.success) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: parsed.error.flatten(),
				},
			});
		}

		normalizedMeta.videoOptions = parsed.data;
	}

	const imageOptionsValue = (() => {
		if ("imageOptions" in meta) return meta.imageOptions;
		return undefined;
	})();
	if (typeof imageOptionsValue !== "undefined") {
		if (!isRecord(imageOptionsValue)) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: "meta.imageOptions must be an object",
				},
			});
		}

		const parsed = ModelCatalogImageOptionsSchema.safeParse(imageOptionsValue);
		if (!parsed.success) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: parsed.error.flatten(),
				},
			});
		}

		normalizedMeta.imageOptions = parsed.data;
	}

	if ("useCases" in meta) {
		const useCasesRaw = meta.useCases;
		if (!Array.isArray(useCasesRaw)) {
			throw new AppError("invalid model meta", {
				status: 400,
				code: "invalid_model_meta",
				details: {
					modelKey: input.modelKey,
					reason: "meta.useCases must be an array of strings",
				},
			});
		}
		const useCases = useCasesRaw
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean);
		normalizedMeta.useCases = useCases;
	}

	return normalizedMeta;
}

function defaultPricingCostByKind(kind: string): number {
	if (kind === "image") return 1;
	if (kind === "video") return 10;
	return 0;
}

function normalizePricingSpecKey(value: string): string {
	return value.trim();
}

function buildPricingByModelKey(
	costRows: ModelCreditCostRow[],
): Map<
	string,
	{
		cost: number;
		enabled: boolean;
		createdAt?: string;
		updatedAt?: string;
		specCosts: Array<{
			specKey: string;
			cost: number;
			enabled: boolean;
			createdAt?: string;
			updatedAt?: string;
		}>;
	}
> {
	const pricingMap = new Map<
		string,
		{
			cost: number;
			enabled: boolean;
			createdAt?: string;
			updatedAt?: string;
			specCosts: Array<{
				specKey: string;
				cost: number;
				enabled: boolean;
				createdAt?: string;
				updatedAt?: string;
			}>;
		}
	>();

	for (const row of costRows) {
		const modelKey = normalizeBillingModelKey(String(row.model_key || ""));
		if (!modelKey) continue;
		const specKey = normalizePricingSpecKey(String(row.spec_key || ""));
		const existing = pricingMap.get(modelKey) ?? {
			cost: 0,
			enabled: true,
			specCosts: [],
		};

		if (!specKey) {
			pricingMap.set(modelKey, {
				...existing,
				cost: Math.max(0, Math.floor(Number(row.cost ?? 0) || 0)),
				enabled: Number(row.enabled ?? 1) !== 0,
				createdAt: String(row.created_at || ""),
				updatedAt: String(row.updated_at || ""),
			});
			continue;
		}

		existing.specCosts.push({
			specKey,
			cost: Math.max(0, Math.floor(Number(row.cost ?? 0) || 0)),
			enabled: Number(row.enabled ?? 1) !== 0,
			createdAt: String(row.created_at || ""),
			updatedAt: String(row.updated_at || ""),
		});
		pricingMap.set(modelKey, existing);
	}

	for (const [, pricing] of pricingMap) {
		pricing.specCosts.sort((a, b) => a.specKey.localeCompare(b.specKey));
	}

	return pricingMap;
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

function mapModel(
	row: any,
	pricingMap?: Map<
		string,
		{
			cost: number;
			enabled: boolean;
			createdAt?: string;
			updatedAt?: string;
			specCosts: Array<{
				specKey: string;
				cost: number;
				enabled: boolean;
				createdAt?: string;
				updatedAt?: string;
			}>;
		}
	>,
): ModelCatalogModelDto {
	const modelKey = String(row.model_key || "").trim();
	const normalizedModelKey = normalizeBillingModelKey(modelKey);
	const pricing = pricingMap?.get(normalizedModelKey);
	const kind = String(row.kind || "").trim();

	return ModelCatalogModelSchema.parse({
		modelKey,
		vendorKey: row.vendor_key,
		modelAlias: normalizeOptionalString(row.model_alias ?? null),
		labelZh: row.label_zh,
		kind,
		enabled: Number(row.enabled ?? 1) !== 0,
		meta: safeJsonParse(row.meta ?? null),
		pricing: {
			cost: pricing?.cost ?? defaultPricingCostByKind(kind),
			enabled: pricing?.enabled ?? true,
			...(pricing?.createdAt ? { createdAt: pricing.createdAt } : {}),
			...(pricing?.updatedAt ? { updatedAt: pricing.updatedAt } : {}),
			specCosts: pricing?.specCosts ?? [],
		},
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
	const [rows, costRows] = await Promise.all([
		listCatalogModels(c.env.DB, {
			vendorKey: filter?.vendorKey ? normalizeKey(filter.vendorKey) : undefined,
			kind: filter?.kind ? String(filter.kind).trim() : undefined,
			enabled: filter?.enabled,
		}),
		listBillingModelCreditCosts(c.env.DB),
	]);
	const pricingMap = buildPricingByModelKey(costRows);
	return rows.map((row) => mapModel(row, pricingMap));
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
		pricing?: {
			cost: number;
			enabled?: boolean;
			specCosts?: Array<{
				specKey: string;
				cost: number;
				enabled?: boolean;
			}>;
		};
	},
): Promise<ModelCatalogModelDto> {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	const modelKey = String(input.modelKey || "").trim();
	const vendorKey = normalizeKey(input.vendorKey);
	const modelAlias = normalizeOptionalString(input.modelAlias ?? null) || modelKey;
	const labelZh = String(input.labelZh || "").trim();
	const kind = String(input.kind || "").trim();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
	const meta = validateModelCatalogModelMeta(input.meta, { modelKey });

	const vendor = await getCatalogVendorByKey(c.env.DB, vendorKey);
	if (!vendor) {
		throw new AppError("vendor not found", {
			status: 400,
			code: "vendor_not_found",
			details: { vendorKey },
		});
	}

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
				typeof meta === "undefined"
					? null
					: JSON.stringify(meta),
		},
		nowIso,
	);

	if (input.pricing) {
		await upsertBillingModelCreditCost(c.env.DB, {
			modelKey,
			cost: input.pricing.cost,
			enabled:
				typeof input.pricing.enabled === "boolean" ? input.pricing.enabled : true,
			nowIso,
		});

		const nextSpecKeys = new Set<string>();
		for (const spec of input.pricing.specCosts ?? []) {
			const specKey = normalizePricingSpecKey(String(spec.specKey || ""));
			if (!specKey) continue;
			nextSpecKeys.add(specKey);
			await upsertBillingModelCreditCost(c.env.DB, {
				modelKey,
				specKey,
				cost: spec.cost,
				enabled: typeof spec.enabled === "boolean" ? spec.enabled : true,
				nowIso,
			});
		}

		const existingPricingRows = await listBillingModelCreditCosts(c.env.DB);
		for (const pricingRow of existingPricingRows) {
			const pricingModelKey = normalizeBillingModelKey(
				String(pricingRow.model_key || ""),
			);
			if (pricingModelKey !== normalizeBillingModelKey(modelKey)) continue;
			const specKey = normalizePricingSpecKey(String(pricingRow.spec_key || ""));
			if (!specKey || nextSpecKeys.has(specKey)) continue;
			await deleteBillingModelCreditCost(c.env.DB, modelKey, specKey);
		}
	}

	const pricingMap = buildPricingByModelKey(await listBillingModelCreditCosts(c.env.DB));
	return mapModel(row, pricingMap);
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
	const pricingMap = buildPricingByModelKey(await listBillingModelCreditCosts(c.env.DB));

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
		const bundleModels = (modelsByVendor[vendorKey] || []).flatMap((m) => {
			const parsedKind = BillingModelKindSchema.safeParse(String(m.kind || "").trim());
			if (!parsedKind.success) return [];
			return [{
				modelKey: String(m.model_key || "").trim(),
				vendorKey,
				modelAlias: normalizeOptionalString((m as any).model_alias ?? null),
				labelZh: String(m.label_zh || "").trim(),
				kind: parsedKind.data,
				enabled: Number(m.enabled ?? 1) !== 0,
				meta: safeJsonParse(m.meta ?? null),
				pricing: pricingMap.get(
					normalizeBillingModelKey(String(m.model_key || "").trim()),
				),
			}];
		});

		const bundleMappings = (mappingsByVendor[vendorKey] || []).flatMap((mp) => {
			const parsedTaskKind = TaskKindSchema.safeParse(String(mp.task_kind || "").trim());
			if (!parsedTaskKind.success) return [];
			const requestMapping = safeJsonParse(mp.request_mapping ?? null);
			const responseMapping = safeJsonParse(mp.response_mapping ?? null);
			const requestProfile =
				isRequestProfileV2Like(requestMapping) &&
				isRequestProfileV2Like(responseMapping)
					? requestMapping
					: isRequestProfileV2Like(requestMapping)
						? requestMapping
						: null;
			return [{
				taskKind: parsedTaskKind.data,
				name: String(mp.name || "").trim(),
				enabled: Number(mp.enabled ?? 1) !== 0,
				...(requestProfile ? { requestProfile } : {}),
				...(requestProfile ? {} : { requestMapping }),
				...(requestProfile ? {} : { responseMapping }),
			}];
		});

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
		version: "v2",
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
					const modelKey = String(m.modelKey || "").trim();
					const modelAlias =
						normalizeOptionalString((m as any).modelAlias ?? null) || modelKey;
					const meta = validateModelCatalogModelMeta(m.meta, { modelKey });
					await upsertCatalogModelRow(
						c.env.DB,
						{
							modelKey,
							vendorKey: modelVendorKey,
							modelAlias,
							labelZh: String(m.labelZh || "").trim(),
							kind: String(m.kind || "").trim(),
							enabled: typeof m.enabled === "boolean" ? m.enabled : true,
							meta: typeof meta === "undefined" ? null : JSON.stringify(meta),
						},
						nowIso,
					);
					if (m.pricing) {
						await upsertBillingModelCreditCost(c.env.DB, {
							modelKey,
							cost: m.pricing.cost,
							enabled:
								typeof m.pricing.enabled === "boolean"
									? m.pricing.enabled
									: true,
							nowIso,
						});
						for (const spec of m.pricing.specCosts ?? []) {
							const specKey = normalizePricingSpecKey(String(spec.specKey || ""));
							if (!specKey) continue;
							await upsertBillingModelCreditCost(c.env.DB, {
								modelKey,
								specKey,
								cost: spec.cost,
								enabled:
									typeof spec.enabled === "boolean"
										? spec.enabled
										: true,
								nowIso,
							});
						}
					}
					result.imported.models += 1;
				} catch (err: any) {
					result.errors.push(
						`Failed to import model "${m.modelKey}": ${err?.message ?? String(err)}`,
					);
				}
			}

			for (const mapping of bundle.mappings || []) {
				try {
					const requestProfile =
						typeof mapping.requestProfile === "undefined"
							? undefined
							: mapping.requestProfile;
					const requestMapping =
						typeof requestProfile === "undefined"
							? mapping.requestMapping
							: requestProfile;
					const responseMapping =
						typeof requestProfile === "undefined"
							? mapping.responseMapping
							: requestProfile;
					await upsertCatalogMappingRow(
						c.env.DB,
						{
							vendorKey,
							taskKind: String(mapping.taskKind || "").trim(),
							name: String(mapping.name || "").trim(),
							enabled:
								typeof mapping.enabled === "boolean" ? mapping.enabled : true,
							requestMapping:
								typeof requestMapping === "undefined"
									? null
									: JSON.stringify(requestMapping),
							responseMapping:
								typeof responseMapping === "undefined"
									? null
									: JSON.stringify(responseMapping),
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
