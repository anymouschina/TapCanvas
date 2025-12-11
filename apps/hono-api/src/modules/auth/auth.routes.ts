import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { setCookie } from "hono/cookie";
import {
	AuthResponseSchema,
	GithubExchangeRequestSchema,
	GuestLoginRequestSchema,
} from "./auth.schemas";
import { exchangeGithubCode, createGuestUser } from "./auth.service";

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
