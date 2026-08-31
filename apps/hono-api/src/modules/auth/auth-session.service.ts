import type { AppContext } from "../../types";
import { getConfig } from "../../config";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	DEFAULT_MAX_ACTIVE_SESSIONS,
	DEFAULT_SESSION_TTL_DAYS,
	readAccountSettings,
} from "../account/account.settings";

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthSessionState =
	| { valid: true; id: string }
	| {
			valid: false;
			code:
				| "session_missing"
				| "session_revoked"
				| "session_expired"
				| "session_owner_mismatch";
	  };

export type RenewedAuthSessionState =
	| { valid: true; id: string; ttlSeconds: number }
	| Exclude<AuthSessionState, { valid: true }>;

function readHeader(c: AppContext, name: string): string | null {
	const value = String(c.req.header(name) || "").trim();
	return value ? value : null;
}

function inferDeviceLabel(userAgent: string | null): string {
	if (!userAgent) return "未知设备";
	const browser = userAgent.includes("Edg/")
		? "Edge"
		: userAgent.includes("Chrome/")
			? "Chrome"
			: userAgent.includes("Firefox/")
				? "Firefox"
				: userAgent.includes("Safari/")
					? "Safari"
					: "浏览器";
	const system = userAgent.includes("Windows")
		? "Windows"
		: userAgent.includes("Android")
			? "Android"
			: userAgent.includes("iPhone") || userAgent.includes("iPad")
				? "iOS"
				: userAgent.includes("Mac OS")
					? "macOS"
					: userAgent.includes("Linux")
						? "Linux"
						: "未知系统";
	return `${browser} · ${system}`;
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(
		new Uint8Array(digest),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
}

async function buildNetworkHash(c: AppContext): Promise<string | null> {
	const address = readHeader(c, "cf-connecting-ip") || readHeader(c, "x-real-ip");
	if (!address) return null;
	return sha256Hex(`${getConfig(c.env).jwtSecret}:auth-session-network:${address}`);
}

async function sessionPolicy(c: AppContext): Promise<{ ttlSeconds: number; maxActiveSessions: number }> {
	const state = await readAccountSettings(c);
	return {
		ttlSeconds: state.effectiveSessionTtlDays * 24 * 60 * 60,
		maxActiveSessions: state.effectiveMaxActiveSessions,
	};
}

export async function createAuthSession(c: AppContext, userId: string): Promise<{ id: string; ttlSeconds: number }> {
	const id = crypto.randomUUID();
	const now = new Date();
	const nowIso = now.toISOString();
	const userAgent = readHeader(c, "user-agent");
	const [networkHash, policy] = await Promise.all([buildNetworkHash(c), sessionPolicy(c)]);
	await getPrismaClient().$transaction(async (tx) => {
		// The user row lock serializes create-and-prune for this user until commit.
		await tx.$queryRaw<Array<{ id: string }>>`
			SELECT "id"
			FROM "users"
			WHERE "id" = ${userId}
			FOR UPDATE
		`;
		await tx.auth_sessions.create({
			data: {
				id,
				user_id: userId,
				device_label: inferDeviceLabel(userAgent),
				user_agent: userAgent?.slice(0, 512) ?? null,
				network_hash: networkHash,
				created_at: nowIso,
				last_seen_at: nowIso,
				expires_at: new Date(now.getTime() + policy.ttlSeconds * 1000).toISOString(),
			},
		});
		const existingActive = await tx.auth_sessions.findMany({
			where: {
				user_id: userId,
				id: { not: id },
				revoked_at: null,
				expires_at: { gt: nowIso },
			},
			orderBy: [
				{ last_seen_at: "desc" },
				{ created_at: "desc" },
				{ id: "desc" },
			],
			select: { id: true },
		});
		const retainedExistingCount = Math.max(0, policy.maxActiveSessions - 1);
		const overflowIds = existingActive
			.slice(retainedExistingCount)
			.map((row) => row.id);
		if (overflowIds.length > 0) {
			await tx.auth_sessions.updateMany({
				where: { id: { in: overflowIds }, revoked_at: null },
				data: { revoked_at: nowIso, revoked_reason: "session_limit" },
			});
		}
	});
	return { id, ttlSeconds: policy.ttlSeconds };
}

export async function validateAuthSession(
	userId: string,
	sessionId: string | undefined,
): Promise<AuthSessionState> {
	if (!sessionId) return { valid: false, code: "session_missing" };
	const row = await getPrismaClient().auth_sessions.findUnique({
		where: { id: sessionId },
		select: { id: true, user_id: true, revoked_at: true, expires_at: true, last_seen_at: true },
	});
	if (!row) return { valid: false, code: "session_missing" };
	if (row.user_id !== userId) return { valid: false, code: "session_owner_mismatch" };
	if (row.revoked_at) return { valid: false, code: "session_revoked" };
	const now = Date.now();
	if (Date.parse(row.expires_at) <= now) return { valid: false, code: "session_expired" };
	if (now - Date.parse(row.last_seen_at) >= SESSION_TOUCH_INTERVAL_MS) {
		await getPrismaClient().auth_sessions.updateMany({
			where: { id: row.id, revoked_at: null },
			data: { last_seen_at: new Date(now).toISOString() },
		});
	}
	return { valid: true, id: row.id };
}

export async function renewAuthSession(
	c: AppContext,
	userId: string,
	sessionId: string,
): Promise<RenewedAuthSessionState> {
	const now = new Date();
	const nowIso = now.toISOString();
	const policy = await sessionPolicy(c);
	const result = await getPrismaClient().auth_sessions.updateMany({
		where: {
			id: sessionId,
			user_id: userId,
			revoked_at: null,
			expires_at: { gt: nowIso },
		},
		data: {
			last_seen_at: nowIso,
			expires_at: new Date(now.getTime() + policy.ttlSeconds * 1000).toISOString(),
		},
	});
	if (result.count === 0) {
		const current = await validateAuthSession(userId, sessionId);
		if (!current.valid) return current;
		throw new Error("auth session renewal did not update an otherwise valid session");
	}
	return { valid: true, id: sessionId, ttlSeconds: policy.ttlSeconds };
}

export async function revokeAuthSession(
	sessionId: string,
	reason: "logout" | "user_revoked" | "admin_revoked" | "session_limit",
): Promise<boolean> {
	const result = await getPrismaClient().auth_sessions.updateMany({
		where: { id: sessionId, revoked_at: null },
		data: { revoked_at: new Date().toISOString(), revoked_reason: reason },
	});
	return result.count > 0;
}
