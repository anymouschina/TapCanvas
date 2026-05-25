import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { AppError } from "../../middleware/error";
import type { WorkerEnv } from "../../types";
import { normalizeBillingModelKey } from "./billing.models";

type UnknownRecord = Record<string, unknown>;

type NewApiStatusResponse = {
	usdExchangeRate: number;
};

// Assumed input-token budget (in thousands) used to convert a per-token ratio
// into a fixed per-call credit cost for chat / completion models.
const CHAT_TOKEN_BUDGET_K = 5;

// new-api base rate: modelRatio 1.0 == $0.002 per 1K input tokens (gpt-3.5 reference).
const USD_PER_1K_TOKENS_AT_RATIO_1 = 0.002;

type ParamPricingSpec = {
	specKey: string;
	price: number;
	currency: "CNY" | "USD";
};

type NewApiPricingRow = {
	modelName: string;
	quotaType: number;
	modelPrice: number;
	// present for quotaType === 0 (token-based) models
	modelRatio?: number;
	// present for param_pricing (e.g. per-second video billing)
	paramPricingSpecs?: ParamPricingSpec[];
};

export type NewApiPricingSnapshot = {
	creditsPerCny: number;
	pricingVersion: string | null;
	usdExchangeRate: number;
	creditsByModelKey: Map<string, number>;
	directCreditsByModelKey: Map<string, number>;
	// spec-level credits for param_pricing models; key = "modelKey:specKey"
	specCreditsByModelSpecKey: Map<string, number>;
};

type CachedPricingSnapshot = {
	expiresAt: number;
	snapshot: NewApiPricingSnapshot;
};

const PRICING_CACHE_TTL_MS = 5 * 60_000;

let cachedPricingSnapshot: CachedPricingSnapshot | null = null;
let pricingSnapshotRefreshing = false;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(env: WorkerEnv, key: "NEW_API_INTERNAL_BASE_URL" | "NEW_API_INTERNAL_TOKEN"): string {
	const processEnv = globalThis.process?.env;
	const envValue = env[key];
	const processValue = processEnv?.[key];
	const raw = typeof envValue === "string" ? envValue : typeof processValue === "string" ? processValue : "";
	return raw.trim();
}

function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, "");
}

function resolveCreditsPerCny(env: WorkerEnv): number {
	const processEnv = globalThis.process?.env;
	const rawValue = (() => {
		const envValue = env.TAP_CREDITS_PER_CNY;
		if (typeof envValue === "string") return envValue.trim();
		const processValue = processEnv?.TAP_CREDITS_PER_CNY;
		return typeof processValue === "string" ? processValue.trim() : "";
	})();
	const numeric = Number(rawValue);
	if (Number.isFinite(numeric) && numeric > 0) {
		return numeric;
	}
	return 10;
}

function requireRelayConfig(env: WorkerEnv): { baseUrl: string; token: string } {
	const baseUrl = normalizeBaseUrl(readString(env, "NEW_API_INTERNAL_BASE_URL"));
	const token = readString(env, "NEW_API_INTERNAL_TOKEN");
	if (!baseUrl || !token) {
		throw new AppError("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置", {
			status: 500,
			code: "new_api_not_configured",
		});
	}
	return { baseUrl, token };
}

async function fetchJson(env: WorkerEnv, url: string, token: string): Promise<unknown> {
	const response = await fetchWithHttpDebugLog(
		{ env } as never,
		url,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
		},
		{ tag: "new-api-pricing" },
	);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new AppError("new-api pricing request failed", {
			status: 502,
			code: "new_api_pricing_request_failed",
			details: {
				url,
				status: response.status,
				body: text || null,
			},
		});
	}
	return response.json().catch(() => null);
}

function parseNewApiStatusResponse(payload: unknown): NewApiStatusResponse {
	if (!isRecord(payload)) {
		throw new AppError("new-api status response invalid", {
			status: 502,
			code: "new_api_status_invalid",
		});
	}
	const data = isRecord(payload.data) ? payload.data : null;
	const usdExchangeRate = Number(
		payload.usd_exchange_rate ?? data?.usd_exchange_rate ?? 0,
	);
	if (!Number.isFinite(usdExchangeRate) || usdExchangeRate <= 0) {
		throw new AppError("new-api status missing usd_exchange_rate", {
			status: 502,
			code: "new_api_status_invalid",
			details: { usdExchangeRate: payload.usd_exchange_rate ?? null },
		});
	}
	return { usdExchangeRate };
}

function parseParamPricingSpecs(raw: unknown): ParamPricingSpec[] {
	if (!isRecord(raw)) return [];
	const currency = String(raw.currency || "").trim().toUpperCase() === "CNY" ? "CNY" : "USD";
	const results = raw.results;
	if (!Array.isArray(results)) return [];
	const out: ParamPricingSpec[] = [];
	for (const item of results) {
		if (!isRecord(item)) continue;
		const specKey = typeof item.spec_key === "string" ? item.spec_key.trim() : "";
		const price = currency === "CNY"
			? Number(item.price_cny ?? NaN)
			: Number(item.price_usd ?? NaN);
		if (specKey && Number.isFinite(price) && price > 0) {
			out.push({ specKey, price, currency });
		}
	}
	return out;
}

function parseNewApiPricingRows(payload: unknown): {
	pricingVersion: string | null;
	rows: NewApiPricingRow[];
} {
	if (!isRecord(payload)) {
		throw new AppError("new-api pricing response invalid", {
			status: 502,
			code: "new_api_pricing_invalid",
		});
	}
	const pricingVersion =
		typeof payload.pricing_version === "string" && payload.pricing_version.trim()
			? payload.pricing_version.trim()
			: null;
	const data = payload.data;
	if (!Array.isArray(data)) {
		throw new AppError("new-api pricing response missing data", {
			status: 502,
			code: "new_api_pricing_invalid",
		});
	}
	const rows: NewApiPricingRow[] = [];
	for (const item of data) {
		if (!isRecord(item)) continue;
		const modelName =
			typeof item.model_name === "string" ? item.model_name.trim() : "";
		const quotaType = Number(item.quota_type ?? NaN);
		const modelPrice = Number(item.model_price ?? NaN);
		if (!modelName) continue;
		if (!Number.isFinite(quotaType) || !Number.isFinite(modelPrice)) continue;
		const modelRatio = Number(item.model_ratio ?? NaN);
		const paramPricingSpecs = parseParamPricingSpecs(item.param_pricing);
		rows.push({
			modelName,
			quotaType: Math.trunc(quotaType),
			modelPrice,
			modelRatio: Number.isFinite(modelRatio) && modelRatio > 0 ? modelRatio : undefined,
			paramPricingSpecs: paramPricingSpecs.length > 0 ? paramPricingSpecs : undefined,
		});
	}
	return { pricingVersion, rows };
}

function cnyToCredits(priceCny: number, creditsPerCny: number): number | null {
	if (!Number.isFinite(priceCny) || priceCny <= 0) return null;
	if (!Number.isFinite(creditsPerCny) || creditsPerCny <= 0) return null;
	const scaledCredits = priceCny * creditsPerCny;
	const credits = Math.max(1, Math.ceil(scaledCredits - 1e-9));
	return Number.isFinite(credits) ? credits : null;
}

function buildCreditsByModelKey(input: {
	creditsPerCny: number;
	rows: NewApiPricingRow[];
	usdExchangeRate: number;
}): Map<string, number> {
	const creditsByModelKey = new Map<string, number>();
	for (const row of input.rows) {
		const normalizedModelKey = normalizeBillingModelKey(row.modelName);
		if (!normalizedModelKey) continue;

		let cnyPerCall: number;
		if (row.quotaType === 1) {
			// Fixed per-call price (image/video generation models).
			if (!Number.isFinite(row.modelPrice) || row.modelPrice <= 0) continue;
			cnyPerCall = row.modelPrice;
		} else if (row.quotaType === 0 && row.modelRatio !== undefined) {
			// Token-based model: derive a per-call credit reservation from the
			// input-token ratio, assuming a typical CHAT_TOKEN_BUDGET_K budget.
			cnyPerCall =
				row.modelRatio *
				USD_PER_1K_TOKENS_AT_RATIO_1 *
				CHAT_TOKEN_BUDGET_K *
				input.usdExchangeRate;
		} else {
			continue;
		}

		const credits = cnyToCredits(cnyPerCall, input.creditsPerCny);
		if (credits === null) continue;
		creditsByModelKey.set(normalizedModelKey, credits);
	}
	return creditsByModelKey;
}

function buildSpecCreditsByModelSpecKey(input: {
	creditsPerCny: number;
	rows: NewApiPricingRow[];
	usdExchangeRate: number;
}): Map<string, number> {
	const map = new Map<string, number>();
	for (const row of input.rows) {
		if (!row.paramPricingSpecs?.length) continue;
		const normalizedModelKey = normalizeBillingModelKey(row.modelName);
		if (!normalizedModelKey) continue;
		for (const { specKey, price, currency } of row.paramPricingSpecs) {
			const priceCny = currency === "CNY" ? price : price * input.usdExchangeRate;
			const credits = cnyToCredits(priceCny, input.creditsPerCny);
			if (credits === null) continue;
			map.set(`${normalizedModelKey}:${specKey}`, credits);
		}
	}
	return map;
}

function buildDirectCreditsByModelKey(input: {
	creditsPerCny: number;
	rows: NewApiPricingRow[];
}): Map<string, number> {
	const directCreditsByModelKey = new Map<string, number>();
	for (const row of input.rows) {
		if (row.quotaType !== 1) continue;
		const normalizedModelKey = normalizeBillingModelKey(row.modelName);
		if (!normalizedModelKey) continue;
		if (!Number.isFinite(row.modelPrice) || row.modelPrice <= 0) continue;
		const credits = cnyToCredits(row.modelPrice, input.creditsPerCny);
		if (credits === null) continue;
		directCreditsByModelKey.set(normalizedModelKey, credits);
	}
	return directCreditsByModelKey;
}

async function doFetchPricingSnapshot(env: WorkerEnv): Promise<NewApiPricingSnapshot> {
	const relay = requireRelayConfig(env);
	const [statusPayload, pricingPayload] = await Promise.all([
		fetchJson(env, `${relay.baseUrl}/api/status`, relay.token),
		fetchJson(env, `${relay.baseUrl}/api/pricing`, relay.token),
	]);

	const status = parseNewApiStatusResponse(statusPayload);
	const pricing = parseNewApiPricingRows(pricingPayload);
	const creditsPerCny = resolveCreditsPerCny(env);
	return {
		creditsPerCny,
		pricingVersion: pricing.pricingVersion,
		usdExchangeRate: status.usdExchangeRate,
		creditsByModelKey: buildCreditsByModelKey({
			creditsPerCny,
			rows: pricing.rows,
			usdExchangeRate: status.usdExchangeRate,
		}),
		directCreditsByModelKey: buildDirectCreditsByModelKey({
			creditsPerCny,
			rows: pricing.rows,
		}),
		specCreditsByModelSpecKey: buildSpecCreditsByModelSpecKey({
			creditsPerCny,
			rows: pricing.rows,
			usdExchangeRate: status.usdExchangeRate,
		}),
	};
}

export async function getNewApiPricingSnapshot(
	env: WorkerEnv,
): Promise<NewApiPricingSnapshot> {
	const now = Date.now();
	// Cache still fresh — return immediately.
	if (cachedPricingSnapshot && cachedPricingSnapshot.expiresAt > now) {
		return cachedPricingSnapshot.snapshot;
	}
	// Stale-while-revalidate: return existing stale data and refresh in background.
	if (cachedPricingSnapshot && !pricingSnapshotRefreshing) {
		pricingSnapshotRefreshing = true;
		doFetchPricingSnapshot(env)
			.then((snapshot) => {
				cachedPricingSnapshot = { expiresAt: Date.now() + PRICING_CACHE_TTL_MS, snapshot };
			})
			.catch(() => {})
			.finally(() => {
				pricingSnapshotRefreshing = false;
			});
		return cachedPricingSnapshot.snapshot;
	}
	// Cold start or concurrent refresh already in flight — wait for fresh data.
	const snapshot = await doFetchPricingSnapshot(env);
	cachedPricingSnapshot = { expiresAt: Date.now() + PRICING_CACHE_TTL_MS, snapshot };
	return snapshot;
}
