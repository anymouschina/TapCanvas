import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  propFunctionSpecToolSchema,
  propIdentityBoardSpecToolSchema,
} from "../ai/tool-schemas";

describe("prop-card single-track contract", () => {
  it("exposes functional geometry without fixed presentation or provider presets", () => {
    expect(propIdentityBoardSpecToolSchema.properties.version.enum).toEqual(["prop-board/v1"]);
    expect(propIdentityBoardSpecToolSchema.properties.viewRoles.minItems).toBe(1);
    expect(propIdentityBoardSpecToolSchema.properties.viewRoles).not.toHaveProperty("maxItems");
    expect(propIdentityBoardSpecToolSchema.properties).not.toHaveProperty("panelCount");
    expect(propIdentityBoardSpecToolSchema.properties).not.toHaveProperty("xrayRequired");
    expect(propIdentityBoardSpecToolSchema.properties).not.toHaveProperty("aspectRatio");
    expect(propIdentityBoardSpecToolSchema.properties).not.toHaveProperty("provider");

    expect(propFunctionSpecToolSchema.properties.version.enum).toEqual(["prop-function/v1"]);
    expect(propFunctionSpecToolSchema.required).toEqual(
      expect.arrayContaining([
        "physicalEnvelope",
        "orientationAnchors",
        "interactionAnchors",
        "supportAndForcePaths",
        "movingParts",
        "materialBehaviors",
        "continuityLocks",
      ]),
    );
    expect(propFunctionSpecToolSchema.properties).not.toHaveProperty("qualityScore");
    expect(propFunctionSpecToolSchema.properties).not.toHaveProperty("minimumPromptCharacters");
  });

  it("documents the canonical prop workflow in agents-cli", async () => {
    const skillDoc = await fs.readFile(
      path.resolve(process.cwd(), "../agents-cli/skills/tapcanvas-prop-card/SKILL.md"),
      "utf8",
    );

    expect(skillDoc).toContain("canonical 道具身份、可交互结构和状态版本的唯一方法论");
    expect(skillDoc).toContain("prop-card/v1");
    expect(skillDoc).toContain("prop-board/v1");
    expect(skillDoc).toContain("prop-function/v1");
    expect(skillDoc).toContain("固定三格、固定 4:3、强制文字标签");
    expect(skillDoc).toContain("materialIdentity.mode=\"state\"");
  });
});
