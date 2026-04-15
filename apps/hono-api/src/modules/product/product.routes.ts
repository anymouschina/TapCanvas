import { Hono } from "hono";
import type { AppEnv } from "../../types";
import type { AppContext } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	ProductListQuerySchema,
	ProductListResponseSchema,
	ProductSchema,
	UpdateProductStatusRequestSchema,
	UpsertProductRequestSchema,
} from "./product.schemas";
import {
	deleteProductForCatalog,
	getProductForCatalog,
	listProductsForCatalog,
	updateProductStatusForCatalog,
	upsertProductForCatalog,
} from "./product.service";

export const productRouter = new Hono<AppEnv>();

productRouter.use("*", authMiddleware);

function isAdmin(c: AppContext): boolean {
	const auth = c.get("auth") as { role?: string } | undefined;
	return auth?.role === "admin";
}

productRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const admin = isAdmin(c);
	const parsed = ProductListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	}
	const data = await listProductsForCatalog(c, {
		keyword: parsed.data.keyword,
		status: admin ? parsed.data.status : "active",
		entitlementType: parsed.data.entitlementType,
		page: parsed.data.page,
		size: parsed.data.size,
	});
	return c.json(ProductListResponseSchema.parse(data));
});

productRouter.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const admin = isAdmin(c);
	const dto = await getProductForCatalog(c, c.req.param("id"), admin ? undefined : "active");
	return c.json(ProductSchema.parse(dto));
});

productRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProductRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const dto = await upsertProductForCatalog(c, userId, parsed.data);
	return c.json(ProductSchema.parse(dto));
});

productRouter.put("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProductRequestSchema.safeParse({ ...body, id: c.req.param("id") });
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const dto = await upsertProductForCatalog(c, userId, parsed.data);
	return c.json(ProductSchema.parse(dto));
});

productRouter.patch("/:id/status", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateProductStatusRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const dto = await updateProductStatusForCatalog(c, {
		productId: c.req.param("id"),
		status: parsed.data.status,
	});
	return c.json(ProductSchema.parse(dto));
});

productRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	await deleteProductForCatalog(c, c.req.param("id"));
	return c.body(null, 204);
});
