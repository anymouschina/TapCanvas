import { describe, expect, it } from "vitest";
import { buildPromptMediaObjectKey } from "./prompt-library.media-hosting";

describe("buildPromptMediaObjectKey", () => {
	it("creates a stable R2 key per source URL and role", () => {
		const sourceUrl = "https://cdn.example.com/output/example.mp4?token=one";
		const first = buildPromptMediaObjectKey({ sourceUrl, kind: "video", role: "media" });
		const second = buildPromptMediaObjectKey({ sourceUrl, kind: "video", role: "media" });
		expect(first).toBe(second);
		expect(first).toMatch(/^prompt-library\/media\/video\/[a-f0-9]{64}$/);
		expect(buildPromptMediaObjectKey({ sourceUrl, kind: "image", role: "thumbnail" })).not.toBe(first);
	});
});
