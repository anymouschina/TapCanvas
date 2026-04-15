import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type OrderRow = {
	id: string;
	owner_id: string;
	merchant_id: string;
	order_no: string;
	status: string;
	payment_status: string;
	currency: string;
	total_amount_cents: number;
	paid_amount_cents: number;
	refund_amount_cents: number;
	refund_status: string | null;
	refund_reason: string | null;
	buyer_note: string | null;
	paid_at: string | null;
	canceled_at: string | null;
	created_at: string;
	updated_at: string;
};

export type OrderItemRow = {
	id: string;
	order_id: string;
	product_id: string;
	sku_id: string | null;
	title_snapshot: string;
	sku_name_snapshot: string | null;
	unit_price_cents: number;
	quantity: number;
	total_price_cents: number;
	cover_image_url_snapshot: string | null;
	created_at: string;
	updated_at: string;
};

export type ProductBriefRow = {
	id: string;
	owner_id: string;
	merchant_id: string;
	title: string;
	currency: string;
	price_cents: number;
	stock: number;
	status: string;
	cover_image_url: string | null;
};

export type SkuBriefRow = {
	id: string;
	product_id: string;
	name: string;
	price_cents: number;
	stock: number;
	status: string;
};

export async function getProductBriefById(
	db: PrismaClient,
	input: {
		productId: string;
	},
): Promise<ProductBriefRow | null> {
	void db;
	return getPrismaClient().products.findFirst({
		where: { id: input.productId },
		select: {
			id: true,
			owner_id: true,
			merchant_id: true,
			title: true,
			currency: true,
			price_cents: true,
			stock: true,
			status: true,
			cover_image_url: true,
		},
	});
}

export async function getSkuBriefById(
	db: PrismaClient,
	input: {
		skuId: string;
		productId: string;
	},
): Promise<SkuBriefRow | null> {
	void db;
	return getPrismaClient().product_skus.findFirst({
		where: {
			id: input.skuId,
			product_id: input.productId,
		},
		select: {
			id: true,
			product_id: true,
			name: true,
			price_cents: true,
			stock: true,
			status: true,
		},
	});
}

export async function updateProductStock(
	db: PrismaClient,
	input: {
		productId: string;
		delta: number;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().products.updateMany({
		where: { id: input.productId },
		data: {
			stock: { increment: input.delta },
			updated_at: input.nowIso,
		},
	});
}

export async function updateSkuStock(
	db: PrismaClient,
	input: {
		skuId: string;
		delta: number;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().product_skus.updateMany({
		where: { id: input.skuId },
		data: {
			stock: { increment: input.delta },
			updated_at: input.nowIso,
		},
	});
}

export async function createOrder(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		merchantId: string;
		orderNo: string;
		status: string;
		paymentStatus: string;
		currency: string;
		totalAmountCents: number;
		paidAmountCents: number;
		refundAmountCents: number;
		refundStatus: string | null;
		refundReason: string | null;
		buyerNote: string | null;
		createdAt: string;
		updatedAt: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().orders.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			merchant_id: input.merchantId,
			order_no: input.orderNo,
			status: input.status,
			payment_status: input.paymentStatus,
			currency: input.currency,
			total_amount_cents: input.totalAmountCents,
			paid_amount_cents: input.paidAmountCents,
			refund_amount_cents: input.refundAmountCents,
			refund_status: input.refundStatus,
			refund_reason: input.refundReason,
			buyer_note: input.buyerNote,
			paid_at: null,
			canceled_at: null,
			created_at: input.createdAt,
			updated_at: input.updatedAt,
		},
	});
}

export async function createOrderItem(
	db: PrismaClient,
	input: {
		id: string;
		orderId: string;
		productId: string;
		skuId: string | null;
		titleSnapshot: string;
		skuNameSnapshot: string | null;
		unitPriceCents: number;
		quantity: number;
		totalPriceCents: number;
		coverImageUrlSnapshot: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().order_items.create({
		data: {
			id: input.id,
			order_id: input.orderId,
			product_id: input.productId,
			sku_id: input.skuId,
			title_snapshot: input.titleSnapshot,
			sku_name_snapshot: input.skuNameSnapshot,
			unit_price_cents: input.unitPriceCents,
			quantity: input.quantity,
			total_price_cents: input.totalPriceCents,
			cover_image_url_snapshot: input.coverImageUrlSnapshot,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
}

export async function getOrderById(
	db: PrismaClient,
	input: {
		orderId: string;
		ownerId?: string;
	},
): Promise<OrderRow | null> {
	void db;
	return getPrismaClient().orders.findFirst({
		where: {
			id: input.orderId,
			...(input.ownerId ? { owner_id: input.ownerId } : {}),
		},
	});
}

export async function getOrderByNo(
	db: PrismaClient,
	input: {
		orderNo: string;
		ownerId?: string;
	},
): Promise<OrderRow | null> {
	void db;
	return getPrismaClient().orders.findFirst({
		where: {
			order_no: input.orderNo,
			...(input.ownerId ? { owner_id: input.ownerId } : {}),
		},
	});
}

export async function listOrderItems(
	db: PrismaClient,
	input: {
		orderId: string;
	},
): Promise<OrderItemRow[]> {
	void db;
	return getPrismaClient().order_items.findMany({
		where: { order_id: input.orderId },
		orderBy: { created_at: "asc" },
	});
}

export async function listOrdersByOwner(
	db: PrismaClient,
	input: {
		ownerId?: string;
		status?: string;
		paymentStatus?: string;
		orderNo?: string;
		limit: number;
		offset: number;
	},
): Promise<OrderRow[]> {
	void db;
	const orderNo = input.orderNo?.trim();
	return getPrismaClient().orders.findMany({
		where: {
			...(input.ownerId ? { owner_id: input.ownerId } : {}),
			...(input.status ? { status: input.status } : {}),
			...(input.paymentStatus ? { payment_status: input.paymentStatus } : {}),
			...(orderNo ? { order_no: { contains: orderNo } } : {}),
		},
		orderBy: { created_at: "desc" },
		take: input.limit,
		skip: input.offset,
	});
}

export async function countOrdersByOwner(
	db: PrismaClient,
	input: {
		ownerId?: string;
		status?: string;
		paymentStatus?: string;
		orderNo?: string;
	},
): Promise<number> {
	void db;
	const orderNo = input.orderNo?.trim();
	return getPrismaClient().orders.count({
		where: {
			...(input.ownerId ? { owner_id: input.ownerId } : {}),
			...(input.status ? { status: input.status } : {}),
			...(input.paymentStatus ? { payment_status: input.paymentStatus } : {}),
			...(orderNo ? { order_no: { contains: orderNo } } : {}),
		},
	});
}

export async function updateOrderAsCanceled(
	db: PrismaClient,
	input: {
		orderId: string;
		ownerId: string;
		reason: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const existing = await getPrismaClient().orders.findFirst({
		where: { id: input.orderId, owner_id: input.ownerId },
		select: { payment_status: true, refund_reason: true },
	});
	if (!existing) return;
	await getPrismaClient().orders.updateMany({
		where: { id: input.orderId, owner_id: input.ownerId },
		data: {
			status: "canceled",
			payment_status:
				existing.payment_status === "unpaid" ? "unpaid" : existing.payment_status,
			refund_reason: input.reason ?? existing.refund_reason,
			canceled_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
}

export async function updateOrderAsPaid(
	db: PrismaClient,
	input: {
		orderId: string;
		ownerId: string;
		paidAmountCents: number;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().orders.updateMany({
		where: { id: input.orderId, owner_id: input.ownerId },
		data: {
			status: "paid",
			payment_status: "paid",
			paid_amount_cents: input.paidAmountCents,
			paid_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
}

export async function createOrderStatusEvent(
	db: PrismaClient,
	input: {
		id: string;
		orderId: string;
		ownerId: string;
		fromStatus: string | null;
		toStatus: string;
		eventType: string;
		reason: string | null;
		payloadJson: string | null;
		createdAt: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().order_status_events.create({
		data: {
			id: input.id,
			order_id: input.orderId,
			owner_id: input.ownerId,
			from_status: input.fromStatus,
			to_status: input.toStatus,
			event_type: input.eventType,
			reason: input.reason,
			payload_json: input.payloadJson,
			created_at: input.createdAt,
		},
	});
}
