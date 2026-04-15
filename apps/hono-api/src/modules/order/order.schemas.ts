import { z } from "zod";

export const OrderStatusSchema = z.enum([
	"pending_payment",
	"paid",
	"canceled",
	"refund_pending",
	"partially_refunded",
	"refunded",
]);

export const PaymentStatusSchema = z.enum(["unpaid", "paid", "refund_pending", "partially_refunded", "refunded"]);

export const OrderItemSchema = z.object({
	id: z.string(),
	orderId: z.string(),
	productId: z.string(),
	skuId: z.string().nullable(),
	titleSnapshot: z.string(),
	skuNameSnapshot: z.string().nullable(),
	unitPriceCents: z.number().int().nonnegative(),
	quantity: z.number().int().positive(),
	totalPriceCents: z.number().int().nonnegative(),
	coverImageUrlSnapshot: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const OrderSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	merchantId: z.string(),
	orderNo: z.string(),
	status: OrderStatusSchema,
	paymentStatus: PaymentStatusSchema,
	currency: z.string(),
	totalAmountCents: z.number().int().nonnegative(),
	paidAmountCents: z.number().int().nonnegative(),
	refundAmountCents: z.number().int().nonnegative(),
	refundStatus: z.string().nullable(),
	refundReason: z.string().nullable(),
	buyerNote: z.string().nullable(),
	paidAt: z.string().nullable(),
	canceledAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	items: z.array(OrderItemSchema),
});
export type OrderDto = z.infer<typeof OrderSchema>;

export const CreateOrderRequestSchema = z.object({
	items: z.array(z.object({
		productId: z.string().trim().min(1),
		skuId: z.string().trim().min(1).optional(),
		quantity: z.number().int().positive().max(1000),
	})).min(1).max(200),
	buyerNote: z.string().trim().max(2000).optional(),
});

export const OrderListQuerySchema = z.object({
	status: OrderStatusSchema.optional(),
	paymentStatus: PaymentStatusSchema.optional(),
	orderNo: z.string().trim().optional(),
	page: z.coerce.number().int().min(1).default(1),
	size: z.coerce.number().int().min(1).max(100).default(20),
});

export const OrderListResponseSchema = z.object({
	items: z.array(OrderSchema),
	total: z.number().int().nonnegative(),
	page: z.number().int().min(1),
	size: z.number().int().min(1),
});

export const CancelOrderRequestSchema = z.object({
	reason: z.string().trim().max(500).optional(),
});
