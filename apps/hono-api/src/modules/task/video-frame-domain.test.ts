import { describe, expect, it } from "vitest";
import { projectVideoAspectRatio } from "./video-frame-domain";

/**
 * Regression contract for the chapter-wide video submission failure
 * `unsupported Dola ratio "1280x720"`: a size token must never survive into the
 * provider's `aspect_ratio` field.
 */
describe("projectVideoAspectRatio", () => {
	it("resolves a declared size token through its own declared ratio", () => {
		const projection = projectVideoAspectRatio({
			requested: "1280x720",
			sizeOptions: [
				{ value: "1280x720", aspectRatio: "16:9" },
				{ value: "720x1280", aspectRatio: "9:16" },
			],
		});

		expect(projection).toEqual({ kind: "resolved", aspectRatio: "16:9" });
	});

	it("keeps an already-reduced ratio", () => {
		const projection = projectVideoAspectRatio({
			requested: "9:16",
			sizeOptions: [{ value: "9:16", aspectRatio: "9:16" }],
		});

		expect(projection).toEqual({ kind: "resolved", aspectRatio: "9:16" });
	});

	it("reduces a stale pixel size against a ratio-only catalog", () => {
		const projection = projectVideoAspectRatio({
			requested: "1920x1080",
			sizeOptions: [
				{ value: "16:9", aspectRatio: "16:9" },
				{ value: "9:16", aspectRatio: "9:16" },
			],
		});

		expect(projection).toEqual({ kind: "resolved", aspectRatio: "16:9" });
	});

	it("reports a size token the model does not offer instead of forwarding it", () => {
		const projection = projectVideoAspectRatio({
			requested: "1024x768",
			sizeOptions: [
				{ value: "16:9", aspectRatio: "16:9" },
				{ value: "1:1", aspectRatio: "1:1" },
			],
		});

		expect(projection).toEqual({
			kind: "unresolved",
			reason: "size_token_in_ratio_field",
			requested: "1024x768",
		});
	});

	it("leaves an unclassified token unchanged", () => {
		const projection = projectVideoAspectRatio({
			requested: "auto",
			sizeOptions: [{ value: "16:9", aspectRatio: "16:9" }],
		});

		expect(projection).toEqual({ kind: "resolved", aspectRatio: "auto" });
	});

	it("treats an absent ratio as absent rather than inventing one", () => {
		expect(projectVideoAspectRatio({ requested: "   ", sizeOptions: [] }))
			.toEqual({ kind: "resolved", aspectRatio: "" });
		expect(projectVideoAspectRatio({ requested: undefined, sizeOptions: [] }))
			.toEqual({ kind: "resolved", aspectRatio: "" });
	});

	it("still reduces a pixel size when no catalog is available", () => {
		const projection = projectVideoAspectRatio({
			requested: "1280x720",
			sizeOptions: [],
		});

		expect(projection).toEqual({ kind: "resolved", aspectRatio: "16:9" });
	});
});
