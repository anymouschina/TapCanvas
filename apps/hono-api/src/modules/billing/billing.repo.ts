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

