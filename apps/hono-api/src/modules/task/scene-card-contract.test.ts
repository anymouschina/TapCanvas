import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { sceneLightingSpecToolSchema } from "../ai/tool-schemas";

describe("scene-card single-track contract", () => {
  it("exposes physical lighting facts without an emotion-to-light lookup", () => {
    expect(sceneLightingSpecToolSchema.properties.version.enum).toEqual(["scene-lighting/v1"]);
    expect(sceneLightingSpecToolSchema.required).toEqual(
      expect.arrayContaining([
        "keySource",
        "direction",
        "colorTemperature",
        "lightQuality",
        "shadowBehavior",
        "reflectiveBehavior",
        "continuityLocks",
      ]),
    );
    expect(sceneLightingSpecToolSchema.properties).not.toHaveProperty("moodPreset");
    expect(sceneLightingSpecToolSchema.properties).not.toHaveProperty("cinematicPreset");
  });

  it("documents the authoritative scene and lighting workflow in agents-cli", async () => {
    const skillDoc = await fs.readFile(
      path.resolve(process.cwd(), "../agents-cli/skills/tapcanvas-scene-card/SKILL.md"),
      "utf8",
    );

    expect(skillDoc).toContain("场景视觉身份、空间设计和场景灯光的唯一方法论来源");
    expect(skillDoc).toContain("scene-card/v1");
    expect(skillDoc).toContain("scene-lighting/v1");
    expect(skillDoc).toContain("情绪不是光源");
    expect(skillDoc).toContain("不再使用“兼容模式 / 借鉴模式”两套固定前缀");
    expect(skillDoc).not.toContain("现代都市  | 手机、高铁");
  });
});
