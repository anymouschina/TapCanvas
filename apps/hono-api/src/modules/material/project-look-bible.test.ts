import { describe, expect, it } from "vitest";
import {
  buildProjectLookBibleImagePrompt,
  buildProjectLookBibleVideoPrompt,
  normalizeProjectLookBible,
  type ActiveProjectLookBible,
} from "./project-look-bible";

function makeLookBible() {
  return {
    schemaVersion: "project-look-bible/v1",
    name: "民国夜戏",
    summary: "真人实拍、物理光源与冷暖对冲",
    globalCore: {
      styleName: "民国夜戏",
      summary: "稳定项目基调",
      visualDirectives: ["所有光线具有物理来源"],
      negativeDirectives: ["禁止无源补光"],
      consistencyRules: ["皮肤与服装材质跨镜稳定"],
      characterPrompt: "角色卡保留真实皮肤和3200K侧前柔光",
      imagePrompt: "图片保留暗部纹理和暖灯冷影",
      videoPrompt: "视频中亮度随人物与灯光距离连续变化",
    },
    sections: [
      {
        id: "farewell",
        name: "隐忍别离",
        dimension: "灯光与情绪",
        applicability: "克制离别场景",
        directives: ["低反差灯笼柔光"],
        imagePrompt: "薄雾与2.4:1低反差",
        videoPrompt: "走向廊尾时自然变暗",
      },
    ],
    contentExclusions: ["具体人物和递枪事件不得进入全局规则"],
  };
}

function makeActive(): ActiveProjectLookBible {
  const lookBible = normalizeProjectLookBible(makeLookBible());
  return {
    assetId: "look-1",
    assetName: "项目影调｜民国夜戏｜V1",
    kind: "projectLookBible",
    schemaVersion: "project-look-bible/v1",
    revision: 1,
    projectId: "project-1",
    sourceNodeId: "node-look-1",
    sourceFlowId: "flow-1",
    sourceChapterId: null,
    sourceDocument: "完整影调文档",
    sourceDocumentHash: "source-hash",
    lookBibleHash: "look-hash",
    lookBible,
    activatedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("Project Look Bible", () => {
  it("normalizes one structured project look bible", () => {
    const normalized = normalizeProjectLookBible(makeLookBible());
    expect(normalized.name).toBe("民国夜戏");
    expect(normalized.sections.map((section) => section.id)).toEqual(["farewell"]);
  });

  it("uses the role-card projection without adding a scene module by default", () => {
    const prompt = buildProjectLookBibleImagePrompt({ active: makeActive(), roleCard: true });
    expect(prompt).toContain("角色卡保留真实皮肤");
    expect(prompt).not.toContain("薄雾与2.4:1低反差");
  });

  it("adds an explicitly selected module and rejects an unknown id", () => {
    expect(buildProjectLookBibleImagePrompt({
      active: makeActive(),
      roleCard: false,
      sectionIds: ["farewell"],
    })).toContain("薄雾与2.4:1低反差");
    expect(() => buildProjectLookBibleImagePrompt({
      active: makeActive(),
      roleCard: false,
      sectionIds: ["unknown"],
    })).toThrow("project_look_section_not_found:unknown");
  });

  it("projects only explicitly selected motion sections to video", () => {
    const prompt = buildProjectLookBibleVideoPrompt({
      active: makeActive(),
      sectionIds: ["farewell"],
    });
    expect(prompt).not.toContain("亮度随人物与灯光距离连续变化");
    expect(prompt).toContain("走向廊尾时自然变暗");
    expect(prompt).not.toContain("http");
    expect(() => buildProjectLookBibleVideoPrompt({
      active: makeActive(),
      sectionIds: ["unknown"],
    })).toThrow("project_look_section_not_found:unknown");
  });
});
