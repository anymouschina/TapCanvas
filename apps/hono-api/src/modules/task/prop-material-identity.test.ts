import { describe, expect, it } from "vitest";

import {
  parsePropMaterialIdentity,
  readPropMaterialIdentity,
  selectCanonicalPropBaseImageUrl,
} from "./prop-material-identity";

describe("parsePropMaterialIdentity", () => {
  it("accepts a canonical base prop identity", () => {
    expect(
      parsePropMaterialIdentity({ mode: "base", canonicalName: "混元金斗" }),
    ).toEqual({
      ok: true,
      value: { mode: "base", canonicalName: "混元金斗" },
    });
  });

  it("requires complete canonical evidence for a prop state", () => {
    expect(
      parsePropMaterialIdentity({
        mode: "state",
        canonicalName: "混元金斗",
        canonicalAssetId: "asset-1",
        stateKey: "clear-light",
        stateDescription: "释放清光",
      }),
    ).toEqual({
      ok: true,
      value: {
        mode: "state",
        canonicalName: "混元金斗",
        canonicalAssetId: "asset-1",
        stateKey: "clear-light",
        stateDescription: "释放清光",
      },
    });
    expect(
      parsePropMaterialIdentity({ mode: "state", canonicalName: "混元金斗" }),
    ).toEqual({
      ok: false,
      error: "state materialIdentity.canonicalAssetId 必填",
    });
  });
});

describe("selectCanonicalPropBaseImageUrl", () => {
  it("selects the latest real unstate version and never falls back to a state image", () => {
    expect(
      selectCanonicalPropBaseImageUrl([
        {
          version: 3,
          data: {
            imageUrl: "https://cdn.test/state.png",
            stateKey: "clear-light",
          },
        },
        { version: 2, data: { imageUrl: "https://cdn.test/base-2.png" } },
        { version: 1, data: { imageUrl: "https://cdn.test/base-1.png" } },
      ]),
    ).toBe("https://cdn.test/base-2.png");
    expect(
      selectCanonicalPropBaseImageUrl([
        {
          version: 1,
          data: {
            imageUrl: "https://cdn.test/state-only.png",
            stateKey: "clear-light",
          },
        },
      ]),
    ).toBeNull();
  });
});

describe("readPropMaterialIdentity", () => {
  it("returns null instead of inventing identity from a display label", () => {
    expect(
      readPropMaterialIdentity({ label: "道具卡｜混元金斗清光" }),
    ).toBeNull();
  });
});
