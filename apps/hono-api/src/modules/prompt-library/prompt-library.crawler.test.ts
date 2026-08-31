import { describe, expect, it } from "vitest";
import { readRetryAfterMs, toChinesePromptUrl, toLocaleNeutralPromptUrl } from "./prompt-library.crawler";

describe("toChinesePromptUrl", () => {
	it.each([
		["https://youmind.com/prompts/example-1", "https://youmind.com/zh-CN/prompts/example-1"],
		["https://youmind.com/en-US/prompts/example-1", "https://youmind.com/zh-CN/prompts/example-1"],
		["https://youmind.com/es-419/prompts/example-1", "https://youmind.com/zh-CN/prompts/example-1"],
		["https://youmind.com/ja/prompts/example-1", "https://youmind.com/zh-CN/prompts/example-1"],
	])("normalizes %s", (source, expected) => {
		expect(toChinesePromptUrl(source)).toBe(expected);
	});
});

describe("toLocaleNeutralPromptUrl", () => {
	it("removes only the preferred Chinese locale and clears query state", () => {
		expect(toLocaleNeutralPromptUrl("https://youmind.com/zh-CN/prompts/example-1?from=test#output")).toBe(
			"https://youmind.com/prompts/example-1",
		);
	});
});

describe("readRetryAfterMs", () => {
	it("honors the server retry-after seconds and adds a one-second safety margin", () => {
		const response = new Response(null, { status: 429, headers: { "retry-after": "12" } });
		expect(readRetryAfterMs(response)).toBe(13_000);
	});
});
