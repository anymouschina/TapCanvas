/**
 * 公众号扫码登录路由。挂在 /auth/wechat-official 下（见 auth.routes.ts）。
 *
 * callback 的两个端点对【微信直连】和【Tanva 转发】行为完全一致：转发方原样带上
 * signature/timestamp/nonce，本端用同一个 WECHAT_OFFICIAL_TOKEN 自行验签。
 * 故将来若把公众号后台 URL 改指本服务，无需改任何代码。
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../types";
import { AuthResponseSchema, BrowserAuthResponseSchema } from "./auth.schemas";
import { attachAuthCookies } from "./auth.cookies";
import {
	consumeWechatLoginSession,
	createWechatLoginSession,
	getWechatLoginSessionStatus,
	handleWechatOfficialCallback,
	isWechatOfficialEnabled,
	verifyWechatOfficialSignature,
} from "./wechat-official.service";

export const wechatOfficialRouter = new Hono<AppEnv>();

const CreateSessionRequestSchema = z.object({
	returnTo: z.string().trim().max(512).optional(),
});

wechatOfficialRouter.post("/sessions", async (c) => {
	// 未配置凭证时整体关闭，与 GitHub 登录已关的处理一致——返 501 而不是抛栈
	if (!isWechatOfficialEnabled(c.env)) {
		return c.json(
			{ success: false, error: "微信扫码登录未开启", code: "wechat_official_disabled" },
			501,
		);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateSessionRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ success: false, error: "请求参数不合法", issues: parsed.error.issues }, 400);
	}
	try {
		const dto = await createWechatLoginSession(c, parsed.data.returnTo ?? null);
		return c.json({ success: true, ...dto });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[auth/wechat-official] create session failed", { message });
		return c.json({ success: false, error: message, code: "wechat_qr_create_failed" }, 502);
	}
});

wechatOfficialRouter.get("/sessions/:id", async (c) => {
	const dto = await getWechatLoginSessionStatus(c, c.req.param("id"));
	if (!dto) return c.json({ success: false, error: "登录会话不存在" }, 404);
	return c.json({ success: true, ...dto });
});

wechatOfficialRouter.post("/sessions/:id/consume", async (c) => {
	const result = await consumeWechatLoginSession(c, c.req.param("id"));
	if (result instanceof Response) return result;
	const validated = AuthResponseSchema.parse(result);
	attachAuthCookies(c, {
		accessToken: validated.token,
		refreshToken: validated.refreshToken,
		accessTokenExpiresInSeconds: validated.accessTokenExpiresInSeconds,
		refreshTokenExpiresInSeconds: validated.refreshTokenExpiresInSeconds,
	});
	return c.json(BrowserAuthResponseSchema.parse({ authenticated: true, user: validated.user }));
});

/// 微信后台配置 URL 时的校验握手：验签通过则原样回 echostr。
wechatOfficialRouter.get("/callback", async (c) => {
	const { signature, timestamp, nonce, echostr } = c.req.query();
	if (!verifyWechatOfficialSignature(c.env, signature, timestamp, nonce)) {
		return c.text("invalid signature", 401);
	}
	return c.text(echostr || "", 200, { "Content-Type": "text/plain; charset=utf-8" });
});

/// 事件入口。body 是 XML 不是 JSON，必须走 c.req.text()。
wechatOfficialRouter.post("/callback", async (c) => {
	const { signature, timestamp, nonce } = c.req.query();
	if (!verifyWechatOfficialSignature(c.env, signature, timestamp, nonce)) {
		return c.text("invalid signature", 401);
	}

	const rawXml = await c.req.text().catch(() => "");
	try {
		const reply = await handleWechatOfficialCallback(c, rawXml);
		if (reply.trim().startsWith("<xml>")) {
			return c.text(reply, 200, { "Content-Type": "application/xml; charset=utf-8" });
		}
		return c.text("success", 200, { "Content-Type": "text/plain; charset=utf-8" });
	} catch (error) {
		// 绝不把 5xx 抛给微信：它会在 5s 超时后重试 3 次，把错误放大成风暴。
		// 回 success 让微信收手，错误留在日志里排查。
		console.error("[auth/wechat-official] callback failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		return c.text("success", 200, { "Content-Type": "text/plain; charset=utf-8" });
	}
});
