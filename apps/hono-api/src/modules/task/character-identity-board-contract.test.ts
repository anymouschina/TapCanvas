import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { characterIdentityBoardSpecToolSchema } from "../ai/tool-schemas";
import { CharacterIdentityBoardSpecSchema } from "./character-identity-board-contract";
import * as imageGenerationRuntime from "./agents-tool-bridge.generate-image-to-canvas";

const completeIdentityBoard = {
  layout: "identity_board_four_view",
  faceViews: ["front", "three_quarter"],
  fullBodyViews: ["front", "back"],
  crossViewConsistency: true,
  referenceRoleIsolation: true,
  neutralReferenceBackground: true,
  readableTextVisible: false,
  brandingVisible: false,
  neutralBaseState: true,
  canonicalNameVisible: false,
  ipSafeOriginal: true,
} as const;

describe("CharacterIdentityBoardSpecSchema", () => {
  it("accepts the source-grounded four-view identity board", () => {
    expect(CharacterIdentityBoardSpecSchema.safeParse(completeIdentityBoard).success).toBe(true);
  });

  it("rejects removed style and body defaults instead of preserving a legacy branch", () => {
    const result = CharacterIdentityBoardSpecSchema.safeParse({
      ...completeIdentityBoard,
      bodyProportion: "nine_head_supermodel",
      renderingMode: "photorealistic_studio_photography",
      lens: "85mm_portrait",
    });
    expect(result.success).toBe(false);
  });

  it("rejects the retired four-view animation research board", () => {
    const result = CharacterIdentityBoardSpecSchema.safeParse({
      layout: "character_identity_board",
      heroView: "three_quarter_full_body",
      fullBodyViews: ["front", "back", "left", "right"],
      faceCloseups: ["front", "three_quarter", "profile"],
      detailStudies: ["hair", "costume", "material"],
      expressionStudies: 3,
      neutralBaseState: true,
      canonicalNameVisible: false,
      ipSafeOriginal: true,
    });
    expect(result.success).toBe(false);
  });

  it("requires face and full-body views in their canonical order", () => {
    const reversedFaceResult = CharacterIdentityBoardSpecSchema.safeParse({
      ...completeIdentityBoard,
      faceViews: ["three_quarter", "front"],
    });
    const duplicateResult = CharacterIdentityBoardSpecSchema.safeParse({
      ...completeIdentityBoard,
      fullBodyViews: ["front", "front"],
    });
    const reversedResult = CharacterIdentityBoardSpecSchema.safeParse({
      ...completeIdentityBoard,
      fullBodyViews: ["back", "front"],
    });
    expect(reversedFaceResult.success).toBe(false);
    expect(duplicateResult.success).toBe(false);
    expect(reversedResult.success).toBe(false);
  });

  it("requires canonical binding names to remain invisible in the rendered board", () => {
    const result = CharacterIdentityBoardSpecSchema.safeParse({
      ...completeIdentityBoard,
      canonicalNameVisible: true,
    });
    expect(result.success).toBe(false);
  });

  it("does not expose a Hono runtime quality gate for identity-board generation", () => {
    expect(imageGenerationRuntime).not.toHaveProperty("assertCharacterIdentityBoardContract");
  });

  it("keeps the model-visible tool schema aligned with the runtime contract", () => {
    expect(characterIdentityBoardSpecToolSchema.properties.layout.enum).toEqual([
      "identity_board_four_view",
    ]);
    expect(characterIdentityBoardSpecToolSchema.properties.faceViews.items.enum).toEqual([
      "front",
      "three_quarter",
    ]);
    expect(characterIdentityBoardSpecToolSchema.properties.fullBodyViews.items.enum).toEqual([
      "front",
      "back",
    ]);
    expect(characterIdentityBoardSpecToolSchema.properties).not.toHaveProperty("bodyProportion");
    expect(characterIdentityBoardSpecToolSchema.properties).not.toHaveProperty("renderingMode");
    expect(characterIdentityBoardSpecToolSchema.properties).not.toHaveProperty("lens");
    expect(characterIdentityBoardSpecToolSchema.required).toEqual(
      expect.arrayContaining([
        "faceViews",
        "crossViewConsistency",
        "referenceRoleIsolation",
        "neutralReferenceBackground",
        "readableTextVisible",
        "brandingVisible",
      ]),
    );
  });

  it("documents the single-track source-grounded contract in the authoritative agents skill", async () => {
    const skillDoc = await fs.readFile(
      path.resolve(
        process.cwd(),
        "../agents-cli/skills/tapcanvas-character-card/SKILL.md",
      ),
      "utf8",
    );

    expect(skillDoc).toContain("角色卡生成方法论的唯一权威");
    expect(skillDoc).toContain("identity_board_four_view");
    expect(skillDoc).toContain("正面脸、3/4 脸、正面全身、背面全身");
    expect(skillDoc).toContain("参考图各自只负责身份、布局、内容或风格");
    expect(skillDoc).toContain("不强制九头身、真人写实、特定镜头焦段");
    expect(skillDoc).not.toContain("活人感随机池");
    expect(skillDoc).not.toContain("same face / sibling resemblance");
  });
});
