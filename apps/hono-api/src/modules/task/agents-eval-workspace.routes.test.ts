import { describe, expect, it } from "vitest";

import { isStableEvalAssetUrl } from "./agents-eval-workspace-readiness";

describe("agents eval workspace asset readiness", () => {
  it("accepts stable HTTP(S) asset URLs without credentials or transient suffixes", () => {
    expect(isStableEvalAssetUrl("https://assets.example.com/projects/p1/hero.png")).toBe(true);
    expect(isStableEvalAssetUrl("http://127.0.0.1:9000/assets/scene.webp")).toBe(true);
  });

  it("rejects signed, fragmented, credentialed, or non-HTTP asset references", () => {
    expect(isStableEvalAssetUrl("https://assets.example.com/hero.png?Expires=123")).toBe(false);
    expect(isStableEvalAssetUrl("https://assets.example.com/hero.png#preview")).toBe(false);
    expect(isStableEvalAssetUrl("https://user:secret@assets.example.com/hero.png")).toBe(false);
    expect(isStableEvalAssetUrl("file:///tmp/hero.png")).toBe(false);
    expect(isStableEvalAssetUrl("not-a-url")).toBe(false);
  });
});
