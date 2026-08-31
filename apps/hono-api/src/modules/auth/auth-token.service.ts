import { getCookie } from "hono/cookie";
import { getConfig } from "../../config";
import { signJwtHS256, verifyJwtHS256 } from "../../jwt";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";
import type { UserPayload } from "./auth.schemas";
import { renewAuthSession } from "./auth-session.service";
import { resolveLocalDevRole } from "./local-admin";
import { hasPasswordConfigured } from "./password";

export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;

export type BrowserAuthTokens = {
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresInSeconds: number;
	refreshTokenExpiresInSeconds: number;
};

type RefreshTokenPayload = {
	sub: string;
	sid: string;
	tokenUse: "refresh";
};

export async function issueBrowserAuthTokens(
	c: AppContext,
	user: UserPayload,
	sessionId: string,
	refreshTokenTtlSeconds: number,
): Promise<BrowserAuthTokens> {
	const secret = getConfig(c.env).jwtSecret;
	const [accessToken, refreshToken] = await Promise.all([
		signJwtHS256(
			{ ...user, sid: sessionId, tokenUse: "access" },
			secret,
			ACCESS_TOKEN_TTL_SECONDS,
		),
		signJwtHS256(
			{ sub: user.sub, sid: sessionId, tokenUse: "refresh" },
			secret,
			refreshTokenTtlSeconds,
		),
	]);
	return {
		accessToken,
		refreshToken,
		accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
		refreshTokenExpiresInSeconds: refreshTokenTtlSeconds,
	};
}

function invalidRefreshToken(): AppError {
	return new AppError("登录续期凭据无效，请重新登录", {
		status: 401,
		code: "refresh_token_invalid",
	});
}

export async function refreshBrowserAuthSession(
	c: AppContext,
): Promise<{ user: UserPayload; tokens: BrowserAuthTokens }> {
	const rawToken = getCookie(c, "tap_refresh_token") || "";
	if (!rawToken) throw invalidRefreshToken();

	const payload = await verifyJwtHS256<RefreshTokenPayload>(
		rawToken,
		getConfig(c.env).jwtSecret,
	);
	if (
		!payload ||
		payload.tokenUse !== "refresh" ||
		typeof payload.sub !== "string" ||
		!payload.sub ||
		typeof payload.sid !== "string" ||
		!payload.sid
	) {
		throw invalidRefreshToken();
	}

	const row = await getPrismaClient().users.findUnique({
		where: { id: payload.sub },
		select: {
			id: true,
			login: true,
			name: true,
			avatar_url: true,
			email: true,
			phone: true,
			password_hash: true,
			role: true,
			guest: true,
			disabled: true,
			deleted_at: true,
		},
	});
	if (!row || row.deleted_at) throw invalidRefreshToken();
	if (Number(row.disabled ?? 0) !== 0) {
		throw new AppError("账号已被停用", {
			status: 403,
			code: "user_disabled",
		});
	}

	const renewed = await renewAuthSession(c, payload.sub, payload.sid);
	if (!renewed.valid) {
		const message = renewed.code === "session_expired"
			? "登录续期已过期，请重新登录"
			: renewed.code === "session_revoked"
				? "当前登录设备已被移除"
				: "登录续期凭据无效，请重新登录";
		throw new AppError(message, { status: 401, code: renewed.code });
	}

	const user: UserPayload = {
		sub: row.id,
		login: row.login,
		name: row.name ?? undefined,
		avatarUrl: row.avatar_url,
		email: row.email,
		phone: row.phone,
		hasPassword: hasPasswordConfigured(row.password_hash),
		role: resolveLocalDevRole(c, row.role),
		guest: Number(row.guest ?? 0) !== 0,
	};
	const tokens = await issueBrowserAuthTokens(
		c,
		user,
		payload.sid,
		renewed.ttlSeconds,
	);
	return { user, tokens };
}
