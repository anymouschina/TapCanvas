import { z } from "zod";
import { CommerceEntitlementTypeSchema } from "../commerce/commerce.schemas";

export const ProductStatusSchema = z.enum(["draft", "active", "inactive"]);

export const ProductSkuSchema = z.object({
	id: z.string(),
	productId: z.string(),
	name: z.string(),
	spec: z.string(),
	priceCents: z.number().int().nonnegative(),
	stock: z.number().int().nonnegative(),
	isDefault: z.boolean(),
	status: ProductStatusSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type ProductSkuDto = z.infer<typeof ProductSkuSchema>;

export const ProductSchema = z.object({
	id: z.string(),
	title: z.string(),
	subtitle: z.string().nullable(),
	description: z.string().nullable(),
	currency: z.string(),
	priceCents: z.number().int().nonnegative(),
	stock: z.number().int().nonnegative(),
	status: ProductStatusSchema,
	entitlementType: CommerceEntitlementTypeSchema,
	entitlementConfigJson: z.string().nullable(),
	coverImageUrl: z.string().nullable(),
	images: z.array(z.string()),
	skus: z.array(ProductSkuSchema),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type ProductDto = z.infer<typeof ProductSchema>;

export const ProductListQuerySchema = z.object({
	keyword: z.string().trim().optional(),
	status: ProductStatusSchema.optional(),
	entitlementType: CommerceEntitlementTypeSchema.exclude(["none"]).optional(),
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().min(1).max(100).default(20),
});

export const UpsertProductSkuSchema = z.object({
	id: z.string().trim().min(1).optional(),
	name: z.string().trim().min(1).max(120),
	spec: z.string().trim().max(240).default(""),
	priceCents: z.number().int().nonnegative(),
	stock: z.number().int().nonnegative(),
	isDefault: z.boolean().optional(),
	status: ProductStatusSchema.optional(),
});

export const UpsertProductRequestSchema = z.object({
	id: z.string().trim().min(1).optional(),
	title: z.string().trim().min(1).max(200),
	subtitle: z.string().trim().max(300).optional(),
	description: z.string().trim().max(5000).optional(),
	currency: z.string().trim().min(1).max(12).default("CNY"),
	priceCents: z.number().int().nonnegative(),
	stock: z.number().int().nonnegative(),
	status: ProductStatusSchema.optional(),
	coverImageUrl: z.string().trim().url().optional(),
	images: z.array(z.string().trim().url()).max(20).optional(),
	skus: z.array(UpsertProductSkuSchema).max(200).optional(),
});

export const ProductListResponseSchema = z.object({
	items: z.array(ProductSchema),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	size: z.number().int().min(1),
});

export const UpdateProductStatusRequestSchema = z.object({
	status: ProductStatusSchema,
});
