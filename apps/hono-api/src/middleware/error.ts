import type { Next } from "hono";
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

export async function errorMiddleware(c: AppContext, next: Next) {
	try {
		await next();
	} catch (err) {
		if (err instanceof AppError) {
			return c.json(
				{
					// 兼容前端：同时提供 message 和 error 字段
					message: err.message,
					error: err.message,
					code: err.code,
					details: err.details,
				},
				err.status,
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
