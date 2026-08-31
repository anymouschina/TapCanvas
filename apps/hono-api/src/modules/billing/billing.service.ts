import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../team/team.service";
import {
	normalizeBillingModelKey,
	type BillingModelKind,
} from "./billing.models";
import {
	deleteModelCreditCost,
	getModelCreditCost,
	listModelCreditCosts,
	upsertModelCreditCost,
} from "./billing.repo";
import { listCatalogModels } from "../model-catalog/model-catalog.repo";
import {
	getNewApiPricingSnapshot,
	type NewApiPricingSnapshot,
} from "./new-api-pricing";
import { listNewApiModels } from "../new-api-models/new-api-models.service";

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function imageResolutionSpecKey(specKey: string): string | null {
	const parts = specKey.trim().toLowerCase().split(":").filter(Boolean);
	if (parts[0] !== "image") return null;
	const resolution = parts.find((part) => /^(?:0\.5k|1k|2k|4k)$/.test(part));
	return resolution ? `image:${resolution}` : null;
}

function isQualityQualifiedImageSpecKey(specKey: string): boolean {
	const parts = specKey.trim().toLowerCase().split(":").filter(Boolean);
	if (parts[0] !== "image" || parts.length < 3) return false;
	return /^(?:0\.5k|1k|2k|4k)$/.test(parts[parts.length - 2] || "");
}

async function resolveDynamicPricingModelKeys(
	c: AppContext,
	normalizedModelKey: string,
	options?: {
		fresh?: boolean;
		pricingSnapshot?: NewApiPricingSnapshot;
	},
): Promise<{
	modelKeys: string[];
	routeState: "available" | "runtime_endpoint_missing" | "metadata_missing";
}> {
	const keys = new Set<string>([normalizedModelKey]);
	let metadataMatched = false;
	let runtimeEndpointAvailable = false;
	const newApiModels = await listNewApiModels(c.env, {
		enabled: true,
		fresh: options?.fresh === true,
		pricingSnapshot: options?.pricingSnapshot,
	});
	for (const model of newApiModels) {
		const requestKey = normalizeBillingModelKey(model.requestModelKey);
		const modelNameKey = normalizeBillingModelKey(model.modelName);
		if (
			requestKey !== normalizedModelKey &&
			modelNameKey !== normalizedModelKey
		) {
			continue;
		}
		metadataMatched = true;
		if (model.runtimeEndpoints.length > 0) runtimeEndpointAvailable = true;
		if (requestKey) keys.add(requestKey);
		if (modelNameKey) keys.add(modelNameKey);
	}
	return {
		modelKeys: Array.from(keys),
		routeState: runtimeEndpointAvailable
			? "available"
			: metadataMatched
				? "runtime_endpoint_missing"
				: "metadata_missing",
	};
}

function resolvePositiveCredits(
	map: Map<string, number>,
	keys: string[],
): number | null {
	for (const key of keys) {
		const credits = map.get(key);
		if (typeof credits === "number" && Number.isFinite(credits) && credits > 0) {
			return Math.ceil(credits);
		}
	}
	return null;
}

function resolveSpecCredits(input: {
	specCreditsByModelSpecKey: Map<string, number>;
	directCreditsByModelKey: Map<string, number>;
	modelKeys: string[];
	specKey: string;
}): number | null {
	const normalizedSpec = input.specKey.toLowerCase();
	const specKeys = Array.from(new Set([input.specKey, normalizedSpec]));
	for (const modelKey of input.modelKeys) {
		for (const specKey of specKeys) {
			const exact = input.specCreditsByModelSpecKey.get(`${modelKey}:${specKey}`);
			if (typeof exact === "number" && Number.isFinite(exact) && exact > 0) {
				return Math.ceil(exact);
			}
		}
	}
	// Quality is an independent paid dimension. Missing image:<resolution>:<quality>
	// must fail explicitly instead of collapsing to a cheaper resolution/base row.
	if (isQualityQualifiedImageSpecKey(input.specKey)) return null;
	const resolutionSpec = imageResolutionSpecKey(input.specKey);
	if (resolutionSpec) {
		for (const modelKey of input.modelKeys) {
			const resolutionCredits = input.specCreditsByModelSpecKey.get(
				`${modelKey}:${resolutionSpec}`,
			);
			if (
				typeof resolutionCredits === "number" &&
				Number.isFinite(resolutionCredits) &&
				resolutionCredits > 0
			) {
				return Math.ceil(resolutionCredits);
			}
		}
	}
	return resolvePositiveCredits(input.directCreditsByModelKey, input.modelKeys);
}

async function resolveReferenceImageSurcharge(
	c: AppContext,
	modelKey: string,
	referenceImageCount: number | null | undefined,
): Promise<number> {
	if (referenceImageCount == null || referenceImageCount === 0) return 0;
	if (!Number.isInteger(referenceImageCount) || referenceImageCount < 0) {
		throw new AppError("参考图数量必须为非负整数", {
			status: 400,
			code: "reference_image_count_invalid_for_pricing",
			details: { modelKey, referenceImageCount },
		});
	}
	const snapshot = await getNewApiPricingSnapshot(c.env);
	const creditsPerReference = snapshot.referenceImageCreditsByModelKey.get(modelKey);
	if (creditsPerReference === undefined) return 0;
	if (!Number.isFinite(creditsPerReference) || creditsPerReference <= 0) {
		throw new AppError("模型参考图附加价格配置无效", {
			status: 503,
			code: "model_reference_image_pricing_invalid",
			details: { modelKey, creditsPerReference },
		});
	}
	return Math.ceil(creditsPerReference) * referenceImageCount;
}

async function resolveRealtimeCredits(
	c: AppContext,
	input: {
		normalizedModelKey: string;
		explicitSpec: string;
		fresh: boolean;
	},
): Promise<{
	credits: number | null;
	routeState: "available" | "runtime_endpoint_missing" | "metadata_missing";
}> {
	const pricingSnapshot = await getNewApiPricingSnapshot(
		c.env,
		input.fresh ? { fresh: true } : undefined,
	);
	const modelResolution = await resolveDynamicPricingModelKeys(
		c,
		input.normalizedModelKey,
		{
			fresh: input.fresh,
			pricingSnapshot,
		},
	);
	if (modelResolution.routeState !== "available") {
		return { credits: null, routeState: modelResolution.routeState };
	}
	if (input.explicitSpec) {
		const specCredits = resolveSpecCredits({
			specCreditsByModelSpecKey: pricingSnapshot.specCreditsByModelSpecKey,
			directCreditsByModelKey: pricingSnapshot.directCreditsByModelKey,
			modelKeys: modelResolution.modelKeys,
			specKey: input.explicitSpec,
		});
		return { credits: specCredits, routeState: modelResolution.routeState };
	}

	const modelCredits = resolvePositiveCredits(
		pricingSnapshot.creditsByModelKey,
		modelResolution.modelKeys,
	);
	return { credits: modelCredits, routeState: modelResolution.routeState };
}

async function resolveConfiguredCredits(
	c: AppContext,
	input: { modelKey: string; specKey?: string | null },
): Promise<number | null> {
	const row = await getModelCreditCost(c.env.DB, input.modelKey, input.specKey);
	if (!row) return null;
	const isSpecPrice = Boolean(input.specKey);
	if (row.enabled !== 1) {
		throw new AppError(isSpecPrice ? "模型规格积分价格已禁用" : "模型积分价格已禁用", {
			status: 503,
			code: isSpecPrice ? "model_spec_pricing_disabled" : "model_pricing_disabled",
			details: {
				modelKey: input.modelKey,
				specKey: input.specKey ?? null,
				pricingSource: "system_model_management",
			},
		});
	}
	if (!Number.isFinite(row.cost) || row.cost <= 0) {
		throw new AppError(isSpecPrice ? "模型规格积分价格配置无效" : "模型积分价格配置无效", {
			status: 503,
			code: isSpecPrice ? "model_spec_pricing_invalid" : "model_pricing_invalid",
			details: {
				modelKey: input.modelKey,
				specKey: input.specKey ?? null,
				pricingSource: "system_model_management",
				configuredCost: row.cost,
			},
		});
	}
	return Math.ceil(row.cost);
}

export async function resolveTeamCreditsCostForTask(c: AppContext, input: {
	taskKind: string | null | undefined;
	modelKey?: string | null | undefined;
	specKey?: string | null | undefined;
	outputDurationSeconds?: number | null | undefined;
	referenceVideoDurationSeconds?: number | null | undefined;
	referenceImageCount?: number | null | undefined;
}): Promise<number> {
	const normalizedModelKey = normalizeBillingModelKey(input.modelKey);
	if (!normalizedModelKey) {
		throw new AppError("模型计价必须提供 modelKey", {
			status: 400,
			code: "model_key_required_for_pricing",
			details: { taskKind: input.taskKind ?? null, specKey: input.specKey ?? null },
		});
	}

	const explicitSpec = typeof input.specKey === "string" ? input.specKey.trim() : "";
	const finalizeCredits = async (baseCredits: number): Promise<number> => {
		const durationAdjusted = scaleVideoCreditsByBillableDuration(baseCredits, input);
		const referenceSurcharge = await resolveReferenceImageSurcharge(
			c,
			normalizedModelKey,
			input.referenceImageCount,
		);
		return durationAdjusted + referenceSurcharge;
	};
	const configuredCredits = await resolveConfiguredCredits(c, {
		modelKey: normalizedModelKey,
		...(explicitSpec ? { specKey: explicitSpec } : {}),
	});
	if (configuredCredits !== null) return finalizeCredits(configuredCredits);

	const currentCredits = await resolveRealtimeCredits(c, {
		normalizedModelKey,
		explicitSpec,
		fresh: false,
	});
	if (currentCredits.credits !== null) return finalizeCredits(currentCredits.credits);

	// Model/channel/pricing changes are administrative writes outside Hono's
	// process. A cache miss is therefore rechecked once against a fresh model
	// and pricing snapshot before the request is rejected. This is a cache
	// revalidation, not a price or model fallback.
	const refreshedCredits = await resolveRealtimeCredits(c, {
		normalizedModelKey,
		explicitSpec,
		fresh: true,
	});
	if (refreshedCredits.credits !== null) return finalizeCredits(refreshedCredits.credits);

	if (refreshedCredits.routeState !== "available") {
		throw new AppError("模型没有可执行的启用渠道协议", {
			status: 503,
			code: "model_runtime_route_unavailable",
			details: {
				modelKey: normalizedModelKey,
				taskKind: input.taskKind ?? null,
				specKey: explicitSpec || null,
				routeState: refreshedCredits.routeState,
				pricingRefreshAttempted: true,
			},
		});
	}

	if (explicitSpec) {
		throw new AppError("模型规格积分价格未配置", {
			status: 503,
			code: "model_spec_pricing_unavailable",
			details: {
				modelKey: normalizedModelKey,
				taskKind: input.taskKind ?? null,
				specKey: explicitSpec,
				pricingRefreshAttempted: true,
			},
		});
	}
	throw new AppError("模型积分价格未配置", {
		status: 503,
		code: "model_pricing_unavailable",
		details: {
			modelKey: normalizedModelKey,
			taskKind: input.taskKind ?? null,
			specKey: null,
			pricingRefreshAttempted: true,
		},
	});
}

function scaleVideoCreditsByBillableDuration(
	outputCredits: number,
	input: {
		outputDurationSeconds?: number | null | undefined;
		referenceVideoDurationSeconds?: number | null | undefined;
	},
): number {
	const referenceDuration = input.referenceVideoDurationSeconds;
	if (referenceDuration == null) return outputCredits;
	const outputDuration = input.outputDurationSeconds;
	if (!Number.isFinite(outputDuration) || Number(outputDuration) <= 0) {
		throw new AppError("视频计费缺少有效的预计输出时长", {
			status: 400,
			code: "video_output_duration_required_for_pricing",
			details: { outputDurationSeconds: outputDuration ?? null },
		});
	}
	if (!Number.isFinite(referenceDuration) || referenceDuration <= 0) {
		throw new AppError("参考视频时长缺失，无法计费", {
			status: 400,
			code: "reference_video_duration_required_for_pricing",
			details: { referenceVideoDurationSeconds: referenceDuration },
		});
	}
	const billedReferenceDuration = Math.ceil(referenceDuration);
	return Math.ceil(outputCredits * ((Number(outputDuration) + billedReferenceDuration) / Number(outputDuration)));
}

export async function listBillingModelCatalog(c: AppContext) {
	requireAdmin(c);
	const merged = new Map<
		string,
		{ modelKey: string; labelZh: string; kind: BillingModelKind; vendor?: string }
	>();

	const stripLabelOrientation = (label: string): string => {
		const raw = String(label || "").trim();
		if (!raw) return raw;
		// Remove explicit orientation markers in labels.
		return raw
			.replace(/（\s*横屏\s*）/g, "")
			.replace(/（\s*竖屏\s*）/g, "")
			.replace(/\(\s*横屏\s*\)/g, "")
			.replace(/\(\s*竖屏\s*\)/g, "")
			// Within bracketed label parts like "（横屏 10s）" -> "（10s）"
			.replace(/（\s*(横屏|竖屏)\s+/g, "（")
			.replace(/\(\s*(横屏|竖屏)\s+/g, "(")
			.replace(/\s{2,}/g, " ")
			.trim();
	};

	// Dynamic model list from system model catalog.
	// IMPORTANT: include all configured modelKey regardless of enabled status.
	const dynamic = await listCatalogModels(c.env.DB);
	for (const row of dynamic) {
		if (!row) continue;
		const canonicalKey = normalizeBillingModelKey(row.model_key);
		if (!canonicalKey) continue;
		const kindRaw = typeof row.kind === "string" ? row.kind.trim() : "";
		if (kindRaw !== "text" && kindRaw !== "image" && kindRaw !== "video") continue;
		const labelZh = stripLabelOrientation(
			String(row.label_zh || "").trim() || canonicalKey,
		);
		const vendor =
			typeof row.vendor_key === "string" && row.vendor_key.trim()
				? row.vendor_key.trim()
				: undefined;
		if (!merged.has(canonicalKey)) {
			merged.set(canonicalKey, {
				modelKey: canonicalKey,
				labelZh,
				kind: kindRaw as BillingModelKind,
				...(vendor ? { vendor } : {}),
			});
		}
	}

	// Preserve keys that already exist in billing cost table even if they are
	// not present in current model catalog rows.
	const existingCosts = await listModelCreditCosts(c.env.DB);
	for (const row of existingCosts) {
		const canonicalKey = normalizeBillingModelKey(row.model_key);
		if (!canonicalKey || merged.has(canonicalKey)) continue;
		merged.set(canonicalKey, {
			modelKey: canonicalKey,
			labelZh: canonicalKey,
			kind: "text",
		});
	}

	return Array.from(merged.values()).map(({ modelKey, labelZh, kind, vendor }) => ({
		modelKey,
		labelZh,
		kind,
		...(vendor ? { vendor } : {}),
	}));
}

export async function listModelCreditCostsForAdmin(c: AppContext) {
	requireAdmin(c);
	return listModelCreditCosts(c.env.DB);
}

export async function upsertModelCreditCostForAdmin(
	c: AppContext,
	input: { modelKey: string; specKey?: string; cost: number; enabled?: boolean },
) {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	return upsertModelCreditCost(c.env.DB, {
		modelKey: input.modelKey,
		specKey: input.specKey,
		cost: input.cost,
		enabled: typeof input.enabled === "boolean" ? input.enabled : true,
		nowIso,
	});
}

export async function deleteModelCreditCostForAdmin(c: AppContext, modelKey: string, specKey?: string) {
	requireAdmin(c);
	await deleteModelCreditCost(c.env.DB, modelKey, specKey);
}
