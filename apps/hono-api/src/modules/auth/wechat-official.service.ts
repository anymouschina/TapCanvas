/**
 * 公众号带参二维码扫码登录。
 *
 * 与 Tanva（/Users/libiqiang/business/Tanva）共用同一个公众号，但账号体系各自独立：
 * 同一个微信在两边是两个账号，open_id 只在本库唯一，不与 Tanva 的用户表关联。
 *
 * ⚠️ 公众号后台只能填一个回调 URL，现指向 Tanva。微信没有「查询谁扫了 scene X」的拉取接口，
 * 故本项目拿不到扫码事件，除非 Tanva 按 tclogin_ 前缀把原始 XML 转发过来。
 *
 * ⛔ 本文件【刻意不实现任何转发能力】：callback 只认 tclogin_ 前缀，遇到不认识的 scene
 * 直接返回 success，不转发给任何人。转发单向 ⇒ 成环在结构上不可能。这不是靠检测，
 * 是靠没有这个能力——因此不得引入任何 *_FORWARD_URL 配置项。
 *
 * 设计详见 docs/superpowers/specs/2026-07-15-wechat-official-login-design.md
 */
import crypto from "node:crypto";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	issueAuthPayload,
} from "./auth.service";

/// scene 前缀必须与 Tanva 的 wxlogin_ 区分开，否则两个项目抢同一个扫码事件。
const SCENE_PREFIX = "tclogin_";

export type WechatOfficialConfig = {
	appId: string;
	appSecret: string;
	token: string;
	qrExpireSeconds: number;
	welcomeMessage: string;
};

export function isWechatOfficialEnabled(env: AppContext["env"]): boolean {
	return Boolean(
		String(env.WECHAT_OFFICIAL_APP_ID || "").trim() &&
			String(env.WECHAT_OFFICIAL_APP_SECRET || "").trim() &&
			String(env.WECHAT_OFFICIAL_TOKEN || "").trim(),
	);
}

export function getWechatOfficialConfig(
	env: AppContext["env"],
): WechatOfficialConfig {
	const raw = Number(env.WECHAT_OFFICIAL_QR_EXPIRE_SECONDS || "600");
	return {
		appId: String(env.WECHAT_OFFICIAL_APP_ID || "").trim(),
		appSecret: String(env.WECHAT_OFFICIAL_APP_SECRET || "").trim(),
		token: String(env.WECHAT_OFFICIAL_TOKEN || "").trim(),
		// 微信允许 60s~30d；越界会被微信直接拒，故在这里夹紧
		qrExpireSeconds: Number.isFinite(raw)
			? Math.max(60, Math.min(2592000, Math.floor(raw)))
			: 600,
		welcomeMessage:
			String(env.WECHAT_OFFICIAL_LOGIN_MESSAGE || "").trim() ||
			"正在授权中，请返回电脑端完成登录",
	};
}

// ---------------------------------------------------------------------------
// access_token
// ---------------------------------------------------------------------------

let accessTokenCache: { token: string; expiresAt: number; appId: string } | null =
	null;

/**
 * ⚠️ 必须走 stable_token 且 force_refresh=false。
 *
 * 我们与 Tanva 共用同一个 appid，两边各自缓存 token。stable_token 就是为这种多实例场景
 * 设计的：非强制刷新时返回当前有效 token，多方拿到同一个、互不顶掉。
 * 若改用传统 /cgi-bin/token，双方会互相使对方的 token 失效 —— 这是画布能自持凭证
 * 独立建码（而不必把建码也代理给 Tanva）的前提。
 */
export async function getWechatOfficialAccessToken(
	env: AppContext["env"],
	forceRefresh = false,
): Promise<string> {
	const config = getWechatOfficialConfig(env);
	const now = Date.now();
	if (
		!forceRefresh &&
		accessTokenCache &&
		accessTokenCache.appId === config.appId &&
		accessTokenCache.expiresAt > now + 60_000
	) {
		return accessTokenCache.token;
	}

	const res = await fetch("https://api.weixin.qq.com/cgi-bin/stable_token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "client_credential",
			appid: config.appId,
			secret: config.appSecret,
			force_refresh: forceRefresh,
		}),
	});
	const data = (await res.json().catch(() => null)) as {
		access_token?: string;
		expires_in?: number;
		errmsg?: string;
	} | null;

	if (!res.ok || !data?.access_token) {
		throw new Error(
			`微信公众号 access_token 获取失败: ${data?.errmsg || `HTTP ${res.status}`}`,
		);
	}

	accessTokenCache = {
		token: data.access_token,
		appId: config.appId,
		// 提前 300s 过期，避免边界上拿到刚失效的 token
		expiresAt: now + Math.max((data.expires_in || 7200) - 300, 300) * 1000,
	};
	return data.access_token;
}

function shouldRefreshAccessToken(
	error?: { errcode?: number; errmsg?: string } | null,
): boolean {
	const code = Number(error?.errcode);
	if (code === 40001 || code === 42001) return true;
	const msg = String(error?.errmsg || "").toLowerCase();
	return (
		msg.includes("access_token is invalid") ||
		msg.includes("not latest") ||
		msg.includes("access token expired")
	);
}

// ---------------------------------------------------------------------------
// 验签 / XML
// ---------------------------------------------------------------------------

export function verifyWechatOfficialSignature(
	env: AppContext["env"],
	signature?: string,
	timestamp?: string,
	nonce?: string,
): boolean {
	const { token } = getWechatOfficialConfig(env);
	if (!token || !signature || !timestamp || !nonce) return false;
	const expected = crypto
		.createHash("sha1")
		.update([token, timestamp, nonce].sort().join(""))
		.digest("hex");
	return expected === signature;
}

/// 轻量正则解析，只取我们要的几个字段，不引入 XML 依赖（移植自 Tanva）。
export function parseWechatOfficialXml(rawXml: string): Record<string, string> {
	const xml = typeof rawXml === "string" ? rawXml.trim() : "";
	const parsed: Record<string, string> = {};
	if (!xml) return parsed;

	for (const m of xml.matchAll(/<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/gs)) {
		parsed[m[1]] = m[2] || "";
	}
	for (const m of xml.matchAll(/<(\w+)>([^<]*)<\/\1>/gs)) {
		if (!(m[1] in parsed)) parsed[m[1]] = (m[2] || "").trim();
	}
	return parsed;
}

function buildTextResponse(
	toUserName: string,
	fromUserName: string,
	content: string,
): string {
	return `<xml>
<ToUserName><![CDATA[${toUserName}]]></ToUserName>
<FromUserName><![CDATA[${fromUserName}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
}

// ---------------------------------------------------------------------------
// 用户资料
// ---------------------------------------------------------------------------

export type WechatOfficialProfile = {
	openId: string;
	unionId: string | null;
	nickname: string | null;
	avatarUrl: string | null;
};

function syntheticName(openId: string): string {
	return `用户-${openId.slice(-6)}`;
}

/// 拉昵称/头像。失败【不阻断登录】——降级为合成名即可，身份靠 openId 而非昵称。
async function fetchUserInfo(
	env: AppContext["env"],
	openId: string,
): Promise<{ unionId: string | null; nickname: string | null; avatarUrl: string | null } | null> {
	try {
		let accessToken = await getWechatOfficialAccessToken(env);
		const call = async (token: string) => {
			const url = new URL("https://api.weixin.qq.com/cgi-bin/user/info");
			url.searchParams.set("access_token", token);
			url.searchParams.set("openid", openId);
			url.searchParams.set("lang", "zh_CN");
			const res = await fetch(url.toString());
			return (await res.json().catch(() => null)) as
				| { openid?: string; unionid?: string; nickname?: string; headimgurl?: string; errcode?: number; errmsg?: string }
				| null;
		};

		let data = await call(accessToken);
		if ((!data || data.errcode) && shouldRefreshAccessToken(data)) {
			accessToken = await getWechatOfficialAccessToken(env, true);
			data = await call(accessToken);
		}
		if (!data || data.errcode || !data.openid) return null;
		return {
			unionId: data.unionid || null,
			nickname: data.nickname || null,
			avatarUrl: data.headimgurl || null,
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

function sanitizeReturnTo(returnTo?: string | null): string | null {
	const v = String(returnTo || "").trim();
	// 只收站内相对路径，挡开放重定向；`//evil.com` 会被浏览器当协议相对 URL 故一并拒
	if (!v || !v.startsWith("/") || v.startsWith("//")) return null;
	return v.slice(0, 512);
}

export async function createWechatLoginSession(
	c: AppContext,
	returnTo?: string | null,
): Promise<{ sessionId: string; qrCodeUrl: string; expiresAt: string }> {
	const config = getWechatOfficialConfig(c.env);
	const sceneKey = `${SCENE_PREFIX}${crypto.randomBytes(12).toString("hex")}`;

	const createQr = async (token: string) => {
		const res = await fetch(
			`https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(token)}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					expire_seconds: config.qrExpireSeconds,
					action_name: "QR_STR_SCENE",
					action_info: { scene: { scene_str: sceneKey } },
				}),
			},
		);
		const data = (await res.json().catch(() => null)) as
			| { ticket?: string; errcode?: number; errmsg?: string }
			| null;
		return { ok: res.ok, status: res.status, data };
	};

	let accessToken = await getWechatOfficialAccessToken(c.env);
	let qr = await createQr(accessToken);
	if ((!qr.ok || !qr.data?.ticket) && shouldRefreshAccessToken(qr.data)) {
		accessToken = await getWechatOfficialAccessToken(c.env, true);
		qr = await createQr(accessToken);
	}
	if (!qr.ok || !qr.data?.ticket) {
		throw new Error(
			`微信公众号二维码生成失败: ${qr.data?.errmsg || `HTTP ${qr.status}`}`,
		);
	}

	const nowIso = new Date().toISOString();
	const expiresAtIso = new Date(
		Date.now() + config.qrExpireSeconds * 1000,
	).toISOString();
	const id = crypto.randomUUID();

	await getPrismaClient().wechat_login_sessions.create({
		data: {
			id,
			scene_key: sceneKey,
			status: "pending",
			qr_ticket: qr.data.ticket,
			qr_code_url: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(qr.data.ticket)}`,
			return_to: sanitizeReturnTo(returnTo),
			expires_at: expiresAtIso,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});

	return {
		sessionId: id,
		qrCodeUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(qr.data.ticket)}`,
		expiresAt: expiresAtIso,
	};
}

export type WechatLoginSessionStatus = {
	status: "pending" | "unlinked" | "authorized" | "consumed" | "expired";
	nickname: string | null;
	avatarUrl: string | null;
	returnTo: string | null;
};

/// 供前端轮询。⛔ 绝不返回 open_id —— 那是身份凭据，泄露即可被冒用绑定。
export async function getWechatLoginSessionStatus(
	c: AppContext,
	sessionId: string,
): Promise<WechatLoginSessionStatus | null> {
	const row = await getPrismaClient().wechat_login_sessions.findUnique({
		where: { id: sessionId },
		select: {
			status: true,
			nickname: true,
			avatar_url: true,
			return_to: true,
			expires_at: true,
		},
	});
	if (!row) return null;

	const expired =
		row.status !== "consumed" && new Date(row.expires_at).getTime() <= Date.now();
	return {
		status: expired ? "expired" : (row.status as WechatLoginSessionStatus["status"]),
		nickname: row.nickname,
		avatarUrl: row.avatar_url,
		returnTo: row.return_to,
	};
}

async function markConsumed(sessionId: string): Promise<void> {
	const nowIso = new Date().toISOString();
	await getPrismaClient().wechat_login_sessions.update({
		where: { id: sessionId },
		data: { status: "consumed", consumed_at: nowIso, updated_at: nowIso },
	});
}

/// 仅 authorized 可消费。消费即置 consumed（一次性），防同一会话被重复换 token。
export async function consumeWechatLoginSession(
	c: AppContext,
	sessionId: string,
) {
	const prisma = getPrismaClient();
	const row = await prisma.wechat_login_sessions.findUnique({
		where: { id: sessionId },
		select: {
			status: true,
			user_id: true,
			expires_at: true,
			return_to: true,
		},
	});
	if (!row) return c.json({ success: false, error: "登录会话不存在" }, 404);
	if (row.status === "consumed") {
		return c.json(
			{ success: false, error: "登录会话已使用", code: "wechat_session_consumed" },
			400,
		);
	}
	if (new Date(row.expires_at).getTime() <= Date.now()) {
		return c.json(
			{ success: false, error: "登录二维码已过期，请刷新重试", code: "wechat_session_expired" },
			400,
		);
	}
	if (row.status !== "authorized" || !row.user_id) {
		return c.json(
			{ success: false, error: "尚未完成扫码授权", code: "wechat_session_not_authorized" },
			400,
		);
	}

	const user = await prisma.users.findUnique({
		where: { id: row.user_id },
		select: { id: true, login: true, name: true, avatar_url: true, email: true, phone: true, disabled: true },
	});
	if (!user) return c.json({ success: false, error: "账号不存在" }, 404);
	if (user.disabled) {
		return c.json({ success: false, error: "账号已被禁用", code: "user_disabled" }, 403);
	}

	await markConsumed(sessionId);

	return issueAuthPayload(c, {
		userId: user.id,
		login: user.login,
		name: user.name ?? user.login,
		avatarUrl: user.avatar_url ?? null,
		email: user.email ?? null,
		phone: user.phone ?? null,
		guest: false,
	});
}

/**
 * 社区版只允许已经关联到现有账号的微信身份扫码登录。
 * 未关联身份明确标记为 unlinked，并引导用户改用邮箱或账号密码登录。
 */

// ---------------------------------------------------------------------------
// 回调
// ---------------------------------------------------------------------------

/**
 * 处理微信推来的事件 XML（可能经 Tanva 转发）。返回回复 XML 或 "success"。
 *
 * ⛔ 只认 tclogin_ 前缀。别的 scene（含 Tanva 的 wxlogin_）一律 "success" 放过，
 * 【绝不转发给任何人】—— 见文件头注释：这是防死循环的第一层，结构性的。
 */
export async function handleWechatOfficialCallback(
	c: AppContext,
	rawXml: string,
): Promise<string> {
	const msg = parseWechatOfficialXml(rawXml);
	const fromUserName = msg.FromUserName;
	const toUserName = msg.ToUserName;
	if (String(msg.MsgType || "").toLowerCase() !== "event" || !fromUserName || !toUserName) {
		return "success";
	}

	const event = String(msg.Event || "").toUpperCase();
	if (event !== "SCAN" && event !== "SUBSCRIBE") return "success";

	// 未关注用户扫码走 SUBSCRIBE，EventKey 会带 qrscene_ 前缀；已关注走 SCAN，不带
	const rawKey = msg.EventKey || "";
	const sceneKey = event === "SUBSCRIBE" ? rawKey.replace(/^qrscene_/, "") : rawKey;

	if (!sceneKey || !sceneKey.startsWith(SCENE_PREFIX)) return "success";

	const config = getWechatOfficialConfig(c.env);
	const prisma = getPrismaClient();
	const session = await prisma.wechat_login_sessions.findUnique({
		where: { scene_key: sceneKey },
		select: { id: true, status: true, expires_at: true },
	});
	if (!session) return "success";

	if (new Date(session.expires_at).getTime() <= Date.now()) {
		return buildTextResponse(
			fromUserName,
			toUserName,
			"登录二维码已过期，请返回电脑端刷新后重试",
		);
	}

	// 幂等：微信 5s 超时会重试最多 3 次。已处理过的会话直接回成功，
	// 不重复调 userinfo，也不把已 consumed 的会话打回 authorized。
	if (session.status === "authorized" || session.status === "consumed") {
		return buildTextResponse(fromUserName, toUserName, config.welcomeMessage);
	}

	const fetched = await fetchUserInfo(c.env, fromUserName);
	const nickname = fetched?.nickname || syntheticName(fromUserName);

	const linked = await prisma.users.findUnique({
		where: { wechat_official_open_id: fromUserName },
		select: { id: true, disabled: true },
	});
	const canAuthorize = Boolean(linked && !linked.disabled);

	const nowIso = new Date().toISOString();
	await prisma.wechat_login_sessions.update({
		where: { id: session.id },
		data: {
			status: canAuthorize ? "authorized" : "unlinked",
			open_id: fromUserName,
			union_id: fetched?.unionId ?? null,
			nickname,
			avatar_url: fetched?.avatarUrl ?? null,
			user_id: canAuthorize ? linked!.id : null,
			authorized_at: canAuthorize ? nowIso : null,
			updated_at: nowIso,
		},
	});

	return buildTextResponse(
		fromUserName,
		toUserName,
		canAuthorize
			? config.welcomeMessage
			: "该微信尚未关联现有账号，请改用邮箱或账号密码登录",
	);
}
