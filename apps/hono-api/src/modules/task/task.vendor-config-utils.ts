import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import type { ProviderRow, TokenRow } from "../model/model.repo";
import { ensureModelCatalogSchema } from "../model-catalog/model-catalog.repo";
import { normalizeBaseUrl, normalizeVendorKey } from "./task.vendor-utils";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.beqlee.icu";
const LEGACY_GEMINI_BASE_HOST = "generativelanguage.googleapis.com";

export type SharedTokenWithProvider = {
	token: TokenRow;
	provider: ProviderRow;
};

export function requiresApiKeyForVendor(vendor: string): boolean {
	const v = normalizeVendorKey(vendor);
	return (
		v === "gemini" ||
		v === "qwen" ||
		v === "anthropic" ||
		v === "openai" ||
		v === "apimart" ||
		v === "veo" ||
		v === "grsai"
	);
}

export function defaultBaseUrlForVendor(vendor: string): string | null {
	const v = normalizeVendorKey(vendor);
	if (v === "openai") return "https://api.openai.com";
	if (v === "gemini") return DEFAULT_GEMINI_BASE_URL;
	if (v === "qwen") return "https://dashscope.aliyuncs.com";
	if (v === "anthropic") return "https://api.anthropic.com/v1";
	if (v === "apimart") return "https://api.apimart.ai";
	if (v === "veo") return "https://api.grsai.com";
	return null;
}

export function normalizeGeminiBaseUrl(raw: string): string {
	const normalized = normalizeBaseUrl(raw || "") || "";
	if (!normalized) return DEFAULT_GEMINI_BASE_URL;
	try {
		const url = new URL(normalized);
		if (url.hostname.toLowerCase() !== LEGACY_GEMINI_BASE_HOST) {
			return normalized;
		}
		const target = new URL(DEFAULT_GEMINI_BASE_URL);
		url.protocol = target.protocol;
		url.hostname = target.hostname;
		url.port = target.port;
		return url.toString().replace(/\/+$/, "");
	} catch {
		return normalized;
	}
}

export async function resolveSharedBaseUrl(
	c: AppContext,
	vendor: string,
): Promise<string | null> {
	void c;
	const row = await getPrismaClient().model_providers.findFirst({
		where: {
			vendor,
			shared_base_url: 1,
			base_url: { not: null },
		},
		orderBy: { updated_at: "desc" },
		select: { base_url: true },
	});
	return row?.base_url ?? null;
}

export async function findSharedTokenForVendor(
	c: AppContext,
	vendor: string,
): Promise<SharedTokenWithProvider | null> {
	void c;
	const nowIso = new Date().toISOString();
	const row = await getPrismaClient().model_tokens.findFirst({
		where: {
			shared: 1,
			enabled: 1,
			OR: [
				{ shared_disabled_until: null },
				{ shared_disabled_until: { lt: nowIso } },
			],
			model_providers: {
				vendor,
			},
		},
		orderBy: { updated_at: "asc" },
		include: {
			model_providers: true,
		},
	});
	if (!row) return null;
	return {
		token: row,
		provider: row.model_providers,
	};
}

type SystemVendorApiKeyContext = {
	vendorKey: string;
	apiKey: string;
	enabled: boolean;
	vendorEnabled: boolean;
	baseUrlHint: string | null;
};

export async function resolveSystemVendorApiKeyContext(
	c: AppContext,
	vendorKey: string,
): Promise<SystemVendorApiKeyContext | null> {
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const key = vendorKey.toLowerCase();
		const row = await getPrismaClient().model_catalog_vendor_api_keys.findFirst({
			where: { vendor_key: key },
			include: {
				model_catalog_vendors: true,
			},
		});
		if (!row) return null;
		const apiKey = typeof row.api_key === "string" ? row.api_key.trim() : "";
		if (!apiKey) return null;
		const enabled = Number(row.enabled ?? 1) !== 0;
		const vendorEnabled =
			Number(row.model_catalog_vendors?.enabled ?? 1) !== 0;
		const baseUrlHint =
			typeof row.model_catalog_vendors?.base_url_hint === "string" &&
			row.model_catalog_vendors.base_url_hint.trim()
				? row.model_catalog_vendors.base_url_hint.trim()
				: null;
		return {
			vendorKey,
			apiKey,
			enabled,
			vendorEnabled,
			baseUrlHint,
		};
	} catch {
		return null;
	}
}

export async function resolveSystemVendorBaseUrlHint(
	c: AppContext,
	vendorKey: string,
): Promise<string | null> {
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const row = await getPrismaClient().model_catalog_vendors.findFirst({
			where: { key: vendorKey.toLowerCase() },
			select: { base_url_hint: true, enabled: true },
		});
		if (!row) return null;
		if (Number(row.enabled ?? 1) === 0) return null;
		const hint =
			typeof row.base_url_hint === "string" ? row.base_url_hint.trim() : "";
		return hint ? hint : null;
	} catch {
		return null;
	}
}
