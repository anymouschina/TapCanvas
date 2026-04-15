import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateWechatNativePaymentRequestSchema,
	CreateWechatNativePaymentResponseSchema,
	WechatPaymentReconcileResponseSchema,
	WechatPaymentCallbackAckSchema,
	WechatPaymentSchema,
} from "./wechat-pay.schemas";
import {
	createWechatNativePaymentForOrder,
	getWechatPaymentForOrder,
	handleWechatPaymentCallback,
	reconcileWechatPaymentForOrder,
} from "./wechat-pay.service";

export const wechatPayRouter = new Hono<AppEnv>();

wechatPayRouter.post("/callback", async (c) => {
	const bodyText = await c.req.text();
	const ack = await handleWechatPaymentCallback(c, bodyText);
	return c.json(WechatPaymentCallbackAckSchema.parse(ack));
});

const authed = new Hono<AppEnv>();
authed.use("*", authMiddleware);

authed.post("/native/create", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateWechatNativePaymentRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const dto = await createWechatNativePaymentForOrder(c, {
		ownerId: userId,
		orderId: parsed.data.orderId,
	});
	return c.json(CreateWechatNativePaymentResponseSchema.parse(dto));
});

authed.get("/orders/:orderId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dto = await getWechatPaymentForOrder(c, {
		ownerId: userId,
		orderId: c.req.param("orderId"),
	});
	return c.json(WechatPaymentSchema.parse(dto));
});

authed.post("/orders/:orderId/reconcile", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dto = await reconcileWechatPaymentForOrder(c, {
		ownerId: userId,
		orderId: c.req.param("orderId"),
	});
	return c.json(WechatPaymentReconcileResponseSchema.parse(dto));
});

wechatPayRouter.route("/", authed);
