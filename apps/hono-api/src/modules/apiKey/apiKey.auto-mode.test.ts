import { describe, expect, it } from "vitest";

import { resolvePublicChatAutoModeBehavior } from "./apiKey.routes";

describe("agents chat auto mode routing", () => {
	it("treats explicit auto mode as agents auto without local semantic gating", () => {
		expect(
			resolvePublicChatAutoModeBehavior({
				mode: "auto",
				vendor: "auto",
			}),
		).toBe("agents_auto");
	});

	it("keeps non-auto requests on normal chat mode", () => {
		expect(
			resolvePublicChatAutoModeBehavior({
				mode: "chat",
				vendor: "auto",
			}),
		).toBe("chat");
	});
});
