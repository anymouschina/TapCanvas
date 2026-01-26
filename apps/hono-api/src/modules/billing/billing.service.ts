import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../team/team.service";
import {
	BILLING_MODEL_CATALOG,
	normalizeBillingModelKey,
} from "./billing.models";
import {
	deleteModelCreditCost,
	getModelCreditCost,
	listModelCreditCosts,
	upsertModelCreditCost,
} from "./billing.repo";

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
	return BILLING_MODEL_CATALOG;
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

