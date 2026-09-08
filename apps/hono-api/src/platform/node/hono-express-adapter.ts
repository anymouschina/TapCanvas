import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv, WorkerEnv } from "../../types";

type HonoLike = Pick<OpenAPIHono<AppEnv>, "fetch">;
type HonoExecutionContext = NonNullable<Parameters<HonoLike["fetch"]>[2]>;

type ExpressLikeRequest = {
	headers?: Record<string, string | string[] | undefined>;
	protocol?: string;
	originalUrl?: string;
	url?: string;
	method?: string;
};

type ExpressLikeResponse = {
	statusCode: number;
	headersSent?: boolean;
	writableEnded?: boolean;
	setHeader: (name: string, value: string | string[]) => void;
	write: (chunk: Uint8Array) => boolean;
	end: (chunk?: string | Uint8Array) => void;
	once: (
		event: "drain" | "close" | "error",
		listener: (error?: Error) => void,
	) => void;
	off: (
		event: "drain" | "close" | "error",
		listener: (error?: Error) => void,
	) => void;
};

type AsyncRequestBody = AsyncIterable<unknown> & {
	destroy?: () => void;
};

function isAsyncRequestBody(value: unknown): value is AsyncRequestBody {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { [Symbol.asyncIterator]?: unknown };
	return typeof candidate[Symbol.asyncIterator] === "function";
}

function toRequestBodyChunk(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (typeof value === "string") return new TextEncoder().encode(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	throw new TypeError("Unsupported Node request body chunk");
}

function buildRequestBody(req: ExpressLikeRequest): ReadableStream<Uint8Array> {
	if (!isAsyncRequestBody(req)) {
		throw new TypeError("Express request body is not an async iterable stream");
	}
	const iterator = req[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) {
					controller.close();
					return;
				}
				controller.enqueue(toRequestBodyChunk(next.value));
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel() {
			await iterator.return?.();
			req.destroy?.();
		},
	});
}

function hasResponseStarted(res: ExpressLikeResponse): boolean {
	return Boolean(res.headersSent || res.writableEnded);
}

function waitForResponseDrain(res: ExpressLikeResponse): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			res.off("drain", onDrain);
			res.off("close", onClose);
			res.off("error", onError);
		};
		const settle = (complete: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			complete();
		};
		const onDrain = () => settle(resolve);
		const onClose = () =>
			settle(() => reject(new Error("Client closed while response was backpressured")));
		const onError = (error?: Error) =>
			settle(() => reject(error ?? new Error("Response stream failed")));

		res.once("drain", onDrain);
		res.once("close", onClose);
		res.once("error", onError);
	});
}

function buildRequestFromExpress(req: ExpressLikeRequest): Request {
	const host = String(req.headers?.host || "localhost");
	const proto = String(req.protocol || "http");
	const url = new URL(String(req.originalUrl || req.url || "/"), `${proto}://${host}`);

	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers || {})) {
		if (typeof value === "undefined") continue;
		if (Array.isArray(value)) {
			value.forEach((v) => headers.append(key, String(v)));
			continue;
		}
		headers.set(key, String(value));
	}

	const method = String(req.method || "GET").toUpperCase();
	const hasBody = !(method === "GET" || method === "HEAD");
	const requestInit: RequestInit & { duplex?: "half" } = {
		method,
		headers,
		...(hasBody ? { body: buildRequestBody(req), duplex: "half" } : {}),
	};

	return new Request(url, requestInit);
}

async function writeResponseToExpress(
	res: ExpressLikeResponse,
	response: Response,
): Promise<void> {
	res.statusCode = response.status;

	const setCookies =
		typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
		"function"
			? (
					response.headers as Headers & {
						getSetCookie: () => string[];
					}
				).getSetCookie()
			: [];
	if (Array.isArray(setCookies) && setCookies.length) {
		res.setHeader("Set-Cookie", setCookies);
	}

	response.headers.forEach((value, key) => {
		if (key.toLowerCase() === "set-cookie") return;
		res.setHeader(key, value);
	});

	if (!response.body) {
		res.end();
		return;
	}

	const reader = response.body.getReader();
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		if (!res.write(chunk.value)) {
			await waitForResponseDrain(res);
		}
	}
	res.end();
}

export function mountHonoToExpress(
	expressApp: { use: (handler: (req: ExpressLikeRequest, res: ExpressLikeResponse) => Promise<void>) => void },
	honoApp: HonoLike,
	env: WorkerEnv,
): void {
	// Delegate everything to Hono (keep existing routes/OpenAPI/docs intact).
	expressApp.use(async (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
		try {
			const request = buildRequestFromExpress(req);
			const ctx = {
				waitUntil: (p: Promise<unknown>) => {
					p.catch((err) => {
						// eslint-disable-next-line no-console
						console.warn("[api] waitUntil rejected", err);
					});
				},
				passThroughOnException: () => undefined,
				props: undefined,
			} satisfies HonoExecutionContext;
			const response = await honoApp.fetch(request, env, ctx);
			await writeResponseToExpress(res, response);
		} catch (err) {
			// If headers/body were already started, the original error must be logged,
			// but we must not try to send a second response.
			if (hasResponseStarted(res)) {
				// eslint-disable-next-line no-console
				console.error("[api] response failed after headers sent", err);
				return;
			}
			res.statusCode = 500;
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			res.end(
				JSON.stringify({
					error: "internal_error",
					message: err instanceof Error ? err.message : String(err),
				}),
			);
		}
	});
}
