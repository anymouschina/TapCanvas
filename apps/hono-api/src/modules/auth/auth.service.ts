import { getConfig } from "../../config";
import type { AppContext } from "../../types";
import { createAuthSession } from "./auth-session.service";
import { issueBrowserAuthTokens } from "./auth-token.service";
import { resolveLocalDevRole } from "./local-admin";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { getPrismaClient } from "../../platform/node/prisma";
import type { UserPayload } from "./auth.schemas";
import { ensurePersonalBillingTeamOnLogin } from "../team/team.service";
import {
	isAliyunEmailConfigured,
	sendAliyunEmail,
} from "./aliyun-email";
import {
	hasPasswordConfigured,
	verifyPasswordRecord,
} from "./password";

function normalizeEmailLocalPart(email: string): string {
	const at = email.indexOf("@");
	const local = (at >= 0 ? email.slice(0, at) : email).trim();
	const cleaned = local.replace(/[^\w.-]/g, "");
	return cleaned || "user";
}

function randomDigits(length: number): string {
	const out: number[] = [];
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	for (let i = 0; i < length; i += 1) {
		out.push(bytes[i] % 10);
	}
	return out.join("");
}

function hexFromArrayBuffer(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

export async function sha256Hex(input: string): Promise<string> {
	const enc = new TextEncoder();
	const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
	return hexFromArrayBuffer(buf);
}

type PersistLoginUserInput = {
	id: string;
	login: string;
	name: string;
	avatarUrl: string | null;
	email: string | null;
	phone: string | null;
	guest: boolean;
	role: string | null;
	nowIso: string;
};

type IssueAuthPayloadInput = {
	userId: string;
	login: string;
	name: string;
	avatarUrl: string | null;
	email: string | null;
	phone: string | null;
	guest: boolean;
};

export async function persistLoginUser(
	c: AppContext,
	input: PersistLoginUserInput,
): Promise<{ created: boolean; role: string | null }> {
	const prisma = getPrismaClient();
	const existing = await prisma.users.findUnique({
		where: { id: input.id },
		select: { id: true, role: true },
	});
	if (existing) {
		const persistedRole = input.role ?? existing.role ?? null;
		await prisma.users.update({
			where: { id: input.id },
			data: {
				login: input.login,
				name: input.name,
				avatar_url: input.avatarUrl,
				email: input.email,
				phone: input.phone,
				role: persistedRole,
				guest: input.guest ? 1 : 0,
				last_seen_at: input.nowIso,
				updated_at: input.nowIso,
			},
		});
		if (!input.guest) {
			await ensurePersonalBillingTeamOnLogin(c, input.id);
		}
		return { created: false, role: persistedRole };
	}

	try {
		await prisma.users.create({
			data: {
				id: input.id,
				login: input.login,
				name: input.name,
				avatar_url: input.avatarUrl,
				email: input.email,
				phone: input.phone,
				role: input.role,
				guest: input.guest ? 1 : 0,
				last_seen_at: input.nowIso,
				created_at: input.nowIso,
				updated_at: input.nowIso,
			},
		});
		if (!input.guest) {
			await ensurePersonalBillingTeamOnLogin(c, input.id);
			const refCode = c.req.header("x-tapcanvas-ref-code") ?? null;
			const clientIp =
				c.req.header("cf-connecting-ip") ??
				c.req.header("x-forwarded-for") ??
				null;
			const { bindReferrerOnRegister } = await import(
				"../referral/referral.service"
			);
			await bindReferrerOnRegister(c, input.id, refCode, clientIp, null);
		}
		return { created: true, role: input.role };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/unique|constraint|duplicate/i.test(message)) {
			throw error;
		}
		const reread = await prisma.users.findUnique({
			where: { id: input.id },
			select: { role: true },
		});
		const persistedRole = input.role ?? reread?.role ?? null;
		await prisma.users.update({
			where: { id: input.id },
			data: {
				login: input.login,
				name: input.name,
				avatar_url: input.avatarUrl,
				email: input.email,
				phone: input.phone,
				role: persistedRole,
				guest: input.guest ? 1 : 0,
				last_seen_at: input.nowIso,
				updated_at: input.nowIso,
			},
		});
		if (!input.guest) {
			await ensurePersonalBillingTeamOnLogin(c, input.id);
		}
		return { created: false, role: persistedRole };
	}
}

export async function issueAuthPayload(
	c: AppContext,
	input: IssueAuthPayloadInput,
): Promise<{
	token: string;
	refreshToken: string;
	accessTokenExpiresInSeconds: number;
	refreshTokenExpiresInSeconds: number;
	user: UserPayload;
}> {
	const userRow = await getPrismaClient().users.findUnique({
		where: { id: input.userId },
		select: {
			role: true,
			password_hash: true,
		},
	});

	const payload: UserPayload = {
		sub: input.userId,
		login: input.login,
		name: input.name,
		avatarUrl: input.avatarUrl,
		email: input.email,
		phone: input.phone,
		hasPassword: hasPasswordConfigured(userRow?.password_hash),
		role: resolveLocalDevRole(c, userRow?.role ?? null),
		guest: input.guest,
	};
	const session = await createAuthSession(c, input.userId);
	const tokens = await issueBrowserAuthTokens(
		c,
		payload,
		session.id,
		session.ttlSeconds,
	);

	return {
		token: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		accessTokenExpiresInSeconds: tokens.accessTokenExpiresInSeconds,
		refreshTokenExpiresInSeconds: tokens.refreshTokenExpiresInSeconds,
		user: payload,
	};
}

async function sendEmailOtpIfConfigured(options: {
	c: AppContext;
	to: string;
	code: string;
}): Promise<{ sent: boolean; skipped: boolean }> {
	const { c, to, code } = options;
	const config = getConfig(c.env);

	if (!isAliyunEmailConfigured(config)) {
		return { sent: false, skipped: true };
	}

	const result = await sendAliyunEmail({
		config: {
			accessKeyId: config.aliyunEmailAccessKeyId!,
			accessKeySecret: config.aliyunEmailAccessKeySecret!,
			accountName: config.aliyunEmailFrom!,
			fromAlias: config.aliyunEmailFromAlias ?? "TapCanvas",
		},
		to,
		subject: "TapCanvas 登录验证码",
		textBody: `你的 TapCanvas 登录验证码：${code}\n\n10 分钟内有效。`,
	});

	if (!result.ok) {
		console.error("[auth/email] aliyun send failed", {
			errorMessage: result.errorMessage,
			requestId: result.requestId,
		});
		return { sent: false, skipped: false };
	}

	return { sent: true, skipped: false };
}

export async function exchangeGithubCode(c: AppContext, code: string) {
	const config = getConfig(c.env);

	if (!config.githubClientId || !config.githubClientSecret) {
		return c.json(
			{
				success: false,
				error: "GitHub OAuth is not configured",
				code: "github_oauth_not_configured",
				missing: {
					GITHUB_CLIENT_ID: !config.githubClientId,
					GITHUB_CLIENT_SECRET: !config.githubClientSecret,
				},
			},
			501,
		);
	}

	const tokenResp = await fetchWithHttpDebugLog(
		c,
		"https://github.com/login/oauth/access_token",
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "TapCanvas/1.0",
			},
			body: JSON.stringify({
				client_id: config.githubClientId,
				client_secret: config.githubClientSecret,
				code,
			}),
		},
		{ tag: "github:oauth" },
	);

	if (!tokenResp.ok) {
		const text = await tokenResp.text().catch(() => "");
		console.error("[auth/github] token exchange failed", {
			status: tokenResp.status,
			statusText: tokenResp.statusText,
			bodySnippet: text.slice(0, 500),
		});
		return c.json(
			{
				success: false,
				error:
					"Failed to exchange GitHub code: " +
					(tokenResp.statusText || text),
			},
			502,
		);
	}

	const tokenJson = (await tokenResp.json()) as {
		access_token?: string;
	};
	const accessToken = tokenJson.access_token;

	if (!accessToken) {
		return c.json(
			{
				success: false,
				error: "No access token from GitHub",
			},
			502,
		);
	}

	const userResp = await fetchWithHttpDebugLog(
		c,
		"https://api.github.com/user",
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "TapCanvas/1.0",
			},
		},
		{ tag: "github:user" },
	);

	if (!userResp.ok) {
		const text = await userResp.text().catch(() => "");
		console.error("[auth/github] fetch user failed", {
			status: userResp.status,
			statusText: userResp.statusText,
			bodySnippet: text.slice(0, 500),
		});
		return c.json(
			{
				success: false,
				error:
					"Failed to fetch GitHub user: " +
					(userResp.statusText || text),
			},
			502,
		);
	}

	const user = (await userResp.json()) as {
		id: number | string;
		login: string;
		name?: string | null;
		avatar_url?: string | null;
	};

	let primaryEmail: string | undefined;
	try {
		const emailResp = await fetchWithHttpDebugLog(
			c,
			"https://api.github.com/user/emails",
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "TapCanvas/1.0",
				},
			},
			{ tag: "github:emails" },
		);
		if (emailResp.ok) {
			const emailData = (await emailResp.json()) as any[];
			if (Array.isArray(emailData) && emailData.length > 0) {
				const primary =
					emailData.find((e: any) => e.primary) ?? emailData[0];
				if (primary?.email && typeof primary.email === "string") {
					primaryEmail = primary.email;
				}
			}
		}
	} catch {
		// ignore email errors, keep primaryEmail undefined
	}

	const payload: UserPayload = {
		sub: String(user.id),
		login: user.login,
		name: user.name || user.login,
		avatarUrl: user.avatar_url ?? null,
		email: primaryEmail ?? null,
		phone: null,
		hasPassword: false,
		role: resolveLocalDevRole(c, null),
		guest: false,
	};
	const persistedRole = resolveLocalDevRole(c, null);

	const nowIso = new Date().toISOString();
	await persistLoginUser(c, {
		id: payload.sub,
		login: payload.login,
		name: payload.name ?? payload.login,
		avatarUrl: payload.avatarUrl ?? null,
		email: payload.email ?? null,
		phone: null,
		guest: false,
		role: persistedRole,
		nowIso,
	});
	return issueAuthPayload(c, {
		userId: payload.sub,
		login: payload.login,
		name: payload.name ?? payload.login,
		avatarUrl: payload.avatarUrl ?? null,
		email: payload.email ?? null,
		phone: null,
		guest: false,
	});
}

export async function createGuestUser(c: AppContext, nickname?: string) {
	const id = crypto.randomUUID();
	const trimmed =
		typeof nickname === "string" ? nickname.trim().slice(0, 32) : "";
	const normalizedLogin = trimmed
		? trimmed.replace(/[^\w-]/g, "").toLowerCase()
		: "";
	const login = normalizedLogin || `guest_${id.slice(0, 8)}`;
	const name = trimmed || `Guest ${id.slice(0, 4).toUpperCase()}`;

	const nowIso = new Date().toISOString();
	await persistLoginUser(c, {
		id,
		login,
		name,
		avatarUrl: null,
		email: null,
		phone: null,
		guest: true,
		role: resolveLocalDevRole(c, null),
		nowIso,
	});

	return issueAuthPayload(c, {
		userId: id,
		login,
		name,
		avatarUrl: null,
		email: null,
		phone: null,
		guest: true,
	});
}

export async function requestEmailLoginCode(c: AppContext, email: string) {
	const config = getConfig(c.env);

	const now = Date.now();
	const nowIso = new Date(now).toISOString();
	const expiresAtIso = new Date(now + 10 * 60 * 1000).toISOString();

	const isDebug = config.emailLoginDebug;
	const host = (c.req.header("host") || "").toLowerCase();
	const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
	const canReturnDevCode = isDebug || isLocalhost;

	if (!isAliyunEmailConfigured(config)) {
		if (!canReturnDevCode) {
			return c.json(
				{
					success: false,
					error: "邮箱登录未配置邮件发送服务，请联系管理员",
					code: "email_login_not_configured",
					missing: {
						ALIYUN_EMAIL_ACCESS_KEY_ID: !config.aliyunEmailAccessKeyId,
						ALIYUN_EMAIL_ACCESS_KEY_SECRET: !config.aliyunEmailAccessKeySecret,
						ALIYUN_EMAIL_FROM: !config.aliyunEmailFrom,
					},
				},
				501,
			);
		}
	}

	const id = crypto.randomUUID();
	const code = randomDigits(6);
	const salt = crypto.randomUUID();
	const codeHash = await sha256Hex(`${salt}:${code}`);

	try {
		await getPrismaClient().email_login_codes.create({
			data: {
				id,
				email,
				code_salt: salt,
				code_hash: codeHash,
				expires_at: expiresAtIso,
				used_at: null,
				created_at: nowIso,
				updated_at: nowIso,
			},
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("does not exist") || msg.includes("no such table")) {
			return c.json(
				{
					success: false,
					error:
						"邮箱登录尚未初始化（缺少 email_login_codes 表），请先执行数据库 schema 更新",
					code: "email_login_schema_missing",
				},
				501,
			);
		}
		throw err;
	}

	const mail = await sendEmailOtpIfConfigured({ c, to: email, code });
	if (!mail.sent && !mail.skipped) {
		return c.json({ success: false, error: "验证码发送失败，请稍后再试" }, 502);
	}

	return { sent: true, expiresInSeconds: 10 * 60 };
}

export async function verifyEmailLoginCode(
	c: AppContext,
	email: string,
	code: string,
) {
	const nowIso = new Date().toISOString();

	const row = await getPrismaClient().email_login_codes.findFirst({
		where: {
			email,
			used_at: null,
			expires_at: { gt: nowIso },
		},
		orderBy: { created_at: "desc" },
		select: {
			id: true,
			code_salt: true,
			code_hash: true,
			expires_at: true,
		},
	});

	if (!row) {
		return c.json({ success: false, error: "验证码不正确或已过期" }, 401);
	}

	const expected = String(row.code_hash || "");
	const salt = String(row.code_salt || "");
	const actual = await sha256Hex(`${salt}:${code}`);

	if (!expected || expected !== actual) {
		return c.json({ success: false, error: "验证码不正确或已过期" }, 401);
	}

	try {
		await getPrismaClient().email_login_codes.update({
			where: { id: String(row.id) },
			data: { used_at: nowIso, updated_at: nowIso },
		});
	} catch {
		// Best-effort; even if it fails, token is already issued below.
	}

	const userId = `email_${await sha256Hex(email)}`;
	const login = normalizeEmailLocalPart(email);
	const name = login;

	await persistLoginUser(c, {
		id: userId,
		login,
		name,
		avatarUrl: null,
		email,
		phone: null,
		guest: false,
		role: resolveLocalDevRole(c, null),
		nowIso,
	});

	return issueAuthPayload(c, {
		userId,
		login,
		name,
		avatarUrl: null,
		email,
		phone: null,
		guest: false,
	});
}

export async function loginWithCredentials(
	c: AppContext,
	username: string,
	password: string,
) {
	const normalizedUsername = username.trim();
	const matchingUsers = await getPrismaClient().users.findMany({
		where: {
			login: normalizedUsername,
			deleted_at: null,
		},
		select: {
			id: true,
			login: true,
			name: true,
			avatar_url: true,
			email: true,
			phone: true,
			guest: true,
			disabled: true,
			password_hash: true,
			password_salt: true,
		},
		take: 2,
	});
	if (matchingUsers.length > 1) {
		return c.json(
			{ success: false, error: "账号数据不唯一，请联系管理员", code: "login_not_unique" },
			409,
		);
	}
	const userRow = matchingUsers[0];

	if (!userRow) {
		return c.json({ success: false, error: "账号或密码不正确" }, 401);
	}
	if (Number(userRow.disabled ?? 0) !== 0) {
		return c.json({ success: false, error: "账号已被禁用", code: "user_disabled" }, 403);
	}
	if (!hasPasswordConfigured(userRow.password_hash) || !userRow.password_salt) {
		return c.json(
			{ success: false, error: "该账号尚未设置密码", code: "password_not_set" },
			401,
		);
	}

	const matched = await verifyPasswordRecord({
		password,
		hash: userRow.password_hash ?? "",
		salt: userRow.password_salt,
	});
	if (!matched) {
		return c.json({ success: false, error: "账号或密码不正确" }, 401);
	}

	const nowIso = new Date().toISOString();
	await getPrismaClient().users.update({
		where: { id: userRow.id },
		data: { last_seen_at: nowIso, updated_at: nowIso },
	});

	return issueAuthPayload(c, {
		userId: userRow.id,
		login: userRow.login,
		name: userRow.name || userRow.login,
		avatarUrl: userRow.avatar_url ?? null,
		email: userRow.email ?? null,
		phone: userRow.phone ?? null,
		guest: Number(userRow.guest ?? 0) !== 0,
	});
}
