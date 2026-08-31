import type { AppContext } from "../../types";
import type {
	ModelCatalogImageOptions,
	ModelCatalogModelDto,
	ModelCatalogVideoOptions,
} from "./model-catalog.schemas";
import { listModelCatalogModels } from "./model-catalog.service";
import {
	isNonSelectableCatalogModel,
	isSelectableNewApiModel,
	listNewApiModels,
	type NewApiModelDto,
} from "../new-api-models/new-api-models.service";
import {
	matchesNewApiRuntimeModelIdentity,
	type NewApiRuntimeModelIdentity,
} from "../new-api-models/new-api-model-identity";

type UnknownRecord = Record<string, unknown>;

type VendorAvailabilityFlags = {
	system: boolean;
	user: boolean;
};

export type PublicChatModelAvailability = "system" | "user" | "system+user";

export type PublicChatEnabledImageModelSummary = {
	vendorKey: string;
	modelKey: string;
	modelAlias: string | null;
	labelZh: string;
	availability: PublicChatModelAvailability;
	pricingCost: number | null;
	useCases: string[];
	imageOptions: {
		defaultAspectRatio: string | null;
		defaultImageSize: string | null;
		aspectRatioOptions: string[];
		imageSizeOptions: Array<{
			value: string;
			label: string;
			priceLabel: string | null;
		}>;
		resolutionOptions: string[];
		supportsReferenceImages: boolean | null;
		supportsTextToImage: boolean | null;
		supportsImageToImage: boolean | null;
	} | null;
};

export type PublicChatEnabledVideoModelSummary = {
	vendorKey: string;
	modelKey: string;
	modelAlias: string | null;
	labelZh: string;
	availability: PublicChatModelAvailability;
	pricingCost: number | null;
	useCases: string[];
	videoOptions: {
		defaultDurationSeconds: number | null;
		defaultResolution: string | null;
		maxDurationSeconds: number | null;
		maxReferenceImages: number | null;
		maxReferenceAudios: number | null;
		maxReferenceAudioDurationSeconds: number | null;
		supportsReferenceImages: boolean | null;
		supportsReferenceAudios: boolean | null;
		supportsNativeAudio: boolean | null;
		durationOptions: Array<{
			value: number;
			label: string;
			priceLabel: string | null;
		}>;
		sizeOptions: Array<{
			value: string;
			label: string;
			orientation: "portrait" | "landscape" | null;
			aspectRatio: string | null;
			priceLabel: string | null;
		}>;
		resolutionOptions: Array<{
			value: string;
			label: string;
			priceLabel: string | null;
		}>;
		orientationOptions: Array<{
			value: "portrait" | "landscape";
			label: string;
			size: string | null;
			aspectRatio: string | null;
		}>;
	} | null;
};

export type PublicChatVideoFinishingModelSummary = {
	modelKey: string;
	label: string;
	parameters: Array<{
		key: string;
		type: "float" | "number" | "integer" | "boolean" | "string" | "enum";
		label: string | null;
		required: boolean;
		defaultValue: string | number | boolean | null;
		minimum: number | null;
		maximum: number | null;
		options: Array<{ value: string | number; label: string }>;
	}>;
};

export type PublicChatEnabledAudioModelSummary = {
	modelKey: string;
	label: string;
	audioType: "speech" | "music";
	engine: string | null;
	pricingCost: number;
};

export type PublicChatEnabledModelCatalogSummary = {
	imageModels: PublicChatEnabledImageModelSummary[];
	videoModels: PublicChatEnabledVideoModelSummary[];
	audioModels: PublicChatEnabledAudioModelSummary[];
	videoFinishingModels?: PublicChatVideoFinishingModelSummary[];
};

export type PublicChatEnabledModelCatalogSummaryResult = {
	summary: PublicChatEnabledModelCatalogSummary | null;
	error: string | null;
};

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/**
 * The model catalog describes product-facing capabilities while new-api owns
 * the executable runtime routes. A media model is safe to show to agents only
 * when an exact, structured modelKey/modelAlias identity intersects an enabled,
 * selectable new-api modelName/requestModelKey/routingAliases. All three come
 * from the same live runtime directory. No fuzzy matching, family guessing, or
 * hard-coded alias conversion is allowed here.
 */
export function filterCatalogModelsByExecutableRuntime(
	models: readonly ModelCatalogModelDto[],
	runtimeModels: readonly NewApiRuntimeModelIdentity[],
): ModelCatalogModelDto[] {
	return models.filter((model) => {
		if (model.kind !== "image" && model.kind !== "video") return true;
		return runtimeModels.some((runtimeModel) =>
			matchesNewApiRuntimeModelIdentity(runtimeModel, model.modelKey) ||
			matchesNewApiRuntimeModelIdentity(runtimeModel, model.modelAlias),
		);
	});
}

function normalizeStringArray(values: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const normalized = normalizeNonEmptyString(value);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: null;
}

function normalizeOptionalPositiveNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: null;
}

function readModelUseCases(meta: unknown): string[] {
	if (!isRecord(meta)) return [];
	const raw = meta.useCases;
	return Array.isArray(raw) ? normalizeStringArray(raw) : [];
}

function readRuntimeParameterSummaries(
	meta: unknown,
): PublicChatVideoFinishingModelSummary["parameters"] {
	if (!isRecord(meta) || !Array.isArray(meta.runtimeParameters)) return [];
	return meta.runtimeParameters.flatMap((rawParameter) => {
		if (!isRecord(rawParameter)) return [];
		const key = normalizeNonEmptyString(rawParameter.key);
		const type = normalizeNonEmptyString(rawParameter.type);
		if (
			!key ||
			(type !== "float" && type !== "number" && type !== "integer" && type !== "boolean" &&
				type !== "string" && type !== "enum")
		) {
			return [];
		}
		const defaultValue =
			typeof rawParameter.default === "string" ||
			typeof rawParameter.default === "number" ||
			typeof rawParameter.default === "boolean"
				? rawParameter.default
				: null;
		const options = Array.isArray(rawParameter.options)
			? rawParameter.options.flatMap((rawOption) => {
					if (!isRecord(rawOption)) return [];
					const value = rawOption.value;
					const label = normalizeNonEmptyString(rawOption.label);
					return (typeof value === "string" || typeof value === "number") && label
						? [{ value, label }]
						: [];
				})
			: [];
		return [{
			key,
			type,
			label: normalizeNonEmptyString(rawParameter.label),
			required: rawParameter.required === true,
			defaultValue,
			minimum: typeof rawParameter.min === "number" && Number.isFinite(rawParameter.min)
				? rawParameter.min
				: null,
			maximum: typeof rawParameter.max === "number" && Number.isFinite(rawParameter.max)
				? rawParameter.max
				: null,
			options,
		}];
	});
}

function readImageOptions(
	meta: unknown,
): PublicChatEnabledImageModelSummary["imageOptions"] {
	if (!isRecord(meta) || !isRecord(meta.imageOptions)) return null;
	const imageOptions = meta.imageOptions as ModelCatalogImageOptions;
	const defaultAspectRatio = normalizeNonEmptyString(
		imageOptions.defaultAspectRatio,
	);
	const defaultImageSize = normalizeNonEmptyString(imageOptions.defaultImageSize);
	const aspectRatioOptions = Array.isArray(imageOptions.aspectRatioOptions)
		? normalizeStringArray(imageOptions.aspectRatioOptions)
		: [];
	const imageSizeOptions = Array.isArray(imageOptions.imageSizeOptions)
		? imageOptions.imageSizeOptions
				.map((option) => {
					if (typeof option === "string") {
						const value = normalizeNonEmptyString(option);
						if (!value) return null;
						return { value, label: value, priceLabel: null };
					}
					if (!isRecord(option)) return null;
					const value = normalizeNonEmptyString(option.value);
					const label =
						normalizeNonEmptyString(option.label) ||
						normalizeNonEmptyString(option.size) ||
						value;
					if (!value || !label) return null;
					return {
						value,
						label,
						priceLabel: normalizeNonEmptyString(
							"priceLabel" in option ? option.priceLabel : undefined,
						),
					};
				})
				.filter(
					(
						option,
					): option is {
						value: string;
						label: string;
						priceLabel: string | null;
					} => option !== null,
				)
				.filter((option, index, list) =>
					list.findIndex((item) => item.value === option.value) === index,
				)
		: [];
	const resolutionOptions = Array.isArray(imageOptions.resolutionOptions)
		? normalizeStringArray(imageOptions.resolutionOptions)
		: [];
	const supportsReferenceImages = normalizeOptionalBoolean(
		imageOptions.supportsReferenceImages,
	);
	const supportsTextToImage = normalizeOptionalBoolean(
		imageOptions.supportsTextToImage,
	);
	const supportsImageToImage = normalizeOptionalBoolean(
		imageOptions.supportsImageToImage,
	);
	if (
		defaultAspectRatio === null &&
		defaultImageSize === null &&
		aspectRatioOptions.length === 0 &&
		imageSizeOptions.length === 0 &&
		resolutionOptions.length === 0 &&
		supportsReferenceImages === null &&
		supportsTextToImage === null &&
		supportsImageToImage === null
	) {
		return null;
	}
	return {
		defaultAspectRatio,
		defaultImageSize,
		aspectRatioOptions,
		imageSizeOptions,
		resolutionOptions,
		supportsReferenceImages,
		supportsTextToImage,
		supportsImageToImage,
	};
}

function readVideoOptions(
	meta: unknown,
): PublicChatEnabledVideoModelSummary["videoOptions"] {
	if (!isRecord(meta) || !isRecord(meta.videoOptions)) return null;
	const videoOptions = meta.videoOptions as ModelCatalogVideoOptions;
	const durationOptions = Array.isArray(videoOptions.durationOptions)
		? videoOptions.durationOptions
				.map((option) => {
					const label = normalizeNonEmptyString(option.label);
					const priceLabel = normalizeNonEmptyString(
						"priceLabel" in option ? option.priceLabel : undefined,
					);
					const value =
						typeof option.value === "number" && Number.isFinite(option.value)
							? Math.trunc(option.value)
							: null;
					if (!label || value === null || value <= 0) return null;
					return {
						value,
						label,
						priceLabel,
					};
				})
				.filter(
					(
						option,
					): option is {
						value: number;
						label: string;
						priceLabel: string | null;
					} => option !== null,
				)
		: [];
	const sizeOptions = Array.isArray(videoOptions.sizeOptions)
		? videoOptions.sizeOptions
				.map((option) => {
					const value = normalizeNonEmptyString(option.value);
					const label = normalizeNonEmptyString(option.label);
					if (!value || !label) return null;
					return {
						value,
						label,
						orientation:
							option.orientation === "portrait" || option.orientation === "landscape"
								? option.orientation
								: null,
						aspectRatio: normalizeNonEmptyString(option.aspectRatio),
						priceLabel: normalizeNonEmptyString(
							"priceLabel" in option ? option.priceLabel : undefined,
						),
					};
				})
				.filter(
					(
						option,
					): option is {
						value: string;
						label: string;
						orientation: "portrait" | "landscape" | null;
						aspectRatio: string | null;
						priceLabel: string | null;
					} => option !== null,
				)
		: [];
	const resolutionOptions = Array.isArray(videoOptions.resolutionOptions)
		? videoOptions.resolutionOptions
				.map((option) => {
					const value = normalizeNonEmptyString(option.value);
					const label = normalizeNonEmptyString(option.label);
					if (!value || !label) return null;
					return {
						value,
						label,
						priceLabel: normalizeNonEmptyString(
							"priceLabel" in option ? option.priceLabel : undefined,
						),
					};
				})
				.filter(
					(
						option,
					): option is {
						value: string;
						label: string;
						priceLabel: string | null;
					} => option !== null,
				)
		: [];
	const orientationOptions = Array.isArray(videoOptions.orientationOptions)
		? videoOptions.orientationOptions
				.map((option) => {
					const label = normalizeNonEmptyString(option.label);
					if (
						!label ||
						(option.value !== "portrait" && option.value !== "landscape")
					) {
						return null;
					}
					return {
						value: option.value,
						label,
						size: normalizeNonEmptyString(option.size),
						aspectRatio: normalizeNonEmptyString(option.aspectRatio),
					};
				})
				.filter(
					(
						option,
					): option is {
						value: "portrait" | "landscape";
						label: string;
						size: string | null;
						aspectRatio: string | null;
					} => option !== null,
				)
		: [];
	const defaultDurationSeconds =
		typeof videoOptions.defaultDurationSeconds === "number" &&
		Number.isFinite(videoOptions.defaultDurationSeconds) &&
		videoOptions.defaultDurationSeconds > 0
			? Math.trunc(videoOptions.defaultDurationSeconds)
			: null;
	const defaultResolution = normalizeNonEmptyString(videoOptions.defaultResolution);
	const maxDurationSeconds =
		durationOptions.length > 0
			? durationOptions.reduce(
					(maxValue, option) => (option.value > maxValue ? option.value : maxValue),
					0,
				)
			: defaultDurationSeconds;
	const maxReferenceImages = normalizeOptionalPositiveInteger(
		videoOptions.maxReferenceImages,
	);
	const maxReferenceAudios = normalizeOptionalPositiveInteger(
		videoOptions.maxReferenceAudios,
	);
	const maxReferenceAudioDurationSeconds = normalizeOptionalPositiveNumber(
		videoOptions.maxReferenceAudioDurationSeconds,
	);
	const supportsReferenceImages = normalizeOptionalBoolean(
		videoOptions.supportsReferenceImages,
	);
	const supportsReferenceAudios = normalizeOptionalBoolean(
		videoOptions.supportsReferenceAudios,
	);
	const supportsNativeAudio = normalizeOptionalBoolean(
		videoOptions.supportsNativeAudio,
	);
	if (
		defaultDurationSeconds === null &&
		defaultResolution === null &&
		maxDurationSeconds === null &&
		durationOptions.length === 0 &&
		sizeOptions.length === 0 &&
		resolutionOptions.length === 0 &&
		orientationOptions.length === 0 &&
		maxReferenceImages === null &&
		maxReferenceAudios === null &&
		maxReferenceAudioDurationSeconds === null &&
		supportsReferenceImages === null &&
		supportsReferenceAudios === null &&
		supportsNativeAudio === null
	) {
		return null;
	}
	return {
		defaultDurationSeconds,
		defaultResolution,
		maxDurationSeconds,
		maxReferenceImages,
		maxReferenceAudios,
		maxReferenceAudioDurationSeconds,
		supportsReferenceImages,
		supportsReferenceAudios,
		supportsNativeAudio,
		durationOptions,
		sizeOptions,
		resolutionOptions,
		orientationOptions,
	};
}

function toModelAvailability(
	flags: VendorAvailabilityFlags,
): PublicChatModelAvailability {
	if (flags.system && flags.user) return "system+user";
	return flags.system ? "system" : "user";
}

function compareModelPricing(
	a: { pricingCost: number | null; modelAlias: string | null; modelKey: string },
	b: { pricingCost: number | null; modelAlias: string | null; modelKey: string },
): number {
	const aCost = a.pricingCost ?? -1;
	const bCost = b.pricingCost ?? -1;
	if (aCost !== bCost) return bCost - aCost;
	const aIdentity = a.modelAlias || a.modelKey;
	const bIdentity = b.modelAlias || b.modelKey;
	return aIdentity.localeCompare(bIdentity);
}

function buildImageModelSummary(
	model: ModelCatalogModelDto,
	flags: VendorAvailabilityFlags,
): PublicChatEnabledImageModelSummary {
	return {
		vendorKey: model.vendorKey,
		modelKey: model.modelKey,
		modelAlias: normalizeNonEmptyString(model.modelAlias),
		labelZh: model.labelZh,
		availability: toModelAvailability(flags),
		pricingCost:
			typeof model.pricing?.cost === "number" && Number.isFinite(model.pricing.cost)
				? model.pricing.cost
				: null,
		useCases: readModelUseCases(model.meta),
		imageOptions: readImageOptions(model.meta),
	};
}

function buildVideoModelSummary(
	model: ModelCatalogModelDto,
	flags: VendorAvailabilityFlags,
): PublicChatEnabledVideoModelSummary {
	return {
		vendorKey: model.vendorKey,
		modelKey: model.modelKey,
		modelAlias: normalizeNonEmptyString(model.modelAlias),
		labelZh: model.labelZh,
		availability: toModelAvailability(flags),
		pricingCost:
			typeof model.pricing?.cost === "number" && Number.isFinite(model.pricing.cost)
				? model.pricing.cost
				: null,
		useCases: readModelUseCases(model.meta),
		videoOptions: readVideoOptions(model.meta),
	};
}

export function buildPublicChatEnabledModelCatalogSummaryFromModels(
	models: readonly ModelCatalogModelDto[],
	vendorAvailabilityMap: ReadonlyMap<string, VendorAvailabilityFlags>,
	runtimeModels: readonly (NewApiRuntimeModelIdentity & {
		displayLabel?: string;
		tags?: string[];
		kind?: NewApiModelDto["kind"];
		pricing?: NewApiModelDto["pricing"];
		meta?: unknown;
	})[] = [],
): PublicChatEnabledModelCatalogSummary {
	const imageModels: PublicChatEnabledImageModelSummary[] = [];
	const videoModels: PublicChatEnabledVideoModelSummary[] = [];
	for (const model of models) {
		if (!model.enabled) continue;
		const flags = vendorAvailabilityMap.get(model.vendorKey);
		if (!flags) continue;
		if (model.kind === "image") {
			imageModels.push(buildImageModelSummary(model, flags));
			continue;
		}
		if (model.kind === "video") {
			const runtimeModel = runtimeModels.find((candidate) =>
				matchesNewApiRuntimeModelIdentity(candidate, model.modelKey) ||
				matchesNewApiRuntimeModelIdentity(candidate, model.modelAlias),
			);
			if (runtimeModel && isNonSelectableCatalogModel(runtimeModel.modelName)) continue;
			const catalogMeta = isRecord(model.meta) ? model.meta : {};
			const runtimeVideoOptions = runtimeModel && isRecord(runtimeModel.meta) &&
				isRecord(runtimeModel.meta.videoOptions)
				? runtimeModel.meta.videoOptions
				: null;
			const runtimeBackedModel = runtimeModel
				? {
						...model,
						meta: {
							...catalogMeta,
							videoOptions: runtimeVideoOptions ?? {},
						},
					}
				: model;
			videoModels.push(buildVideoModelSummary(runtimeBackedModel, flags));
		}
	}
	imageModels.sort(compareModelPricing);
	videoModels.sort(compareModelPricing);
	const seenFinishingModels = new Set<string>();
	const videoFinishingModels = runtimeModels.flatMap((runtimeModel) => {
		if (!isNonSelectableCatalogModel(runtimeModel.modelName)) return [];
		const modelKey = normalizeNonEmptyString(runtimeModel.requestModelKey) ||
			normalizeNonEmptyString(runtimeModel.modelName);
		if (!modelKey || seenFinishingModels.has(modelKey)) return [];
		seenFinishingModels.add(modelKey);
		const catalogModel = models.find((model) =>
			matchesNewApiRuntimeModelIdentity(runtimeModel, model.modelKey) ||
			matchesNewApiRuntimeModelIdentity(runtimeModel, model.modelAlias),
		);
		return [{
			modelKey,
			label: normalizeNonEmptyString(catalogModel?.labelZh) ||
				normalizeNonEmptyString(runtimeModel.modelName) || modelKey,
			parameters: readRuntimeParameterSummaries(runtimeModel.meta),
		}];
	});
	const audioModels = runtimeModels.flatMap((runtimeModel) => {
		if (runtimeModel.kind !== "audio" || !Array.isArray(runtimeModel.tags)) return [];
		const modelKey = normalizeNonEmptyString(runtimeModel.requestModelKey);
		const pricingCost = runtimeModel.pricing?.enabled === true &&
			typeof runtimeModel.pricing.cost === "number" &&
			Number.isFinite(runtimeModel.pricing.cost) && runtimeModel.pricing.cost > 0
			? runtimeModel.pricing.cost
			: null;
		if (!modelKey || pricingCost === null) return [];
		const normalizedTags = runtimeModel.tags.map((tag) => tag.trim().toLowerCase());
		const audioType = normalizedTags.includes("tapcanvas:audio-type=speech")
			? "speech" as const
			: normalizedTags.includes("tapcanvas:audio-type=music")
				? "music" as const
				: null;
		if (!audioType) return [];
		const engineTag = normalizedTags.find((tag) => tag.startsWith("tapcanvas:audio-engine="));
		return [{
			modelKey,
			label: normalizeNonEmptyString(runtimeModel.displayLabel) || modelKey,
			audioType,
			engine: engineTag?.slice("tapcanvas:audio-engine=".length) || null,
			pricingCost,
		}];
	});
	audioModels.sort((a, b) => a.pricingCost - b.pricingCost || a.modelKey.localeCompare(b.modelKey));
	return {
		imageModels,
		videoModels,
		audioModels,
		videoFinishingModels,
	};
}

function findRuntimeCatalogMetadata(
	models: readonly ModelCatalogModelDto[],
	runtimeModel: NewApiRuntimeModelIdentity,
): ModelCatalogModelDto | undefined {
	return models.find((model) =>
		matchesNewApiRuntimeModelIdentity(runtimeModel, model.modelKey) ||
		matchesNewApiRuntimeModelIdentity(runtimeModel, model.modelAlias),
	);
}

function mergeRuntimeMeta(
	catalogMeta: unknown,
	runtimeMeta: unknown,
	optionsKey: "imageOptions" | "videoOptions",
): UnknownRecord {
	const catalogRecord = isRecord(catalogMeta) ? catalogMeta : {};
	const runtimeRecord = isRecord(runtimeMeta) ? runtimeMeta : {};
	const runtimeOptions = isRecord(runtimeRecord[optionsKey])
		? runtimeRecord[optionsKey]
		: null;
	return {
		...catalogRecord,
		...runtimeRecord,
		...(runtimeOptions ? { [optionsKey]: runtimeOptions } : {}),
	};
}

/**
 * new-api is the execution router for public media tasks, so its fresh,
 * selectable runtime directory is the authority for whether a model can be
 * submitted. The local product catalog may enrich labels and use cases, but it
 * must never hide a currently executable runtime model or rewrite the exact
 * requestModelKey that new-api accepts.
 */
export function buildPublicChatExecutableModelCatalogSummary(
	models: readonly ModelCatalogModelDto[],
	runtimeModels: readonly NewApiModelDto[],
): PublicChatEnabledModelCatalogSummary {
	const imageModels: PublicChatEnabledImageModelSummary[] = [];
	const videoModels: PublicChatEnabledVideoModelSummary[] = [];
	const seenImageModelKeys = new Set<string>();
	const seenVideoModelKeys = new Set<string>();

	for (const runtimeModel of runtimeModels) {
		if (!isSelectableNewApiModel(runtimeModel)) continue;
		if (runtimeModel.kind !== "image" && runtimeModel.kind !== "video") continue;
		const modelKey = normalizeNonEmptyString(runtimeModel.requestModelKey);
		if (!modelKey) continue;
		const catalogModel = findRuntimeCatalogMetadata(models, runtimeModel);
		const modelAlias = normalizeNonEmptyString(runtimeModel.modelName);
		const labelZh = normalizeNonEmptyString(catalogModel?.labelZh) ||
			normalizeNonEmptyString(runtimeModel.displayLabel) || modelKey;
		const pricingCost = runtimeModel.pricing?.enabled === true &&
			typeof runtimeModel.pricing.cost === "number" &&
			Number.isFinite(runtimeModel.pricing.cost)
				? runtimeModel.pricing.cost
				: null;
		const useCases = readModelUseCases(catalogModel?.meta);

		if (runtimeModel.kind === "image") {
			if (seenImageModelKeys.has(modelKey)) continue;
			seenImageModelKeys.add(modelKey);
			imageModels.push({
				vendorKey: "newapi",
				modelKey,
				modelAlias: modelAlias === modelKey ? null : modelAlias,
				labelZh,
				availability: "system",
				pricingCost,
				useCases,
				imageOptions: readImageOptions(
					mergeRuntimeMeta(catalogModel?.meta, runtimeModel.meta, "imageOptions"),
				),
			});
			continue;
		}

		if (isNonSelectableCatalogModel(runtimeModel.modelName)) continue;
		if (seenVideoModelKeys.has(modelKey)) continue;
		seenVideoModelKeys.add(modelKey);
		videoModels.push({
			vendorKey: "newapi",
			modelKey,
			modelAlias: modelAlias === modelKey ? null : modelAlias,
			labelZh,
			availability: "system",
			pricingCost,
			useCases,
			videoOptions: readVideoOptions(
				mergeRuntimeMeta(catalogModel?.meta, runtimeModel.meta, "videoOptions"),
			),
		});
	}

	imageModels.sort(compareModelPricing);
	videoModels.sort(compareModelPricing);
	const runtimeOnlySummary = buildPublicChatEnabledModelCatalogSummaryFromModels(
		[],
		new Map(),
		runtimeModels,
	);
	return {
		imageModels,
		videoModels,
		audioModels: runtimeOnlySummary.audioModels,
		videoFinishingModels: runtimeOnlySummary.videoFinishingModels,
	};
}

export async function loadPublicChatEnabledModelCatalogSummary(
	c: AppContext,
	userId: string,
): Promise<PublicChatEnabledModelCatalogSummaryResult> {
	void userId;
	try {
		const [models, runtimeModels] = await Promise.all([
			listModelCatalogModels(c, { enabled: true }),
			// Agent execution contracts must observe the current executable
			// directory. A process-local five-minute catalog/pricing snapshot is
			// valid for passive lists, but it can otherwise make a newly enabled
			// model disappear from a freshly submitted logical task.
			listNewApiModels(c.env, { enabled: true, fresh: true }),
		]);
		const executableRuntimeModels = runtimeModels.filter(isSelectableNewApiModel);
		const summary = buildPublicChatExecutableModelCatalogSummary(
			models,
			executableRuntimeModels,
		);
		if (
			summary.imageModels.length === 0 &&
			summary.videoModels.length === 0 &&
			summary.audioModels.length === 0
		) {
			console.warn("[public-chat-model-catalog] executable media projection is empty", {
				enabledCatalogModelCount: models.length,
				runtimeModelCount: runtimeModels.length,
				executableRuntimeModelCount: executableRuntimeModels.length,
			});
		}

		return {
			summary,
			error: null,
		};
	} catch (error) {
		const message =
			error instanceof Error && error.message.trim()
				? error.message.trim()
				: "enabled model catalog summary unavailable";
		return {
			summary: null,
			error: message,
		};
	}
}
