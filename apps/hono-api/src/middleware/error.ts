import type { Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "../types";

export class AppError extends Error {
	status: number;
	code: string;
	details?: unknown;
	terminal?: boolean;
	severity?: "warning" | "error";

	constructor(
		message: string,
		options?: {
			status?: number;
			code?: string;
			details?: unknown;
			terminal?: boolean;
			severity?: "warning" | "error";
		},
	) {
		super(message);
		this.name = "AppError";
		this.status = options?.status ?? 400;
		this.code = options?.code ?? "bad_request";
		this.details = options?.details;
		// Application errors describe one failed tool action, not the end of the
		// agent's user-level goal. Only a caller with positive terminal evidence
		// (for example an upstream task's final hard failure) may opt into true.
		this.terminal = options?.terminal ?? false;
		this.severity = options?.severity;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function normalizeHttpStatus(value: unknown, fallback: ContentfulStatusCode): ContentfulStatusCode {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	const status = Math.trunc(n);
	if (status < 400 || status > 599) return fallback;
	return status as ContentfulStatusCode;
}

function isAppErrorLike(err: unknown): err is {
	name?: unknown;
	message?: unknown;
	status?: unknown;
	code?: unknown;
	details?: unknown;
	terminal?: unknown;
	severity?: unknown;
} {
	if (!isRecord(err)) return false;
	return err.name === "AppError" || (typeof err.status === "number" && typeof err.code === "string");
}

export function honoErrorHandler(err: unknown, c: AppContext) {
	// NOTE:
	// In some bundling/dev setups, `instanceof AppError` can fail due to module duplication.
	// Fallback to a shape-based check so upstream/vendor errors keep their intended HTTP status.
	if (err instanceof AppError || isAppErrorLike(err)) {
		const errorRecord = err as Record<string, unknown>;
		const status = normalizeHttpStatus(errorRecord.status, 400);
		const code =
			typeof errorRecord.code === "string" && errorRecord.code.trim()
				? errorRecord.code
				: "bad_request";
		const message =
			typeof errorRecord.message === "string" && errorRecord.message.trim()
				? errorRecord.message
				: "Bad Request";
		const terminal = errorRecord.terminal === true;
		const severity = errorRecord.severity === "warning" || errorRecord.severity === "error"
			? errorRecord.severity
			: undefined;

		return c.json(
			{
				// 兼容前端：同时提供 message 和 error 字段
				message,
				error: message,
				code,
				details: errorRecord.details,
				terminal,
				...(severity ? { severity } : {}),
			},
			status,
		);
	}

	console.error("Unhandled error", err);
	const requestId = c.get("requestId")?.trim() || null;
	const message = "服务内部错误";

	return c.json(
		{
			// 与 AppError 保持结构一致
			message,
			error: message,
			code: "internal_error",
			details: requestId ? { requestId } : undefined,
			terminal: false,
		},
		500,
	);
}

export async function errorMiddleware(c: AppContext, next: Next) {
	try {
		await next();
	} catch (err) {
		return honoErrorHandler(err, c);
	}
}
