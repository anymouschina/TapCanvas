import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type ProductRow = {
	id: string;
	owner_id: string;
	merchant_id: string;
	title: string;
	subtitle: string | null;
	description: string | null;
	currency: string;
	price_cents: number;
	stock: number;
	status: string;
	cover_image_url: string | null;
	created_at: string;
	updated_at: string;
};

export type ProductSkuRow = {
	id: string;
	product_id: string;
	owner_id: string;
	merchant_id: string;
	name: string;
	spec: string;
	price_cents: number;
	stock: number;
	is_default: number;
	status: string;
	created_at: string;
	updated_at: string;
};

export async function getMerchantByOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<{ id: string } | null> {
	void db;
	const row = await getPrismaClient().merchants.findUnique({
		where: { owner_id: ownerId },
		select: { id: true },
	});
	return row ? { id: row.id } : null;
}

export async function createMerchant(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		name: string;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().merchants.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			name: input.name,
			status: "active",
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
}

export async function getDefaultMerchant(
	db: PrismaClient,
): Promise<{ id: string; ownerId: string } | null> {
	void db;
	const row = await getPrismaClient().merchants.findFirst({
		orderBy: [{ created_at: "asc" }, { id: "asc" }],
		select: { id: true, owner_id: true },
	});
	return row
		? {
				id: row.id,
				ownerId: row.owner_id,
			}
		: null;
}

export async function listProducts(
	db: PrismaClient,
	input: {
		ownerId?: string;
		keyword?: string;
		status?: string;
		entitlementType?: "points_topup" | "monthly_quota" | "openclaw_subscription";
		limit: number;
		offset: number;
	},
): Promise<ProductRow[]> {
	void db;
	const keyword = input.keyword?.trim();
	return getPrismaClient().products.findMany({
		where: {
			...(input.ownerId ? { owner_id: input.ownerId } : {}),
			...(input.status ? { status: input.status } : {}),
			...(input.entitlementType
				? {
					product_entitlements: {
						some: {
							entitlement_type: input.entitlementType,
						},
					},
				}
				: {}),
			...(keyword
				? {
						OR: [
							{ title: { contains: keyword } },
							{ subtitle: { contains: keyword } },
						],
					}
				: {}),
		},
		orderBy: { updated_at: "desc" },
		take: input.limit,
		skip: input.offset,
	});
}

export async function countProducts(
	db: PrismaClient,
	input: {
		ownerId?: string;
		keyword?: string;
		status?: string;
		entitlementType?: "points_topup" | "monthly_quota" | "openclaw_subscription";
	},
): Promise<number> {
	void db;
	const keyword = input.keyword?.trim();
	return getPrismaClient().products.count({
		where: {
			...(input.ownerId ? { owner_id: input.ownerId } : {}),
			...(input.status ? { status: input.status } : {}),
			...(input.entitlementType
				? {
					product_entitlements: {
						some: {
							entitlement_type: input.entitlementType,
						},
					},
				}
				: {}),
			...(keyword
				? {
						OR: [
							{ title: { contains: keyword } },
							{ subtitle: { contains: keyword } },
						],
					}
				: {}),
		},
	});
}

export async function getProductById(
	db: PrismaClient,
	input: {
		id: string;
		ownerId?: string;
		status?: string;
	},
): Promise<ProductRow | null> {
	void db;
	return getPrismaClient().products.findFirst({
		where: {
			id: input.id,
			...(input.ownerId ? { owner_id: input.ownerId } : {}),
			...(input.status ? { status: input.status } : {}),
		},
	});
}

export async function updateProductById(
	db: PrismaClient,
	input: {
		id: string;
		title: string;
		subtitle: string | null;
		description: string | null;
		currency: string;
		priceCents: number;
		stock: number;
		status: string;
		coverImageUrl: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.updateMany({
		where: { id: input.id },
		data: {
			title: input.title,
			subtitle: input.subtitle,
			description: input.description,
			currency: input.currency,
			price_cents: input.priceCents,
			stock: input.stock,
			status: input.status,
			cover_image_url: input.coverImageUrl,
			updated_at: input.nowIso,
		},
	});
}

export async function updateProductStatusById(
	db: PrismaClient,
	input: {
		id: string;
		status: string;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.updateMany({
		where: { id: input.id },
		data: { status: input.status, updated_at: input.nowIso },
	});
}

export async function deleteProductByIdAnyOwner(
	db: PrismaClient,
	input: {
		id: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.deleteMany({
		where: { id: input.id },
	});
}

export async function createProduct(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		merchantId: string;
		title: string;
		subtitle: string | null;
		description: string | null;
		currency: string;
		priceCents: number;
		stock: number;
		status: string;
		coverImageUrl: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			merchant_id: input.merchantId,
			title: input.title,
			subtitle: input.subtitle,
			description: input.description,
			currency: input.currency,
			price_cents: input.priceCents,
			stock: input.stock,
			status: input.status,
			cover_image_url: input.coverImageUrl,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
}

export async function updateProduct(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		title: string;
		subtitle: string | null;
		description: string | null;
		currency: string;
		priceCents: number;
		stock: number;
		status: string;
		coverImageUrl: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.updateMany({
		where: { id: input.id, owner_id: input.ownerId },
		data: {
			title: input.title,
			subtitle: input.subtitle,
			description: input.description,
			currency: input.currency,
			price_cents: input.priceCents,
			stock: input.stock,
			status: input.status,
			cover_image_url: input.coverImageUrl,
			updated_at: input.nowIso,
		},
	});
}

export async function updateProductStatus(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		status: string;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.updateMany({
		where: { id: input.id, owner_id: input.ownerId },
		data: { status: input.status, updated_at: input.nowIso },
	});
}

export async function deleteProductById(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.deleteMany({
		where: { id: input.id, owner_id: input.ownerId },
	});
}

export async function replaceProductImages(
	db: PrismaClient,
	input: {
		productId: string;
		ownerId: string;
		imageUrls: string[];
		nowIso: string;
	},
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	await prisma.$transaction(async (tx) => {
		await tx.product_images.deleteMany({
			where: { product_id: input.productId, owner_id: input.ownerId },
		});
		for (let index = 0; index < input.imageUrls.length; index += 1) {
			await tx.product_images.create({
				data: {
					id: crypto.randomUUID(),
					product_id: input.productId,
					owner_id: input.ownerId,
					image_url: input.imageUrls[index],
					sort_order: index,
					created_at: input.nowIso,
					updated_at: input.nowIso,
				},
			});
		}
	});
}

export async function listProductImages(
	db: PrismaClient,
	input: {
		productId: string;
		ownerId: string;
	},
): Promise<string[]> {
	void db;
	const rows = await getPrismaClient().product_images.findMany({
		where: { product_id: input.productId, owner_id: input.ownerId },
		orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
		select: { image_url: true },
	});
	return rows.map((row) => row.image_url);
}

export async function replaceProductSkus(
	db: PrismaClient,
	input: {
		productId: string;
		ownerId: string;
		merchantId: string;
		skus: Array<{
			id: string;
			name: string;
			spec: string;
			priceCents: number;
			stock: number;
			isDefault: boolean;
			status: string;
		}>;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	await prisma.$transaction(async (tx) => {
		await tx.product_skus.deleteMany({
			where: { product_id: input.productId, owner_id: input.ownerId },
		});
		for (const sku of input.skus) {
			await tx.product_skus.create({
				data: {
					id: sku.id,
					product_id: input.productId,
					owner_id: input.ownerId,
					merchant_id: input.merchantId,
					name: sku.name,
					spec: sku.spec,
					price_cents: sku.priceCents,
					stock: sku.stock,
					is_default: sku.isDefault ? 1 : 0,
					status: sku.status,
					created_at: input.nowIso,
					updated_at: input.nowIso,
				},
			});
		}
	});
}

export async function listProductSkus(
	db: PrismaClient,
	input: {
		productId: string;
		ownerId: string;
	},
): Promise<ProductSkuRow[]> {
	void db;
	return getPrismaClient().product_skus.findMany({
		where: { product_id: input.productId, owner_id: input.ownerId },
		orderBy: [{ is_default: "desc" }, { created_at: "asc" }],
	});
}
