import { X509Certificate, createDecipheriv, createPrivateKey, createPublicKey, createVerify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Pay = require("wechatpay-node-v3");
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getOrderById, getOrderByNo, type OrderRow } from "../order/order.repo";
import { markOrderPaidFromPaymentCallback } from "../order/order.service";
import {
	createPayment,
	createPaymentCallbackLog,
	getPaymentByOrderId,
	getPaymentByOutTradeNo,
	updatePaymentAsSucceeded,
	type PaymentRow,
} from "./wechat-pay.repo";

type WechatCallbackBody = {
	event_type?: string;
	resource?: {
		ciphertext?: string;
		nonce?: string;
		associated_data?: string;
		original_type?: string;
	};
};

type WechatDecryptTransaction = {
	out_trade_no?: string;
	transaction_id?: string;
	trade_state?: string;
	amount?: {
		total?: number;
		payer_total?: number;
		currency?: string;
		payer_currency?: string;
	};
};

function requireEnv(c: AppContext, key: keyof AppContext["env"]): string {
	const value = c.env[key];
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) {
		throw new AppError(`Missing env: ${String(key)}`, {
			status: 500,
			code: "wechat_env_missing",
			details: { key },
		});
	}
	return text;
}

function requireEnvWithLegacyHints(c: AppContext, key: keyof AppContext["env"], legacyKeys: string[] = []): string {
	const value = c.env[key];
	const text = typeof value === "string" ? value.trim() : "";
	if (text) return text;
	throw new AppError(`Missing env: ${String(key)}`, {
		status: 500,
		code: "wechat_env_missing",
		details: {
			key,
			legacyAcceptedKeys: legacyKeys,
			note:
				key === "WECHAT_PAY_APP_ID"
					? "WECHAT_APP_SECRET is not used for WeChat Pay V3 signing/callback verify in this flow."
					: undefined,
		},
	});
}

function normalizePem(content: string): string {
	return content.replaceAll("\\n", "\n").trim();
}

function mustBeHttpsUrl(value: string, code: string, field: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new AppError(`${field} must be a valid URL`, {
			status: 400,
			code,
			details: { field, value },
		});
	}
	if (parsed.protocol !== "https:") {
		throw new AppError(`${field} must use https`, {
			status: 400,
			code,
			details: { field, value },
		});
	}
	return parsed.toString();
}

function validateWechatMaterial(input: {
	privateKeyPem: string;
	platformPublicKeyPem: string;
}): void {
	const privateKey = normalizePem(input.privateKeyPem);
	try {
		createPrivateKey(privateKey);
	} catch {
		throw new AppError("Invalid merchant private key PEM", {
			status: 500,
			code: "wechat_private_key_invalid",
			details: {
				field: "WECHAT_PAY_PRIVATE_KEY",
				note: "Use full apiclient_key.pem with BEGIN/END lines.",
			},
		});
	}

	const platform = normalizePem(input.platformPublicKeyPem);
	try {
		if (platform.includes("BEGIN CERTIFICATE")) {
			const cert = new X509Certificate(platform);
			createPublicKey(cert.publicKey);
			return;
		}
		createPublicKey(platform);
	} catch {
		throw new AppError("Invalid WeChat platform public key/certificate PEM", {
			status: 500,
			code: "wechat_platform_public_key_invalid",
			details: {
				field: "WECHAT_PAY_PLATFORM_PUBLIC_KEY",
				note: "Use full platform public key or platform certificate PEM.",
			},
		});
	}
}

function resolveMerchantCertPem(c: AppContext): string {
	const fromEnv = (typeof c.env.WECHAT_PAY_MCH_CERT_PEM === "string" ? c.env.WECHAT_PAY_MCH_CERT_PEM : "").trim();
	if (fromEnv) return fromEnv;
	const envPath = (typeof c.env.WECHAT_PAY_MCH_CERT_FILE === "string" ? c.env.WECHAT_PAY_MCH_CERT_FILE : "").trim();
	const candidates = [
		envPath ? path.resolve(process.cwd(), envPath) : "",
		path.resolve(process.cwd(), "cert/apiclient_cert.pem"),
		path.resolve(process.cwd(), "apps/hono-api/cert/apiclient_cert.pem"),
	].filter(Boolean);
	for (const p of candidates) {
		try {
			if (!fs.existsSync(p)) continue;
			const pem = fs.readFileSync(p, "utf8").trim();
			if (pem) return pem;
		} catch {
			// ignore
		}
	}
	throw new AppError("Missing merchant cert pem for wechat sdk", {
		status: 500,
		code: "wechat_env_missing",
		details: {
			key: "WECHAT_PAY_MCH_CERT_FILE",
			note: "Expected apiclient_cert.pem for SDK init.",
		},
	});
}

function createWechatPayClient(c: AppContext): {
	pay: any;
	mchId: string;
	appId: string;
	serialNo: string;
	notifyUrl: string;
} {
	const mchId = requireEnvWithLegacyHints(c, "WECHAT_PAY_MCH_ID", [
		"WXPAY_MCHID",
		"WECHAT_MCH_ID",
	]);
	const appId = requireEnvWithLegacyHints(c, "WECHAT_PAY_APP_ID", [
		"WECHAT_APP_ID",
	]);
	const privateKeyPem = requireEnv(c, "WECHAT_PAY_PRIVATE_KEY");
	const platformPublicKeyPem = requireEnv(c, "WECHAT_PAY_PLATFORM_PUBLIC_KEY");
	const apiV3Key = requireEnv(c, "WECHAT_PAY_API_V3_KEY");
	const serialNo = requireEnv(c, "WECHAT_PAY_MCH_SERIAL_NO");
	const notifyUrl = requireEnvWithLegacyHints(c, "WECHAT_PAY_NOTIFY_URL", [
		"WECHAT_NOTIFY_URL",
	]);
	const normalizedNotifyUrl = mustBeHttpsUrl(
		notifyUrl,
		"wechat_notify_url_invalid",
		"WECHAT_PAY_NOTIFY_URL",
	);
	const merchantCertPem = resolveMerchantCertPem(c);
	validateWechatMaterial({
		privateKeyPem,
		platformPublicKeyPem,
	});

	const pay = new Pay({
		appid: appId,
		mchid: mchId,
		serial_no: serialNo,
		publicKey: Buffer.from(merchantCertPem),
		privateKey: Buffer.from(privateKeyPem),
		key: apiV3Key,
		userAgent: "tapcanvas-hono/1.0",
	} as any);
	return { pay, mchId, appId, serialNo, notifyUrl: normalizedNotifyUrl };
}

function decodeWechatResource(apiV3Key: string, ciphertextBase64: string, nonce: string, associatedData: string): string {
	const key = Buffer.from(apiV3Key, "utf8");
	if (key.length !== 32) {
		throw new AppError("WECHAT_PAY_API_V3_KEY must be 32 bytes", {
			status: 500,
			code: "wechat_api_v3_key_invalid",
		});
	}
	const ciphertext = Buffer.from(ciphertextBase64, "base64");
	if (ciphertext.length <= 16) {
		throw new AppError("Invalid callback ciphertext", {
			status: 400,
			code: "wechat_callback_ciphertext_invalid",
		});
	}
	const data = ciphertext.subarray(0, ciphertext.length - 16);
	const authTag = ciphertext.subarray(ciphertext.length - 16);
	const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "utf8"));
	decipher.setAAD(Buffer.from(associatedData || "", "utf8"));
	decipher.setAuthTag(authTag);
	const plain = Buffer.concat([decipher.update(data), decipher.final()]);
	return plain.toString("utf8");
}

function verifyWechatCallbackSignature(input: {
	platformPublicKeyPem: string;
	timestamp: string;
	nonce: string;
	body: string;
	signature: string;
}): boolean {
	const message = `${input.timestamp}\n${input.nonce}\n${input.body}\n`;
	const verifier = createVerify("RSA-SHA256");
	verifier.update(message);
	verifier.end();
	return verifier.verify(input.platformPublicKeyPem, input.signature, "base64");
}

function mapPaymentRowToDto(row: PaymentRow) {
	return {
		id: row.id,
		ownerId: row.owner_id,
		orderId: row.order_id,
		provider: row.provider,
		tradeType: row.trade_type,
		outTradeNo: row.out_trade_no,
		prepayId: row.prepay_id,
		transactionId: row.transaction_id,
		status: row.status,
		totalAmountCents: Number(row.total_amount_cents ?? 0) || 0,
		currency: row.currency,
		refundAmountCents: Number(row.refund_amount_cents ?? 0) || 0,
		refundStatus: row.refund_status,
		refundReason: row.refund_reason,
		rawRequestJson: row.raw_request_json,
		rawResponseJson: row.raw_response_json,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		succeededAt: row.succeeded_at,
		closedAt: row.closed_at,
	};
}

function safeJsonParseObject(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

async function ensureRecoveredPaymentForOrder(c: AppContext, input: {
	order: OrderRow;
	outTradeNo: string;
	prepayId?: string | null;
	status?: PaymentRow["status"];
	rawResponseJson: string | null;
	nowIso?: string;
}): Promise<PaymentRow> {
	const existed = await getPaymentByOutTradeNo(c.env.DB, { outTradeNo: input.outTradeNo });
	if (existed) return existed;

	const nowIso = input.nowIso || new Date().toISOString();
	const paymentId = crypto.randomUUID();
	await createPayment(c.env.DB, {
		id: paymentId,
		ownerId: input.order.owner_id,
		orderId: input.order.id,
		outTradeNo: input.outTradeNo,
		prepayId: input.prepayId ?? null,
		status: input.status ?? "pending",
		totalAmountCents: Number(input.order.total_amount_cents ?? 0) || 0,
		currency: input.order.currency || "CNY",
		rawRequestJson: null,
		rawResponseJson: input.rawResponseJson,
		nowIso,
	});
	const recovered = await getPaymentByOutTradeNo(c.env.DB, { outTradeNo: input.outTradeNo });
	if (!recovered) {
		throw new AppError("Recovered payment create failed", {
			status: 500,
			code: "payment_recover_create_failed",
			details: {
				orderId: input.order.id,
				outTradeNo: input.outTradeNo,
			},
		});
	}
	return recovered;
}

export async function createWechatNativePaymentForOrder(c: AppContext, input: {
	ownerId: string;
	orderId: string;
}) {
	const order = await getOrderById(c.env.DB, { orderId: input.orderId, ownerId: input.ownerId });
	if (!order) {
		throw new AppError("Order not found", {
			status: 404,
			code: "order_not_found",
		});
	}
	if (order.payment_status === "paid") {
		throw new AppError("Order already paid", {
			status: 400,
			code: "order_already_paid",
		});
	}
	if (order.status === "canceled") {
		throw new AppError("Order canceled", {
			status: 400,
			code: "order_canceled",
		});
	}

	const existed = await getPaymentByOrderId(c.env.DB, {
		orderId: order.id,
		ownerId: input.ownerId,
	});
	if (existed && existed.status === "success") {
		throw new AppError("Order already paid", {
			status: 400,
			code: "order_already_paid",
		});
	}
	if (existed && existed.status === "pending") {
		const raw = safeJsonParseObject(existed.raw_response_json);
		const codeUrl =
			typeof raw?.code_url === "string" && raw.code_url.trim() ? raw.code_url.trim() : "";
		if (codeUrl) {
			return {
				paymentId: existed.id,
				orderId: order.id,
				orderNo: order.order_no,
				outTradeNo: existed.out_trade_no,
				prepayId: existed.prepay_id,
				codeUrl,
				expiresAt: null,
				createdAt: existed.created_at,
			};
		}
	}

	const { pay, mchId, appId, serialNo, notifyUrl } = createWechatPayClient(c);

	const outTradeNo = existed?.out_trade_no || order.order_no;
	const payload = {
		appid: appId,
		mchid: mchId,
		description: `TapCanvas Order ${order.order_no}`,
		out_trade_no: outTradeNo,
		notify_url: notifyUrl,
		amount: {
			total: Number(order.total_amount_cents ?? 0) || 0,
			currency: order.currency || "CNY",
		},
	};
	const requestBody = JSON.stringify(payload);
	const sdkResp = await pay.transactions_native(payload);
	const status = Number(sdkResp?.status ?? 0) || 0;
	const sdkDataRaw = sdkResp?.data;
	const sdkErrorRaw = sdkResp?.error;
	let sdkErrorJson: Record<string, unknown> | null = null;
	if (typeof sdkErrorRaw === "string" && sdkErrorRaw.trim()) {
		try {
			const parsed: unknown = JSON.parse(sdkErrorRaw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				sdkErrorJson = parsed as Record<string, unknown>;
			}
		} catch {
			// keep raw text only
		}
	}
	const sdkData = (sdkDataRaw && typeof sdkDataRaw === "object")
		? (sdkDataRaw as Record<string, unknown>)
		: {};
	const sdkDataText =
		typeof sdkDataRaw === "string"
			? sdkDataRaw
			: sdkDataRaw == null
				? ""
				: JSON.stringify(sdkDataRaw);
	if (status < 200 || status >= 300) {
		console.error("[wechat-pay] create native failed", {
			status,
			orderId: order.id,
			outTradeNo,
			mchId,
			appId,
			serialNo,
			notifyUrl,
			sdkStatusText:
				typeof sdkResp?.statusText === "string" ? sdkResp.statusText : undefined,
			sdkHeaders:
				sdkResp?.header && typeof sdkResp.header === "object"
					? sdkResp.header
					: undefined,
			sdkDataType: typeof sdkDataRaw,
			sdkDataRaw: sdkDataRaw ?? null,
			sdkErrorRaw: sdkErrorRaw ?? null,
			sdkErrorJson,
		});
		throw new AppError("WeChat Native payment create failed", {
			status: 502,
			code: "wechat_native_create_failed",
			details: {
				status,
				body: sdkData,
				rawData: sdkDataText || null,
				rawError: typeof sdkErrorRaw === "string" ? sdkErrorRaw : null,
				errorBody: sdkErrorJson,
				statusText:
					typeof sdkResp?.statusText === "string" ? sdkResp.statusText : null,
				headers:
					sdkResp?.header && typeof sdkResp.header === "object"
						? sdkResp.header
						: null,
				requestPreview: {
					outTradeNo,
					mchId,
					appId,
					serialNo,
					notifyUrl,
				},
			},
		});
	}
	const codeUrl = typeof sdkData.code_url === "string" && sdkData.code_url.trim() ? sdkData.code_url.trim() : "";
	if (!codeUrl) {
		throw new AppError("WeChat Native response missing code_url", {
			status: 502,
			code: "wechat_native_code_url_missing",
			details: sdkData,
		});
	}
	const prepayId = typeof sdkData.prepay_id === "string" ? sdkData.prepay_id : null;
	const responseText = JSON.stringify(sdkData);

	const nowIso = new Date().toISOString();
	const paymentId = existed?.id || crypto.randomUUID();
	if (!existed) {
		await createPayment(c.env.DB, {
			id: paymentId,
			ownerId: input.ownerId,
			orderId: order.id,
			outTradeNo,
			prepayId,
			status: "pending",
			totalAmountCents: Number(order.total_amount_cents ?? 0) || 0,
			currency: order.currency || "CNY",
			rawRequestJson: requestBody,
			rawResponseJson: responseText,
			nowIso,
		});
	}

	return {
		paymentId,
		orderId: order.id,
		orderNo: order.order_no,
		outTradeNo,
		prepayId,
		codeUrl,
		expiresAt: null,
		createdAt: nowIso,
	};
}

export async function getWechatPaymentForOrder(c: AppContext, input: {
	ownerId: string;
	orderId: string;
}) {
	const payment = await getPaymentByOrderId(c.env.DB, input);
	if (!payment) {
		throw new AppError("Payment not found", {
			status: 404,
			code: "payment_not_found",
		});
	}
	return mapPaymentRowToDto(payment);
}

export async function reconcileWechatPaymentForOrder(c: AppContext, input: {
	ownerId: string;
	orderId: string;
}) {
	const order = await getOrderById(c.env.DB, {
		orderId: input.orderId,
		ownerId: input.ownerId,
	});
	if (!order) {
		throw new AppError("Order not found", {
			status: 404,
			code: "order_not_found",
		});
	}
	let payment = await getPaymentByOrderId(c.env.DB, {
		ownerId: input.ownerId,
		orderId: input.orderId,
	});
	const outTradeNo = payment?.out_trade_no || order.order_no;
	if (!payment && order.payment_status === "paid") {
		return {
			orderId: input.orderId,
			outTradeNo,
			paymentStatus: "success" as const,
			orderPaymentStatus: "paid" as const,
			tradeState: "SUCCESS",
			transactionId: null,
		};
	}
	if (payment?.status === "success" || order.payment_status === "paid") {
		return {
			orderId: input.orderId,
			outTradeNo,
			paymentStatus: "success" as const,
			orderPaymentStatus: "paid" as const,
			tradeState: "SUCCESS",
			transactionId: payment?.transaction_id ?? null,
		};
	}

	const { pay, mchId, appId, serialNo } = createWechatPayClient(c);
	const queryResp = await pay.query({ out_trade_no: outTradeNo });
	const status = Number(queryResp?.status ?? 0) || 0;
	const queryDataRaw = queryResp?.data;
	const queryErrorRaw = queryResp?.error;
	let queryErrorJson: Record<string, unknown> | null = null;
	if (typeof queryErrorRaw === "string" && queryErrorRaw.trim()) {
		try {
			const parsed: unknown = JSON.parse(queryErrorRaw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				queryErrorJson = parsed as Record<string, unknown>;
			}
		} catch {
			// keep raw
		}
	}
	if (status < 200 || status >= 300) {
		console.error("[wechat-pay] reconcile query failed", {
			status,
			orderId: input.orderId,
			outTradeNo,
			mchId,
			appId,
			serialNo,
			queryDataRaw: queryDataRaw ?? null,
			queryErrorRaw: queryErrorRaw ?? null,
			queryErrorJson,
		});
		if (status === 404) {
			throw new AppError("Wechat payment not initiated", {
				status: 404,
				code: "wechat_payment_not_initiated",
				details: {
					outTradeNo,
					errorBody: queryErrorJson,
				},
			});
		}
		throw new AppError("WeChat order query failed", {
			status: 502,
			code: "wechat_query_failed",
			details: {
				status,
				rawData: queryDataRaw ?? null,
				rawError: typeof queryErrorRaw === "string" ? queryErrorRaw : null,
				errorBody: queryErrorJson,
				requestPreview: {
					outTradeNo,
					mchId,
					appId,
					serialNo,
				},
			},
		});
	}
	const queryData = (queryDataRaw && typeof queryDataRaw === "object")
		? (queryDataRaw as Record<string, unknown>)
		: {};
	const tradeState = typeof queryData.trade_state === "string" ? queryData.trade_state : null;
	const transactionId = typeof queryData.transaction_id === "string" ? queryData.transaction_id : null;
	if (!payment) {
		payment = await ensureRecoveredPaymentForOrder(c, {
			order,
			outTradeNo,
			prepayId: typeof queryData.prepay_id === "string" ? queryData.prepay_id : null,
			rawResponseJson: JSON.stringify(queryData),
		});
	}

	if (tradeState === "SUCCESS") {
		const amountObj =
			queryData.amount && typeof queryData.amount === "object"
				? (queryData.amount as Record<string, unknown>)
				: {};
		const paidAmountCents = Number(amountObj.total ?? 0) || 0;
		if (paidAmountCents <= 0) {
			throw new AppError("Invalid paid amount from query", {
				status: 400,
				code: "wechat_query_paid_amount_invalid",
				details: {
					outTradeNo: payment.out_trade_no,
					amount: amountObj,
				},
			});
		}
		const nowIso = new Date().toISOString();
		await updatePaymentAsSucceeded(c.env.DB, {
			id: payment.id,
			transactionId: transactionId || payment.transaction_id || "",
			rawResponseJson: JSON.stringify(queryData),
			nowIso,
		});
		await markOrderPaidFromPaymentCallback(c, {
			ownerId: input.ownerId,
			orderId: input.orderId,
			paidAmountCents,
			paymentPayload: {
				source: "active_query",
				outTradeNo: payment.out_trade_no,
				transactionId,
				tradeState,
				queryData,
			},
		});
		return {
			orderId: input.orderId,
			outTradeNo,
			paymentStatus: "success" as const,
			orderPaymentStatus: "paid" as const,
			tradeState,
			transactionId,
		};
	}

	return {
		orderId: input.orderId,
		outTradeNo,
		paymentStatus: "pending" as const,
		orderPaymentStatus: "unpaid" as const,
		tradeState,
		transactionId,
	};
}

export async function handleWechatPaymentCallback(c: AppContext, bodyText: string): Promise<{ code: string; message: string }> {
	const timestamp = c.req.header("wechatpay-timestamp") || "";
	const nonce = c.req.header("wechatpay-nonce") || "";
	const signature = c.req.header("wechatpay-signature") || "";
	const serial = c.req.header("wechatpay-serial") || "";
	if (!timestamp || !nonce || !signature) {
		throw new AppError("Missing wechatpay signature headers", {
			status: 400,
			code: "wechat_callback_header_missing",
		});
	}

	const platformPublicKeyPem = requireEnv(c, "WECHAT_PAY_PLATFORM_PUBLIC_KEY");
	const signatureValid = verifyWechatCallbackSignature({
		platformPublicKeyPem,
		timestamp,
		nonce,
		body: bodyText,
		signature,
	});
	if (!signatureValid) {
		throw new AppError("Wechat callback signature invalid", {
			status: 400,
			code: "wechat_callback_signature_invalid",
			details: { serial },
		});
	}

	let parsed: WechatCallbackBody = {};
	try {
		parsed = JSON.parse(bodyText) as WechatCallbackBody;
	} catch {
		throw new AppError("Invalid callback body json", {
			status: 400,
			code: "wechat_callback_json_invalid",
		});
	}
	const resource = parsed.resource;
	if (!resource?.ciphertext || !resource.nonce) {
		throw new AppError("Invalid callback resource", {
			status: 400,
			code: "wechat_callback_resource_invalid",
		});
	}
	const apiV3Key = requireEnv(c, "WECHAT_PAY_API_V3_KEY");
	const decrypted = decodeWechatResource(
		apiV3Key,
		resource.ciphertext,
		resource.nonce,
		resource.associated_data || "",
	);
	let tx: WechatDecryptTransaction = {};
	try {
		tx = JSON.parse(decrypted) as WechatDecryptTransaction;
	} catch {
		throw new AppError("Failed to parse decrypted transaction", {
			status: 400,
			code: "wechat_callback_decrypt_parse_failed",
			details: { decrypted },
		});
	}
	const outTradeNo = tx.out_trade_no?.trim() || "";
	if (!outTradeNo) {
		throw new AppError("Missing out_trade_no", {
			status: 400,
			code: "wechat_callback_out_trade_no_missing",
		});
	}
	const payment = await getPaymentByOutTradeNo(c.env.DB, { outTradeNo });
	const eventType = parsed.event_type || "UNKNOWN";
	const logCreatedAt = new Date().toISOString();
	await createPaymentCallbackLog(c.env.DB, {
		id: crypto.randomUUID(),
		paymentId: payment?.id || null,
		provider: "wechat",
		eventType,
		outTradeNo: outTradeNo || null,
		transactionId: tx.transaction_id?.trim() || null,
		signatureValid,
		payloadJson: bodyText,
		headersJson: JSON.stringify({
			timestamp,
			nonce,
			signature,
			serial,
		}),
		errorMessage: null,
		createdAt: logCreatedAt,
	});

	let resolvedPayment = payment;
	if (!resolvedPayment) {
		const order = await getOrderByNo(c.env.DB, { orderNo: outTradeNo });
		if (!order) {
			throw new AppError("Payment not found for callback", {
				status: 404,
				code: "payment_not_found",
				details: { outTradeNo },
			});
		}
		resolvedPayment = await ensureRecoveredPaymentForOrder(c, {
			order,
			outTradeNo,
			rawResponseJson: decrypted,
			nowIso: logCreatedAt,
		});
	}
	if (tx.trade_state !== "SUCCESS") {
		return { code: "SUCCESS", message: "OK" };
	}
	if (resolvedPayment.status === "success") {
		return { code: "SUCCESS", message: "OK" };
	}

	const paidAmountCents = Number(tx.amount?.payer_total ?? tx.amount?.total ?? 0) || 0;
	if (paidAmountCents <= 0) {
		throw new AppError("Invalid paid amount from callback", {
			status: 400,
			code: "wechat_callback_paid_amount_invalid",
		});
	}

	await updatePaymentAsSucceeded(c.env.DB, {
		id: resolvedPayment.id,
		transactionId: tx.transaction_id?.trim() || "",
		rawResponseJson: decrypted,
		nowIso: new Date().toISOString(),
	});

	const payloadObj = safeJsonParseObject(decrypted) || {};
	await markOrderPaidFromPaymentCallback(c, {
		ownerId: resolvedPayment.owner_id,
		orderId: resolvedPayment.order_id,
		paidAmountCents,
		paymentPayload: payloadObj,
	});

	return { code: "SUCCESS", message: "OK" };
}
