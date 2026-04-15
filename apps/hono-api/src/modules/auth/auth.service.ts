import { getConfig } from "../../config";
import type { AppContext } from "../../types";
import { signJwtHS256 } from "../../jwt";
import { resolveLocalDevRole } from "./local-admin";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { getPrismaClient } from "../../platform/node/prisma";
import type { UserPayload } from "./auth.schemas";
import { grantSignupBonusToPersonalTeam } from "../team/team.service";
import IORedis from "ioredis";
import {
	isAliyunSmsConfigured,
	sendAliyunSmsOtp,
} from "./aliyun-sms";
import {
	createPasswordRecord,
	hasPasswordConfigured,
	verifyPasswordRecord,
} from "./password";

function normalizeEmailLocalPart(email: string): string {
	const at = email.indexOf("@");
	const local = (at >= 0 ? email.slice(0, at) : email).trim();
	const cleaned = local.replace(/[^\w.-]/g, "");
	return cleaned || "user";
}

function normalizePhoneE164(raw: string): string {
	const trimmed = (raw || "").trim();
	if (!trimmed) return "";
	const cleaned = trimmed.replace(/[^\d+]/g, "");
	if (!cleaned) return "";
	if (cleaned.startsWith("+")) {
		const digits = cleaned.slice(1).replace(/\D/g, "");
		return digits ? `+${digits}` : "";
	}
	const digits = cleaned.replace(/\D/g, "");
	if (!digits) return "";
	// Heuristic: treat mainland China 11-digit mobile as +86 by default.
	if (digits.length === 11 && digits.startsWith("1")) return `+86${digits}`;
	return `+${digits}`;
}

function isValidE164(phone: string): boolean {
	return /^\+\d{8,15}$/.test((phone || "").trim());
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

async function sha256Hex(input: string): Promise<string> {
	const enc = new TextEncoder();
	const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
	return hexFromArrayBuffer(buf);
}

const PHONE_OTP_TTL_SECONDS = 10 * 60;
const PHONE_OTP_DAILY_LIMIT = 10;

type PhoneOtpRedisPayload = {
	id?: string;
	codeSalt: string;
	codeHash: string;
	createdAt: string;
};

let phoneOtpRedisClient: IORedis | null = null;
let phoneOtpRedisClientUrl = "";

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

async function persistLoginUser(
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
			await grantSignupBonusToPersonalTeam(c, input.id);
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
			await grantSignupBonusToPersonalTeam(c, input.id);
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
			await grantSignupBonusToPersonalTeam(c, input.id);
		}
		return { created: false, role: persistedRole };
	}
}

async function issueAuthPayload(
	c: AppContext,
	input: IssueAuthPayloadInput,
): Promise<{ token: string; user: UserPayload }> {
	const config = getConfig(c.env);
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

	const token = await signJwtHS256(
		payload,
		config.jwtSecret,
		7 * 24 * 60 * 60,
	);

	return {
		token,
		user: payload,
	};
}

function isPhoneOtpTraceEnabled(c: AppContext): boolean {
	return String(c.env.AUTH_PHONE_OTP_TRACE || "").trim() === "1";
}

function maskPhone(phone: string): string {
	const raw = String(phone || "");
	if (raw.length <= 7) return raw;
	return `${raw.slice(0, 4)}****${raw.slice(-3)}`;
}

function shortHash(input: string): string {
	return String(input || "").slice(0, 12);
}

function phoneOtpTrace(
	c: AppContext,
	event: string,
	details: Record<string, unknown>,
): void {
	if (!isPhoneOtpTraceEnabled(c)) return;
	const requestId = c.get("requestId");
	console.log("[auth/phone][trace]", {
		event,
		requestId: requestId ?? null,
		...details,
	});
}

function disposePhoneOtpRedisClient(): void {
	if (!phoneOtpRedisClient) return;
	void phoneOtpRedisClient.quit().catch(() => undefined);
	phoneOtpRedisClient = null;
	phoneOtpRedisClientUrl = "";
}

function resolvePhoneOtpRedisKey(c: AppContext, phone: string): string {
	const rawPrefix = String(c.env.PHONE_OTP_REDIS_PREFIX || "").trim();
	const prefix = rawPrefix || "auth:phone-login-code";
	return `${prefix}:${phone}`;
}

function getChinaDayStartIso(nowMs: number): string {
	const chinaOffsetMs = 8 * 60 * 60 * 1000;
	const chinaNow = new Date(nowMs + chinaOffsetMs);
	const year = chinaNow.getUTCFullYear();
	const month = chinaNow.getUTCMonth();
	const day = chinaNow.getUTCDate();
	const startUtcMs = Date.UTC(year, month, day) - chinaOffsetMs;
	return new Date(startUtcMs).toISOString();
}

function getChinaNextDayStartIso(nowMs: number): string {
	const chinaOffsetMs = 8 * 60 * 60 * 1000;
	const chinaNow = new Date(nowMs + chinaOffsetMs);
	const year = chinaNow.getUTCFullYear();
	const month = chinaNow.getUTCMonth();
	const day = chinaNow.getUTCDate();
	const nextStartUtcMs = Date.UTC(year, month, day + 1) - chinaOffsetMs;
	return new Date(nextStartUtcMs).toISOString();
}

async function countPhoneOtpRequestsInChinaDay(
	c: AppContext,
	phone: string,
	nowMs: number,
): Promise<number> {
	const dayStartIso = getChinaDayStartIso(nowMs);
	void c;
	return getPrismaClient().phone_login_codes.count({
		where: {
			phone,
			created_at: { gte: dayStartIso },
		},
	});
}

function getPhoneOtpRedisClient(c: AppContext): IORedis | null {
	const redisUrl = String(c.env.REDIS_URL || "").trim();
	if (!redisUrl) return null;

	if (phoneOtpRedisClient && phoneOtpRedisClientUrl === redisUrl) {
		return phoneOtpRedisClient;
	}
	if (phoneOtpRedisClient) {
		disposePhoneOtpRedisClient();
	}

	const client = new IORedis(redisUrl, {
		lazyConnect: true,
		enableAutoPipelining: true,
		enableOfflineQueue: false,
		maxRetriesPerRequest: 2,
		retryStrategy: () => null,
	});
	client.on("error", (error) => {
		console.error("[auth/phone] redis error", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
	phoneOtpRedisClient = client;
	phoneOtpRedisClientUrl = redisUrl;
	return client;
}

function isRedisAlreadyConnectingMessage(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("already connecting/connected");
}

async function waitForPhoneOtpRedisReady(client: IORedis): Promise<void> {
	if (String(client.status) === "ready") return;
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Redis connect timeout"));
		}, 2000);

		const cleanup = () => {
			clearTimeout(timeout);
			client.off("ready", onReady);
			client.off("error", onError);
			client.off("end", onEnd);
		};
		const onReady = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onEnd = () => {
			cleanup();
			reject(new Error("Redis connection ended"));
		};

		client.once("ready", onReady);
		client.once("error", onError);
		client.once("end", onEnd);
	});
}

async function ensurePhoneOtpRedisReady(client: IORedis): Promise<void> {
	if (String(client.status) === "ready") return;
	if (String(client.status) === "wait") {
		try {
			await client.connect();
		} catch (error) {
			if (!isRedisAlreadyConnectingMessage(error)) throw error;
		}
	}
	if (String(client.status) !== "ready") {
		await waitForPhoneOtpRedisReady(client);
	}
}

async function setPhoneOtpCode(options: {
	c: AppContext;
	phone: string;
	codeSalt: string;
	codeHash: string;
	createdAt: string;
}): Promise<boolean> {
	const { c, phone, codeSalt, codeHash, createdAt } = options;
	const id = crypto.randomUUID();
	const expiresAtIso = new Date(
		Date.parse(createdAt) + PHONE_OTP_TTL_SECONDS * 1000,
	).toISOString();
	await getPrismaClient().phone_login_codes.create({
		data: {
			id,
			phone,
			code_salt: codeSalt,
			code_hash: codeHash,
			expires_at: expiresAtIso,
			used_at: null,
			created_at: createdAt,
			updated_at: createdAt,
		},
	});

	const client = getPhoneOtpRedisClient(c);
	if (client) {
		try {
			const key = resolvePhoneOtpRedisKey(c, phone);
			const payload: PhoneOtpRedisPayload = { codeSalt, codeHash, createdAt };
			await ensurePhoneOtpRedisReady(client);
			await client.set(key, JSON.stringify(payload), "EX", PHONE_OTP_TTL_SECONDS);
		} catch (error) {
				console.error("[auth/phone] redis unavailable, fallback to database", {
				error: error instanceof Error ? error.message : String(error),
			});
			disposePhoneOtpRedisClient();
		}
	}

	return true;
}

async function getPhoneOtpCode(
	c: AppContext,
	phone: string,
): Promise<PhoneOtpRedisPayload | null> {
	const client = getPhoneOtpRedisClient(c);
	if (client) {
		try {
			const key = resolvePhoneOtpRedisKey(c, phone);
			await ensurePhoneOtpRedisReady(client);
			const raw = await client.get(key);
			if (!raw) return null;
			try {
				const parsed = JSON.parse(raw) as PhoneOtpRedisPayload;
				if (!parsed.codeSalt || !parsed.codeHash) return null;
				return parsed;
			} catch {
				return null;
			}
		} catch (error) {
				console.error("[auth/phone] redis unavailable, fallback to database", {
				error: error instanceof Error ? error.message : String(error),
			});
			disposePhoneOtpRedisClient();
		}
	}

	const nowIso = new Date().toISOString();
	const row = await getPrismaClient().phone_login_codes.findFirst({
		where: {
			phone,
			used_at: null,
			expires_at: { gt: nowIso },
		},
		orderBy: { created_at: "desc" },
		select: {
			id: true,
			code_salt: true,
			code_hash: true,
			created_at: true,
		},
	});
	if (!row) return null;
	if (!row.code_salt || !row.code_hash) return null;
	return {
		id: String(row.id || ""),
		codeSalt: String(row.code_salt),
		codeHash: String(row.code_hash),
		createdAt: String(row.created_at || nowIso),
	};
}

async function consumePhoneOtpCode(c: AppContext, phone: string): Promise<void> {
	const client = getPhoneOtpRedisClient(c);
	if (client) {
		try {
			const key = resolvePhoneOtpRedisKey(c, phone);
			await ensurePhoneOtpRedisReady(client);
			await client.del(key);
			return;
		} catch (error) {
				console.error("[auth/phone] redis unavailable, fallback to database", {
				error: error instanceof Error ? error.message : String(error),
			});
			disposePhoneOtpRedisClient();
		}
	}

	const nowIso = new Date().toISOString();
	await getPrismaClient().phone_login_codes.updateMany({
		where: { phone, used_at: null },
		data: { used_at: nowIso, updated_at: nowIso },
	});
}

async function sendEmailOtpIfConfigured(options: {
	c: AppContext;
	to: string;
	code: string;
}): Promise<{ sent: boolean; skipped: boolean }> {
	const { c, to, code } = options;
	const config = getConfig(c.env);
	const apiKey = config.resendApiKey;
	const from = config.resendFrom;

	if (!apiKey || !from) {
		return { sent: false, skipped: true };
	}

	const resp = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from,
			to,
			subject: "TapCanvas 登录验证码",
			text: `你的 TapCanvas 登录验证码：${code}\n\n10 分钟内有效。`,
		}),
	});

	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		console.error("[auth/email] resend send failed", {
			status: resp.status,
			statusText: resp.statusText,
			bodySnippet: text.slice(0, 500),
		});
		return { sent: false, skipped: false };
	}

	return { sent: true, skipped: false };
}

async function sendSmsOtpIfConfigured(options: {
	c: AppContext;
	to: string;
	code: string;
}): Promise<{ sent: boolean; skipped: boolean }> {
	const { c, to, code } = options;
	const config = getConfig(c.env);
	if (!isAliyunSmsConfigured(config)) {
		return { sent: false, skipped: true };
	}

	try {
		const result = await sendAliyunSmsOtp({
			config: {
				accessKeyId: String(config.aliyunSmsAccessKeyId),
				accessKeySecret: String(config.aliyunSmsAccessKeySecret),
				signName: String(config.aliyunSmsSignName),
				templateCode: String(config.aliyunSmsTemplateCode),
				endpoint: String(config.aliyunSmsEndpoint || "dysmsapi.aliyuncs.com"),
			},
			to,
			code,
		});
		if (!result.ok) {
			console.error("[auth/phone] aliyun sms send failed", {
				providerCode: result.providerCode,
				providerMessage: result.providerMessage,
			});
			return { sent: false, skipped: false };
		}
		return { sent: true, skipped: false };
	} catch (error) {
		console.error("[auth/phone] aliyun sms send failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return { sent: false, skipped: false };
	}
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

	if (!config.resendApiKey || !config.resendFrom) {
		if (!canReturnDevCode) {
			return c.json(
				{
					success: false,
					error: "邮箱登录未配置邮件发送服务，请联系管理员",
					code: "email_login_not_configured",
					missing: {
						RESEND_API_KEY: !config.resendApiKey,
						RESEND_FROM: !config.resendFrom,
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

export async function requestPhoneLoginCode(c: AppContext, phone: string) {
	const config = getConfig(c.env);

	const normalized = normalizePhoneE164(phone);
	if (!isValidE164(normalized)) {
		return c.json(
			{ success: false, error: "手机号格式不正确（建议使用 +86...）" },
			400,
		);
	}

	const now = Date.now();
	const nowIso = new Date(now).toISOString();
	phoneOtpTrace(c, "request:start", {
		phone: maskPhone(normalized),
		nowIso,
	});

	const isDebug = config.phoneLoginDebug;
	const host = (c.req.header("host") || "").toLowerCase();
	const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
	const canReturnDevCode = isDebug || isLocalhost;

	if (!isAliyunSmsConfigured(config)) {
		if (!canReturnDevCode) {
			return c.json(
				{
					success: false,
					error: "手机登录未配置短信发送服务，请联系管理员",
					code: "phone_login_not_configured",
					missing: {
						ALIYUN_SMS_ACCESS_KEY_ID: !config.aliyunSmsAccessKeyId,
						ALIYUN_SMS_ACCESS_KEY_SECRET: !config.aliyunSmsAccessKeySecret,
						ALIYUN_SMS_SIGN_NAME: !config.aliyunSmsSignName,
						ALIYUN_SMS_TEMPLATE_CODE: !config.aliyunSmsTemplateCode,
					},
				},
				501,
			);
		}
	}

	let requestCount = 0;
	try {
		requestCount = await countPhoneOtpRequestsInChinaDay(c, normalized, now);
	} catch (err: any) {
		const msg = String(err?.message || "");
		if (msg.includes("no such table")) {
			return c.json(
				{
					success: false,
					error:
						"手机登录尚未初始化（缺少 phone_login_codes 表），请先执行数据库 schema 更新",
					code: "phone_login_schema_missing",
				},
				501,
			);
		}
		throw err;
	}
	if (requestCount >= PHONE_OTP_DAILY_LIMIT) {
		phoneOtpTrace(c, "request:daily_limit_exceeded", {
			phone: maskPhone(normalized),
			requestCount,
			limit: PHONE_OTP_DAILY_LIMIT,
		});
		return c.json(
			{
				success: false,
				error: `该手机号今日验证码请求次数已达上限（${PHONE_OTP_DAILY_LIMIT} 次），请明天再试`,
				code: "phone_login_daily_limit_exceeded",
				details: {
					limitPerDay: PHONE_OTP_DAILY_LIMIT,
					retryAfter: getChinaNextDayStartIso(now),
				},
			},
			429,
		);
	}

	const code = randomDigits(6);
	const salt = crypto.randomUUID();
	const codeHash = await sha256Hex(`${salt}:${code}`);
	phoneOtpTrace(c, "request:otp_generated", {
		phone: maskPhone(normalized),
		codeHashPrefix: shortHash(codeHash),
		saltPrefix: shortHash(salt),
	});

	const stored = await setPhoneOtpCode({
		c,
		phone: normalized,
		codeSalt: salt,
		codeHash,
		createdAt: nowIso,
	});
	if (!stored) {
		phoneOtpTrace(c, "request:store_failed", {
			phone: maskPhone(normalized),
		});
		return c.json({ success: false, error: "验证码保存失败，请稍后重试" }, 500);
	}
	phoneOtpTrace(c, "request:stored", {
		phone: maskPhone(normalized),
		codeHashPrefix: shortHash(codeHash),
	});

	const sms = await sendSmsOtpIfConfigured({ c, to: normalized, code });
	if (!sms.sent && !sms.skipped) {
		await consumePhoneOtpCode(c, normalized);
		phoneOtpTrace(c, "request:sms_send_failed", {
			phone: maskPhone(normalized),
		});
		return c.json({ success: false, error: "验证码发送失败，请稍后再试" }, 502);
	}
	phoneOtpTrace(c, "request:sent", {
		phone: maskPhone(normalized),
		smsSkipped: sms.skipped,
	});

	if (sms.skipped && canReturnDevCode) {
		phoneOtpTrace(c, "request:dev_code_returned", {
			phone: maskPhone(normalized),
			codeHashPrefix: shortHash(codeHash),
		});
		return {
			sent: true,
			expiresInSeconds: PHONE_OTP_TTL_SECONDS,
			devCode: code,
			delivery: "debug",
		};
	}

	return { sent: true, expiresInSeconds: PHONE_OTP_TTL_SECONDS };
}

export async function verifyPhoneLoginCode(
	c: AppContext,
	phone: string,
	code: string,
) {
	const nowIso = new Date().toISOString();

	const normalized = normalizePhoneE164(phone);
	if (!isValidE164(normalized)) {
		return c.json({ success: false, error: "手机号格式不正确" }, 400);
	}
	phoneOtpTrace(c, "verify:start", {
		phone: maskPhone(normalized),
		inputCodeLength: String(code || "").trim().length,
	});

	const row = await getPhoneOtpCode(c, normalized);
	if (row === null) {
		phoneOtpTrace(c, "verify:otp_not_found", {
			phone: maskPhone(normalized),
		});
		return c.json({ success: false, error: "验证码不正确或已过期" }, 401);
	}

	const expected = String(row.codeHash || "");
	const salt = String(row.codeSalt || "");
	const actual = await sha256Hex(`${salt}:${code}`);
	phoneOtpTrace(c, "verify:otp_loaded", {
		phone: maskPhone(normalized),
		createdAt: row.createdAt,
		expectedHashPrefix: shortHash(expected),
		actualHashPrefix: shortHash(actual),
	});

	if (!expected || expected !== actual) {
		phoneOtpTrace(c, "verify:mismatch", {
			phone: maskPhone(normalized),
			createdAt: row.createdAt,
			expectedHashPrefix: shortHash(expected),
			actualHashPrefix: shortHash(actual),
		});
		return c.json({ success: false, error: "验证码不正确或已过期" }, 401);
	}

	await consumePhoneOtpCode(c, normalized);
	phoneOtpTrace(c, "verify:consumed", {
		phone: maskPhone(normalized),
		createdAt: row.createdAt,
		expectedHashPrefix: shortHash(expected),
	});

	const userId = `phone_${await sha256Hex(normalized)}`;
	const digits = normalized.replace(/\D/g, "");
	const loginSuffix = digits.length >= 4 ? digits.slice(-4) : digits;
	const login = loginSuffix ? `phone_${loginSuffix}` : "phone_user";
	const name = login;

	await persistLoginUser(c, {
		id: userId,
		login,
		name,
		avatarUrl: null,
		email: null,
		phone: normalized,
		guest: false,
		role: resolveLocalDevRole(c, null),
		nowIso,
	});

	return issueAuthPayload(c, {
		userId,
		login,
		name,
		avatarUrl: null,
		email: null,
		phone: normalized,
		guest: false,
	});
}

export async function loginWithPhonePassword(
	c: AppContext,
	phone: string,
	password: string,
) {
	const normalized = normalizePhoneE164(phone);
	if (!isValidE164(normalized)) {
		return c.json({ success: false, error: "手机号格式不正确" }, 400);
	}

	const userRow = await getPrismaClient().users.findFirst({
		where: {
			phone: normalized,
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
	});

	if (!userRow) {
		return c.json({ success: false, error: "手机号或密码不正确" }, 401);
	}
	if (Number(userRow.disabled ?? 0) !== 0) {
		return c.json({ success: false, error: "账号已被禁用", code: "user_disabled" }, 403);
	}
	if (!hasPasswordConfigured(userRow.password_hash) || !userRow.password_salt) {
		return c.json(
			{ success: false, error: "该手机号尚未设置密码，请先使用验证码登录", code: "password_not_set" },
			401,
		);
	}

	const matched = await verifyPasswordRecord({
		password,
		hash: userRow.password_hash ?? "",
		salt: userRow.password_salt,
	});
	if (!matched) {
		return c.json({ success: false, error: "手机号或密码不正确" }, 401);
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
		phone: userRow.phone ?? normalized,
		guest: Number(userRow.guest ?? 0) !== 0,
	});
}

export async function setPasswordForAuthenticatedUser(
	c: AppContext,
	password: string,
) {
	const auth = c.get("auth") as UserPayload | undefined;
	const userId = typeof auth?.sub === "string" ? auth.sub : "";
	if (!userId) {
		return c.json({ success: false, error: "Unauthorized" }, 401);
	}

	const userRow = await getPrismaClient().users.findUnique({
		where: { id: userId },
		select: {
			id: true,
			login: true,
			name: true,
			avatar_url: true,
			email: true,
			phone: true,
			guest: true,
			disabled: true,
			deleted_at: true,
		},
	});

	if (!userRow) {
		return c.json({ success: false, error: "用户不存在" }, 404);
	}
	if (userRow.deleted_at) {
		return c.json({ success: false, error: "Account deleted", code: "user_deleted" }, 403);
	}
	if (Number(userRow.disabled ?? 0) !== 0) {
		return c.json({ success: false, error: "账号已被禁用", code: "user_disabled" }, 403);
	}
	if (!userRow.phone) {
		return c.json(
			{ success: false, error: "当前账号未绑定手机号，不能设置手机号密码", code: "phone_not_bound" },
			400,
		);
	}

	const { hash, salt } = await createPasswordRecord(password);
	const nowIso = new Date().toISOString();
	await getPrismaClient().users.update({
		where: { id: userId },
		data: {
			password_hash: hash,
			password_salt: salt,
			password_updated_at: nowIso,
			last_seen_at: nowIso,
			updated_at: nowIso,
		},
	});

	return issueAuthPayload(c, {
		userId,
		login: userRow.login,
		name: userRow.name || userRow.login,
		avatarUrl: userRow.avatar_url ?? null,
		email: userRow.email ?? null,
		phone: userRow.phone,
		guest: Number(userRow.guest ?? 0) !== 0,
	});
}
