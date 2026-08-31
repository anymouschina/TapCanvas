import { Hono } from "hono";
import type { AppEnv } from "../../types";
import {
	AuthResponseSchema,
	BrowserAuthResponseSchema,
	GithubExchangeRequestSchema,
	CredentialLoginRequestSchema,
} from "./auth.schemas";
import {
	exchangeGithubCode,
	loginWithCredentials,
} from "./auth.service";
import { getConfig } from "../../config";
import { authMiddleware, resolveAuth } from "../../middleware/auth";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	parseUserGenerationPrefs,
	resolveEffectiveUserGenerationPrefs,
	sanitizeUserGenerationPrefs,
} from "./generation-prefs";
import { agentsCliAuthRouter } from "./agents-cli-auth.routes";
import { attachAuthCookies, clearAuthCookies } from "./auth.cookies";
import { refreshBrowserAuthSession } from "./auth-token.service";
import { AppError } from "../../middleware/error";

export const authRouter = new Hono<AppEnv>();

authRouter.route("/agents-cli", agentsCliAuthRouter);

function normalizeRedirectTarget(
	raw: string | null,
	base?: string | null,
	allowedOriginsRaw?: string,
): string | null {
	if (!raw) return null;
	try {
		const candidate = base ? new URL(raw, base) : new URL(raw);
		if (candidate.protocol !== "http:" && candidate.protocol !== "https:") return null;
		const baseOrigin = base ? new URL(base).origin : null;
		const allowedOrigins = new Set(
			String(allowedOriginsRaw || "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean)
				.map((value) => new URL(value).origin),
		);
		if (candidate.origin === baseOrigin || allowedOrigins.has(candidate.origin)) {
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

function browserAuthResponse(input: { user: unknown }) {
	return BrowserAuthResponseSchema.parse({
		authenticated: true,
		user: input.user,
	});
}

function attachValidatedAuthCookies(
	c: Parameters<typeof attachAuthCookies>[0],
	input: ReturnType<typeof AuthResponseSchema.parse>,
): void {
	attachAuthCookies(c, {
		accessToken: input.token,
		refreshToken: input.refreshToken,
		accessTokenExpiresInSeconds: input.accessTokenExpiresInSeconds,
		refreshTokenExpiresInSeconds: input.refreshTokenExpiresInSeconds,
	});
}

authRouter.get("/session", async (c) => {
	const config = getConfig(c.env);
	const requestedRedirect =
		c.req.query("redirect") || c.req.query("redirect_uri") || null;
	const normalizedRedirect = normalizeRedirectTarget(
		requestedRedirect,
		config.loginUrl ?? c.req.url,
		typeof c.env.CORS_ALLOWED_ORIGINS === "string" ? c.env.CORS_ALLOWED_ORIGINS : undefined,
	);

	const resolved = await resolveAuth(c);

	if (resolved) {
		if (normalizedRedirect) {
			return c.redirect(normalizedRedirect, 302);
		}
		return c.json(browserAuthResponse({ user: resolved.payload }));
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

authRouter.post("/refresh", async (c) => {
	try {
		const refreshed = await refreshBrowserAuthSession(c);
		attachAuthCookies(c, refreshed.tokens);
		return c.json(browserAuthResponse({ user: refreshed.user }));
	} catch (error: unknown) {
		if (error instanceof AppError && (error.status === 401 || error.status === 403)) {
			clearAuthCookies(c);
			return c.json(
				{ error: error.message, code: error.code },
				error.status === 403 ? 403 : 401,
			);
		}
		throw error;
	}
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
	attachValidatedAuthCookies(c, validated);
	return c.json(browserAuthResponse(validated));
});

authRouter.post("/guest", async (c) => {
	return c.json(
		{
			success: false,
			error: "游客模式已下线，请使用管理员账号登录",
			code: "guest_login_disabled",
		},
		410,
	);
});

authRouter.post("/email/request", async (c) => {
	return c.json(
		{
			success: false,
			error: "邮箱登录已下线，请使用管理员账号登录",
			code: "email_login_disabled",
		},
		410,
	);
});

authRouter.post("/email/verify", async (c) => {
	return c.json(
		{
			success: false,
			error: "邮箱登录已下线，请使用管理员账号登录",
			code: "email_login_disabled",
		},
		410,
	);
});

authRouter.post("/login", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CredentialLoginRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ success: false, error: "请求参数不合法", issues: parsed.error.issues },
			400,
		);
	}

	const result = await loginWithCredentials(
		c,
		parsed.data.username,
		parsed.data.password,
	);
	if (result instanceof Response) return result;

	const validated = AuthResponseSchema.parse(result);
	attachValidatedAuthCookies(c, validated);
	return c.json(browserAuthResponse(validated));
});

authRouter.get("/notification-preferences", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const user = await getPrismaClient().users.findUnique({
		where: { id: userId },
		select: { email_marketing_opt_out: true },
	});
	if (!user) return c.json({ error: "User not found" }, 404);

	return c.json({ emailMarketing: user.email_marketing_opt_out === 0 });
});

authRouter.put("/notification-preferences", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const emailMarketing = typeof body.emailMarketing === "boolean" ? body.emailMarketing : null;
	if (emailMarketing === null) {
		return c.json({ error: "Invalid request body: emailMarketing must be boolean" }, 400);
	}

	await getPrismaClient().users.update({
		where: { id: userId },
		data: { email_marketing_opt_out: emailMarketing ? 0 : 1 },
	});

	return c.json({ emailMarketing });
});

// 用户账号生成偏好（最近一次明确选择的生图/视频模型与规格）。
// GET 返回补齐新账号初始值后的有效偏好；PUT 合并本次明确变更，未提交字段保持不变。
authRouter.get("/generation-preferences", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const user = await getPrismaClient().users.findUnique({
		where: { id: userId },
		select: { generation_prefs: true },
	});
	if (!user) return c.json({ error: "User not found" }, 404);
	return c.json({
		prefs: resolveEffectiveUserGenerationPrefs(
			parseUserGenerationPrefs(user.generation_prefs),
		),
	});
});

authRouter.put("/generation-preferences", authMiddleware, async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => null)) as unknown;
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return c.json({ error: "Invalid request body" }, 400);
	}
	const patch = sanitizeUserGenerationPrefs(body);
	if (!patch) {
		return c.json({ error: "Invalid request body: at least one generation preference is required" }, 400);
	}
	const user = await getPrismaClient().users.findUnique({
		where: { id: userId },
		select: { generation_prefs: true },
	});
	if (!user) return c.json({ error: "User not found" }, 404);
	const prefs = resolveEffectiveUserGenerationPrefs({
		...(parseUserGenerationPrefs(user.generation_prefs) ?? {}),
		...patch,
	});
	await getPrismaClient().users.update({
		where: { id: userId },
		data: { generation_prefs: JSON.stringify(prefs) },
	});
	return c.json({ prefs });
});
