import { describe, expect, it } from "vitest";

import { parseMaterialAssetKind } from "./material.repo";

describe("material asset kind DTO mapping", () => {
  it.each(["character", "scene", "prop", "style", "text", "ensemble", "pose", "voice"] as const)(
    "保真映射数据库 kind=%s",
    (kind) => {
      expect(parseMaterialAssetKind(kind)).toBe(kind);
    },
  );

  it("未知 kind 显式失败，不伪装成 prop", () => {
    expect(() => parseMaterialAssetKind("unknown-kind")).toThrow(
      "material_asset_kind_invalid: unknown-kind",
    );
  });
});
