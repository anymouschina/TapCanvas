import { describe, expect, it } from "vitest";
import type { AppContext } from "../../types";
import { readApiKeyFromRequest } from "./apiKey-auth-resolver";

function createContext(headers: Readonly<Record<string, string>>): AppContext {
	return {
		req: {
			header: (name: string) => headers[name.toLowerCase()],
		} as unknown as AppContext["req"],
	} as unknown as AppContext;
}

describe("readApiKeyFromRequest", () => {
	it("accepts a signed internal delegation carried as a Bearer credential", () => {
		const credential = "tc_internal:v2:payload:signature";
		const context = createContext({ authorization: `Bearer ${credential}` });

		expect(readApiKeyFromRequest(context)).toBe(credential);
	});

	it("does not reinterpret an ordinary JWT as an API key", () => {
		const context = createContext({ authorization: "Bearer header.payload.signature" });

		expect(readApiKeyFromRequest(context)).toBeNull();
	});
});
