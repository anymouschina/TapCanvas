import { AppError } from "../../middleware/error";
import { getProductEntitlement } from "../commerce/commerce.repo";
import type { CommerceEntitlementType } from "../commerce/commerce.schemas";
import type { AppContext } from "../../types";
import {
	countProducts,
	createMerchant,
	createProduct,
	deleteProductByIdAnyOwner,
	getDefaultMerchant,
	getProductById,
	listProductImages,
	listProductSkus,
	listProducts,
	replaceProductImages,
	replaceProductSkus,
	updateProductById,
	updateProductStatusById,
	type ProductRow,
	type ProductSkuRow,
} from "./product.repo";
import type { ProductDto, ProductSkuDto } from "./product.schemas";
import { assertOwnerUserExists } from "../user/user-owner";

function mapSkuRowToDto(row: ProductSkuRow): ProductSkuDto {
	return {
		id: row.id,
		productId: row.product_id,
		name: row.name,
		spec: row.spec,
		priceCents: Number(row.price_cents ?? 0) || 0,
		stock: Number(row.stock ?? 0) || 0,
		isDefault: Number(row.is_default ?? 0) !== 0,
		status: row.status as ProductSkuDto["status"],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function mapProductRowToDto(c: AppContext, row: ProductRow): Promise<ProductDto> {
	const [images, skus, entitlement] = await Promise.all([
		listProductImages(c.env.DB, { productId: row.id, ownerId: row.owner_id }),
		listProductSkus(c.env.DB, { productId: row.id, ownerId: row.owner_id }),
		getProductEntitlement(c.env.DB, row.owner_id, row.id),
	]);
	return {
		id: row.id,
		title: row.title,
		subtitle: row.subtitle,
		description: row.description,
		currency: row.currency,
		priceCents: Number(row.price_cents ?? 0) || 0,
		stock: Number(row.stock ?? 0) || 0,
		status: row.status as ProductDto["status"],
		entitlementType: (entitlement?.entitlement_type as CommerceEntitlementType | undefined) ?? "none",
		entitlementConfigJson: entitlement?.config_json ?? null,
		coverImageUrl: row.cover_image_url,
		images,
		skus: skus.map(mapSkuRowToDto),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

type CatalogMerchant = {
	id: string;
	ownerId: string;
};

async function ensureCatalogMerchant(
	c: AppContext,
	actorUserId: string,
): Promise<CatalogMerchant> {
	const existingMerchant = await getDefaultMerchant(c.env.DB);
	if (existingMerchant) {
		return existingMerchant;
	}
	await assertOwnerUserExists(c, actorUserId);
	const nowIso = new Date().toISOString();
	const id = crypto.randomUUID();
	await createMerchant(c.env.DB, {
		id,
		ownerId: actorUserId,
		name: "default_merchant",
		nowIso,
	});
	return { id, ownerId: actorUserId };
}

export async function listProductsForCatalog(c: AppContext, input: {
	keyword?: string;
	status?: "draft" | "active" | "inactive";
	entitlementType?: Exclude<CommerceEntitlementType, "none">;
	page: number;
	size: number;
}) {
	const offset = (input.page - 1) * input.size;
	const [rows, total] = await Promise.all([
		listProducts(c.env.DB, {
			keyword: input.keyword,
			status: input.status,
			entitlementType: input.entitlementType,
			limit: input.size,
			offset,
		}),
		countProducts(c.env.DB, {
			keyword: input.keyword,
			status: input.status,
			entitlementType: input.entitlementType,
		}),
	]);
	const items = await Promise.all(rows.map((row) => mapProductRowToDto(c, row)));
	return { items, total, page: input.page, size: input.size };
}

export async function getProductForCatalog(
	c: AppContext,
	productId: string,
	status?: "draft" | "active" | "inactive",
): Promise<ProductDto> {
	const row = await getProductById(c.env.DB, { id: productId, status });
	if (!row) {
		throw new AppError("Product not found", {
			status: 404,
			code: "product_not_found",
		});
	}
	return mapProductRowToDto(c, row);
}

export async function upsertProductForCatalog(c: AppContext, actorUserId: string, input: {
	id?: string;
	title: string;
	subtitle?: string;
	description?: string;
	currency: string;
	priceCents: number;
	stock: number;
	status?: "draft" | "active" | "inactive";
	coverImageUrl?: string;
	images?: string[];
	skus?: Array<{
		id?: string;
		name: string;
		spec: string;
		priceCents: number;
		stock: number;
		isDefault?: boolean;
		status?: "draft" | "active" | "inactive";
	}>;
}): Promise<ProductDto> {
	const nowIso = new Date().toISOString();
	const catalogMerchant = await ensureCatalogMerchant(c, actorUserId);
	const existing = input.id
		? await getProductById(c.env.DB, { id: input.id })
		: null;
	const productId = input.id || crypto.randomUUID();
	const status = input.status || "draft";
	const subtitle = input.subtitle?.trim() || null;
	const description = input.description?.trim() || null;
	const coverImageUrl = input.coverImageUrl?.trim() || null;
	const catalogOwnerId = existing?.owner_id ?? catalogMerchant.ownerId;
	const catalogMerchantId = existing?.merchant_id ?? catalogMerchant.id;

	if (input.id) {
		if (!existing) {
			throw new AppError("Product not found", {
				status: 404,
				code: "product_not_found",
			});
		}
		await updateProductById(c.env.DB, {
			id: input.id,
			title: input.title,
			subtitle,
			description,
			currency: input.currency,
			priceCents: input.priceCents,
			stock: input.stock,
			status,
			coverImageUrl,
			nowIso,
		});
	} else {
		await createProduct(c.env.DB, {
			id: productId,
			ownerId: catalogOwnerId,
			merchantId: catalogMerchantId,
			title: input.title,
			subtitle,
			description,
			currency: input.currency,
			priceCents: input.priceCents,
			stock: input.stock,
			status,
			coverImageUrl,
			nowIso,
		});
	}

	if (input.images) {
		await replaceProductImages(c.env.DB, {
			productId,
			ownerId: catalogOwnerId,
			imageUrls: input.images,
			nowIso,
		});
	}

	if (input.skus) {
		let hasDefault = false;
		const normalizedSkus = input.skus.map((sku, index) => {
			const isDefault = sku.isDefault === true || (!hasDefault && index === 0);
			if (isDefault) hasDefault = true;
			return {
				id: sku.id || crypto.randomUUID(),
				name: sku.name,
				spec: sku.spec,
				priceCents: sku.priceCents,
				stock: sku.stock,
				isDefault,
				status: sku.status || status,
			};
		});
		await replaceProductSkus(c.env.DB, {
			productId,
			ownerId: catalogOwnerId,
			merchantId: catalogMerchantId,
			skus: normalizedSkus,
			nowIso,
		});
	}

	return getProductForCatalog(c, productId);
}

export async function updateProductStatusForCatalog(c: AppContext, input: {
	productId: string;
	status: "draft" | "active" | "inactive";
}): Promise<ProductDto> {
	const existing = await getProductById(c.env.DB, { id: input.productId });
	if (!existing) {
		throw new AppError("Product not found", {
			status: 404,
			code: "product_not_found",
		});
	}
	await updateProductStatusById(c.env.DB, {
		id: input.productId,
		status: input.status,
		nowIso: new Date().toISOString(),
	});
	return getProductForCatalog(c, input.productId);
}

export async function deleteProductForCatalog(
	c: AppContext,
	productId: string,
): Promise<void> {
	const existing = await getProductById(c.env.DB, { id: productId });
	if (!existing) {
		throw new AppError("Product not found", {
			status: 404,
			code: "product_not_found",
		});
	}
	await deleteProductByIdAnyOwner(c.env.DB, { id: productId });
}
