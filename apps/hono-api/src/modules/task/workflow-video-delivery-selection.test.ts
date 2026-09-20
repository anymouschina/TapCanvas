import { describe, expect, it } from "vitest";
import { resolveOnlyVideoNodes } from "./workflow-video-delivery-selection";

describe("workflow video delivery selection", () => {
  it("honors both explicit choices over the opposite chapter preference", () => {
    expect(resolveOnlyVideoNodes(true, false)).toBe(true);
    expect(resolveOnlyVideoNodes(false, true)).toBe(false);
  });
  it("inherits only when the invocation does not specify a choice", () => {
    expect(resolveOnlyVideoNodes(undefined, true)).toBe(true);
    expect(resolveOnlyVideoNodes(undefined, false)).toBe(false);
    expect(resolveOnlyVideoNodes(undefined, undefined)).toBe(false);
  });
  it.each([null, "true", 1, {}])("rejects an invalid explicit choice %j", value => {
    expect(() => resolveOnlyVideoNodes(value, false)).toThrow("onlyVideoNodes must be a boolean");
  });
});
