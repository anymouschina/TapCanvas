import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
	insertApiKeyRow,
	listApiKeysForOwner,
	updateApiKeyRow,
	deleteApiKeyRow,
	getApiKeyByIdForOwner,
	type ApiKeyRow,
} from "./apiKey.repo";
import {
	ApiKeySchema,
	CreateApiKeyResponseSchema,
	type ApiKeyDto,
} from "./apiKey.schemas";

const encoder = new TextEncoder();

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

function mapApiKey(row: ApiKeyRow): ApiKeyDto {
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
		lastUsedAt: row.last_used_at ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

export async function listApiKeys(c: AppContext, userId: string) {
	const rows = await listApiKeysForOwner(c.env.DB, userId);
	return rows.map(mapApiKey);
}

export async function createApiKey(
	c: AppContext,
	userId: string,
	input: { label?: string; allowedOrigins?: string[]; enabled?: boolean },
) {
	const nowIso = new Date().toISOString();

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

	const row: ApiKeyRow = {
		id: crypto.randomUUID(),
		owner_id: userId,
		label,
		key_prefix: keyPrefix,
		key_hash: keyHash,
		allowed_origins: JSON.stringify(origins),
		enabled: input.enabled === false ? 0 : 1,
		last_used_at: null,
		created_at: nowIso,
		updated_at: nowIso,
	};

	await insertApiKeyRow(c.env.DB, row);
	const dto = mapApiKey(row);

	return CreateApiKeyResponseSchema.parse({
		key: secret,
		apiKey: dto,
	});
}

export async function updateApiKey(
	c: AppContext,
	userId: string,
	id: string,
	patch: { label?: string; allowedOrigins?: string[]; enabled?: boolean },
) {
	const existing = await getApiKeyByIdForOwner(c.env.DB, id, userId);
	if (!existing) {
		throw new AppError("API Key 不存在或无权限", {
			status: 404,
			code: "api_key_not_found",
		});
	}

	const nextLabel =
		typeof patch.label === "string" && patch.label.trim()
			? patch.label.trim()
			: existing.label;

	const nextEnabled =
		typeof patch.enabled === "boolean"
			? patch.enabled
			: existing.enabled === 1;

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

	const nowIso = new Date().toISOString();
	const row = await updateApiKeyRow(
		c.env.DB,
		userId,
		id,
		{
			label: nextLabel,
			allowedOriginsJson: JSON.stringify(nextOrigins),
			enabled: nextEnabled,
		},
		nowIso,
	);

	return mapApiKey(row);
}

export async function deleteApiKey(
	c: AppContext,
	userId: string,
	id: string,
) {
	await deleteApiKeyRow(c.env.DB, userId, id);
}

export async function hashApiKeySecret(secret: string) {
	return sha256Hex(secret);
}
