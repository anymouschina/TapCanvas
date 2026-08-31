import { describe, expect, it } from "vitest";

import { getProfile, listProfiles } from "./profile-library.service";

const VALID_TONES = new Set(["clean-real", "cinematic", "anime", ""]);

describe("profile-library 真实 profiles.json 守护", () => {
  it("每档 styleTone 必须 ∈ 合法枚举(防 toProfileDto 静默接受非法 tone)", async () => {
    const profiles = await listProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    for (const p of profiles) {
      expect(VALID_TONES.has(p.styleTone), `${p.id} 的 styleTone=${p.styleTone} 非法`).toBe(true);
    }
  });

  it("default 档保持 styleTone='' (未命中→等价现状的零回归根因，绝不可设具体 tone)", async () => {
    const profiles = await listProfiles();
    const def = profiles.find((p) => p.id === "default");
    expect(def?.styleTone).toBe("");
  });

  it("fashion 档已加入且字段完整(P0-4)", async () => {
    const fashion = await getProfile("fashion");
    expect(fashion).toBeDefined();
    expect(fashion!.styleTone).toBe("cinematic");
    expect(fashion!.stageOverridesRef).toBe("fashion.md");
    // recipeBias 必须引用真实存在的 recipe
    expect(fashion!.recipeBias).toContain("editorial-8panel");
    expect(fashion!.recipeBias.length).toBeGreaterThan(0);
    // 时尚=穿搭编辑、非单品带货
    expect(fashion!.signals?.isProduct).toBe(false);
  });
});
