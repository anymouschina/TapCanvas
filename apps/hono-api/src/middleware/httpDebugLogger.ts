import type { Next } from "hono";
import type { AppContext } from "../types";
import {
	getHttpDebugLogBodyLimit,
	isHttpDebugLogEnabled,
	logDownstreamHttpTransaction,
	readBodySnippetForLog,
} from "../httpDebugLog";

export async function httpDebugLoggerMiddleware(c: AppContext, next: Next) {
	if (!isHttpDebugLogEnabled(c)) {
		return next();
	}

	const startedAt = Date.now();
	const limit = getHttpDebugLogBodyLimit(c);

	let requestBody: {
		body: unknown;
		truncated: boolean;
		contentType: string | null;
	} | null = null;

	try {
		// clone request so downstream can still read it normally
		const reqClone = c.req.raw.clone();
		const ct = reqClone.headers.get("content-type");
		// avoid attempting to parse huge/non-text payloads
		const contentLength = Number(reqClone.headers.get("content-length") || 0);
		const shouldRead =
			!Number.isFinite(contentLength) ||
			contentLength <= 0 ||
			contentLength <= limit;
		if (shouldRead) {
			requestBody = await readBodySnippetForLog(c, reqClone, limit).catch(() => null);
			if (!requestBody) {
				requestBody = { body: null, truncated: false, contentType: ct };
			}
		} else {
			requestBody = { body: null, truncated: true, contentType: ct };
		}
	} catch {
		requestBody = null;
	}

	await next();

	await logDownstreamHttpTransaction({
		c,
		startedAt,
		requestBody,
	});
}
