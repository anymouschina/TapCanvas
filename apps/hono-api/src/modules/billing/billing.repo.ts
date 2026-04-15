import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { normalizeBillingModelKey } from "./billing.models";

export type ModelCreditCostRow = {
	model_key: string;
	spec_key: string;
	cost: number;
	enabled: number;
	created_at: string;
	updated_at: string;
};

type ModelCreditCostBaseRow = {
	model_key: string;
	cost: number;
	enabled: number;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

function normalizeModelKey(modelKey: string): string {
	return normalizeBillingModelKey(modelKey);
}

function normalizeSpecKey(specKey?: string | null): string {
	return typeof specKey === "string" ? specKey.trim() : "";
}

export async function ensureModelCreditCostsSchema(db: PrismaClient): Promise<void> {
	void db;
	if (schemaEnsured) return;
	const prisma = getPrismaClient();

	const existing = await prisma.model_credit_costs.findMany();
	const groups = new Map<string, ModelCreditCostBaseRow[]>();
	for (const row of existing) {
		const canonical = normalizeBillingModelKey(row.model_key);
		if (!canonical) continue;
		const arr = groups.get(canonical) || [];
		arr.push(row);
		groups.set(canonical, arr);
	}
	for (const [canonical, rows] of groups) {
		if (!rows.length) continue;
		if (rows.length === 1 && rows[0]?.model_key === canonical) continue;

		const best = rows.reduce((a, b) => {
			const au = String(a.updated_at || "");
			const bu = String(b.updated_at || "");
			return bu > au ? b : a;
		}, rows[0]);
		const canonicalRow = rows.find((r) => r.model_key === canonical) || null;

		if (!canonicalRow) {
			await prisma.model_credit_costs.upsert({
				where: { model_key: canonical },
				create: {
					model_key: canonical,
					cost: Number(best.cost ?? 0) || 0,
					enabled: Number(best.enabled ?? 1) || 1,
					created_at: best.created_at,
					updated_at: best.updated_at,
				},
				update: {},
			});
		} else if (best.model_key !== canonical) {
			await prisma.model_credit_costs.update({
				where: { model_key: canonical },
				data: {
					cost: Number(best.cost ?? 0) || 0,
					enabled: Number(best.enabled ?? 1) || 1,
					updated_at: best.updated_at,
				},
			});
		}

		for (const row of rows) {
			if (row.model_key === canonical) continue;
			await prisma.model_credit_costs.deleteMany({
				where: { model_key: row.model_key },
			});
		}
	}

	schemaEnsured = true;
}

export async function listModelCreditCosts(db: PrismaClient): Promise<ModelCreditCostRow[]> {
	await ensureModelCreditCostsSchema(db);
	const prisma = getPrismaClient();
	const [baseRows, specRows] = await Promise.all([
		prisma.model_credit_costs.findMany(),
		prisma.model_credit_cost_specs.findMany(),
	]);
	const rows: ModelCreditCostRow[] = [
		...baseRows.map((r) => ({
			model_key: r.model_key,
			spec_key: "",
			cost: r.cost,
			enabled: r.enabled,
			created_at: r.created_at,
			updated_at: r.updated_at,
		})),
		...specRows.map((r) => ({
			model_key: r.model_key,
			spec_key: r.spec_key,
			cost: r.cost,
			enabled: r.enabled,
			created_at: r.created_at,
			updated_at: r.updated_at,
		})),
	];
	rows.sort((a, b) => {
		const mk = String(a.model_key || "").localeCompare(String(b.model_key || ""));
		if (mk !== 0) return mk;
		return String(a.spec_key || "").localeCompare(String(b.spec_key || ""));
	});
	return rows;
}

export async function getModelCreditCost(
	db: PrismaClient,
	modelKey: string,
	specKey?: string | null,
): Promise<ModelCreditCostRow | null> {
	await ensureModelCreditCostsSchema(db);
	const prisma = getPrismaClient();
	const key = normalizeModelKey(modelKey);
	if (!key) return null;
	const spec = normalizeSpecKey(specKey);
	if (spec) {
		const specRow = await prisma.model_credit_cost_specs.findUnique({
			where: {
				model_key_spec_key: {
					model_key: key,
					spec_key: spec,
				},
			},
		});
		if (!specRow) return null;
		return {
			model_key: specRow.model_key,
			spec_key: specRow.spec_key,
			cost: specRow.cost,
			enabled: specRow.enabled,
			created_at: specRow.created_at,
			updated_at: specRow.updated_at,
		};
	}
	const baseRow = await prisma.model_credit_costs.findUnique({
		where: { model_key: key },
	});
	if (!baseRow) return null;
	return {
		model_key: baseRow.model_key,
		spec_key: "",
		cost: baseRow.cost,
		enabled: baseRow.enabled,
		created_at: baseRow.created_at,
		updated_at: baseRow.updated_at,
	};
}

export async function upsertModelCreditCost(
	db: PrismaClient,
	input: {
		modelKey: string;
		specKey?: string | null;
		cost: number;
		enabled: boolean;
		nowIso: string;
	},
): Promise<ModelCreditCostRow> {
	await ensureModelCreditCostsSchema(db);
	const prisma = getPrismaClient();
	const key = normalizeModelKey(input.modelKey);
	if (!key) throw new Error("modelKey is required");
	const spec = normalizeSpecKey(input.specKey);
	const cost = Math.max(0, Math.floor(input.cost));
	const enabled = input.enabled ? 1 : 0;

	if (spec) {
		await prisma.model_credit_cost_specs.upsert({
			where: {
				model_key_spec_key: {
					model_key: key,
					spec_key: spec,
				},
			},
			create: {
				model_key: key,
				spec_key: spec,
				cost,
				enabled,
				created_at: input.nowIso,
				updated_at: input.nowIso,
			},
			update: {
				cost,
				enabled,
				updated_at: input.nowIso,
			},
		});
	} else {
		await prisma.model_credit_costs.upsert({
			where: { model_key: key },
			create: {
				model_key: key,
				cost,
				enabled,
				created_at: input.nowIso,
				updated_at: input.nowIso,
			},
			update: {
				cost,
				enabled,
				updated_at: input.nowIso,
			},
		});
	}
	const row = await getModelCreditCost(db, key, spec);
	if (!row) throw new Error("upsert model credit cost failed");
	return row;
}

export async function deleteModelCreditCost(
	db: PrismaClient,
	modelKey: string,
	specKey?: string | null,
): Promise<void> {
	await ensureModelCreditCostsSchema(db);
	const prisma = getPrismaClient();
	const key = normalizeModelKey(modelKey);
	if (!key) return;
	const spec = normalizeSpecKey(specKey);
	if (spec) {
		await prisma.model_credit_cost_specs.deleteMany({
			where: { model_key: key, spec_key: spec },
		});
		return;
	}
	await prisma.model_credit_costs.deleteMany({ where: { model_key: key } });
}
