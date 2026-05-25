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
import { getNewApiPricingSnapshot } from "./new-api-pricing";
import { listNewApiModels } from "../new-api-models/new-api-models.service";

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function fallbackCostForTaskKind(kind: string | null | undefined): number {
	const k = (kind || "").trim();
	if (k === "text_to_image" || k === "image_edit") return 1;
	if (k === "text_to_video" || k === "image_to_video") return 10;
	return 0;
}

function inferSpecCandidates(modelKey?: string | null): string[] {
	const raw = typeof modelKey === "string" ? modelKey.trim() : "";
	if (!raw) return [];
	const normalized = normalizeBillingModelKey(raw);
	const out: string[] = [];
	if (normalized && raw !== normalized) out.push(`variant:${raw}`);
	const lower = raw.toLowerCase();
	if (lower.includes("landscape")) out.push("orientation:landscape");
	if (lower.includes("portrait")) out.push("orientation:portrait");
	const d = lower.match(/(?:^|[-_])([0-9]{1,3})s(?:[-_]|$)/);
	if (d && d[1]) out.push(`duration:${d[1]}s`);
	if (lower.includes("-pro") || lower.endsWith("pro")) out.push("quality:pro");
	if (lower.includes("-fast") || lower.endsWith("fast")) out.push("quality:fast");
	return Array.from(new Set(out));
}

function imageResolutionSpecKey(specKey: string): string | null {
	const parts = specKey.trim().toLowerCase().split(":").filter(Boolean);
	if (parts[0] !== "image") return null;
	const resolution = parts.find((part) => /^(?:1k|2k|4k)$/.test(part));
	return resolution ? `image:${resolution}` : null;
}

export function resolveSyntheticImageSpecCostFromBase(input: {
	baseCost: number | null | undefined;
	specKey: string | null | undefined;
}): number | null {
	const normalizedSpecKey =
		typeof input.specKey === "string" ? input.specKey.trim().toLowerCase() : "";
	if (!normalizedSpecKey) return null;
	const resolutionSpec = imageResolutionSpecKey(normalizedSpecKey);
	if (!resolutionSpec || resolutionSpec !== normalizedSpecKey) return null;
	const baseCost =
		typeof input.baseCost === "number" && Number.isFinite(input.baseCost)
			? Math.max(0, Math.floor(input.baseCost))
			: 0;
	if (baseCost <= 0) return null;
	return resolutionSpec === "image:4k" ? baseCost * 2 : baseCost;
}

async function resolveDirectNewApiCreditsFallback(
	c: AppContext,
	normalizedModelKey: string,
): Promise<number | null> {
	const pricingSnapshot = await getNewApiPricingSnapshot(c.env);
	const directCredits =
		pricingSnapshot.directCreditsByModelKey.get(normalizedModelKey);
	if (typeof directCredits === "number" && Number.isFinite(directCredits)) {
		return Math.max(0, Math.floor(directCredits));
	}

	const newApiModels = await listNewApiModels(c.env, { enabled: true });
	for (const model of newApiModels) {
		const requestKey = normalizeBillingModelKey(model.requestModelKey);
		const modelNameKey = normalizeBillingModelKey(model.modelName);
		if (
			requestKey !== normalizedModelKey &&
			modelNameKey !== normalizedModelKey
		) {
			continue;
		}
		const translatedCredits =
			pricingSnapshot.directCreditsByModelKey.get(requestKey) ??
			pricingSnapshot.directCreditsByModelKey.get(modelNameKey);
		if (
			typeof translatedCredits === "number" &&
			Number.isFinite(translatedCredits)
		) {
			return Math.max(0, Math.floor(translatedCredits));
		}
	}
	return null;
}

export async function resolveTeamCreditsCostForTask(c: AppContext, input: {
	taskKind: string | null | undefined;
	modelKey?: string | null | undefined;
	specKey?: string | null | undefined;
}): Promise<number> {
	const normalizedModelKey = normalizeBillingModelKey(input.modelKey);
	if (normalizedModelKey) {
		const explicitSpec = typeof input.specKey === "string" ? input.specKey.trim() : "";
		if (explicitSpec) {
			const specSnapshot = await (async () => {
				const snap = await getNewApiPricingSnapshot(c.env);
				const exact = snap.specCreditsByModelSpecKey.get(`${normalizedModelKey}:${explicitSpec}`);
				if (typeof exact === "number") return exact;
				const resolutionSpec = imageResolutionSpecKey(explicitSpec);
				return resolutionSpec
					? snap.specCreditsByModelSpecKey.get(`${normalizedModelKey}:${resolutionSpec}`)
					: undefined;
			})();
			if (typeof specSnapshot === "number" && Number.isFinite(specSnapshot) && specSnapshot > 0) {
				return specSnapshot;
			}

			// snapshot 没命中时不论是否 image spec 都先走 DB / direct fallback。
			// Why: 2026-05-04 patch 把 gpt-image-2 的 model_credit_cost_specs 清空、
			// 改为从 new-api /api/pricing 取价；但只要上游 new-api 部署滞后、模型 Status≠1
			// 或 ability 缺失，snapshot 就拿不到 image:4k 这类 spec，原逻辑会硬抛 503，
			// 现把 DB + direct credits 留作兜底，仍未命中再抛错。
			const explicitSpecRow = await getModelCreditCost(
				c.env.DB,
				normalizedModelKey,
				explicitSpec,
			);
			if (explicitSpecRow && Number(explicitSpecRow.enabled ?? 1) !== 0) {
				const cost =
					typeof explicitSpecRow.cost === "number" &&
					Number.isFinite(explicitSpecRow.cost)
						? explicitSpecRow.cost
						: 0;
				return Math.max(0, Math.floor(cost));
			}
			const baseRow = await getModelCreditCost(c.env.DB, normalizedModelKey);
			if (baseRow && Number(baseRow.enabled ?? 1) !== 0) {
				const syntheticImageSpecCost = resolveSyntheticImageSpecCostFromBase({
					baseCost: baseRow.cost,
					specKey: explicitSpec,
				});
				if (syntheticImageSpecCost !== null) {
					return syntheticImageSpecCost;
				}
			}
			const directFallbackCredits = await resolveDirectNewApiCreditsFallback(
				c,
				normalizedModelKey,
			);
			if (
				typeof directFallbackCredits === "number" &&
				Number.isFinite(directFallbackCredits) &&
				directFallbackCredits > 0
			) {
				return directFallbackCredits;
			}
			throw new AppError("模型规格积分价格未配置", {
				status: 503,
				code: "model_spec_pricing_unavailable",
				details: {
					modelKey: normalizedModelKey,
					taskKind: input.taskKind ?? null,
					specKey: explicitSpec,
				},
			});
		}

		const specCandidates = inferSpecCandidates(input.modelKey);
		for (const specKey of specCandidates) {
			const specRow = await getModelCreditCost(c.env.DB, normalizedModelKey, specKey);
			if (specRow && Number(specRow.enabled ?? 1) !== 0) {
				const cost = typeof specRow.cost === "number" && Number.isFinite(specRow.cost) ? specRow.cost : 0;
				return Math.max(0, Math.floor(cost));
			}
		}

		const pricingSnapshot = await getNewApiPricingSnapshot(c.env);
		const directCredits = pricingSnapshot.creditsByModelKey.get(normalizedModelKey);
		if (typeof directCredits === "number" && Number.isFinite(directCredits)) {
			return Math.max(0, Math.floor(directCredits));
		}

		const baseRow = await getModelCreditCost(c.env.DB, normalizedModelKey);
		if (baseRow && Number(baseRow.enabled ?? 1) !== 0) {
			const cost =
				typeof baseRow.cost === "number" && Number.isFinite(baseRow.cost)
					? baseRow.cost
					: 0;
			return Math.max(0, Math.floor(cost));
		}

		const newApiModels = await listNewApiModels(c.env, { enabled: true });
		for (const model of newApiModels) {
			const requestKey = normalizeBillingModelKey(model.requestModelKey);
			const modelNameKey = normalizeBillingModelKey(model.modelName);
			if (
				requestKey !== normalizedModelKey &&
				modelNameKey !== normalizedModelKey
			) {
				continue;
			}
			const translatedCredits =
				pricingSnapshot.creditsByModelKey.get(requestKey) ??
				pricingSnapshot.creditsByModelKey.get(modelNameKey);
			if (
				typeof translatedCredits === "number" &&
				Number.isFinite(translatedCredits)
			) {
				return Math.max(0, Math.floor(translatedCredits));
			}
		}
		const fallback = fallbackCostForTaskKind(input.taskKind);
		if (fallback > 0) {
			return fallback;
		}
		throw new AppError("模型积分价格未配置", {
			status: 503,
			code: "model_pricing_unavailable",
			details: {
				modelKey: normalizedModelKey,
				taskKind: input.taskKind ?? null,
				specKey: null,
			},
		});
	}
	return fallbackCostForTaskKind(input.taskKind);
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
