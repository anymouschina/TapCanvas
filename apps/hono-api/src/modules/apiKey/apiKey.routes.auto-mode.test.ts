import { describe, expect, it } from "vitest";

import { resolvePublicChatAutoModeBehavior } from "./apiKey.routes";

describe("agents chat auto mode prompt gating", () => {
	it("treats plain public auto requests as agents auto without local execution heuristics", () => {
		expect(
			resolvePublicChatAutoModeBehavior({
				mode: "auto",
				vendor: "auto",
			}),
		).toBe("agents_auto");
	});
});
