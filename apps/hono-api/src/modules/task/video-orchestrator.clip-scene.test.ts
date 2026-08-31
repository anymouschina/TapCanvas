import { describe, expect, it } from "vitest";

import { buildDeclaredClipSceneData } from "./video-orchestrator.clip-scene";

describe("buildDeclaredClipSceneData", () => {
  it("透传当前冻结 clip 显式声明的 canonical sceneName", () => {
    expect(buildDeclaredClipSceneData({ sceneName: "界级传送阵·奥术永恒星降临空间" })).toEqual({
      sceneName: "界级传送阵·奥术永恒星降临空间",
    });
  });

  it("未声明 sceneName 时省略字段，不推断默认场景", () => {
    expect(buildDeclaredClipSceneData(undefined)).toEqual({});
    expect(buildDeclaredClipSceneData({})).toEqual({});
    expect(buildDeclaredClipSceneData({ sceneName: "   " })).toEqual({});
  });
});
