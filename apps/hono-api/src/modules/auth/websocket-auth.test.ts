import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { readWebSocketSessionToken } from "./websocket-auth";

function requestWithCookie(cookie?: string): IncomingMessage {
	return { headers: cookie ? { cookie } : {} } as unknown as IncomingMessage;
}

describe("readWebSocketSessionToken", () => {
	it("reads the HttpOnly session from the upgrade Cookie header", () => {
		expect(readWebSocketSessionToken(requestWithCookie("a=1; tap_token=jwt%2Evalue; b=2"))).toBe("jwt.value");
	});

	it("does not accept absent or malformed session cookies", () => {
		expect(readWebSocketSessionToken(requestWithCookie())).toBeNull();
		expect(readWebSocketSessionToken(requestWithCookie("tap_token=%E0%A4%A"))).toBeNull();
	});
});
