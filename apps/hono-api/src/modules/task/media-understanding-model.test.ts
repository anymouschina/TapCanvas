import { describe, expect, it } from "vitest";
import { resolveImageUnderstandingModelKey } from "./media-understanding-model";

describe("deployment image understanding model", () => {
	it("uses the explicitly configured model without substituting another model", () => {
		expect(resolveImageUnderstandingModelKey(" gemini-3.8-flash ")).toBe("gemini-3.8-flash");
		expect(resolveImageUnderstandingModelKey("configured-vision-model")).toBe("configured-vision-model");
	});
	it("rejects empty explicit configuration instead of silently changing models", () => {
		expect(() => resolveImageUnderstandingModelKey(" ")).toThrow("must not be empty");
	});
	it("retains the established model when the environment has no override", () => {
		expect(resolveImageUnderstandingModelKey(undefined)).toBe("doubao-seed-2-1-turbo-260628");
	});
});
