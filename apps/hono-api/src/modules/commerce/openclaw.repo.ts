import type { PrismaClient } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";

export type OpenClawAuthorizationRow = {
  id: string;
  owner_id: string;
  subscription_id: string | null;
  source_order_id: string | null;
  product_id: string | null;
  sku_id: string | null;
  external_key: string | null;
  external_name: string;
  quota_limit: number;
  description_text: string | null;
  allow_wallet: number;
  allowed_item_ids_json: string | null;
  expired_at: string | null;
  status: string;
  upstream_key_id: string | null;
  upstream_payload_json: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
};

let schemaEnsured = false;

async function hasOpenClawColumn(db: PrismaClient, column: string): Promise<boolean> {
  const rows = await queryAll<{ name: string }>(db, `PRAGMA table_info(openclaw_authorizations)`);
  return rows.some((row) => row.name === column);
}

export async function ensureOpenClawSchema(db: PrismaClient): Promise<void> {
  if (schemaEnsured) return;
  await execute(
    db,
    `CREATE TABLE IF NOT EXISTS openclaw_authorizations (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      subscription_id TEXT,
      source_order_id TEXT,
      product_id TEXT,
      sku_id TEXT,
      external_key TEXT,
      external_name TEXT NOT NULL,
      quota_limit INT NOT NULL DEFAULT 0,
      description_text TEXT,
      allow_wallet INT NOT NULL DEFAULT 1,
      allowed_item_ids_json TEXT,
      expired_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      upstream_key_id TEXT,
      upstream_payload_json TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      disabled_at TEXT,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
      FOREIGN KEY (source_order_id) REFERENCES orders(id),
      UNIQUE(owner_id)
    )`,
  );

  if (!(await hasOpenClawColumn(db, "expired_at"))) {
    await execute(db, `ALTER TABLE openclaw_authorizations ADD COLUMN expired_at TEXT`);
  }
  if (!(await hasOpenClawColumn(db, "disabled_at"))) {
    await execute(db, `ALTER TABLE openclaw_authorizations ADD COLUMN disabled_at TEXT`);
  }

  await execute(
    db,
    `CREATE INDEX IF NOT EXISTS idx_openclaw_authorizations_status_updated
     ON openclaw_authorizations(status, updated_at DESC)`,
  );
  await execute(
    db,
    `CREATE INDEX IF NOT EXISTS idx_openclaw_authorizations_subscription
     ON openclaw_authorizations(subscription_id)`,
  );
  schemaEnsured = true;
}

export async function getOpenClawAuthorizationByOwner(
  db: PrismaClient,
  ownerId: string,
): Promise<OpenClawAuthorizationRow | null> {
  await ensureOpenClawSchema(db);
  return queryOne<OpenClawAuthorizationRow>(
    db,
    `SELECT * FROM openclaw_authorizations WHERE owner_id = ? LIMIT 1`,
    [ownerId],
  );
}

export async function getOpenClawAuthorizationById(
  db: PrismaClient,
  id: string,
): Promise<OpenClawAuthorizationRow | null> {
  await ensureOpenClawSchema(db);
  return queryOne<OpenClawAuthorizationRow>(
    db,
    `SELECT * FROM openclaw_authorizations WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function upsertOpenClawAuthorization(
  db: PrismaClient,
  input: {
    id: string;
    ownerId: string;
    subscriptionId?: string | null;
    sourceOrderId?: string | null;
    productId?: string | null;
    skuId?: string | null;
    externalKey?: string | null;
    externalName: string;
    quotaLimit: number;
    descriptionText?: string | null;
    allowWallet: boolean;
    allowedItemIdsJson?: string | null;
    status: string;
    expiredAt?: string | null;
    upstreamKeyId?: string | null;
    upstreamPayloadJson?: string | null;
    lastSyncedAt?: string | null;
    lastError?: string | null;
    disabledAt?: string | null;
    nowIso: string;
  },
): Promise<void> {
  await ensureOpenClawSchema(db);
  await execute(
    db,
    `INSERT INTO openclaw_authorizations (
      id, owner_id, subscription_id, source_order_id, product_id, sku_id,
      external_key, external_name, quota_limit, description_text, allow_wallet,
      allowed_item_ids_json, expired_at, status, upstream_key_id, upstream_payload_json,
      last_synced_at, last_error, created_at, updated_at, disabled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET
      subscription_id = excluded.subscription_id,
      source_order_id = excluded.source_order_id,
      product_id = excluded.product_id,
      sku_id = excluded.sku_id,
      external_key = excluded.external_key,
      external_name = excluded.external_name,
      quota_limit = excluded.quota_limit,
      description_text = excluded.description_text,
      allow_wallet = excluded.allow_wallet,
      allowed_item_ids_json = excluded.allowed_item_ids_json,
      expired_at = excluded.expired_at,
      status = excluded.status,
      upstream_key_id = excluded.upstream_key_id,
      upstream_payload_json = excluded.upstream_payload_json,
      last_synced_at = excluded.last_synced_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at,
      disabled_at = excluded.disabled_at`,
    [
      input.id,
      input.ownerId,
      input.subscriptionId ?? null,
      input.sourceOrderId ?? null,
      input.productId ?? null,
      input.skuId ?? null,
      input.externalKey ?? null,
      input.externalName,
      input.quotaLimit,
      input.descriptionText ?? null,
      input.allowWallet ? 1 : 0,
      input.allowedItemIdsJson ?? null,
      input.expiredAt ?? null,
      input.status,
      input.upstreamKeyId ?? null,
      input.upstreamPayloadJson ?? null,
      input.lastSyncedAt ?? null,
      input.lastError ?? null,
      input.nowIso,
      input.nowIso,
      input.disabledAt ?? null,
    ],
  );
}

export async function listOpenClawAuthorizations(
  db: PrismaClient,
  input: {
    q?: string;
    status?: string | null;
    limit: number;
  },
): Promise<OpenClawAuthorizationRow[]> {
  await ensureOpenClawSchema(db);
  const where: string[] = [];
  const bindings: unknown[] = [];
  const q = String(input.q || "").trim().toLowerCase();
  const status = String(input.status || "").trim().toLowerCase();
  if (q) {
    where.push(`(
      LOWER(owner_id) LIKE ? OR
      LOWER(COALESCE(external_name, '')) LIKE ? OR
      LOWER(COALESCE(description_text, '')) LIKE ? OR
      LOWER(COALESCE(external_key, '')) LIKE ?
    )`);
    const like = `%${q}%`;
    bindings.push(like, like, like, like);
  }
  if (status) {
    where.push(`LOWER(status) = ?`);
    bindings.push(status);
  }
  bindings.push(Math.max(1, Math.min(500, Math.trunc(input.limit))));
  return queryAll<OpenClawAuthorizationRow>(
    db,
    `SELECT * FROM openclaw_authorizations
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY updated_at DESC
     LIMIT ?`,
    bindings,
  );
}

export async function deleteOpenClawAuthorizationById(
  db: PrismaClient,
  id: string,
): Promise<void> {
  await ensureOpenClawSchema(db);
  await execute(db, `DELETE FROM openclaw_authorizations WHERE id = ?`, [id]);
}
