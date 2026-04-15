import { Hono } from "hono";
import type { AppEnv } from "../../types";
import type { AppContext } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CancelOrderRequestSchema,
	CreateOrderRequestSchema,
	OrderListQuerySchema,
	OrderListResponseSchema,
	OrderSchema,
} from "./order.schemas";
import {
	cancelOrderForOwner,
	createOrderForOwner,
	getOrderForOwner,
	listOrdersForOwner,
} from "./order.service";

export const orderRouter = new Hono<AppEnv>();

orderRouter.use("*", authMiddleware);

function isAdmin(c: AppContext): boolean {
	const auth = c.get("auth") as { role?: string } | undefined;
	return auth?.role === "admin";
}

orderRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateOrderRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const dto = await createOrderForOwner(c, userId, parsed.data);
	return c.json(OrderSchema.parse(dto));
});

orderRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const admin = isAdmin(c);
	const parsed = OrderListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	}
	const data = await listOrdersForOwner(c, {
		ownerId: admin ? undefined : userId,
		status: parsed.data.status,
		paymentStatus: parsed.data.paymentStatus,
		orderNo: parsed.data.orderNo,
		page: parsed.data.page,
		size: parsed.data.size,
	});
	return c.json(OrderListResponseSchema.parse(data));
});

orderRouter.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const admin = isAdmin(c);
	const dto = await getOrderForOwner(c, admin ? undefined : userId, c.req.param("id"));
	return c.json(OrderSchema.parse(dto));
});

orderRouter.post("/:id/cancel", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CancelOrderRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const dto = await cancelOrderForOwner(c, {
		ownerId: userId,
		orderId: c.req.param("id"),
		reason: parsed.data.reason,
	});
	return c.json(OrderSchema.parse(dto));
});
