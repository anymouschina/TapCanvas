import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	countOrdersByOwner,
	createOrder,
	createOrderItem,
	createOrderStatusEvent,
	getOrderById,
	getProductBriefById,
	getSkuBriefById,
	listOrderItems,
	listOrdersByOwner,
	updateOrderAsCanceled,
	updateOrderAsPaid,
	updateProductStock,
	updateSkuStock,
	type OrderItemRow,
	type OrderRow,
} from "./order.repo";
import type { OrderDto } from "./order.schemas";
import { applyOrderEntitlementsForPaidOrder } from "../commerce/commerce.service";

type SelectedLine = {
	productId: string;
	productOwnerId: string;
	skuId: string | null;
	titleSnapshot: string;
	skuNameSnapshot: string | null;
	unitPriceCents: number;
	quantity: number;
	totalPriceCents: number;
	coverImageUrlSnapshot: string | null;
	merchantId: string;
	currency: string;
};

function generateOrderNo(): string {
	const now = new Date();
	const pad = (n: number, len = 2) => `${n}`.padStart(len, "0");
	const ts = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
	const rand = Math.floor(Math.random() * 900000 + 100000);
	return `TC${ts}${rand}`;
}

function mapOrderItemRowToDto(row: OrderItemRow): OrderDto["items"][number] {
	return {
		id: row.id,
		orderId: row.order_id,
		productId: row.product_id,
		skuId: row.sku_id,
		titleSnapshot: row.title_snapshot,
		skuNameSnapshot: row.sku_name_snapshot,
		unitPriceCents: Number(row.unit_price_cents ?? 0) || 0,
		quantity: Number(row.quantity ?? 0) || 0,
		totalPriceCents: Number(row.total_price_cents ?? 0) || 0,
		coverImageUrlSnapshot: row.cover_image_url_snapshot,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function mapOrderRowToDto(c: AppContext, row: OrderRow): Promise<OrderDto> {
	const items = await listOrderItems(c.env.DB, { orderId: row.id });
	return {
		id: row.id,
		ownerId: row.owner_id,
		merchantId: row.merchant_id,
		orderNo: row.order_no,
		status: row.status as OrderDto["status"],
		paymentStatus: row.payment_status as OrderDto["paymentStatus"],
		currency: row.currency,
		totalAmountCents: Number(row.total_amount_cents ?? 0) || 0,
		paidAmountCents: Number(row.paid_amount_cents ?? 0) || 0,
		refundAmountCents: Number(row.refund_amount_cents ?? 0) || 0,
		refundStatus: row.refund_status,
		refundReason: row.refund_reason,
		buyerNote: row.buyer_note,
		paidAt: row.paid_at,
		canceledAt: row.canceled_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		items: items.map(mapOrderItemRowToDto),
	};
}

async function loadOrderOrThrow(c: AppContext, ownerId: string | undefined, orderId: string): Promise<OrderRow> {
	const row = await getOrderById(c.env.DB, { orderId, ownerId });
	if (!row) {
		throw new AppError("Order not found", {
			status: 404,
			code: "order_not_found",
		});
	}
	return row;
}

async function buildSelectedLines(c: AppContext, ownerId: string, items: Array<{
	productId: string;
	skuId?: string;
	quantity: number;
}>): Promise<SelectedLine[]> {
	void ownerId;
	const lines: SelectedLine[] = [];
	for (const item of items) {
		const product = await getProductBriefById(c.env.DB, {
			productId: item.productId,
		});
		if (!product) {
			throw new AppError(`Product not found: ${item.productId}`, {
				status: 400,
				code: "product_not_found",
			});
		}
		if (product.status !== "active") {
			throw new AppError(`Product is not active: ${item.productId}`, {
				status: 400,
				code: "product_inactive",
			});
		}

		if (item.skuId) {
			const sku = await getSkuBriefById(c.env.DB, {
				skuId: item.skuId,
				productId: item.productId,
			});
			if (!sku) {
				throw new AppError(`SKU not found: ${item.skuId}`, {
					status: 400,
					code: "sku_not_found",
				});
			}
			if (sku.status !== "active") {
				throw new AppError(`SKU is not active: ${item.skuId}`, {
					status: 400,
					code: "sku_inactive",
				});
			}
			if (sku.stock < item.quantity) {
				throw new AppError(`SKU stock not enough: ${item.skuId}`, {
					status: 400,
					code: "stock_not_enough",
				});
			}
			lines.push({
				productId: product.id,
				productOwnerId: product.owner_id,
				skuId: sku.id,
				titleSnapshot: product.title,
				skuNameSnapshot: sku.name,
				unitPriceCents: Number(sku.price_cents ?? 0) || 0,
				quantity: item.quantity,
				totalPriceCents: (Number(sku.price_cents ?? 0) || 0) * item.quantity,
				coverImageUrlSnapshot: product.cover_image_url,
				merchantId: product.merchant_id,
				currency: product.currency,
			});
			continue;
		}

		if (product.stock < item.quantity) {
			throw new AppError(`Product stock not enough: ${item.productId}`, {
				status: 400,
				code: "stock_not_enough",
			});
		}
		const unitPrice = Number(product.price_cents ?? 0) || 0;
		lines.push({
			productId: product.id,
			productOwnerId: product.owner_id,
			skuId: null,
			titleSnapshot: product.title,
			skuNameSnapshot: null,
			unitPriceCents: unitPrice,
			quantity: item.quantity,
			totalPriceCents: unitPrice * item.quantity,
			coverImageUrlSnapshot: product.cover_image_url,
			merchantId: product.merchant_id,
			currency: product.currency,
		});
	}
	return lines;
}

export async function createOrderForOwner(c: AppContext, ownerId: string, input: {
	items: Array<{
		productId: string;
		skuId?: string;
		quantity: number;
	}>;
	buyerNote?: string;
}): Promise<OrderDto> {
	const lines = await buildSelectedLines(c, ownerId, input.items);
	const merchantId = lines[0]?.merchantId;
	if (!merchantId) {
		throw new AppError("Invalid order items", { status: 400, code: "invalid_order_items" });
	}
	for (const line of lines) {
		if (line.merchantId !== merchantId) {
			throw new AppError("Cross-merchant order is not supported", {
				status: 400,
				code: "cross_merchant_order_not_supported",
			});
		}
	}
	const currency = lines[0]?.currency || "CNY";
	for (const line of lines) {
		if (line.currency !== currency) {
			throw new AppError("Mixed currency order is not supported", {
				status: 400,
				code: "mixed_currency_order_not_supported",
			});
		}
	}

	const totalAmountCents = lines.reduce((acc, line) => acc + line.totalPriceCents, 0);
	const orderId = crypto.randomUUID();
	const orderNo = generateOrderNo();
	const nowIso = new Date().toISOString();

	await createOrder(c.env.DB, {
		id: orderId,
		ownerId,
		merchantId,
		orderNo,
		status: "pending_payment",
		paymentStatus: "unpaid",
		currency,
		totalAmountCents,
		paidAmountCents: 0,
		refundAmountCents: 0,
		refundStatus: null,
		refundReason: null,
		buyerNote: input.buyerNote?.trim() || null,
		createdAt: nowIso,
		updatedAt: nowIso,
	});

	for (const line of lines) {
		await createOrderItem(c.env.DB, {
			id: crypto.randomUUID(),
			orderId,
			productId: line.productId,
			skuId: line.skuId,
			titleSnapshot: line.titleSnapshot,
			skuNameSnapshot: line.skuNameSnapshot,
			unitPriceCents: line.unitPriceCents,
			quantity: line.quantity,
			totalPriceCents: line.totalPriceCents,
			coverImageUrlSnapshot: line.coverImageUrlSnapshot,
			nowIso,
		});
		await updateProductStock(c.env.DB, {
			productId: line.productId,
			delta: -line.quantity,
			nowIso,
		});
		if (line.skuId) {
			await updateSkuStock(c.env.DB, {
				skuId: line.skuId,
				delta: -line.quantity,
				nowIso,
			});
		}
	}

	await createOrderStatusEvent(c.env.DB, {
		id: crypto.randomUUID(),
		orderId,
		ownerId,
		fromStatus: null,
		toStatus: "pending_payment",
		eventType: "created",
		reason: null,
		payloadJson: null,
		createdAt: nowIso,
	});

	return getOrderForOwner(c, ownerId, orderId);
}

export async function getOrderForOwner(c: AppContext, ownerId: string | undefined, orderId: string): Promise<OrderDto> {
	const row = await loadOrderOrThrow(c, ownerId, orderId);
	return mapOrderRowToDto(c, row);
}

export async function listOrdersForOwner(c: AppContext, input: {
	ownerId?: string;
	status?: OrderDto["status"];
	paymentStatus?: OrderDto["paymentStatus"];
	orderNo?: string;
	page: number;
	size: number;
}) {
	const offset = (input.page - 1) * input.size;
	const [rows, total] = await Promise.all([
		listOrdersByOwner(c.env.DB, {
			ownerId: input.ownerId,
			status: input.status,
			paymentStatus: input.paymentStatus,
			orderNo: input.orderNo,
			limit: input.size,
			offset,
		}),
		countOrdersByOwner(c.env.DB, {
			ownerId: input.ownerId,
			status: input.status,
			paymentStatus: input.paymentStatus,
			orderNo: input.orderNo,
		}),
	]);
	const items = await Promise.all(rows.map((row) => mapOrderRowToDto(c, row)));
	return { items, total, page: input.page, size: input.size };
}

export async function cancelOrderForOwner(c: AppContext, input: {
	ownerId: string;
	orderId: string;
	reason?: string;
}): Promise<OrderDto> {
	const order = await loadOrderOrThrow(c, input.ownerId, input.orderId);
	if (order.payment_status !== "unpaid") {
		throw new AppError("Paid order cannot be canceled directly", {
			status: 400,
			code: "order_already_paid",
		});
	}
	if (order.status === "canceled") {
		return mapOrderRowToDto(c, order);
	}
	const nowIso = new Date().toISOString();
	const items = await listOrderItems(c.env.DB, { orderId: order.id });
	for (const item of items) {
		await updateProductStock(c.env.DB, {
			productId: item.product_id,
			delta: item.quantity,
			nowIso,
		});
		if (item.sku_id) {
			await updateSkuStock(c.env.DB, {
				skuId: item.sku_id,
				delta: item.quantity,
				nowIso,
			});
		}
	}
	await updateOrderAsCanceled(c.env.DB, {
		orderId: order.id,
		ownerId: input.ownerId,
		reason: input.reason?.trim() || null,
		nowIso,
	});
	await createOrderStatusEvent(c.env.DB, {
		id: crypto.randomUUID(),
		orderId: order.id,
		ownerId: input.ownerId,
		fromStatus: order.status,
		toStatus: "canceled",
		eventType: "canceled",
		reason: input.reason?.trim() || null,
		payloadJson: null,
		createdAt: nowIso,
	});
	return getOrderForOwner(c, input.ownerId, order.id);
}

export async function markOrderPaidFromPaymentCallback(c: AppContext, input: {
	ownerId: string;
	orderId: string;
	paidAmountCents: number;
	paymentPayload: Record<string, unknown>;
}): Promise<void> {
	const order = await loadOrderOrThrow(c, input.ownerId, input.orderId);
	if (order.payment_status === "paid") {
		return;
	}
	if (order.status === "canceled") {
		throw new AppError("Order already canceled", {
			status: 400,
			code: "order_canceled",
		});
	}
	if (input.paidAmountCents !== Number(order.total_amount_cents ?? 0)) {
		throw new AppError("Paid amount mismatch", {
			status: 400,
			code: "paid_amount_mismatch",
			details: {
				expected: Number(order.total_amount_cents ?? 0),
				actual: input.paidAmountCents,
			},
		});
	}
	const nowIso = new Date().toISOString();
	await updateOrderAsPaid(c.env.DB, {
		orderId: order.id,
		ownerId: input.ownerId,
		paidAmountCents: input.paidAmountCents,
		nowIso,
	});
	await createOrderStatusEvent(c.env.DB, {
		id: crypto.randomUUID(),
		orderId: order.id,
		ownerId: input.ownerId,
		fromStatus: order.status,
		toStatus: "paid",
		eventType: "payment_confirmed",
		reason: null,
		payloadJson: JSON.stringify(input.paymentPayload),
		createdAt: nowIso,
	});
	await applyOrderEntitlementsForPaidOrder(c, input.ownerId, order.id);
}
