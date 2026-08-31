import type { IncomingMessage } from "node:http";

export function readWebSocketSessionToken(request: IncomingMessage): string | null {
	const cookieHeader = request.headers.cookie;
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const entry = part.trim();
		const separator = entry.indexOf("=");
		if (separator <= 0) continue;
		if (entry.slice(0, separator).trim() !== "tap_token") continue;
		const encoded = entry.slice(separator + 1).trim();
		if (!encoded) return null;
		try {
			return decodeURIComponent(encoded);
		} catch {
			return null;
		}
	}
	return null;
}
