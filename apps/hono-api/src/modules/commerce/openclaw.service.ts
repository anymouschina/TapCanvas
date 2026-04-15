import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
  ensureOpenClawSchema,
  deleteOpenClawAuthorizationById as deleteOpenClawAuthorizationRowById,
  getOpenClawAuthorizationById,
  getOpenClawAuthorizationByOwner,
  listOpenClawAuthorizations,
  upsertOpenClawAuthorization,
  type OpenClawAuthorizationRow,
} from "./openclaw.repo";

export type OpenClawAdminAuthorizationDto = {
  id: string;
  ownerId: string;
  subscriptionId: string | null;
  sourceOrderId: string | null;
  productId: string | null;
  skuId: string | null;
  externalKeyMasked: string | null;
  externalName: string;
  quotaLimit: number;
  descriptionText: string | null;
  allowWallet: boolean;
  allowedItemIds: string[] | null;
  expiredAt: string | null;
  status: "pending" | "active" | "inactive" | "error";
  upstreamKeyId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

export type OpenClawSelfAuthorizationDto = OpenClawAdminAuthorizationDto;

export type OpenClawSelfKeyDto = {
  key: string;
  keyMasked: string;
  externalName: string;
  status: "pending" | "active" | "inactive" | "error";
  expiredAt: string | null;
  quotaLimit: number;
  allowWallet: boolean;
  allowedItemIds: string[] | null;
  upstreamKeyId: string | null;
  updatedAt: string;
};

type OpenClawSyncInput = {
  ownerId: string;
  subscriptionId?: string | null;
  sourceOrderId?: string | null;
  productId?: string | null;
  skuId?: string | null;
  quotaLimit: number;
  externalName: string;
  descriptionText?: string | null;
  allowWallet: boolean;
  allowedItemIds: string[] | null;
  desiredStatus: "active" | "inactive";
  expiredAt?: string | null;
};

type OpenClawListKey = {
  id: string | null;
  key: string | null;
  name: string | null;
  quotaLimit: number | null;
  expiredAt: string | null;
  isActive: boolean | null;
  allowWallet: boolean | null;
  allowedItemIds: string[] | null;
  payloadJson: string;
};

type OpenClawUpstreamResult = {
  upstreamKeyId: string | null;
  externalKey: string | null;
  quotaLimit: number;
  expiredAt: string | null;
  status: "active" | "inactive";
  payloadJson: string;
};

type AppErrorLike = {
  code?: unknown;
  details?: unknown;
};

function readRequiredEnv(c: AppContext, key: keyof AppContext["env"]): string {
  const value = c.env[key];
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new AppError(`Missing env: ${String(key)}`, {
      status: 500,
      code: "openclaw_env_missing",
      details: { key },
    });
  }
  return text;
}

function getOpenClawBaseUrl(c: AppContext): string {
  const value = c.env.OPENCLAW_API_BASE_URL;
  const text = typeof value === "string" ? value.trim() : "";
  return text || "https://www.right.codes";
}

function getOpenClawPaths(input: { upstreamId?: string | null }): {
  list: string;
  create: string;
  update: string;
  resetUsage: string;
  remove: string;
} {
  const upstreamId = String(input.upstreamId || "").trim();
  if (!upstreamId && input.upstreamId !== undefined) {
    throw new AppError("OpenClaw upstream key id is required", {
      status: 500,
      code: "openclaw_missing_upstream_id",
    });
  }
  return {
    list: "/api-key/list",
    create: "/api-key/create",
    update: upstreamId ? "/api-key/" + encodeURIComponent(upstreamId) : "/api-key/{id}",
    resetUsage: upstreamId ? "/api-key/" + encodeURIComponent(upstreamId) + "/reset-usage" : "/api-key/{id}/reset-usage",
    remove: upstreamId ? "/api-key/" + encodeURIComponent(upstreamId) : "/api-key/{id}",
  };
}

function maskKey(value: string | null): string | null {
  const key = String(value || "").trim();
  if (!key) return null;
  if (key.length <= 8) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

function normalizeStatus(raw: string | null | undefined): "pending" | "active" | "inactive" | "error" {
  if (raw === "pending" || raw === "active" || raw === "inactive" || raw === "error") return raw;
  return "pending";
}

function parseAllowedItemIdsJson(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const items = parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function isOpenClawUpstream404(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as AppErrorLike;
  if (err.code !== "openclaw_upstream_failed") return false;
  if (!err.details || typeof err.details !== "object") return false;
  return Number((err.details as { status?: unknown }).status) === 404;
}

function mapAuthorizationRow(row: OpenClawAuthorizationRow): OpenClawAdminAuthorizationDto {
  return {
    id: row.id,
    ownerId: row.owner_id,
    subscriptionId: row.subscription_id,
    sourceOrderId: row.source_order_id,
    productId: row.product_id,
    skuId: row.sku_id,
    externalKeyMasked: maskKey(row.external_key),
    externalName: row.external_name,
    quotaLimit: Math.max(0, Math.trunc(Number(row.quota_limit || 0))),
    descriptionText: row.description_text,
    allowWallet: Number(row.allow_wallet || 0) !== 0,
    allowedItemIds: parseAllowedItemIdsJson(row.allowed_item_ids_json),
    expiredAt: row.expired_at,
    status: normalizeStatus(row.status),
    upstreamKeyId: row.upstream_key_id,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
  };
}

function parseMaybeObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(obj[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function pickBoolean(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "true" || text === "1") return true;
      if (text === "false" || text === "0") return false;
    }
  }
  return null;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function equalStringArrays(left: string[] | null, right: string[] | null): boolean {
  const leftItems = left || [];
  const rightItems = right || [];
  if (leftItems.length !== rightItems.length) return false;
  return leftItems.every((item, index) => item === rightItems[index]);
}

function resolveDesiredExpireAt(input: OpenClawSyncInput): string | null {
  if (input.desiredStatus === "inactive") return input.expiredAt || new Date().toISOString();
  return input.expiredAt || null;
}

function buildHeaders(c: AppContext): Headers {
  const token = readRequiredEnv(c, "OPENCLAW_API_TOKEN");
  const headers = new Headers();
  headers.set("accept", "application/json, text/plain, */*");
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  return headers;
}

async function callUpstream(
  c: AppContext,
  input: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; body?: Record<string, unknown> },
): Promise<string> {
  const baseUrl = getOpenClawBaseUrl(c);
  const url = new URL(input.path, baseUrl);
  const response = await fetch(url.toString(), {
    method: input.method,
    headers: buildHeaders(c),
    body: input.method === "GET" || input.method === "DELETE" ? undefined : JSON.stringify(input.body || {}),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new AppError(`OpenClaw upstream request failed: ${response.status}`, {
      status: 502,
      code: "openclaw_upstream_failed",
      details: {
        method: input.method,
        path: input.path,
        status: response.status,
        responseText: bodyText.slice(0, 2000),
      },
    });
  }
  return bodyText;
}

function mapListKey(raw: unknown): OpenClawListKey | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return {
    id: pickString(obj, ["id", "key_id", "apiKeyId"]),
    key: pickString(obj, ["key", "api_key", "token", "value"]),
    name: pickString(obj, ["name"]),
    quotaLimit: pickNumber(obj, ["quota_limit", "quotaLimit"]),
    expiredAt: pickString(obj, ["expired_at", "expiredAt"]),
    isActive: pickBoolean(obj, ["is_active", "isActive", "enabled"]),
    allowWallet: pickBoolean(obj, ["allow_wallet", "allowWallet"]),
    allowedItemIds: parseStringArray(obj.allowed_item_ids ?? obj.allowedItemIds),
    payloadJson: JSON.stringify(obj),
  };
}

async function listUpstreamKeys(c: AppContext): Promise<OpenClawListKey[]> {
  const path = getOpenClawPaths({}).list;
  const bodyText = await callUpstream(c, { method: "GET", path });
  const parsed = parseMaybeObject(bodyText);
  const keysRaw = Array.isArray(parsed.keys)
    ? parsed.keys
    : Array.isArray(parsed.data)
      ? parsed.data
      : Array.isArray(parsed.items)
        ? parsed.items
        : [];
  return keysRaw.map(mapListKey).filter((item): item is OpenClawListKey => item !== null);
}

function mapUpstreamMutationResponse(bodyText: string, fallback: {
  upstreamKeyId?: string | null;
  externalKey?: string | null;
  quotaLimit: number;
  expiredAt?: string | null;
  status: "active" | "inactive";
}): OpenClawUpstreamResult {
  const parsed = parseMaybeObject(bodyText);
  const source = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
    ? (parsed.data as Record<string, unknown>)
    : parsed;
  const upstreamKeyId = pickString(source, ["id", "key_id", "apiKeyId"]) || fallback.upstreamKeyId || null;
  const externalKey = pickString(source, ["key", "api_key", "token", "value"]) || fallback.externalKey || null;
  const quotaLimit = pickNumber(source, ["quota_limit", "quotaLimit"]) ?? fallback.quotaLimit;
  const expiredAt = pickString(source, ["expired_at", "expiredAt"]) || fallback.expiredAt || null;
  const isActive = pickBoolean(source, ["is_active", "isActive", "enabled"]);
  return {
    upstreamKeyId,
    externalKey,
    quotaLimit,
    expiredAt,
    status: isActive === null ? fallback.status : (isActive ? "active" : "inactive"),
    payloadJson: JSON.stringify(parsed),
  };
}

async function createUpstreamKey(c: AppContext, input: OpenClawSyncInput): Promise<OpenClawUpstreamResult> {
  const path = getOpenClawPaths({}).create;
  const bodyText = await callUpstream(c, {
    method: "POST",
    path,
    body: {
      name: input.externalName,
      quota_limit: input.quotaLimit,
      allow_wallet: input.allowWallet,
      allowed_item_ids: input.allowedItemIds,
    },
  });
  return mapUpstreamMutationResponse(bodyText, {
    quotaLimit: input.quotaLimit,
    expiredAt: null,
    status: "active",
  });
}

async function patchUpstreamKey(
  c: AppContext,
  upstreamId: string,
  input: {
    quotaLimit: number;
    desiredStatus: "active" | "inactive";
    externalName: string;
    allowWallet: boolean;
    allowedItemIds: string[] | null;
  },
  current: OpenClawUpstreamResult,
): Promise<OpenClawUpstreamResult> {
  const path = getOpenClawPaths({ upstreamId }).update;
  const bodyText = await callUpstream(c, {
    method: "PATCH",
    path,
    body: {
      name: input.externalName,
      quota_limit: input.quotaLimit,
      allow_wallet: input.allowWallet,
      allowed_item_ids: input.allowedItemIds,
      is_active: input.desiredStatus === "active",
    },
  });
  return mapUpstreamMutationResponse(bodyText, {
    upstreamKeyId: current.upstreamKeyId,
    externalKey: current.externalKey,
    quotaLimit: input.quotaLimit,
    expiredAt: current.expiredAt,
    status: input.desiredStatus,
  });
}

async function resetUpstreamUsage(c: AppContext, upstreamId: string, current: OpenClawUpstreamResult): Promise<OpenClawUpstreamResult> {
  const path = getOpenClawPaths({ upstreamId }).resetUsage;
  const bodyText = await callUpstream(c, {
    method: "POST",
    path,
    body: {},
  });
  return mapUpstreamMutationResponse(bodyText, {
    upstreamKeyId: current.upstreamKeyId,
    externalKey: current.externalKey,
    quotaLimit: current.quotaLimit,
    expiredAt: current.expiredAt,
    status: current.status,
  });
}

async function deleteUpstreamKey(c: AppContext, upstreamId: string): Promise<void> {
  const path = getOpenClawPaths({ upstreamId }).remove;
  await callUpstream(c, {
    method: "DELETE",
    path,
  });
}

function pickMatchingUpstreamKey(
  existingRow: OpenClawAuthorizationRow | null,
  upstreamKeys: OpenClawListKey[],
): OpenClawListKey | null {
  const upstreamId = String(existingRow?.upstream_key_id || "").trim();
  if (upstreamId) {
    const matched = upstreamKeys.find((item) => item.id === upstreamId);
    if (matched) return matched;
  }
  const externalKey = String(existingRow?.external_key || "").trim();
  if (externalKey) {
    const matched = upstreamKeys.find((item) => item.key === externalKey);
    if (matched) return matched;
  }
  return null;
}

async function persistAuthorization(
  c: AppContext,
  row: OpenClawAuthorizationRow | null,
  input: OpenClawSyncInput,
  upstream: OpenClawUpstreamResult,
  lastError: string | null,
): Promise<OpenClawAdminAuthorizationDto> {
  const nowIso = new Date().toISOString();
  await upsertOpenClawAuthorization(c.env.DB, {
    id: row?.id || crypto.randomUUID(),
    ownerId: input.ownerId,
    subscriptionId: input.subscriptionId ?? row?.subscription_id ?? null,
    sourceOrderId: input.sourceOrderId ?? row?.source_order_id ?? null,
    productId: input.productId ?? row?.product_id ?? null,
    skuId: input.skuId ?? row?.sku_id ?? null,
    externalKey: upstream.externalKey ?? row?.external_key ?? null,
    externalName: input.externalName,
    quotaLimit: Math.max(0, Math.trunc(upstream.quotaLimit)),
    descriptionText: input.descriptionText ?? row?.description_text ?? null,
    allowWallet: input.allowWallet,
    allowedItemIdsJson: input.allowedItemIds ? JSON.stringify(input.allowedItemIds) : null,
    expiredAt: input.expiredAt ?? row?.expired_at ?? null,
    status: upstream.status,
    upstreamKeyId: upstream.upstreamKeyId ?? row?.upstream_key_id ?? null,
    upstreamPayloadJson: upstream.payloadJson,
    lastSyncedAt: nowIso,
    lastError,
    disabledAt: upstream.status === "inactive" ? nowIso : null,
    nowIso,
  });
  const saved = await getOpenClawAuthorizationByOwner(c.env.DB, input.ownerId);
  if (!saved) {
    throw new AppError("OpenClaw authorization persisted but cannot be reloaded", {
      status: 500,
      code: "openclaw_persist_reload_failed",
    });
  }
  return mapAuthorizationRow(saved);
}

async function persistSyncError(
  c: AppContext,
  row: OpenClawAuthorizationRow | null,
  input: OpenClawSyncInput,
  errorMessage: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await upsertOpenClawAuthorization(c.env.DB, {
    id: row?.id || crypto.randomUUID(),
    ownerId: input.ownerId,
    subscriptionId: input.subscriptionId ?? row?.subscription_id ?? null,
    sourceOrderId: input.sourceOrderId ?? row?.source_order_id ?? null,
    productId: input.productId ?? row?.product_id ?? null,
    skuId: input.skuId ?? row?.sku_id ?? null,
    externalKey: row?.external_key ?? null,
    externalName: input.externalName,
    quotaLimit: Math.max(0, Math.trunc(input.quotaLimit)),
    descriptionText: input.descriptionText ?? row?.description_text ?? null,
    allowWallet: input.allowWallet,
    allowedItemIdsJson: input.allowedItemIds ? JSON.stringify(input.allowedItemIds) : null,
    expiredAt: resolveDesiredExpireAt(input),
    status: "error",
    upstreamKeyId: row?.upstream_key_id ?? null,
    upstreamPayloadJson: row?.upstream_payload_json ?? null,
    lastSyncedAt: nowIso,
    lastError: errorMessage,
    disabledAt: input.desiredStatus === "inactive" ? nowIso : null,
    nowIso,
  });
}

export async function syncOpenClawAuthorizationForOwner(
  c: AppContext,
  input: OpenClawSyncInput,
): Promise<OpenClawAdminAuthorizationDto> {
  await ensureOpenClawSchema(c.env.DB);
  const normalizedInput: OpenClawSyncInput = {
    ...input,
    quotaLimit: Math.max(1, Math.trunc(Number(input.quotaLimit || 0))),
    externalName: String(input.externalName || "").trim() || "openclaw",
    descriptionText: typeof input.descriptionText === "string" && input.descriptionText.trim() ? input.descriptionText.trim() : null,
    allowWallet: input.allowWallet !== false,
    allowedItemIds: input.allowedItemIds && input.allowedItemIds.length > 0 ? input.allowedItemIds.map((item) => item.trim()).filter(Boolean) : null,
    expiredAt: resolveDesiredExpireAt(input),
  };

  if (normalizedInput.quotaLimit <= 0) {
    throw new AppError("OpenClaw quotaLimit must be positive", {
      status: 400,
      code: "openclaw_invalid_quota_limit",
    });
  }

  const row = await getOpenClawAuthorizationByOwner(c.env.DB, normalizedInput.ownerId);

  try {
    const upstreamKeys = await listUpstreamKeys(c);
    const matched = pickMatchingUpstreamKey(row, upstreamKeys);

    let result: OpenClawUpstreamResult;
    if (!matched) {
      if (row && (row.upstream_key_id || row.external_key)) {
        throw new AppError("OpenClaw local authorization exists but upstream key is missing", {
          status: 502,
          code: "openclaw_upstream_key_missing",
          details: { ownerId: normalizedInput.ownerId, localAuthorizationId: row.id },
        });
      }
      result = await createUpstreamKey(c, normalizedInput);
    } else {
      result = {
        upstreamKeyId: matched.id,
        externalKey: matched.key,
        quotaLimit: matched.quotaLimit ?? normalizedInput.quotaLimit,
        expiredAt: matched.expiredAt,
        status: matched.isActive === false ? "inactive" : "active",
        payloadJson: matched.payloadJson,
      };
    }

    const upstreamId = result.upstreamKeyId;
    if (!upstreamId) {
      throw new AppError("OpenClaw upstream key id is missing", {
        status: 502,
        code: "openclaw_missing_upstream_id",
      });
    }

    const needPatchKey =
      result.quotaLimit !== normalizedInput.quotaLimit ||
      result.status !== normalizedInput.desiredStatus ||
      matched?.name !== normalizedInput.externalName ||
      matched?.allowWallet !== normalizedInput.allowWallet ||
      !equalStringArrays(matched?.allowedItemIds || null, normalizedInput.allowedItemIds);

    if (needPatchKey) {
      result = await patchUpstreamKey(c, upstreamId, {
        quotaLimit: normalizedInput.quotaLimit,
        desiredStatus: normalizedInput.desiredStatus,
        externalName: normalizedInput.externalName,
        allowWallet: normalizedInput.allowWallet,
        allowedItemIds: normalizedInput.allowedItemIds,
      }, result);
    }

    return await persistAuthorization(c, row, normalizedInput, result, null);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "OpenClaw sync failed");
    await persistSyncError(c, row, normalizedInput, message);
    throw error;
  }
}

export async function listOpenClawAdminAuthorizations(
  c: AppContext,
  input: { q?: string; status?: string; limit: number },
): Promise<OpenClawAdminAuthorizationDto[]> {
  await ensureOpenClawSchema(c.env.DB);
  const rows = await listOpenClawAuthorizations(c.env.DB, input);
  return rows.map(mapAuthorizationRow);
}

export async function getOpenClawAuthorizationForOwner(
  c: AppContext,
  ownerId: string,
): Promise<OpenClawSelfAuthorizationDto> {
  await ensureOpenClawSchema(c.env.DB);
  const row = await getOpenClawAuthorizationByOwner(c.env.DB, ownerId);
  if (!row) {
    throw new AppError("OpenClaw authorization not found", {
      status: 404,
      code: "openclaw_authorization_not_found",
    });
  }
  return mapAuthorizationRow(row);
}

export async function getOpenClawKeyForOwner(
  c: AppContext,
  ownerId: string,
): Promise<OpenClawSelfKeyDto> {
  await ensureOpenClawSchema(c.env.DB);
  const row = await getOpenClawAuthorizationByOwner(c.env.DB, ownerId);
  if (!row) {
    throw new AppError("OpenClaw authorization not found", {
      status: 404,
      code: "openclaw_authorization_not_found",
    });
  }
  const key = String(row.external_key || "").trim();
  if (!key) {
    throw new AppError("OpenClaw key not found", {
      status: 404,
      code: "openclaw_key_not_found",
    });
  }
  return {
    key,
    keyMasked: maskKey(key) || key,
    externalName: row.external_name,
    status: normalizeStatus(row.status),
    expiredAt: row.expired_at,
    quotaLimit: Math.max(0, Math.trunc(Number(row.quota_limit || 0))),
    allowWallet: Number(row.allow_wallet || 0) !== 0,
    allowedItemIds: parseAllowedItemIdsJson(row.allowed_item_ids_json),
    upstreamKeyId: row.upstream_key_id,
    updatedAt: row.updated_at,
  };
}

export async function resyncOpenClawAuthorizationById(
  c: AppContext,
  input: {
    id: string;
    quotaLimit?: number;
    descriptionText?: string | null;
    desiredStatus?: "active" | "inactive";
  },
): Promise<OpenClawAdminAuthorizationDto> {
  await ensureOpenClawSchema(c.env.DB);
  const row = await getOpenClawAuthorizationById(c.env.DB, input.id);
  if (!row) {
    throw new AppError("OpenClaw authorization not found", {
      status: 404,
      code: "openclaw_authorization_not_found",
    });
  }

  return await syncOpenClawAuthorizationForOwner(c, {
    ownerId: row.owner_id,
    subscriptionId: row.subscription_id,
    sourceOrderId: row.source_order_id,
    productId: row.product_id,
    skuId: row.sku_id,
    quotaLimit: typeof input.quotaLimit === "number" ? input.quotaLimit : Number(row.quota_limit || 0),
    externalName: row.external_name,
    descriptionText: input.descriptionText !== undefined ? input.descriptionText : row.description_text,
    allowWallet: Number(row.allow_wallet || 0) !== 0,
    allowedItemIds: parseAllowedItemIdsJson(row.allowed_item_ids_json),
    desiredStatus: input.desiredStatus || (row.status === "inactive" ? "inactive" : "active"),
    expiredAt: row.expired_at,
  });
}

export async function resetOpenClawAuthorizationUsageById(
  c: AppContext,
  input: { id: string },
): Promise<OpenClawAdminAuthorizationDto> {
  await ensureOpenClawSchema(c.env.DB);
  const row = await getOpenClawAuthorizationById(c.env.DB, input.id);
  if (!row) {
    throw new AppError("OpenClaw authorization not found", {
      status: 404,
      code: "openclaw_authorization_not_found",
    });
  }
  const upstreamId = String(row.upstream_key_id || "").trim();
  if (!upstreamId) {
    throw new AppError("OpenClaw upstream key id is missing", {
      status: 400,
      code: "openclaw_missing_upstream_id",
    });
  }
  const current: OpenClawUpstreamResult = {
    upstreamKeyId: row.upstream_key_id,
    externalKey: row.external_key,
    quotaLimit: Math.max(0, Math.trunc(Number(row.quota_limit || 0))),
    expiredAt: row.expired_at,
    status: row.status === "inactive" ? "inactive" : "active",
    payloadJson: row.upstream_payload_json || "{}",
  };
  const result = await resetUpstreamUsage(c, upstreamId, current);
  return await persistAuthorization(c, row, {
    ownerId: row.owner_id,
    subscriptionId: row.subscription_id,
    sourceOrderId: row.source_order_id,
    productId: row.product_id,
    skuId: row.sku_id,
    quotaLimit: current.quotaLimit,
    externalName: row.external_name,
    descriptionText: row.description_text,
    allowWallet: Number(row.allow_wallet || 0) !== 0,
    allowedItemIds: parseAllowedItemIdsJson(row.allowed_item_ids_json),
    desiredStatus: row.status === "inactive" ? "inactive" : "active",
    expiredAt: row.expired_at,
  }, result, null);
}

export async function resetAllOpenClawAuthorizationUsages(
  c: AppContext,
): Promise<{ total: number; succeeded: number; failed: number }> {
  await ensureOpenClawSchema(c.env.DB);
  const rows = await listOpenClawAuthorizations(c.env.DB, { status: "active", limit: 500 });
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await resetOpenClawAuthorizationUsageById(c, { id: row.id });
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  return { total: rows.length, succeeded, failed };
}

export async function deleteOpenClawAuthorizationById(
  c: AppContext,
  input: { id: string },
): Promise<{ id: string; ownerId: string; upstreamKeyId: string | null; upstreamDeleted: boolean; upstreamDeleteStatus: "deleted" | "not_found" }> {
  await ensureOpenClawSchema(c.env.DB);
  const row = await getOpenClawAuthorizationById(c.env.DB, input.id);
  if (!row) {
    throw new AppError("OpenClaw authorization not found", {
      status: 404,
      code: "openclaw_authorization_not_found",
    });
  }
  const upstreamId = String(row.upstream_key_id || "").trim();
  if (!upstreamId) {
    throw new AppError("OpenClaw upstream key id is missing", {
      status: 400,
      code: "openclaw_missing_upstream_id",
    });
  }

  let upstreamDeleted = true;
  let upstreamDeleteStatus: "deleted" | "not_found" = "deleted";
  try {
    await deleteUpstreamKey(c, upstreamId);
  } catch (error: unknown) {
    if (isOpenClawUpstream404(error)) {
      upstreamDeleted = false;
      upstreamDeleteStatus = "not_found";
    } else {
      throw error;
    }
  }

  await deleteOpenClawAuthorizationRowById(c.env.DB, row.id);
  return {
    id: row.id,
    ownerId: row.owner_id,
    upstreamKeyId: row.upstream_key_id,
    upstreamDeleted,
    upstreamDeleteStatus,
  };
}
