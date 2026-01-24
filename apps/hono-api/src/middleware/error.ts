import type { Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "../types";

export class AppError extends Error {
	status: number;
	code: string;
	details?: unknown;

	constructor(message: string, options?: { status?: number; code?: string; details?: unknown }) {
		super(message);
		this.name = "AppError";
		this.status = options?.status ?? 400;
		this.code = options?.code ?? "bad_request";
		this.details = options?.details;
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
} {
	if (!isRecord(err)) return false;
	return err.name === "AppError" || (typeof err.status === "number" && typeof err.code === "string");
}

export async function errorMiddleware(c: AppContext, next: Next) {
	try {
		await next();
	} catch (err) {
		// NOTE:
		// In some bundling/dev setups, `instanceof AppError` can fail due to module duplication.
		// Fallback to a shape-based check so upstream/vendor errors keep their intended HTTP status.
		if (err instanceof AppError || isAppErrorLike(err)) {
			const anyErr = err as any;
			const status = normalizeHttpStatus(anyErr?.status, 400);
			const code =
				typeof anyErr?.code === "string" && anyErr.code.trim()
					? anyErr.code
					: "bad_request";
			const message =
				typeof anyErr?.message === "string" && anyErr.message.trim()
					? anyErr.message
					: "Bad Request";

			return c.json(
				{
					// 兼容前端：同时提供 message 和 error 字段
					message,
					error: message,
					code,
					details: anyErr?.details,
				},
				status,
			);
		}

		console.error("Unhandled error", err);

		const anyErr = err as any;
		const message =
			anyErr && typeof anyErr.message === "string"
				? anyErr.message
				: "Internal Server Error";

		return c.json(
			{
				// 与 AppError 保持结构一致
				message,
				error: "Internal Server Error",
				code: "internal_error",
				details: {
					name:
						anyErr && typeof anyErr.name === "string"
							? anyErr.name
							: undefined,
					stack:
						anyErr && typeof anyErr.stack === "string"
							? anyErr.stack
							: undefined,
				},
			},
			500,
		);
	}
}
