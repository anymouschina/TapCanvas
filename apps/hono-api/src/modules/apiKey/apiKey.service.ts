import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
	insertApiKeyRow,
	listApiKeysForOwner,
	updateApiKeyRow,
	deleteApiKeyRow,
	getApiKeyByIdForOwner,
	getInternalApiKeyForOwner,
	rotateApiKeyRow,
	type ApiKeyRow,
} from "./apiKey.repo";
import {
	ApiKeySchema,
	CreateApiKeyResponseSchema,
	type ApiKeyDto,
	type ApiKeyBillingOptionDto,
} from "./apiKey.schemas";
import { ensurePersonalBillingTeam, isPersonalTeamId } from "../team/team.service";
import {
	getTeamById,
	getTeamCreditsOverview,
	getTeamMembershipForUserInTeam,
	listTeamMembershipsByUserId,
} from "../team/team.repo";

const encoder = new TextEncoder();
const USER_API_KEY_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const USER_API_KEY_MAX_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const USER_API_KEY_SCOPES = ["public:read", "public:write", "agent:execute"] as const;
type UserApiKeyScope = (typeof USER_API_KEY_SCOPES)[number];

function parseUserApiKeyScopes(raw: string): UserApiKeyScope[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(value): value is UserApiKeyScope =>
				typeof value === "string" && USER_API_KEY_SCOPES.includes(value as UserApiKeyScope),
		);
	} catch {
		return [];
	}
}

function normalizeUserApiKeyScopes(input: readonly UserApiKeyScope[]): UserApiKeyScope[] {
	return USER_API_KEY_SCOPES.filter((scope) => input.includes(scope));
}

function resolveUserApiKeyExpiry(
	value: string | null | undefined,
	now: Date,
	existing?: string | null,
): string {
	if (value === undefined && existing) return existing;
	const expiresAt = value
		? new Date(value)
		: new Date(now.getTime() + USER_API_KEY_LIFETIME_MS);
	const lifetimeMs = expiresAt.getTime() - now.getTime();
	if (!Number.isFinite(expiresAt.getTime()) || lifetimeMs <= 0) {
		throw new AppError("API Key 过期时间必须晚于当前时间", {
			status: 400,
			code: "api_key_expiry_invalid",
		});
	}
	if (lifetimeMs > USER_API_KEY_MAX_LIFETIME_MS) {
		throw new AppError("API Key 有效期不能超过 365 天", {
			status: 400,
			code: "api_key_expiry_too_long",
		});
	}
	return expiresAt.toISOString();
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i += 1) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
	const bytes = new Uint8Array(digest);
	let out = "";
	for (let i = 0; i < bytes.length; i += 1) {
		out += bytes[i].toString(16).padStart(2, "0");
	}
	return out;
}

function normalizeAllowedOrigins(input: unknown): {
	origins: string[];
	invalid: string[];
} {
	const raw = Array.isArray(input) ? input : [];

	let wildcard = false;
	const normalized: string[] = [];
	const invalid: string[] = [];

	for (const item of raw) {
		const trimmed =
			typeof item === "string" ? item.trim() : "";
		if (!trimmed) continue;
		if (trimmed === "*") {
			wildcard = true;
			continue;
		}
		try {
			const url = new URL(trimmed);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				invalid.push(trimmed);
				continue;
			}
			normalized.push(url.origin);
		} catch {
			invalid.push(trimmed);
		}
	}

	if (wildcard) return { origins: ["*"], invalid };

	const deduped = Array.from(
		new Set(normalized.map((o) => o.trim()).filter(Boolean)),
	);
	deduped.sort((a, b) => a.localeCompare(b, "en"));

	return { origins: deduped, invalid };
}

function mapApiKey(
	row: ApiKeyRow,
	display?: { name: string | null; available: number | null },
): ApiKeyDto {
	let allowedOrigins: string[] = [];
	try {
		const parsed = JSON.parse(row.allowed_origins);
		if (Array.isArray(parsed)) {
			allowedOrigins = parsed.filter(
				(v) => typeof v === "string" && !!v.trim(),
			) as string[];
		}
	} catch {
		allowedOrigins = [];
	}

	return ApiKeySchema.parse({
		id: row.id,
		label: row.label,
		keyPrefix: row.key_prefix,
		allowedOrigins,
		enabled: row.enabled === 1,
		scopes: parseUserApiKeyScopes(row.scopes),
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
		rotatedFromId: row.rotated_from_id,
		billingTeamId: row.billing_team_id ?? null,
		billingTeamName: display?.name ?? null,
		billingAvailableCredits: display?.available ?? null,
		lastUsedAt: row.last_used_at ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

/**
 * 校验并归一化用户指定的计费归属团队 id。
 * - 空/undefined/null → 返回 null（不指定，回落现状）。
 * - "personal" sentinel 或 personal_<uid> → 归一到当前用户的个人计费团队；
 *   若传入的是「别人的」personal_<uid> 则拒绝（防越权）。
 * - 具体企业团队 id → 必须是当前操作用户的成员，否则 400（防把 key 计费指向不属于自己的团队盗刷）。
 */
async function resolveAssignedBillingTeamId(
	c: AppContext,
	userId: string,
	billingTeamId: string | null | undefined,
): Promise<string | null> {
	const raw = typeof billingTeamId === "string" ? billingTeamId.trim() : "";
	if (!raw) return null;

	if (raw === "personal" || isPersonalTeamId(raw)) {
		const personalId = await ensurePersonalBillingTeam(c, userId);
		if (!personalId) {
			throw new AppError("无法解析个人计费账户", {
				status: 400,
				code: "billing_team_invalid",
			});
		}
		if (isPersonalTeamId(raw) && raw !== personalId) {
			throw new AppError("无权把 API Key 计费指向该个人账户", {
				status: 400,
				code: "billing_team_forbidden",
			});
		}
		return personalId;
	}

	const membership = await getTeamMembershipForUserInTeam(c.env.DB, userId, raw);
	if (!membership?.team_id) {
		throw new AppError("无权把 API Key 计费指向该团队（需为其成员）", {
			status: 400,
			code: "billing_team_forbidden",
		});
	}
	return membership.team_id;
}

async function resolveBillingTeamDisplay(
	c: AppContext,
	teamId: string | null,
	cache?: Map<string, { name: string | null; available: number | null }>,
): Promise<{ name: string | null; available: number | null }> {
	if (!teamId) return { name: null, available: null };
	const cached = cache?.get(teamId);
	if (cached) return cached;
	const [team, overview] = await Promise.all([
		getTeamById(c.env.DB, teamId),
		getTeamCreditsOverview(c.env.DB, teamId),
	]);
	const display = {
		name: team?.name ?? null,
		available: typeof overview?.available === "number" ? overview.available : null,
	};
	cache?.set(teamId, display);
	return display;
}

/**
 * 当前用户可分配的计费归属选项：个人账户 + 其所有企业团队成员关系（各带余额）。
 * 供前端「计费归属」下拉「名称（余额分）」。
 */
export async function listApiKeyBillingOptions(
	c: AppContext,
	userId: string,
): Promise<ApiKeyBillingOptionDto[]> {
	const options: ApiKeyBillingOptionDto[] = [];

	const personalId = await ensurePersonalBillingTeam(c, userId);
	if (personalId) {
		const [team, overview] = await Promise.all([
			getTeamById(c.env.DB, personalId),
			getTeamCreditsOverview(c.env.DB, personalId),
		]);
		options.push({
			teamId: personalId,
			name: team?.name ?? "个人账户",
			isPersonal: true,
			availableCredits: overview?.available ?? 0,
		});
	}

	const memberships = await listTeamMembershipsByUserId(c.env.DB, userId);
	for (const membership of memberships) {
		const teamId = String(membership.team_id || "").trim();
		if (!teamId || isPersonalTeamId(teamId)) continue;
		const team = await getTeamById(c.env.DB, teamId);
		if (!team) continue;
		const overview = await getTeamCreditsOverview(c.env.DB, teamId);
		options.push({
			teamId,
			name: team.name,
			isPersonal: false,
			availableCredits: overview?.available ?? 0,
		});
	}

	return options;
}

export async function listApiKeys(c: AppContext, userId: string) {
	const rows = await listApiKeysForOwner(c.env.DB, userId);
	const cache = new Map<string, { name: string | null; available: number | null }>();
	return Promise.all(
		rows.map(async (row) =>
			mapApiKey(
				row,
				await resolveBillingTeamDisplay(c, row.billing_team_id ?? null, cache),
			),
		),
	);
}

export async function createApiKey(
	c: AppContext,
	userId: string,
	input: {
		label?: string;
		allowedOrigins?: string[];
		enabled?: boolean;
		scopes?: UserApiKeyScope[];
		expiresAt?: string | null;
		billingTeamId?: string | null;
	},
) {
	const now = new Date();
	const nowIso = now.toISOString();

	const billingTeamId = await resolveAssignedBillingTeamId(
		c,
		userId,
		input.billingTeamId,
	);

	const label =
		typeof input.label === "string" && input.label.trim()
			? input.label.trim()
			: "";
	if (!label) {
		throw new AppError("label 是必填项", {
			status: 400,
			code: "label_required",
		});
	}

	const { origins, invalid } = normalizeAllowedOrigins(
		input.allowedOrigins,
	);

	if (invalid.length) {
		throw new AppError("allowedOrigins 含无效 URL", {
			status: 400,
			code: "invalid_allowed_origins",
			details: { invalid },
		});
	}

	if (!origins.length) {
		throw new AppError("必须配置至少一个 Origin 白名单（或使用 *）", {
			status: 400,
			code: "allowed_origins_required",
		});
	}

	const secret = `tc_sk_${base64UrlEncodeBytes(
		crypto.getRandomValues(new Uint8Array(32)),
	)}`;
	const keyHash = await sha256Hex(secret);
	const keyPrefix = secret.slice(0, 12);
	const scopes = normalizeUserApiKeyScopes(input.scopes ?? ["public:read"]);
	if (!scopes.length) {
		throw new AppError("必须配置至少一个 API Key 权限范围", {
			status: 400,
			code: "api_key_scopes_required",
		});
	}

	const row: ApiKeyRow = {
		id: crypto.randomUUID(),
		owner_id: userId,
		label,
		key_prefix: keyPrefix,
		key_hash: keyHash,
		allowed_origins: JSON.stringify(origins),
		enabled: input.enabled === false ? 0 : 1,
		kind: "user",
		billing_team_id: billingTeamId,
		scopes: JSON.stringify(scopes),
		expires_at: resolveUserApiKeyExpiry(input.expiresAt, now),
		revoked_at: null,
		rotated_from_id: null,
		last_used_at: null,
		created_at: nowIso,
		updated_at: nowIso,
	};

	await insertApiKeyRow(c.env.DB, row);
	const dto = mapApiKey(
		row,
		await resolveBillingTeamDisplay(c, billingTeamId),
	);

	return CreateApiKeyResponseSchema.parse({
		key: secret,
		apiKey: dto,
	});
}

export async function updateApiKey(
	c: AppContext,
	userId: string,
	id: string,
	patch: {
		label?: string;
		allowedOrigins?: string[];
		enabled?: boolean;
		scopes?: UserApiKeyScope[];
		expiresAt?: string | null;
		billingTeamId?: string | null;
	},
) {
	const existing = await getApiKeyByIdForOwner(c.env.DB, id, userId);
	if (!existing) {
		throw new AppError("API Key 不存在或无权限", {
			status: 404,
			code: "api_key_not_found",
		});
	}

	// 传了该字段才改：传 null 清除（回落现状），传具体 id 走成员校验；缺省保持不变。
	const nextBillingTeamId = "billingTeamId" in patch
		? await resolveAssignedBillingTeamId(c, userId, patch.billingTeamId)
		: existing.billing_team_id ?? null;

	const nextLabel =
		typeof patch.label === "string" && patch.label.trim()
			? patch.label.trim()
			: existing.label;

	const nextEnabled =
		typeof patch.enabled === "boolean"
			? patch.enabled
			: existing.enabled === 1;
	const nextScopes = "scopes" in patch
		? normalizeUserApiKeyScopes(patch.scopes ?? [])
		: parseUserApiKeyScopes(existing.scopes);
	if (!nextScopes.length) {
		throw new AppError("必须配置至少一个 API Key 权限范围", {
			status: 400,
			code: "api_key_scopes_required",
		});
	}

	const nextOrigins = (() => {
		if (!("allowedOrigins" in patch)) {
			try {
				const parsed = JSON.parse(existing.allowed_origins);
				return Array.isArray(parsed) ? parsed : [];
			} catch {
				return [];
			}
		}
		const { origins, invalid } = normalizeAllowedOrigins(
			patch.allowedOrigins,
		);
		if (invalid.length) {
			throw new AppError("allowedOrigins 含无效 URL", {
				status: 400,
				code: "invalid_allowed_origins",
				details: { invalid },
			});
		}
		if (!origins.length) {
			throw new AppError("必须配置至少一个 Origin 白名单（或使用 *）", {
				status: 400,
				code: "allowed_origins_required",
			});
		}
		return origins;
	})();

	const now = new Date();
	const nowIso = now.toISOString();
	const row = await updateApiKeyRow(
		c.env.DB,
		userId,
		id,
		{
			label: nextLabel,
			allowedOriginsJson: JSON.stringify(nextOrigins),
			enabled: nextEnabled,
			billingTeamId: nextBillingTeamId,
			scopesJson: JSON.stringify(nextScopes),
			expiresAt: resolveUserApiKeyExpiry(patch.expiresAt, now, existing.expires_at),
		},
		nowIso,
	);

	return mapApiKey(row, await resolveBillingTeamDisplay(c, nextBillingTeamId));
}

export async function rotateApiKey(
	c: AppContext,
	userId: string,
	id: string,
) {
	const existing = await getApiKeyByIdForOwner(c.env.DB, id, userId);
	if (!existing || existing.kind !== "user") {
		throw new AppError("API Key 不存在或无权限", {
			status: 404,
			code: "api_key_not_found",
		});
	}
	const now = new Date();
	const nowIso = now.toISOString();
	const secret = `tc_sk_${base64UrlEncodeBytes(crypto.getRandomValues(new Uint8Array(32)))}`;
	const replacement: ApiKeyRow = {
		...existing,
		id: crypto.randomUUID(),
		key_prefix: secret.slice(0, 12),
		key_hash: await sha256Hex(secret),
		expires_at: resolveUserApiKeyExpiry(undefined, now),
		revoked_at: null,
		rotated_from_id: existing.id,
		last_used_at: null,
		created_at: nowIso,
		updated_at: nowIso,
	};
	try {
		await rotateApiKeyRow(c.env.DB, userId, id, replacement, nowIso);
	} catch {
		throw new AppError("API Key 已失效或无法轮换", {
			status: 409,
			code: "api_key_rotation_conflict",
		});
	}
	return CreateApiKeyResponseSchema.parse({
		key: secret,
		apiKey: mapApiKey(
			replacement,
			await resolveBillingTeamDisplay(c, replacement.billing_team_id),
		),
	});
}

export async function deleteApiKey(
	c: AppContext,
	userId: string,
	id: string,
) {
	const existing = await getApiKeyByIdForOwner(c.env.DB, id, userId);
	if (existing?.kind === "internal_system") {
		throw new AppError("系统内部 API Key 不可删除", {
			status: 403,
			code: "internal_api_key_protected",
		});
	}
	await deleteApiKeyRow(c.env.DB, userId, id);
}

export async function hashApiKeySecret(secret: string) {
	return sha256Hex(secret);
}

const INTERNAL_KEY_LABEL = "__agents_internal__";

// Derives a deterministic raw API key for a user using HMAC-SHA256.
// The raw key is never stored; only its hash is persisted for authentication.
async function deriveInternalRawKey(userId: string, masterSecret: string): Promise<string> {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(masterSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", keyMaterial, enc.encode(`internal_agents:${userId}`));
	return `tc_sk_${base64UrlEncodeBytes(new Uint8Array(sig))}`;
}

// Returns the raw internal API key for a user, creating the DB record on first call.
// The key is stable across calls as long as the master secret doesn't change.
export async function ensureUserInternalApiKey(
	c: AppContext,
	userId: string,
): Promise<string | null> {
	const masterSecret = (() => {
		const fromEnv = typeof (c.env as any).AGENTS_BRIDGE_TOKEN === "string"
			? (c.env as any).AGENTS_BRIDGE_TOKEN.trim() : "";
		if (fromEnv) return fromEnv;
		return typeof (globalThis as any)?.process?.env?.AGENTS_BRIDGE_TOKEN === "string"
			? String((globalThis as any).process.env.AGENTS_BRIDGE_TOKEN).trim() : "";
	})();
	if (!masterSecret) return null;

	const rawKey = await deriveInternalRawKey(userId, masterSecret);
	const keyHash = await sha256Hex(rawKey);

	const existing = await getInternalApiKeyForOwner(c.env.DB, userId);
	if (!existing) {
		const nowIso = new Date().toISOString();
		const row: ApiKeyRow = {
			id: crypto.randomUUID(),
			owner_id: userId,
			label: INTERNAL_KEY_LABEL,
			key_prefix: rawKey.slice(0, 12),
			key_hash: keyHash,
			allowed_origins: JSON.stringify(["*"]),
			enabled: 1,
			kind: "internal_system",
			billing_team_id: null,
			scopes: JSON.stringify(["*"]),
			expires_at: null,
			revoked_at: null,
			rotated_from_id: null,
			last_used_at: null,
			created_at: nowIso,
			updated_at: nowIso,
		};
		try {
			await insertApiKeyRow(c.env.DB, row);
		} catch {
			// Another request may have inserted concurrently; that's fine.
		}
	}

	return rawKey;
}
