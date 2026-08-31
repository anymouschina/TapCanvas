import { describe, expect, it } from "vitest";

import {
	AgentObservabilityRequestError,
	decodeAgentTraceCursor,
	encodeAgentTraceCursor,
} from "./agent-observability.service";

describe("agent observability trace cursor", () => {
	it("round-trips a root trace cursor", () => {
		const cursor = {
			startedAt: "2026-08-01T00:00:00.000Z",
			id: "trace-root-1",
		};
		expect(decodeAgentTraceCursor(encodeAgentTraceCursor(cursor))).toEqual(cursor);
	});

	it("fails explicitly for malformed or incomplete cursors", () => {
		expect(() => decodeAgentTraceCursor("not-json")).toThrow(AgentObservabilityRequestError);
		expect(() => decodeAgentTraceCursor("not-json")).toThrow(/cursor is invalid/);
		const missingId = Buffer.from(JSON.stringify({
			startedAt: "2026-08-01T00:00:00.000Z",
		}), "utf8").toString("base64url");
		expect(() => decodeAgentTraceCursor(missingId)).toThrow(/cursor is invalid/);
	});
});
