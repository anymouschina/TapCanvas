/**
 * 登录 cookie 的写入。
 *
 * 单独成文件是为了打破循环依赖：auth.routes.ts 要挂载 wechat-official.routes.ts，
 * 而后者又需要 attachAuthCookies —— 若从 auth.routes.ts 导入就形成环。
 * 任何新的子路由需要写登录态时，都从这里导入，不要回头去 import auth.routes。
 */
import { deleteCookie, setCookie } from "hono/cookie";
import type { AppContext } from "../../types";

const DEFAULT_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function resolveCookieOptions(
	hostHeader?: string,
	maxAge = DEFAULT_COOKIE_TTL_SECONDS,
) {
	const host = (hostHeader || "").toLowerCase().split(":")[0] || "";
	const isLocalhost =
		host === "localhost" || host === "127.0.0.1" || host === "[::1]";

	if (isLocalhost) {
		// Dev 环境：不设置 domain，使用 Lax，允许 http
		return {
			path: "/",
			sameSite: "Lax" as const,
			secure: false,
			httpOnly: true,
			maxAge,
		};
	}

	return {
		path: "/",
		sameSite: "Lax" as const,
		secure: true,
		httpOnly: true,
		maxAge,
	};
}

function resolveSessionMarkerOptions(hostHeader?: string, maxAge?: number) {
	return {
		...resolveCookieOptions(hostHeader, maxAge),
		httpOnly: false,
	};
}

function resolveRefreshCookieOptions(hostHeader: string | undefined, maxAge?: number) {
	return resolveCookieOptions(hostHeader, maxAge);
}

export function attachAuthCookies(
	c: AppContext,
	input: {
		accessToken: string;
		refreshToken: string;
		accessTokenExpiresInSeconds: number;
		refreshTokenExpiresInSeconds: number;
	},
) {
	const host = c.req.header("host");
	setCookie(
		c,
		"tap_token",
		input.accessToken,
		resolveCookieOptions(host, input.accessTokenExpiresInSeconds),
	);
	setCookie(
		c,
		"tap_refresh_token",
		input.refreshToken,
		resolveRefreshCookieOptions(host, input.refreshTokenExpiresInSeconds),
	);
	setCookie(
		c,
		"tap_session_present",
		"1",
		resolveSessionMarkerOptions(host, input.refreshTokenExpiresInSeconds),
	);
}

export function clearAuthCookies(c: AppContext): void {
	const host = c.req.header("host");
	deleteCookie(c, "tap_token", resolveCookieOptions(host));
	deleteCookie(c, "tap_refresh_token", resolveRefreshCookieOptions(host));
	deleteCookie(c, "tap_session_present", resolveSessionMarkerOptions(host));
}
