import type { D1Database } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";
import {
	BILLING_MODEL_CATALOG,
	normalizeBillingModelKey,
} from "./billing.models";

export type ModelCreditCostRow = {
	model_key: string;
	cost: number;
	enabled: number;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

export async function ensureModelCreditCostsSchema(db: D1Database): Promise<void> {
	if (schemaEnsured) return;

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS model_credit_costs (
      model_key TEXT PRIMARY KEY,
      cost INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
	);

	// Migrate legacy parameter-variant keys (e.g. -landscape/-portrait) into a
	// single canonical model_key so admin billing config doesn't duplicate entries.
	const existing = await queryAll<ModelCreditCostRow>(
		db,
		`SELECT model_key, cost, enabled, created_at, updated_at FROM model_credit_costs`,
	);
	const groups = new Map<string, ModelCreditCostRow[]>();
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
			await execute(
				db,
				`INSERT OR IGNORE INTO model_credit_costs (model_key, cost, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
				[canonical, Number(best.cost ?? 0) || 0, Number(best.enabled ?? 1) || 1, best.created_at, best.updated_at],
			);
		} else if (best.model_key !== canonical) {
			await execute(
				db,
				`UPDATE model_credit_costs
         SET cost = ?, enabled = ?, updated_at = ?
         WHERE model_key = ?`,
				[Number(best.cost ?? 0) || 0, Number(best.enabled ?? 1) || 1, best.updated_at, canonical],
			);
		}

		for (const row of rows) {
			if (row.model_key === canonical) continue;
			await execute(
				db,
				`DELETE FROM model_credit_costs WHERE model_key = ?`,
				[row.model_key],
			);
		}
	}

	const nowIso = new Date().toISOString();
	for (const it of BILLING_MODEL_CATALOG) {
		const key = normalizeBillingModelKey(it.modelKey);
		if (!key) continue;
		await execute(
			db,
			`INSERT OR IGNORE INTO model_credit_costs (model_key, cost, enabled, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
			[key, Math.max(0, Math.floor(it.defaultCost)), nowIso, nowIso],
		);
	}

	schemaEnsured = true;
}

function normalizeModelKey(modelKey: string): string {
	return normalizeBillingModelKey(modelKey);
}

export async function listModelCreditCosts(
	db: D1Database,
): Promise<ModelCreditCostRow[]> {
	await ensureModelCreditCostsSchema(db);
	return queryAll<ModelCreditCostRow>(
		db,
		`SELECT model_key, cost, enabled, created_at, updated_at
     FROM model_credit_costs
     ORDER BY model_key ASC`,
	);
}

export async function getModelCreditCost(
	db: D1Database,
	modelKey: string,
): Promise<ModelCreditCostRow | null> {
	await ensureModelCreditCostsSchema(db);
	const key = normalizeModelKey(modelKey);
	if (!key) return null;
	return queryOne<ModelCreditCostRow>(
		db,
		`SELECT model_key, cost, enabled, created_at, updated_at
     FROM model_credit_costs
     WHERE model_key = ?
     LIMIT 1`,
		[key],
	);
}

export async function upsertModelCreditCost(
	db: D1Database,
	input: { modelKey: string; cost: number; enabled: boolean; nowIso: string },
): Promise<ModelCreditCostRow> {
	await ensureModelCreditCostsSchema(db);
	const key = normalizeModelKey(input.modelKey);
	if (!key) {
		throw new Error("modelKey is required");
	}
	const cost = Math.max(0, Math.floor(input.cost));
	const enabled = input.enabled ? 1 : 0;
	await execute(
		db,
		`INSERT INTO model_credit_costs (model_key, cost, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(model_key) DO UPDATE SET
       cost = excluded.cost,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
		[key, cost, enabled, input.nowIso, input.nowIso],
	);
	const row = await getModelCreditCost(db, key);
	if (!row) {
		throw new Error("upsert model credit cost failed");
	}
	return row;
}

export async function deleteModelCreditCost(
	db: D1Database,
	modelKey: string,
): Promise<void> {
	await ensureModelCreditCostsSchema(db);
	const key = normalizeModelKey(modelKey);
	if (!key) return;
	await execute(
		db,
		`DELETE FROM model_credit_costs WHERE model_key = ?`,
		[key],
	);
}
