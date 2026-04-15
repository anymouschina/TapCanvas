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

export async function resolveTeamCreditsCostForTask(c: AppContext, input: {
	taskKind: string | null | undefined;
	modelKey?: string | null | undefined;
	specKey?: string | null | undefined;
}): Promise<number> {
	const normalizedModelKey = normalizeBillingModelKey(input.modelKey);
	if (normalizedModelKey) {
		const explicitSpec = typeof input.specKey === "string" ? input.specKey.trim() : "";
		const specCandidates = explicitSpec
			? [explicitSpec]
			: inferSpecCandidates(input.modelKey);
		for (const specKey of specCandidates) {
			const specRow = await getModelCreditCost(c.env.DB, normalizedModelKey, specKey);
			if (specRow && Number(specRow.enabled ?? 1) !== 0) {
				const cost = typeof specRow.cost === "number" && Number.isFinite(specRow.cost) ? specRow.cost : 0;
				return Math.max(0, Math.floor(cost));
			}
		}
		const row = await getModelCreditCost(c.env.DB, normalizedModelKey, "");
		if (row && Number(row.enabled ?? 1) !== 0) {
			const cost = typeof row.cost === "number" && Number.isFinite(row.cost) ? row.cost : 0;
			return Math.max(0, Math.floor(cost));
		}
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
