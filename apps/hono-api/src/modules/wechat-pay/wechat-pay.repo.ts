import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type PaymentRow = {
	id: string;
	owner_id: string;
	order_id: string;
	provider: string;
	trade_type: string;
	out_trade_no: string;
	prepay_id: string | null;
	transaction_id: string | null;
	status: string;
	total_amount_cents: number;
	currency: string;
	refund_amount_cents: number;
	refund_status: string | null;
	refund_reason: string | null;
	raw_request_json: string | null;
	raw_response_json: string | null;
	created_at: string;
	updated_at: string;
	succeeded_at: string | null;
	closed_at: string | null;
};

export async function createPayment(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		orderId: string;
		outTradeNo: string;
		prepayId: string | null;
		status: string;
		totalAmountCents: number;
		currency: string;
		rawRequestJson: string | null;
		rawResponseJson: string | null;
		nowIso: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().payments.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			order_id: input.orderId,
			provider: "wechat",
			trade_type: "NATIVE",
			out_trade_no: input.outTradeNo,
			prepay_id: input.prepayId,
			transaction_id: null,
			status: input.status,
			total_amount_cents: input.totalAmountCents,
			currency: input.currency,
			refund_amount_cents: 0,
			refund_status: null,
			refund_reason: null,
			raw_request_json: input.rawRequestJson,
			raw_response_json: input.rawResponseJson,
			created_at: input.nowIso,
			updated_at: input.nowIso,
			succeeded_at: null,
			closed_at: null,
		},
	});
}

export async function getPaymentByOrderId(
	db: PrismaClient,
	input: {
		orderId: string;
		ownerId: string;
	},
	): Promise<PaymentRow | null> {
	void db;
	return getPrismaClient().payments.findFirst({
		where: {
			order_id: input.orderId,
			owner_id: input.ownerId,
		},
		orderBy: { created_at: "desc" },
	});
}

export async function getPaymentByOutTradeNo(
	db: PrismaClient,
	input: {
		outTradeNo: string;
	},
	): Promise<PaymentRow | null> {
	void db;
	return getPrismaClient().payments.findUnique({
		where: { out_trade_no: input.outTradeNo },
	});
}

export async function updatePaymentAsSucceeded(
	db: PrismaClient,
	input: {
		id: string;
		transactionId: string;
		rawResponseJson: string;
		nowIso: string;
	},
): Promise<void> {
	void db;
	const existing = await getPrismaClient().payments.findUnique({
		where: { id: input.id },
		select: { succeeded_at: true },
	});
	await getPrismaClient().payments.update({
		where: { id: input.id },
		data: {
			status: "success",
			transaction_id: input.transactionId,
			raw_response_json: input.rawResponseJson,
			updated_at: input.nowIso,
			succeeded_at: existing?.succeeded_at ?? input.nowIso,
		},
	});
}

export async function createPaymentCallbackLog(
	db: PrismaClient,
	input: {
		id: string;
		paymentId: string | null;
		provider: string;
		eventType: string;
		outTradeNo: string | null;
		transactionId: string | null;
		signatureValid: boolean;
		payloadJson: string;
		headersJson: string;
		errorMessage: string | null;
		createdAt: string;
	},
): Promise<void> {
	void db;
	await getPrismaClient().payment_callbacks.create({
		data: {
			id: input.id,
			payment_id: input.paymentId,
			provider: input.provider,
			event_type: input.eventType,
			out_trade_no: input.outTradeNo,
			transaction_id: input.transactionId,
			signature_valid: input.signatureValid ? 1 : 0,
			payload_json: input.payloadJson,
			headers_json: input.headersJson,
			error_message: input.errorMessage,
			created_at: input.createdAt,
		},
	});
}
