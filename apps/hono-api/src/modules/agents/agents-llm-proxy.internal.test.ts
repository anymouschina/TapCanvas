import { describe, expect, it } from "vitest";

import {
	handleAgentsLlmChatCompletions,
	handleAgentsLlmVideoUnderstand,
} from "./agents-llm-proxy";

describe("generic agents LLM proxy isolation", () => {
	it("retains only the generic chat and video handlers", () => {
		expect(typeof handleAgentsLlmChatCompletions).toBe("function");
		expect(typeof handleAgentsLlmVideoUnderstand).toBe("function");
	});
});
