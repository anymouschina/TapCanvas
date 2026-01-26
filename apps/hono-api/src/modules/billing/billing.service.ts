import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../team/team.service";
import {
	BILLING_MODEL_CATALOG,
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

export async function resolveTeamCreditsCostForTask(c: AppContext, input: {
	taskKind: string | null | undefined;
	modelKey?: string | null | undefined;
}): Promise<number> {
	const normalizedModelKey = normalizeBillingModelKey(input.modelKey);
	if (normalizedModelKey) {
		const row = await getModelCreditCost(c.env.DB, normalizedModelKey);
		if (row && Number(row.enabled ?? 1) !== 0) {
			const cost = typeof row.cost === "number" && Number.isFinite(row.cost) ? row.cost : 0;
			return Math.max(0, Math.floor(cost));
		}
	}
	return fallbackCostForTaskKind(input.taskKind);
}

export async function listBillingModelCatalog(c: AppContext) {
	requireAdmin(c);
	const merged = new Map<string, { modelKey: string; labelZh: string; kind: BillingModelKind; vendor?: string; fromBase: boolean }>();

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

	for (const it of BILLING_MODEL_CATALOG) {
		const canonicalKey = normalizeBillingModelKey(it.modelKey);
		if (!canonicalKey) continue;

		const fromBase = it.modelKey === canonicalKey;
		const labelZh = stripLabelOrientation(it.labelZh);
		const prev = merged.get(canonicalKey);
		if (!prev) {
			merged.set(canonicalKey, { modelKey: canonicalKey, labelZh, kind: it.kind, vendor: it.vendor, fromBase });
			continue;
		}
		// Prefer the base (non-variant) catalog item label when available.
		if (!prev.fromBase && fromBase) {
			merged.set(canonicalKey, { modelKey: canonicalKey, labelZh, kind: it.kind, vendor: it.vendor, fromBase });
		}
	}

	// Merge admin-configurable model catalog (system-level, dynamic)
	try {
		const dynamic = await listCatalogModels(c.env.DB);
		for (const row of dynamic) {
			if (!row) continue;
			const canonicalKey = normalizeBillingModelKey(row.model_key);
			if (!canonicalKey) continue;
			const kindRaw = typeof row.kind === "string" ? row.kind.trim() : "";
			if (kindRaw !== "text" && kindRaw !== "image" && kindRaw !== "video") continue;
			const labelZh = stripLabelOrientation(String(row.label_zh || "").trim() || canonicalKey);
			const vendor = typeof row.vendor_key === "string" && row.vendor_key.trim() ? row.vendor_key.trim() : undefined;
			merged.set(canonicalKey, {
				modelKey: canonicalKey,
				labelZh,
				kind: kindRaw as BillingModelKind,
				...(vendor ? { vendor } : {}),
				fromBase: true,
			});
		}
	} catch {
		// ignore: catalog not migrated or unavailable
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
	input: { modelKey: string; cost: number; enabled?: boolean },
) {
	requireAdmin(c);
	const nowIso = new Date().toISOString();
	return upsertModelCreditCost(c.env.DB, {
		modelKey: input.modelKey,
		cost: input.cost,
		enabled: typeof input.enabled === "boolean" ? input.enabled : true,
		nowIso,
	});
}

export async function deleteModelCreditCostForAdmin(c: AppContext, modelKey: string) {
	requireAdmin(c);
	await deleteModelCreditCost(c.env.DB, modelKey);
}
