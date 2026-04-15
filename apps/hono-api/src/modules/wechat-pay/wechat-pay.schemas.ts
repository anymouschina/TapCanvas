import { z } from "zod";

export const CreateWechatNativePaymentRequestSchema = z.object({
	orderId: z.string().trim().min(1),
});

export const CreateWechatNativePaymentResponseSchema = z.object({
	paymentId: z.string(),
	orderId: z.string(),
	orderNo: z.string(),
	outTradeNo: z.string(),
	prepayId: z.string().nullable(),
	codeUrl: z.string(),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
});

export const WechatPaymentSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	orderId: z.string(),
	provider: z.literal("wechat"),
	tradeType: z.literal("NATIVE"),
	outTradeNo: z.string(),
	prepayId: z.string().nullable(),
	transactionId: z.string().nullable(),
	status: z.enum(["created", "pending", "success", "failed", "closed", "refunding", "refunded"]),
	totalAmountCents: z.number().int().nonnegative(),
	currency: z.string(),
	refundAmountCents: z.number().int().nonnegative(),
	refundStatus: z.string().nullable(),
	refundReason: z.string().nullable(),
	rawRequestJson: z.string().nullable(),
	rawResponseJson: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	succeededAt: z.string().nullable(),
	closedAt: z.string().nullable(),
});

export const WechatPaymentCallbackAckSchema = z.object({
	code: z.string(),
	message: z.string(),
});

export const WechatPaymentReconcileResponseSchema = z.object({
	orderId: z.string(),
	outTradeNo: z.string(),
	paymentStatus: z.enum(["pending", "success"]),
	orderPaymentStatus: z.enum(["unpaid", "paid"]),
	tradeState: z.string().nullable(),
	transactionId: z.string().nullable(),
});
