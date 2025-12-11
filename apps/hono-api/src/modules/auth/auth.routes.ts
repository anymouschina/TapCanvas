import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { setCookie } from "hono/cookie";
import {
	AuthResponseSchema,
	GithubExchangeRequestSchema,
	GuestLoginRequestSchema,
} from "./auth.schemas";
import { exchangeGithubCode, createGuestUser } from "./auth.service";
import { getConfig } from "../../config";
import { resolveAuth, type AuthPayload } from "../../middleware/auth";

export const authRouter = new Hono<AppEnv>();

const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;

function resolveCookieOptions(hostHeader?: string) {
	const host = (hostHeader || "").toLowerCase().split(":")[0];
	const isLocalhost =
		host.includes("localhost") || host.includes("127.0.0.1");

	if (isLocalhost) {
		// Dev 环境：不设置 domain，使用 Lax，允许 http
		return {
			path: "/",
			sameSite: "Lax" as const,
			secure: false,
			httpOnly: false,
			maxAge: ONE_WEEK_SECONDS,
		};
	}

	const domain = host.endsWith(".tapcanvas.com")
		? ".tapcanvas.com"
		: host === "tapcanvas.com"
			? ".tapcanvas.com"
			: undefined;

	return {
		path: "/",
		sameSite: "None" as const,
		secure: true,
		httpOnly: false,
		maxAge: ONE_WEEK_SECONDS,
		...(domain ? { domain } : {}),
	};
}

function attachAuthCookie(c: any, token: string) {
	const options = resolveCookieOptions(c.req.header("host"));
	setCookie(c, "tap_token", token, options);
}

function normalizeRedirectTarget(
	raw: string | null,
	base?: string | null,
): string | null {
	if (!raw) return null;
	try {
		const candidate = base ? new URL(raw, base) : new URL(raw);
		if (
			candidate.protocol === "http:" ||
			candidate.protocol === "https:"
		) {
			return candidate.toString();
		}
		return null;
	} catch {
		return null;
	}
}

function buildLoginRedirectUrl(
	loginUrl: string | null,
	redirectTarget: string | null,
): string | null {
	if (!loginUrl) return null;
	try {
		const url = new URL(loginUrl);
		if (redirectTarget) {
			url.searchParams.set("redirect", redirectTarget);
		}
		return url.toString();
	} catch {
		if (!redirectTarget) return loginUrl;
		const separator = loginUrl.includes("?") ? "&" : "?";
		return `${loginUrl}${separator}redirect=${encodeURIComponent(
			redirectTarget,
		)}`;
	}
}

function appendAuthParams(
	redirectTarget: string,
	token: string,
	user: AuthPayload,
): string | null {
	try {
		const url = new URL(redirectTarget);
		url.searchParams.set("tap_token", token);
		url.searchParams.set("tap_user", encodeURIComponent(JSON.stringify(user)));
		return url.toString();
	} catch {
		return null;
	}
}

authRouter.get("/session", async (c) => {
	const config = getConfig(c.env);
	const requestedRedirect =
		c.req.query("redirect") || c.req.query("redirect_uri") || null;
	const normalizedRedirect = normalizeRedirectTarget(
		requestedRedirect,
		config.loginUrl ?? c.req.url,
	);

	const resolved = await resolveAuth(c);

	if (resolved) {
		if (normalizedRedirect) {
			const redirectWithAuth = appendAuthParams(
				normalizedRedirect,
				resolved.token,
				resolved.payload,
			);
			if (redirectWithAuth) {
				return c.redirect(redirectWithAuth, 302);
			}
		}
		return c.json({
			authenticated: true,
			token: resolved.token,
			user: resolved.payload,
		});
	}

	const loginRedirect = buildLoginRedirectUrl(
		config.loginUrl,
		normalizedRedirect,
	);

	if (loginRedirect && normalizedRedirect) {
		return c.redirect(loginRedirect, 302);
	}

	if (loginRedirect) {
		return c.json(
			{
				authenticated: false,
				error: "Unauthorized",
				loginUrl: loginRedirect,
			},
			401,
		);
	}

	return c.json({ authenticated: false, error: "Unauthorized" }, 401);
});

authRouter.post("/github/exchange", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const parsed = GithubExchangeRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const result = await exchangeGithubCode(c, parsed.data.code);

	// exchangeGithubCode may return a Hono Response on error
	if (result instanceof Response) {
		return result;
	}

	const validated = AuthResponseSchema.parse(result);
	attachAuthCookie(c, validated.token);
	return c.json(validated);
});

authRouter.post("/guest", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = GuestLoginRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const result = await createGuestUser(c, parsed.data.nickname);
	const validated = AuthResponseSchema.parse(result);
	attachAuthCookie(c, validated.token);
	return c.json(validated);
});
