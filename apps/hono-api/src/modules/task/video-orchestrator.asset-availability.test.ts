import { describe, expect, it } from "vitest";

import { isExplicitlyRejectedAsset } from "./video-orchestrator.asset-availability";

describe("authoring asset availability", () => {
  it("treats only the explicit rejected state as unusable", () => {
    expect(isExplicitlyRejectedAsset({ approvalStatus: "rejected" })).toBe(true);
    expect(isExplicitlyRejectedAsset({ approvalStatus: " rejected " })).toBe(true);
    expect(isExplicitlyRejectedAsset({ approvalStatus: "approved" })).toBe(false);
    expect(isExplicitlyRejectedAsset({ approvalStatus: "needs_confirmation" })).toBe(false);
    expect(isExplicitlyRejectedAsset({})).toBe(false);
  });
});
