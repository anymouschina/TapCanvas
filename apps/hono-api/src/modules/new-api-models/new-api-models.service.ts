import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import type { WorkerEnv } from "../../types";
import { AppError } from "../../middleware/error";
import { normalizeBillingModelKey } from "../billing/billing.models";
import {
	getNewApiPricingSnapshot,
	type NewApiPricingSnapshot,
} from "../billing/new-api-pricing";
import {
	resolveVideoAnalysisUpfrontPricing,
	VIDEO_ANALYSIS_CAPABILITY_TAG,
	type VideoAnalysisUpfrontPricing,
} from "../billing/video-analysis-upfront-pricing";
import {
	ModelCatalogVideoOptionsSchema,
	ModelCatalogImageOptionsSchema,
	ModelParamSpecSchema,
	type ModelParamSpec,
	type ModelCatalogVideoOptions,
	type ModelCatalogImageOptions,
} from "../model-catalog/model-catalog.schemas";

export {
	matchesNewApiRuntimeModelIdentity,
} from "./new-api-model-identity";
export type {
	NewApiRuntimeModelIdentity,
} from "./new-api-model-identity";

export type NewApiModelKind = "text" | "image" | "video" | "audio";

type UnknownRecord = Record<string, unknown>;

type NewApiModelMeta = UnknownRecord & {
	videoOptions?: UnknownRecord;
	imageOptions?: UnknownRecord;
	runtimeParameters?: ModelParamSpec[];
};

export type NewApiModelDto = {
	id: number;
	modelName: string;
	requestModelKey: string;
	routingAliases: string[];
	displayLabel: string;
	description: string | null;
	icon: string | null;
	tags: string[];
	vendorId: number | null;
	endpoints: string[];
	runtimeEndpoints: string[];
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
	videoAnalysisPricing?: VideoAnalysisUpfrontPricing;
};

export type NewApiGatewayReadinessDto = {
	ready: boolean;
	enabledModelCount: number;
	configuredChannelCount: number;
	executableModelCount: number;
	reasons: Array<
		| "no_enabled_models"
		| "no_configured_channels"
		| "no_executable_models"
	>;
	setupUrl: string;
	recommendedProvider: {
		name: string;
		baseUrl: string;
		registerUrl: string;
		topupUrl: string;
		tokenUrl: string;
	};
};

type NewApiGatewayReadinessResponse = {
	success?: unknown;
	data?: unknown;
};

type NewApiGatewayReadinessData = {
	ready?: unknown;
	enabled_model_count?: unknown;
	configured_channel_count?: unknown;
	executable_model_count?: unknown;
	reasons?: unknown;
};

const NEW_API_GATEWAY_READINESS_REASONS = new Set([
	"no_enabled_models",
	"no_configured_channels",
	"no_executable_models",
]);

function readNonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function readGatewaySetupUrl(env: WorkerEnv): string {
	const processEnv = globalThis.process?.env;
	const raw = String(
		env.NEW_API_PUBLIC_BASE_URL ?? processEnv?.NEW_API_PUBLIC_BASE_URL ?? "",
	).trim();
	if (!raw) {
		throw new AppError("NEW_API_PUBLIC_BASE_URL 未配置", {
			status: 500,
			code: "new_api_public_base_url_missing",
		});
	}

	let baseUrl: URL;
	try {
		baseUrl = new URL(raw);
	} catch (error) {
		throw new AppError("NEW_API_PUBLIC_BASE_URL 不是合法 URL", {
			status: 500,
			code: "new_api_public_base_url_invalid",
			details: { message: error instanceof Error ? error.message : String(error) },
		});
	}
	if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
		throw new AppError("NEW_API_PUBLIC_BASE_URL 仅支持 http/https", {
			status: 500,
			code: "new_api_public_base_url_invalid",
			details: { protocol: baseUrl.protocol },
		});
	}
	return new URL("/console/channel", baseUrl).toString();
}

function readRecommendedProvider(env: WorkerEnv): NewApiGatewayReadinessDto["recommendedProvider"] {
	const processEnv = globalThis.process?.env;
	const raw = String(
		env.NEW_API_RECOMMENDED_PROVIDER_BASE_URL
			?? processEnv?.NEW_API_RECOMMENDED_PROVIDER_BASE_URL
			?? "https://tt-api.lluban.com",
	).trim();
	let baseUrl: URL;
	try {
		baseUrl = new URL(raw);
	} catch (error) {
		throw new AppError("NEW_API_RECOMMENDED_PROVIDER_BASE_URL 不是合法 URL", {
			status: 500,
			code: "new_api_recommended_provider_url_invalid",
			details: { message: error instanceof Error ? error.message : String(error) },
		});
	}
	if (baseUrl.protocol !== "https:") {
		throw new AppError("推荐渠道站点必须使用 HTTPS", {
			status: 500,
			code: "new_api_recommended_provider_url_invalid",
			details: { protocol: baseUrl.protocol },
		});
	}
	return {
		name: "鲁班 API",
		baseUrl: baseUrl.toString(),
		registerUrl: new URL("/register", baseUrl).toString(),
		topupUrl: new URL("/console/topup", baseUrl).toString(),
		tokenUrl: new URL("/console/token", baseUrl).toString(),
	};
}

export async function getNewApiGatewayReadiness(
	env: WorkerEnv,
): Promise<NewApiGatewayReadinessDto> {
	const config = requireRelayConfig(env);
	const url = `${config.baseUrl}/api/internal/readiness`;
	let response: Response;
	try {
		response = await fetchWithHttpDebugLog(
			{ env } as never,
			url,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${config.token}`,
					Accept: "application/json",
				},
			},
			{ tag: "new-api-gateway-readiness" },
		);
	} catch (error) {
		throw new AppError("new-api 就绪状态网络请求失败", {
			status: 502,
			code: "new_api_readiness_request_failed",
			details: { message: error instanceof Error ? error.message : String(error) },
		});
	}

	if (!response.ok) {
		const upstreamBody = await response.text().catch(() => "");
		throw new AppError("new-api 就绪状态请求失败", {
			status: 502,
			code: "new_api_readiness_request_failed",
			details: {
				upstreamStatus: response.status,
				upstreamBody: upstreamBody.slice(0, 2_000),
			},
		});
	}

	let payload: NewApiGatewayReadinessResponse;
	try {
		payload = await response.json() as NewApiGatewayReadinessResponse;
	} catch (error) {
		throw new AppError("new-api 就绪状态响应不是合法 JSON", {
			status: 502,
			code: "new_api_readiness_invalid",
			details: { message: error instanceof Error ? error.message : String(error) },
		});
	}

	const data = payload.data as NewApiGatewayReadinessData | null | undefined;
	const enabledModelCount = readNonNegativeInteger(data?.enabled_model_count);
	const configuredChannelCount = readNonNegativeInteger(data?.configured_channel_count);
	const executableModelCount = readNonNegativeInteger(data?.executable_model_count);
	const rawReasons = Array.isArray(data?.reasons) ? data.reasons : null;
	const reasons = rawReasons?.filter(
		(reason): reason is NewApiGatewayReadinessDto["reasons"][number] =>
			typeof reason === "string" && NEW_API_GATEWAY_READINESS_REASONS.has(reason),
	) ?? null;
	if (
		payload.success !== true ||
		typeof data?.ready !== "boolean" ||
		enabledModelCount === null ||
		configuredChannelCount === null ||
		executableModelCount === null ||
		!rawReasons ||
		!reasons ||
		reasons.length !== rawReasons.length
	) {
		throw new AppError("new-api 就绪状态响应结构无效", {
			status: 502,
			code: "new_api_readiness_invalid",
		});
	}

	return {
		ready: data.ready,
		enabledModelCount,
		configuredChannelCount,
		executableModelCount,
		reasons,
		setupUrl: readGatewaySetupUrl(env),
		recommendedProvider: readRecommendedProvider(env),
	};
}

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
	routing_aliases?: string[];
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
let modelListRefreshPromise: Promise<NewApiModelListItem[]> | null = null;
const MODEL_LIST_CACHE_TTL_MS = 5 * 60_000;

async function doFetchNewApiModelList(env: WorkerEnv): Promise<NewApiModelListItem[]> {
	const config = requireRelayConfig(env);
	const url = `${config.baseUrl}/api/models/list?enabled=true&require_video_spec=true`;

	let response: Response;
	try {
		response = await fetchWithHttpDebugLog(
			{ env } as never,
			// require_video_spec drops video models whose params_def lacks a
			// `resolution` enum — without it the consumer cannot surface per-spec
			// pricing and the model degrades to a flat fallback (e.g. 14 credits
			// regardless of duration), which is misleading to end users.
			url,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${config.token}`,
					Accept: "application/json",
				},
			},
			{ tag: "new-api-model-list" },
		);
	} catch (error) {
		throw new AppError("new-api 模型目录网络请求失败", {
			status: 502,
			code: "new_api_model_list_request_failed",
			details: {
				reason: "network_error",
				url,
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}

	if (!response.ok) {
		const upstreamBody = await response.text().catch(() => "");
		throw new AppError("new-api 模型目录请求失败", {
			status: 502,
			code: "new_api_model_list_request_failed",
			details: {
				upstreamStatus: response.status,
				upstreamBody: upstreamBody.slice(0, 2_000),
			},
		});
	}

	let json: unknown;
	try {
		json = await response.json();
	} catch (error) {
		throw new AppError("new-api 模型目录响应不是合法 JSON", {
			status: 502,
			code: "new_api_model_list_invalid",
			details: {
				reason: "invalid_json",
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
	if (typeof json !== "object" || json === null || Array.isArray(json)) {
		throw new AppError("new-api 模型目录响应结构无效", {
			status: 502,
			code: "new_api_model_list_invalid",
			details: { reason: "response_not_object" },
		});
	}

	const data = (json as { data?: unknown }).data;
	if (!Array.isArray(data)) {
		throw new AppError("new-api 模型目录响应缺少 data 数组", {
			status: 502,
			code: "new_api_model_list_invalid",
			details: { reason: "data_not_array" },
		});
	}
	return data as NewApiModelListItem[];
}

async function refreshNewApiModelList(env: WorkerEnv): Promise<NewApiModelListItem[]> {
	if (modelListRefreshPromise) return modelListRefreshPromise;

	modelListRefreshPromise = doFetchNewApiModelList(env)
		.then((rows) => {
			cachedModelList = { expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS, rows };
			return rows;
		})
		.finally(() => {
			modelListRefreshPromise = null;
		});
	return modelListRefreshPromise;
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
	// Cold or expired cache must wait for a successful refresh. A failed refresh
	// remains an explicit failure and never turns stale rows into apparent success.
	return refreshNewApiModelList(env);
}

function readPositiveParamMaximum(
	params: ModelParamSpec[],
	key: string,
): number | undefined {
	const maximum = params.find((param) => param.key === key)?.max;
	return typeof maximum === "number" && Number.isFinite(maximum) && maximum > 0
		? maximum
		: undefined;
}

function paramsToVideoOptions(
	params: ModelParamSpec[],
	capabilities: string[],
): ModelCatalogVideoOptions {
	const duration = params.find((p) => p.key === "duration");
	const size = params.find((p) => p.key === "size");
	const resolution = params.find((p) => p.key === "resolution");
	const capabilitySet = new Set(
		capabilities.map((capability) => capability.trim().toLowerCase()).filter(Boolean),
	);
	const supports = (capability: string): true | undefined =>
		capabilitySet.has(capability) ? true : undefined;

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
		maxReferenceImages: readPositiveParamMaximum(params, "reference_images"),
		maxReferenceVideos: readPositiveParamMaximum(params, "reference_videos"),
		maxReferenceAudios: readPositiveParamMaximum(params, "reference_audios"),
		maxReferenceMedia: readPositiveParamMaximum(params, "reference_media"),
		maxReferenceVideoDurationSeconds: readPositiveParamMaximum(
			params,
			"reference_video_duration_seconds",
		),
		maxReferenceAudioDurationSeconds: readPositiveParamMaximum(
			params,
			"reference_audio_duration_seconds",
		),
		maxReferenceAudioTotalDurationSeconds: readPositiveParamMaximum(
			params,
			"reference_audio_total_duration_seconds",
		),
		maxVideoExtensionDurationSeconds: readPositiveParamMaximum(
			params,
			"video_extension_duration_seconds",
		),
		maxNestedVideoDurationSeconds: readPositiveParamMaximum(
			params,
			"nested_video_duration_seconds",
		),
		maxUltraLongDurationSeconds: readPositiveParamMaximum(
			params,
			"ultra_long_duration_seconds",
		),
		supportsMultimodalReferences: supports("multimodal_reference"),
		supportsReferenceImages: supports("reference_images"),
		supportsReferenceVideos: supports("reference_videos"),
		supportsReferenceAudios: supports("reference_audios"),
		supportsAudioOnlyReference: supports("audio_only_reference"),
		supportsFirstLastFrame: supports("first_last_frame"),
		supportsVideoEditing: supports("video_editing"),
		supportsVideoSubjectRemoval: supports("video_subject_removal"),
		supportsVideoSubtitleRemoval: supports("video_subtitle_removal"),
		supportsVideoExtension: supports("video_extension"),
		supportsUltraLongVideo: supports("ultra_long_video"),
		supportsTimestampPrompt: supports("timestamp_prompt"),
		supportsNativeAudio: supports("native_audio"),
	};

	return ModelCatalogVideoOptionsSchema.parse(raw);
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

function normalizeRuntimeParameter(rawParam: unknown): ModelParamSpec | null {
	if (!rawParam || typeof rawParam !== "object" || Array.isArray(rawParam)) return null;
	const record = rawParam as UnknownRecord;
	const explicitType = typeof record.type === "string" ? record.type.trim() : "";
	const inferredType = explicitType || (Array.isArray(record.options) ? "enum" : "");
	if (!inferredType) return null;
	const parsed = ModelParamSpecSchema.safeParse({
		...record,
		type: inferredType,
	});
	return parsed.success ? parsed.data : null;
}


function buildMetaFromListItem(item: NewApiModelListItem): NewApiModelMeta | null {
	const kind = (item.kind ?? "").trim().toLowerCase();
	if (!kind || !item.params_def) return null;
	try {
		const rawParams: unknown = JSON.parse(item.params_def);
		if (!Array.isArray(rawParams) || rawParams.length === 0) return null;
		const params = rawParams.flatMap((rawParam, index) => {
			const normalized = normalizeRuntimeParameter(rawParam);
			if (!normalized) {
				console.warn("[new-api-models] runtime parameter excluded because its structure is invalid", {
					modelName: item.model_name,
					kind,
					parameterIndex: index,
				});
			}
			return normalized ? [normalized] : [];
		});
		if (params.length === 0) return null;
		const meta: NewApiModelMeta = { runtimeParameters: params };
		if (kind === "video") {
			meta.videoOptions = paramsToVideoOptions(
				params,
				parseStringList(item.capabilities),
			);
		} else if (kind === "image") {
			meta.imageOptions = paramsToImageOptions(params);
			meta.useCases = paramsToUseCases(params);
		}
		return Object.keys(meta).length > 0 ? meta : null;
	} catch {
		return null;
	}
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
		if (normalized === "tapcanvas:kind=audio") return "audio";
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
		case "audio": return "audio";
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
	const hasUnitCost =
		typeof input.unitCost === "number" &&
		Number.isFinite(input.unitCost) &&
		input.unitCost > 0;
	if (!hasUnitCost) return [];

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
			const cost = Math.max(0, Math.floor(input.unitCost ?? 0));
			if (cost <= 0) continue;
			out.push({ specKey, cost, enabled: input.pricingEnabled });
		}
	}
	return out;
}

function buildSyntheticImageSpecCosts(input: {
	meta: NewApiModelMeta | null;
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
		const cost = Math.max(0, Math.ceil(input.unitCost ?? 0));
		if (cost <= 0) continue;
		out.push({ specKey, cost, enabled: input.pricingEnabled });
	}
	return out;
}

function extractRequestModelKey(modelName: string, tags: string[]): string {
	for (const tag of tags) {
		const normalized = tag.trim();
		if (normalized.startsWith("tapcanvas:request-model=")) {
			const value = normalized.slice("tapcanvas:request-model=".length).trim();
			if (value) return value;
		}
	}
	return modelName;
}

function mapListItem(
	item: NewApiModelListItem,
	input?: {
		creditsPerCny?: number;
		metaByModelKey?: Map<string, NewApiModelMeta>;
		creditsByModelKey?: Map<string, number>;
		directCreditsByModelKey?: Map<string, number>;
		supportedEndpointTypesByModelKey?: Map<string, string[]>;
		specCreditsByModelSpecKey?: Map<string, number>;
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
	const requestModelKey = extractRequestModelKey(modelName, tags);
	const routingAliases = Array.from(
		new Set(
			(Array.isArray(item.routing_aliases) ? item.routing_aliases : [])
				.map((alias) => String(alias ?? "").trim())
				.filter(Boolean),
		),
	);
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
			...routingAliases.flatMap((alias) =>
				expandChannelAliasModelKeys(normalizeBillingModelKey(alias)),
			),
		]),
	);
	const meta =
		input?.metaByModelKey && metaLookupKeys.length > 0
			? resolveMetaByModelKeys(input.metaByModelKey, metaLookupKeys)
			: null;
	const runtimeEndpoints = (() => {
		const runtimeEndpointMap = input?.supportedEndpointTypesByModelKey;
		if (!runtimeEndpointMap || metaLookupKeys.length === 0) return [];
		const endpoints = new Set<string>();
		for (const lookupKey of metaLookupKeys) {
			for (const endpoint of runtimeEndpointMap.get(lookupKey) ?? []) {
				if (endpoint) endpoints.add(endpoint);
			}
		}
		return Array.from(endpoints);
	})();
	const snapshotCost =
		input?.creditsByModelKey?.get(normalizedModelName) ??
		input?.creditsByModelKey?.get(normalizedRequestModelKey);
	const directSnapshotCost =
		input?.directCreditsByModelKey?.get(normalizedModelName) ??
		input?.directCreditsByModelKey?.get(normalizedRequestModelKey) ??
		null;
	const pricingEnabled = item.status === 1;
	const declaresVideoAnalysis = tags.some(
		(tag) => tag.trim().toLowerCase() === VIDEO_ANALYSIS_CAPABILITY_TAG,
	);
	const videoAnalysisPricing = declaresVideoAnalysis
		&& typeof input?.creditsPerCny === "number"
		? resolveVideoAnalysisUpfrontPricing({
				modelKey: requestModelKey,
				creditsPerCny: input.creditsPerCny,
			})
		: null;
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
							: null,
					pricingEnabled,
					specCreditsBySpecKey: snapshotSpecCreditsForModel,
				})
			: kind === "image"
				? buildSyntheticImageSpecCosts({
						meta,
						unitCost:
							typeof directSnapshotCost === "number" && Number.isFinite(directSnapshotCost)
								? directSnapshotCost
								: null,
						pricingEnabled,
						specCreditsBySpecKey: snapshotSpecCreditsForModel,
					})
				: [];
	const minimumSpecCost = specCosts.reduce<number | null>(
		(current, row) => current === null || row.cost < current ? row.cost : current,
		null,
	);
	const resolvedCost =
		typeof snapshotCost === "number" && Number.isFinite(snapshotCost)
			? snapshotCost
			: minimumSpecCost;

	return {
		id: Math.trunc(item.id),
		modelName,
		requestModelKey,
		routingAliases,
		displayLabel,
		description,
		icon: typeof item.icon === "string" ? item.icon.trim() || null : null,
		tags,
		vendorId:
			typeof item.vendor_id === "number" && Number.isFinite(item.vendor_id)
				? Math.trunc(item.vendor_id)
				: null,
		endpoints,
		runtimeEndpoints,
		kind,
		enabled: item.status === 1,
		syncOfficial: item.sync_official === 1,
		nameRule: Math.trunc(item.name_rule ?? 0),
		createdTime: Math.trunc(item.created_time ?? 0),
		updatedTime: Math.trunc(item.updated_time ?? 0),
		meta,
		...(videoAnalysisPricing ? { videoAnalysisPricing } : {}),
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
	options?: {
		enabled?: boolean;
		kind?: NewApiModelKind;
		fresh?: boolean;
		pricingSnapshot?: NewApiPricingSnapshot;
	},
): Promise<NewApiModelDto[]> {
	const [modelRows, pricingSnapshot] = await Promise.all([
		fetchNewApiModelList(env, { fresh: options?.fresh === true }),
		options?.pricingSnapshot ??
			getNewApiPricingSnapshot(env, { fresh: options?.fresh === true }),
	]);

	const metaByModelKey = new Map<string, NewApiModelMeta>();
	for (const row of modelRows) {
		const meta = buildMetaFromListItem(row);
		if (meta) {
			metaByModelKey.set(normalizeBillingModelKey(row.model_name), meta);
		}
	}

	let mapped = modelRows.map((row) =>
		mapListItem(row, {
			creditsPerCny: pricingSnapshot.creditsPerCny,
			metaByModelKey,
			creditsByModelKey: pricingSnapshot.creditsByModelKey,
			directCreditsByModelKey: pricingSnapshot.directCreditsByModelKey,
			supportedEndpointTypesByModelKey:
				pricingSnapshot.supportedEndpointTypesByModelKey,
			specCreditsByModelSpecKey: pricingSnapshot.specCreditsByModelSpecKey,
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

// A user-selectable model must be enabled in metadata, have at least one
// endpoint published by an enabled channel with a valid explicit protocol, and
// have a positive current runtime price. Management views still use
// listNewApiModels directly so administrators can see and repair invalid rows.
export function isSelectableNewApiModel(
	item: Pick<NewApiModelDto, "enabled" | "pricing" | "runtimeEndpoints">,
): boolean {
	if (
		!item.enabled ||
		item.runtimeEndpoints.length === 0 ||
		!item.pricing ||
		item.pricing.enabled === false
	) {
		return false;
	}
	return (
		typeof item.pricing.cost === "number" &&
		Number.isFinite(item.pricing.cost) &&
		item.pricing.cost > 0
	);
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

// Video-kind models that live in the catalog for billing/relay purposes but are
// NOT user-selectable *generation* models — each backs a specific node action
// (e.g. volc-enhance-video → 画质增强 / video_enhance) invoked by a hardcoded
// modelKey, never chosen from the model dropdown.
//
// IMPORTANT: This exclusion must be applied ONLY in the public catalog HTTP route
// (the dropdown + recharge pricing drawer), NEVER inside listNewApiModels itself:
//   - task.service.ts uses listNewApiModels as an "is this model enabled?" guard;
//     dropping the row there would reject the enhance task (new_api_model_disabled).
//   - billing.service.ts uses it for requestKey↔modelName price translation.
const NON_SELECTABLE_CATALOG_MODEL_NAMES = new Set<string>([
	"volc-enhance-video",
	"volc-erase-video-subtitle",
	"volc-erase-video-subtitle-pro",
	"volc-matte-greenscreen-video",
]);

export function isNonSelectableCatalogModel(modelName: string): boolean {
	return NON_SELECTABLE_CATALOG_MODEL_NAMES.has(
		String(modelName || "").trim().toLowerCase(),
	);
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

	const pricingSnapshot = await getNewApiPricingSnapshot(env);

	return mapListItem(updated, {
		creditsPerCny: pricingSnapshot.creditsPerCny,
		metaByModelKey,
		creditsByModelKey: pricingSnapshot.creditsByModelKey,
		directCreditsByModelKey: pricingSnapshot.directCreditsByModelKey,
		supportedEndpointTypesByModelKey:
			pricingSnapshot.supportedEndpointTypesByModelKey,
		specCreditsByModelSpecKey: pricingSnapshot.specCreditsByModelSpecKey,
	});
}
