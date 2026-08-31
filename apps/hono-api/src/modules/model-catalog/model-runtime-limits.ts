import type { AppContext } from "../../types";
import {
	getCatalogModelByVendorAndKey,
	listCatalogModelsByModelAlias,
	listCatalogModelsByModelKey,
	upsertCatalogModelRow,
} from "./model-catalog.repo";

type UnknownRecord = Record<string, unknown>;

export type ModelRuntimeLimits = {
	contextWindow?: number;
	maxOutput?: number;
	discoveredAt?: string;
	source?: string;
};

export type ModelOutputBudget = {
	contextWindow: number;
	maxOutput: number;
	inputTokens: number;
	availableOutputTokens: number;
	effectiveMaxOutput: number;
	source: string;
};

type StaticLimitEntry = {
	contextWindow: number;
	maxOutput: number;
};

const DEFAULT_LIMITS: StaticLimitEntry = {
	contextWindow: 32_000,
	maxOutput: 4_096,
};

const STATIC_LIMITS: Record<string, StaticLimitEntry> = {
	"deepseek-v3": { contextWindow: 128_000, maxOutput: 8_192 },
	"deepseek-v3.2": { contextWindow: 128_000, maxOutput: 8_192 },
	"deepseek-r1": { contextWindow: 128_000, maxOutput: 16_384 },
	"claude-": { contextWindow: 200_000, maxOutput: 4_096 },
	"gpt-5": { contextWindow: 128_000, maxOutput: 16_384 },
	"gpt-4.1": { contextWindow: 128_000, maxOutput: 16_384 },
	"gpt-4o": { contextWindow: 128_000, maxOutput: 16_384 },
	"gemini-2.5-flash": { contextWindow: 1_048_576, maxOutput: 65_536 },
	"gemini-2.5-pro": { contextWindow: 1_048_576, maxOutput: 65_536 },
	"gemini-": { contextWindow: 1_048_576, maxOutput: 65_536 },
	"glm-4.7": { contextWindow: 200_000, maxOutput: 128_000 },
	"glm-": { contextWindow: 128_000, maxOutput: 8_192 },
};

const SORTED_STATIC_KEYS = Object.keys(STATIC_LIMITS).sort(
	(a, b) => b.length - a.length,
);

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModelName(value: string): string {
	const trimmed = String(value || "").trim();
	if (!trimmed) return "";
	return trimmed.startsWith("models/") ? trimmed.slice(7).toLowerCase() : trimmed.toLowerCase();
}

function parsePositiveInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		const parsed = Number.parseInt(value.trim(), 10);
		return parsed > 0 ? parsed : undefined;
	}
	return undefined;
}

function readRuntimeLimitsFromMeta(meta: unknown): ModelRuntimeLimits | null {
	if (!isRecord(meta)) return null;
	const runtimeLimits = isRecord(meta.runtimeLimits) ? meta.runtimeLimits : null;
	if (!runtimeLimits) return null;
	const contextWindow = parsePositiveInt(runtimeLimits.contextWindow);
	const maxOutput = parsePositiveInt(runtimeLimits.maxOutput);
	if (!contextWindow && !maxOutput) return null;
	return {
		...(contextWindow ? { contextWindow } : {}),
		...(maxOutput ? { maxOutput } : {}),
		...(typeof runtimeLimits.discoveredAt === "string"
			? { discoveredAt: runtimeLimits.discoveredAt }
			: {}),
		...(typeof runtimeLimits.source === "string"
			? { source: runtimeLimits.source }
			: {}),
	};
}

function lookupStaticLimits(modelName: string): StaticLimitEntry {
	const normalized = normalizeModelName(modelName);
	for (const key of SORTED_STATIC_KEYS) {
		if (normalized.startsWith(key)) return STATIC_LIMITS[key];
	}
	return DEFAULT_LIMITS;
}

function estimateTokens(text: string): number {
	const length = String(text || "").trim().length;
	if (!length) return 0;
	return Math.ceil(length / 1.5);
}

async function resolveCatalogRow(input: {
	c: AppContext;
	vendorKey?: string | null;
	modelKey: string;
}) {
	const normalizedModelKey = normalizeModelName(input.modelKey);
	if (!normalizedModelKey) return null;
	if (input.vendorKey) {
		const direct = await getCatalogModelByVendorAndKey(input.c.env.DB, {
			vendorKey: String(input.vendorKey).trim().toLowerCase(),
			modelKey: normalizedModelKey,
		});
		if (direct) return direct;
	}
	const directRows = await listCatalogModelsByModelKey(input.c.env.DB, normalizedModelKey);
	if (directRows[0]) return directRows[0];
	const aliasRows = await listCatalogModelsByModelAlias(input.c.env.DB, normalizedModelKey);
	return aliasRows[0] ?? null;
}

export async function resolveModelOutputBudget(input: {
	c: AppContext;
	vendorKey?: string | null;
	modelKey: string;
	desiredMaxOutput: number;
	inputText: string;
}): Promise<ModelOutputBudget> {
	const catalogRow = await resolveCatalogRow(input);
	const meta = (() => {
		if (!catalogRow?.meta) return undefined;
		try {
			return JSON.parse(catalogRow.meta);
		} catch {
			return undefined;
		}
	})();
	const runtimeLimits = readRuntimeLimitsFromMeta(meta);
	const staticLimits = lookupStaticLimits(input.modelKey);
	const contextWindow = runtimeLimits?.contextWindow ?? staticLimits.contextWindow;
	const maxOutput = runtimeLimits?.maxOutput ?? staticLimits.maxOutput;
	const source = runtimeLimits?.source || (runtimeLimits ? "catalog.runtimeLimits" : "static");
	const desiredMaxOutput = Math.max(1, Math.floor(input.desiredMaxOutput));
	const inputTokens = estimateTokens(input.inputText);
	const safetyMargin = Math.max(256, Math.min(8_192, Math.ceil(contextWindow * 0.1)));
	const availableOutputTokens = Math.max(1, contextWindow - inputTokens - safetyMargin);
	const effectiveMaxOutput = Math.max(
		1,
		Math.min(desiredMaxOutput, maxOutput, availableOutputTokens),
	);
	return {
		contextWindow,
		maxOutput,
		inputTokens,
		availableOutputTokens,
		effectiveMaxOutput,
		source,
	};
}

export function parseModelRuntimeLimitsFromError(error: unknown): ModelRuntimeLimits | null {
	const text = (() => {
		if (typeof error === "string") return error;
		if (error instanceof Error) return error.message;
		if (isRecord(error)) {
			const details = isRecord(error.details) ? error.details : null;
			const upstreamData = details?.upstreamData;
			if (typeof upstreamData === "string") return upstreamData;
			if (upstreamData) return JSON.stringify(upstreamData);
		}
		return "";
	})();
	if (!text.trim()) return null;

	const next: ModelRuntimeLimits = {};

	const contextPatterns = [
		/context.*?length.*?(\d{4,7})/i,
		/maximum.*?(\d{4,7})\s*tokens/i,
	];
	for (const pattern of contextPatterns) {
		const match = text.match(pattern);
		if (match?.[1]) {
			next.contextWindow = Number.parseInt(match[1], 10);
			break;
		}
	}

	const maxOutputPatterns = [
		/valid\s+range.*?\[\s*\d+\s*,\s*(\d+)\s*\]/i,
		/max[_\s-]?tokens.*?(?:less than or equal to|<=|不超过|上限为?)\s*(\d{3,6})/i,
		/max[_\s-]?output[_\s-]?tokens.*?(\d{3,6})/i,
	];
	for (const pattern of maxOutputPatterns) {
		const match = text.match(pattern);
		if (match?.[1]) {
			next.maxOutput = Number.parseInt(match[1], 10);
			break;
		}
	}

	if (!next.contextWindow && !next.maxOutput) return null;
	return next;
}

export async function persistLearnedModelRuntimeLimits(input: {
	c: AppContext;
	vendorKey?: string | null;
	modelKey: string;
	limits: ModelRuntimeLimits;
	source: string;
}): Promise<boolean> {
	const row = await resolveCatalogRow(input);
	if (!row) return false;
	const existingMeta = (() => {
		if (!row.meta) return {};
		try {
			const parsed = JSON.parse(row.meta);
			return isRecord(parsed) ? parsed : {};
		} catch {
			return {};
		}
	})();
	const nextMeta: UnknownRecord = {
		...existingMeta,
		runtimeLimits: {
			...(isRecord(existingMeta.runtimeLimits) ? existingMeta.runtimeLimits : {}),
			...(input.limits.contextWindow ? { contextWindow: input.limits.contextWindow } : {}),
			...(input.limits.maxOutput ? { maxOutput: input.limits.maxOutput } : {}),
			discoveredAt: new Date().toISOString(),
			source: input.source,
		},
	};
	await upsertCatalogModelRow(
		input.c.env.DB,
		{
			modelKey: row.model_key,
			vendorKey: row.vendor_key,
			modelAlias: row.model_alias,
			labelZh: row.label_zh,
			kind: row.kind,
			enabled: Number(row.enabled ?? 1) !== 0,
			meta: JSON.stringify(nextMeta),
		},
		new Date().toISOString(),
	);
	return true;
}
