import { describe, expect, it } from "vitest";

import { normalizeImageEditRequestKind } from "./apiKey.routes";

describe("normalizeImageEditRequestKind", () => {
	it("rewrites gpt-image-2 image_edit requests to text_to_image even when reference images exist", () => {
		const normalized = normalizeImageEditRequestKind({
			kind: "image_edit",
			model: "gpt-image-2",
			prompt: "填充海绵宝宝",
			extras: {
				referenceImages: ["https://example.com/base.png"],
				aspectRatio: "16:9",
			},
		});

		expect(normalized.kind).toBe("text_to_image");
		expect(normalized.extras.referenceImages).toEqual(["https://example.com/base.png"]);
	});

	it("keeps non-gpt-image-2 edits as image_edit when edit sources exist", () => {
		const normalized = normalizeImageEditRequestKind({
			kind: "image_edit",
			model: "nano-banana-pro",
			prompt: "edit image",
			extras: {
				referenceImages: ["https://example.com/base.png"],
			},
		});

		expect(normalized.kind).toBe("image_edit");
	});
});
