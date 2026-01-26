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
	deleteCatalogVendorRow,
	getCatalogVendorByKey,
	listCatalogMappings,
	listCatalogModels,
	listCatalogVendors,
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
	return rows.map(mapVendor);
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
		await deleteCatalogVendorRow(c.env.DB, k);
	} catch (err: any) {
		throw new AppError("delete vendor failed", {
			status: 400,
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

	const row = await upsertCatalogModelRow(
		c.env.DB,
		{
			modelKey,
			vendorKey,
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
	modelKey: string,
): Promise<void> {
	requireAdmin(c);
	const mk = String(modelKey || "").trim();
	if (!mk) return;
	await deleteCatalogModelRow(c.env.DB, mk);
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
