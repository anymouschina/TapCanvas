import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import type { WorkerEnv } from "../../types";
import { AppError } from "../../middleware/error";
import { normalizeBillingModelKey } from "../billing/billing.models";
import {
	listModelCreditCosts as listBillingModelCreditCosts,
	type ModelCreditCostRow,
} from "../billing/billing.repo";
import { getNewApiPricingSnapshot } from "../billing/new-api-pricing";
import {
	ModelCatalogVideoOptionsSchema,
	ModelCatalogImageOptionsSchema,
	type ModelParamSpec,
	type ModelCatalogVideoOptions,
	type ModelCatalogImageOptions,
} from "../model-catalog/model-catalog.schemas";

export type NewApiModelKind = "text" | "image" | "video";

type UnknownRecord = Record<string, unknown>;

type NewApiModelMeta = UnknownRecord & {
	videoOptions?: UnknownRecord;
	imageOptions?: UnknownRecord;
};

export type NewApiModelDto = {
	id: number;
	modelName: string;
	requestModelKey: string;
	displayLabel: string;
	description: string | null;
	icon: string | null;
	tags: string[];
	vendorId: number | null;
	endpoints: string[];
	kind: NewApiModelKind;
	enabled: boolean;
	syncOfficial: boolean;
	nameRule: number;
	createdTime: number;
	updatedTime: number;
	meta: NewApiModelMeta | null;
	pricing?: {
		cost: number;
		enabled: boolean;
		specCosts: Array<{
			specKey: string;
			cost: number;
			enabled: boolean;
		}>;
	};
};

// Shape of a model entry returned by new-api GET /api/models/list.
// Optional fields use undefined (Go omitempty) rather than null.
type NewApiModelListItem = {
	id: number;
	model_name: string;
	description?: string;
	icon?: string;
	tags?: string;
	vendor_id?: number;
	endpoints?: string;
	status: number;
	sync_official: number;
	created_time: number;
	updated_time: number;
	name_rule: number;
	kind?: string;
	capabilities?: string;
	params_def?: string;
};

function readRelayConfig(env: WorkerEnv): { baseUrl: string; token: string } | null {
	const processEnv = globalThis.process?.env;
	const baseUrl = String(
		env.NEW_API_INTERNAL_BASE_URL ?? processEnv?.NEW_API_INTERNAL_BASE_URL ?? "",
	)
		.trim()
		.replace(/\/+$/, "");
	const token = String(
		env.NEW_API_INTERNAL_TOKEN ?? processEnv?.NEW_API_INTERNAL_TOKEN ?? "",
	).trim();
	if (!baseUrl || !token) return null;
	return { baseUrl, token };
}

function requireRelayConfig(env: WorkerEnv): { baseUrl: string; token: string } {
	const config = readRelayConfig(env);
	if (!config) {
		throw new AppError("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置", {
			status: 500,
			code: "new_api_relay_config_missing",
		});
	}
	return config;
}

type CachedModelList = {
	expiresAt: number;
	rows: NewApiModelListItem[];
};

let cachedModelList: CachedModelList | null = null;
let modelListRefreshing = false;
const MODEL_LIST_CACHE_TTL_MS = 5 * 60_000;

async function doFetchNewApiModelList(env: WorkerEnv): Promise<NewApiModelListItem[]> {
	const config = readRelayConfig(env);
	if (!config) return [];

	const response = await fetchWithHttpDebugLog(
		{ env } as never,
		// require_video_spec drops video models whose params_def lacks a
		// `resolution` enum — without it the consumer cannot surface per-spec
		// pricing and the model degrades to a flat fallback (e.g. 14 credits
		// regardless of duration), which is misleading to end users.
		`${config.baseUrl}/api/models/list?enabled=true&require_video_spec=true`,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${config.token}`,
				Accept: "application/json",
			},
		},
		{ tag: "new-api-model-list" },
	);

	if (!response.ok) return [];

	const json: unknown = await response.json().catch(() => null);
	if (typeof json !== "object" || json === null || Array.isArray(json)) return [];

	const data = (json as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];
	return data as NewApiModelListItem[];
}

async function fetchNewApiModelList(
	env: WorkerEnv,
	options?: { fresh?: boolean },
): Promise<NewApiModelListItem[]> {
	const now = Date.now();
	if (options?.fresh) {
		const rows = await doFetchNewApiModelList(env);
		cachedModelList = { expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS, rows };
		return rows;
	}
	// Cache still fresh — return immediately.
	if (cachedModelList && now < cachedModelList.expiresAt) {
		return cachedModelList.rows;
	}
	// Stale-while-revalidate: return existing stale data and refresh in background.
	if (cachedModelList && !modelListRefreshing) {
		modelListRefreshing = true;
		doFetchNewApiModelList(env)
			.then((rows) => {
				cachedModelList = { expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS, rows };
			})
			.catch(() => {})
			.finally(() => {
				modelListRefreshing = false;
			});
		return cachedModelList.rows;
	}
	// Cold start or concurrent refresh already in flight — wait for fresh data.
	const rows = await doFetchNewApiModelList(env);
	cachedModelList = { expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS, rows };
	return rows;
}

function paramsToVideoOptions(params: ModelParamSpec[]): ModelCatalogVideoOptions {
	const duration = params.find((p) => p.key === "duration");
	const size = params.find((p) => p.key === "size");
	const resolution = params.find((p) => p.key === "resolution");

	const raw = {
		defaultDurationSeconds:
			typeof duration?.default === "number" ? duration.default : undefined,
		defaultSize: typeof size?.default === "string" ? size.default : undefined,
		defaultResolution:
			typeof resolution?.default === "string" ? resolution.default : undefined,
		durationOptions: duration?.options ?? [],
		sizeOptions: size?.options ?? [],
		resolutionOptions: resolution?.options ?? [],
		orientationOptions: [],
	};

	const parsed = ModelCatalogVideoOptionsSchema.safeParse(raw);
	return parsed.success ? parsed.data : ModelCatalogVideoOptionsSchema.parse({});
}

// Maps params_def keys to imageOptions control descriptors consumed by the frontend.
const IMAGE_PARAM_CONTROLS: Record<string, { key: string; binding: string; label: string }> = {
	size:       { key: "aspect_ratio", binding: "aspectRatio", label: "比例" },
	image_size: { key: "image_size",   binding: "imageSize",   label: "尺寸" },
	resolution: { key: "resolution",   binding: "resolution",  label: "分辨率" },
	quality:    { key: "quality",      binding: "quality",     label: "质量" },
};

function paramsToImageOptions(params: ModelParamSpec[]): ModelCatalogImageOptions {
	const sizeParam = params.find((p) => p.key === "size");
	const imageSizeParam = params.find((p) => p.key === "image_size");
	const resolutionParam = params.find((p) => p.key === "resolution");
	const qualityParam = params.find((p) => p.key === "quality");
	const hasReferenceImages = params.some((p) => p.key === "urls" || p.key === "images" || p.key === "image");

	const controls = (["size", "image_size", "resolution", "quality"] as const)
		.filter((key) => params.some((p) => p.key === key))
		.map((key) => IMAGE_PARAM_CONTROLS[key]);

	const raw = {
		defaultAspectRatio:
			typeof sizeParam?.default === "string" ? sizeParam.default : undefined,
		defaultImageSize:
			typeof imageSizeParam?.default === "string" ? imageSizeParam.default : undefined,
		defaultResolution:
			typeof resolutionParam?.default === "string" ? resolutionParam.default : undefined,
		defaultQuality:
			typeof qualityParam?.default === "string" ? qualityParam.default : undefined,
		aspectRatioOptions: (sizeParam?.options ?? []).map((o) => String(o.value)),
		imageSizeOptions: (imageSizeParam?.options ?? []).map((o) => ({
			...o,
			value: String(o.value),
			label: o.label,
		})),
		resolutionOptions: (resolutionParam?.options ?? []).map((o) => ({
			...o,
			value: String(o.value),
			label: o.label,
		})),
		qualityOptions: (qualityParam?.options ?? []).map((o) => String(o.value)),
		controls: controls.length > 0 ? controls : undefined,
		supportsTextToImage: true,
		supportsReferenceImages: hasReferenceImages || undefined,
		supportsImageToImage: hasReferenceImages || undefined,
	};

	const parsed = ModelCatalogImageOptionsSchema.safeParse(raw);
	return parsed.success ? parsed.data : ModelCatalogImageOptionsSchema.parse({});
}

function paramsToUseCases(params: ModelParamSpec[]): string[] {
	const hasReferenceImages = params.some((p) => p.key === "urls" || p.key === "images" || p.key === "image");
	const cases = ["image_generation"];
	if (hasReferenceImages) {
		cases.push("image_edit", "reference_guided");
	}
	return cases;
}


function buildMetaFromListItem(item: NewApiModelListItem): NewApiModelMeta | null {
	const kind = (item.kind ?? "").trim().toLowerCase();
	if (!kind || !item.params_def) return null;
	try {
		const params: ModelParamSpec[] = JSON.parse(item.params_def);
		if (!Array.isArray(params) || params.length === 0) return null;
		const meta: NewApiModelMeta = {};
		if (kind === "video") {
			meta.videoOptions = paramsToVideoOptions(params);
		} else if (kind === "image") {
			meta.imageOptions = paramsToImageOptions(params);
			meta.useCases = paramsToUseCases(params);
		}
		return Object.keys(meta).length > 0 ? meta : null;
	} catch {
		return null;
	}
}

function buildSpecCostsByModelKey(
	costRows: ModelCreditCostRow[],
): Map<
	string,
	Array<{
		specKey: string;
		cost: number;
		enabled: boolean;
	}>
> {
	const out = new Map<
		string,
		Array<{
			specKey: string;
			cost: number;
			enabled: boolean;
		}>
	>();
	for (const row of costRows) {
		const modelKey = normalizeBillingModelKey(String(row.model_key || ""));
		const specKey = String(row.spec_key || "").trim();
		if (!modelKey || !specKey) continue;
		const list = out.get(modelKey) || [];
		list.push({
			specKey,
			cost: Math.max(0, Math.floor(Number(row.cost ?? 0) || 0)),
			enabled: Number(row.enabled ?? 1) !== 0,
		});
		out.set(modelKey, list);
	}
	for (const [modelKey, rows] of out.entries()) {
		rows.sort((a, b) => a.specKey.localeCompare(b.specKey));
		out.set(modelKey, rows);
	}
	return out;
}

function buildBaseCostsByModelKey(
	costRows: ModelCreditCostRow[],
): Map<
	string,
	{
		cost: number;
		enabled: boolean;
	}
> {
	const out = new Map<
		string,
		{
			cost: number;
			enabled: boolean;
		}
	>();
	for (const row of costRows) {
		const modelKey = normalizeBillingModelKey(String(row.model_key || ""));
		const specKey = String(row.spec_key || "").trim();
		if (!modelKey || specKey) continue;
		out.set(modelKey, {
			cost: Math.max(0, Math.floor(Number(row.cost ?? 0) || 0)),
			enabled: Number(row.enabled ?? 1) !== 0,
		});
	}
	return out;
}

function parseStringList(raw: string | null | undefined): string[] {
	const text = typeof raw === "string" ? raw.trim() : "";
	if (!text) return [];
	try {
		const parsed: unknown = JSON.parse(text);
		if (Array.isArray(parsed)) {
			return parsed
				.map((item) => (typeof item === "string" ? item.trim() : ""))
				.filter(Boolean);
		}
	} catch {
		// fall through
	}
	return text
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeKindFromTags(tags: string[]): NewApiModelKind | null {
	for (const tag of tags) {
		const normalized = tag.trim().toLowerCase();
		if (normalized === "tapcanvas:kind=image") return "image";
		if (normalized === "tapcanvas:kind=video") return "video";
		if (normalized === "tapcanvas:kind=text") return "text";
	}
	return null;
}

function normalizeKindFromEndpoints(endpoints: string[]): NewApiModelKind {
	const normalized = new Set(endpoints.map((item) => item.trim().toLowerCase()).filter(Boolean));
	if (normalized.has("openai-video")) return "video";
	if (normalized.has("image-generation")) return "image";
	return "text";
}

function normalizeKindFromDescription(description: string | null | undefined): NewApiModelKind | null {
	const normalized = String(description || "").trim().toLowerCase();
	if (!normalized) return null;
	if (normalized.includes("/v1/videos") || normalized.includes("video generation")) return "video";
	if (normalized.includes("image generation") || normalized.includes("image endpoint")) return "image";
	return null;
}

function normalizeKindFromApiField(kind: string | undefined): NewApiModelKind | null {
	switch (kind?.trim().toLowerCase()) {
		case "video": return "video";
		case "image": return "image";
		case "chat":
		case "text": return "text";
		default: return null;
	}
}

function expandChannelAliasModelKeys(modelKey: string): string[] {
	const normalized = normalizeBillingModelKey(modelKey);
	if (!normalized) return [];
	const keys = new Set<string>([normalized]);
	if (normalized.endsWith("-apimart")) {
		const baseKey = normalized.slice(0, -"-apimart".length).trim();
		if (baseKey) {
			keys.add(normalizeBillingModelKey(baseKey));
		}
	}
	return Array.from(keys);
}

function resolveMetaByModelKeys(
	metaByModelKey: Map<string, NewApiModelMeta>,
	keys: string[],
): NewApiModelMeta | null {
	for (const key of keys) {
		const meta = metaByModelKey.get(key);
		if (meta) return meta;
	}
	return null;
}

function normalizeSpecKey(value: string): string {
	return value.trim().toLowerCase();
}

function buildSyntheticVideoSpecCosts(input: {
	meta: NewApiModelMeta | null;
	unitCost: number | null;
	pricingEnabled: boolean;
	specCreditsBySpecKey?: Map<string, number>;
}): Array<{ specKey: string; cost: number; enabled: boolean }> {
	const hasSpecCredits = input.specCreditsBySpecKey && input.specCreditsBySpecKey.size > 0;
	const hasUnitCost =
		typeof input.unitCost === "number" &&
		Number.isFinite(input.unitCost) &&
		input.unitCost > 0;
	if (!hasSpecCredits && !hasUnitCost) return [];

	const rawVideoOptions = input.meta?.videoOptions;
	const parsed = ModelCatalogVideoOptionsSchema.safeParse(rawVideoOptions);
	if (!parsed.success) return [];
	const durationOptions = parsed.data.durationOptions;
	if (durationOptions.length === 0) return [];
	const resolutionOptions =
		parsed.data.resolutionOptions.length > 0
			? parsed.data.resolutionOptions.map((option) => option.value.trim())
			: typeof parsed.data.defaultResolution === "string" &&
				  parsed.data.defaultResolution.trim()
				? [parsed.data.defaultResolution.trim()]
				: [];
	if (resolutionOptions.length === 0) return [];

	const seen = new Set<string>();
	const out: Array<{ specKey: string; cost: number; enabled: boolean }> = [];
	for (const resolution of resolutionOptions) {
		const normalizedResolution = resolution.trim().toLowerCase();
		if (!normalizedResolution) continue;
		for (const duration of durationOptions) {
			const durationSeconds = Math.trunc(Number(duration.value));
			if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;
			const specKey = normalizeSpecKey(
				`video:${normalizedResolution}:${durationSeconds}s`,
			);
			if (!specKey || seen.has(specKey)) continue;
			seen.add(specKey);
			const specCredits = input.specCreditsBySpecKey?.get(specKey);
			const cost =
				typeof specCredits === "number" && Number.isFinite(specCredits) && specCredits > 0
					? specCredits
					: Math.max(0, Math.floor(input.unitCost ?? 0));
			if (cost <= 0) continue;
			out.push({ specKey, cost, enabled: input.pricingEnabled });
		}
	}
	return out;
}

function buildSyntheticImageSpecCosts(input: {
	meta: NewApiModelMeta | null;
	existingSpecCosts: Array<{ specKey: string; cost: number; enabled: boolean }>;
	unitCost: number | null;
	pricingEnabled: boolean;
	specCreditsBySpecKey?: Map<string, number>;
}): Array<{ specKey: string; cost: number; enabled: boolean }> {
	if (input.specCreditsBySpecKey && input.specCreditsBySpecKey.size > 0) {
		return Array.from(input.specCreditsBySpecKey.entries())
			.filter(([, cost]) => Number.isFinite(cost) && cost > 0)
			.map(([specKey, cost]) => ({
				specKey,
				cost: Math.ceil(cost),
				enabled: input.pricingEnabled,
			}))
			.sort((a, b) => a.specKey.localeCompare(b.specKey));
	}
	if (input.existingSpecCosts.length > 0) return input.existingSpecCosts;
	const hasUnitCost =
		typeof input.unitCost === "number" &&
		Number.isFinite(input.unitCost) &&
		input.unitCost > 0;
	if (!hasUnitCost) return [];

	const rawImageOptions = input.meta?.imageOptions;
	const parsed = ModelCatalogImageOptionsSchema.safeParse(rawImageOptions);
	if (!parsed.success) return [];
	const resolutionOptions = parsed.data.resolutionOptions
		.map((option) => (typeof option === "string" ? option.trim() : option.value.trim()))
		.filter(Boolean);
	// Fall back to imageSizeOptions (e.g. doubao-seedream which uses image_size not resolution).
	const effectiveOptions =
		resolutionOptions.length > 0
			? resolutionOptions
			: parsed.data.imageSizeOptions.map((o) => (typeof o === "string" ? o.trim() : o.value.trim())).filter(Boolean);
	if (effectiveOptions.length === 0) return [];

	const seen = new Set<string>();
	const out: Array<{ specKey: string; cost: number; enabled: boolean }> = [];
	for (const resolution of effectiveOptions) {
		const normalizedResolution = resolution.toLowerCase();
		if (!normalizedResolution) continue;
		const specKey = normalizeSpecKey(`image:${normalizedResolution}`);
		if (!specKey || seen.has(specKey)) continue;
		seen.add(specKey);
		const specCredits = input.specCreditsBySpecKey?.get(specKey);
		const cost =
			typeof specCredits === "number" && Number.isFinite(specCredits) && specCredits > 0
				? specCredits
				: Math.max(
						0,
						Math.ceil(
							(input.unitCost ?? 0) * (normalizedResolution === "4k" ? 2 : 1),
						),
					);
		if (cost <= 0) continue;
		out.push({ specKey, cost, enabled: input.pricingEnabled });
	}
	return out;
}

function extractRequestModelKey(modelName: string, description: string | null | undefined, tags: string[]): string {
	for (const tag of tags) {
		const normalized = tag.trim();
		if (normalized.startsWith("tapcanvas:request-model=")) {
			const value = normalized.slice("tapcanvas:request-model=".length).trim();
			if (value) return value;
		}
	}
	const descriptionText = typeof description === "string" ? description.trim() : "";
	const descriptionMatch = descriptionText.match(/\bupstream\s+([A-Za-z0-9._:-]+)\b/i);
	if (descriptionMatch?.[1]) return descriptionMatch[1].trim();
	return modelName;
}

function mapListItem(
	item: NewApiModelListItem,
	input?: {
		metaByModelKey?: Map<string, NewApiModelMeta>;
		creditsByModelKey?: Map<string, number>;
		directCreditsByModelKey?: Map<string, number>;
		specCreditsByModelSpecKey?: Map<string, number>;
		baseCostsByModelKey?: Map<string, { cost: number; enabled: boolean }>;
		localSpecCostsByModelKey?: Map<string, Array<{ specKey: string; cost: number; enabled: boolean }>>;
	},
): NewApiModelDto {
	const modelName = String(item.model_name || "").trim();
	const description = typeof item.description === "string" ? item.description.trim() || null : null;
	const tags = parseStringList(item.tags);
	const endpoints = parseStringList(item.endpoints);
	const kind =
		normalizeKindFromApiField(item.kind) ||
		normalizeKindFromTags(tags) ||
		normalizeKindFromDescription(description) ||
		normalizeKindFromEndpoints(endpoints);
	const requestModelKey = extractRequestModelKey(modelName, description, tags);
	const displayLabel =
		modelName && requestModelKey && modelName !== requestModelKey
			? `${modelName} (${requestModelKey})`
			: requestModelKey || modelName;
	const normalizedRequestModelKey = normalizeBillingModelKey(requestModelKey);
	const normalizedModelName = normalizeBillingModelKey(modelName);
	const metaLookupKeys = Array.from(
		new Set<string>([
			...expandChannelAliasModelKeys(normalizedRequestModelKey),
			...expandChannelAliasModelKeys(normalizedModelName),
		]),
	);
	const meta =
		input?.metaByModelKey && metaLookupKeys.length > 0
			? resolveMetaByModelKeys(input.metaByModelKey, metaLookupKeys)
			: null;
	const basePricing =
		input?.baseCostsByModelKey?.get(normalizedModelName) ??
		input?.baseCostsByModelKey?.get(normalizedRequestModelKey) ??
		null;
	const snapshotCost =
		input?.creditsByModelKey?.get(normalizedModelName) ??
		input?.creditsByModelKey?.get(normalizedRequestModelKey);
	const directSnapshotCost =
		input?.directCreditsByModelKey?.get(normalizedModelName) ??
		input?.directCreditsByModelKey?.get(normalizedRequestModelKey) ??
		null;
	const resolvedCost =
		typeof snapshotCost === "number" && Number.isFinite(snapshotCost)
			? snapshotCost
			: (basePricing?.cost ?? null);
	const pricingEnabled = item.status === 1 && (basePricing?.enabled ?? true);
	const snapshotSpecCreditsForModel = (() => {
		const specMap = input?.specCreditsByModelSpecKey;
		if (!specMap || specMap.size === 0) return undefined;
		const out = new Map<string, number>();
		for (const lookupKey of [normalizedModelName, normalizedRequestModelKey]) {
			if (!lookupKey) continue;
			const prefix = `${lookupKey}:`;
			for (const [key, credits] of specMap) {
				if (key.startsWith(prefix)) out.set(key.slice(prefix.length), credits);
			}
			if (out.size > 0) break;
		}
		return out.size > 0 ? out : undefined;
	})();
	const specCosts =
		kind === "video"
			? buildSyntheticVideoSpecCosts({
					meta,
					unitCost:
						typeof directSnapshotCost === "number" && Number.isFinite(directSnapshotCost)
							? directSnapshotCost
							: resolvedCost,
					pricingEnabled,
					specCreditsBySpecKey: snapshotSpecCreditsForModel,
				})
			: kind === "image"
				? buildSyntheticImageSpecCosts({
						meta,
						existingSpecCosts:
							input?.localSpecCostsByModelKey?.get(normalizedModelName) ??
							input?.localSpecCostsByModelKey?.get(normalizedRequestModelKey) ??
							[],
						unitCost: resolvedCost,
						pricingEnabled,
						specCreditsBySpecKey: snapshotSpecCreditsForModel,
					})
				: [];

	return {
		id: Math.trunc(item.id),
		modelName,
		requestModelKey,
		displayLabel,
		description,
		icon: typeof item.icon === "string" ? item.icon.trim() || null : null,
		tags,
		vendorId:
			typeof item.vendor_id === "number" && Number.isFinite(item.vendor_id)
				? Math.trunc(item.vendor_id)
				: null,
		endpoints,
		kind,
		enabled: item.status === 1,
		syncOfficial: item.sync_official === 1,
		nameRule: Math.trunc(item.name_rule ?? 0),
		createdTime: Math.trunc(item.created_time ?? 0),
		updatedTime: Math.trunc(item.updated_time ?? 0),
		meta,
		...(typeof resolvedCost === "number" && Number.isFinite(resolvedCost)
			? {
					pricing: {
						cost: Math.max(0, Math.floor(resolvedCost)),
						enabled: pricingEnabled,
						specCosts,
					},
				}
			: {}),
	};
}

export async function listNewApiModels(
	env: WorkerEnv,
	options?: { enabled?: boolean; kind?: NewApiModelKind; fresh?: boolean },
): Promise<NewApiModelDto[]> {
	const [modelRows, pricingSnapshot, costRows] = await Promise.all([
		fetchNewApiModelList(env, { fresh: options?.fresh === true }),
		getNewApiPricingSnapshot(env),
		listBillingModelCreditCosts(env.DB),
	]);

	const metaByModelKey = new Map<string, NewApiModelMeta>();
	for (const row of modelRows) {
		const meta = buildMetaFromListItem(row);
		if (meta) {
			metaByModelKey.set(normalizeBillingModelKey(row.model_name), meta);
		}
	}

	const baseCostsByModelKey = buildBaseCostsByModelKey(costRows);
	const localSpecCostsByModelKey = buildSpecCostsByModelKey(costRows);

	let mapped = modelRows.map((row) =>
		mapListItem(row, {
			metaByModelKey,
			creditsByModelKey: pricingSnapshot.creditsByModelKey,
			directCreditsByModelKey: pricingSnapshot.directCreditsByModelKey,
			specCreditsByModelSpecKey: pricingSnapshot.specCreditsByModelSpecKey,
			baseCostsByModelKey,
			localSpecCostsByModelKey,
		}),
	);

	if (typeof options?.enabled === "boolean") {
		mapped = mapped.filter((item) => item.enabled === options.enabled);
	}
	if (options?.kind) {
		mapped = mapped.filter((item) => item.kind === options.kind);
	}
	// Strip channel-pool routing aliases (e.g. -147ai, -apimart, -suchuang).
	// These are internal identifiers used for channel selection; exposing them
	// in the model list confuses users who cannot distinguish them from real models.
	mapped = mapped.filter((item) => !isVendorRoutingAlias(item.modelName));
	return mapped;
}

// Known vendor-routing suffix patterns — mirror of canonicalModelAliasSuffixes in
// apps/new-api/model/canonical_model.go, plus project-specific channel tags.
// "-official" is intentionally excluded: those are independent pricing tiers.
const VENDOR_ROUTING_SUFFIXES = [
	"-apimart",
	"-suchuang",
	"-all",
	"-rightcodes",
	"-147ai",
	"-magic666",
	"-yunwu",
	"-vip",
] as const;

function isVendorRoutingAlias(modelName: string): boolean {
	const lower = modelName.toLowerCase();
	return VENDOR_ROUTING_SUFFIXES.some((s) => lower.endsWith(s));
}

export async function updateNewApiModelStatus(
	env: WorkerEnv,
	input: { id: number; enabled: boolean },
): Promise<NewApiModelDto> {
	const config = requireRelayConfig(env);
	const modelId = Math.trunc(input.id);
	if (!Number.isFinite(modelId) || modelId <= 0) {
		throw new AppError("模型 id 不合法", {
			status: 400,
			code: "new_api_model_id_invalid",
		});
	}

	const response = await fetchWithHttpDebugLog(
		{ env } as never,
		`${config.baseUrl}/api/models/list/${modelId}/status`,
		{
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${config.token}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ enabled: input.enabled }),
		},
		{ tag: "new-api-model-status-update" },
	);

	if (response.status === 404) {
		throw new AppError("new-api 模型不存在", {
			status: 404,
			code: "new_api_model_not_found",
			details: { id: modelId },
		});
	}
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new AppError("new-api 模型状态更新失败", {
			status: 502,
			code: "new_api_model_status_update_failed",
			details: { status: response.status, body: text },
		});
	}

	const json: unknown = await response.json().catch(() => null);
	const updated = (json as { data?: unknown } | null)?.data as NewApiModelListItem | undefined;
	if (!updated) {
		throw new AppError("new-api 返回格式异常", {
			status: 502,
			code: "new_api_model_status_update_invalid_response",
		});
	}

	// Invalidate list cache so next read reflects the change.
	cachedModelList = null;

	const meta = buildMetaFromListItem(updated);
	const metaByModelKey = new Map<string, NewApiModelMeta>();
	if (meta) metaByModelKey.set(normalizeBillingModelKey(updated.model_name), meta);

	const [pricingSnapshot, costRows] = await Promise.all([
		getNewApiPricingSnapshot(env),
		listBillingModelCreditCosts(env.DB),
	]);
	const baseCostsByModelKey = buildBaseCostsByModelKey(costRows);

	return mapListItem(updated, {
		metaByModelKey,
		creditsByModelKey: pricingSnapshot.creditsByModelKey,
		directCreditsByModelKey: pricingSnapshot.directCreditsByModelKey,
		specCreditsByModelSpecKey: pricingSnapshot.specCreditsByModelSpecKey,
		baseCostsByModelKey,
	});
}
