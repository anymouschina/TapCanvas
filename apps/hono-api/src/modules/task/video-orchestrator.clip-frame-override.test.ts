import { describe, it, expect } from "vitest";
import {
  resolveClipFrameOverride,
  selectContinuityFrameUrls,
  validateStoryPlan,
} from "./video-orchestrator.orchestrate";

describe("selectContinuityFrameUrls", () => {
  const endpoints = {
    storyboardImageUrl: "https://r2/start.png",
    lastFrameImageUrl: "https://r2/end.png",
  };

  it("only promotes verified endpoints for a closed bridge role", () => {
    expect(selectContinuityFrameUrls({
      bridgeRole: { isBridgeHead: true, isBridgeTail: true },
      ...endpoints,
    })).toEqual({
      storyboardFirstFrameUrl: endpoints.storyboardImageUrl,
      targetLastFrameUrl: endpoints.lastFrameImageUrl,
    });
  });

  it.each(["editorial_cut", "reference_video"] as const)(
    "%s keeps storyboard assets out of literal frame roles",
    () => {
      expect(selectContinuityFrameUrls({
        bridgeRole: { isBridgeHead: false, isBridgeTail: false },
        ...endpoints,
      })).toEqual({
        storyboardFirstFrameUrl: "",
        targetLastFrameUrl: "",
      });
    },
  );
});

// —— 故事板关键帧覆盖首帧 + per-clip 目标尾帧（接线缺口修复）——
// resolveClipFrameOverride 是纯决策函数：DB→url 的解析由调用方用 readNodeImageUrl 完成，
// 这里只验「有 board → 覆盖；无 board → 旧逻辑不变；有/无 lastFrame → 设/不设」。

describe("resolveClipFrameOverride", () => {
  it("① 有故事板关键帧 → firstFrame=board url（覆盖 card/尾帧），note 改为故事板关键帧", () => {
    const r = resolveClipFrameOverride({
      storyboardFirstFrameUrl: "https://r2/board.png",
      targetLastFrameUrl: "",
      baseFirstFrame: "https://r2/card.png", // reAnchor 旧逻辑算出的母版卡
      reAnchor: true,
    });
    expect(r.firstFrameUrl).toBe("https://r2/board.png");
    expect(r.usedStoryboardFirstFrame).toBe(true);
    expect(r.usedTargetLastFrame).toBe(false);
    expect(r.lastFrameUrl).toBe("");
    expect(r.firstFrameNote).toBe("首帧=本镜故事板关键帧（构图/朝向/特效起势已钉）");
  });

  it("② 无 board（reAnchor）→ firstFrame=母版卡（旧逻辑逐字不变）", () => {
    const r = resolveClipFrameOverride({
      storyboardFirstFrameUrl: "",
      targetLastFrameUrl: "",
      baseFirstFrame: "https://r2/card.png",
      reAnchor: true,
    });
    expect(r.firstFrameUrl).toBe("https://r2/card.png");
    expect(r.usedStoryboardFirstFrame).toBe(false);
    expect(r.firstFrameNote).toBe("首帧=母版参考图（锚定主体/光线/风格）");
  });

  it("② 无 board（续写镜 reAnchor=false）→ firstFrame=上一镜尾帧（旧逻辑逐字不变）", () => {
    const r = resolveClipFrameOverride({
      storyboardFirstFrameUrl: "",
      targetLastFrameUrl: "",
      baseFirstFrame: "https://r2/prev-tail.png",
      reAnchor: false,
    });
    expect(r.firstFrameUrl).toBe("https://r2/prev-tail.png");
    expect(r.usedStoryboardFirstFrame).toBe(false);
    expect(r.firstFrameNote).toBe("首帧=上一镜尾帧（动作从该姿态连贯续接）");
  });

  it("③ 有 lastFrameImageNodeId 解析到 url → lastFrameUrl 设置，note 追加尾帧说明", () => {
    const r = resolveClipFrameOverride({
      storyboardFirstFrameUrl: "https://r2/board.png",
      targetLastFrameUrl: "https://r2/tail.png",
      baseFirstFrame: "https://r2/card.png",
      reAnchor: true,
    });
    expect(r.usedTargetLastFrame).toBe(true);
    expect(r.lastFrameUrl).toBe("https://r2/tail.png");
    expect(r.firstFrameNote).toBe(
      "首帧=本镜故事板关键帧（构图/朝向/特效起势已钉）；尾帧=本镜目标关键帧（特效终态/朝向已钉）",
    );
  });

  it("④ 无 lastFrame → 不设 lastFrameUrl（旧行为），note 不含尾帧说明", () => {
    const r = resolveClipFrameOverride({
      storyboardFirstFrameUrl: "",
      targetLastFrameUrl: "",
      baseFirstFrame: "https://r2/prev-tail.png",
      reAnchor: false,
    });
    expect(r.usedTargetLastFrame).toBe(false);
    expect(r.lastFrameUrl).toBe("");
    // 不追加目标尾帧说明（base note 本身含「上一镜尾帧」字样，故只断言目标尾帧 clause 缺席）
    expect(r.firstFrameNote.includes("目标关键帧")).toBe(false);
    expect(r.firstFrameNote).toBe("首帧=上一镜尾帧（动作从该姿态连贯续接）");
  });

  it("尾帧可独立于 board 设置（无 board 但有 lastFrame）", () => {
    const r = resolveClipFrameOverride({
      storyboardFirstFrameUrl: "",
      targetLastFrameUrl: "https://r2/tail.png",
      baseFirstFrame: "https://r2/card.png",
      reAnchor: true,
    });
    expect(r.firstFrameUrl).toBe("https://r2/card.png"); // 首帧仍走旧逻辑
    expect(r.usedTargetLastFrame).toBe(true);
    expect(r.lastFrameUrl).toBe("https://r2/tail.png");
    expect(r.firstFrameNote).toBe(
      "首帧=母版参考图（锚定主体/光线/风格）；尾帧=本镜目标关键帧（特效终态/朝向已钉）",
    );
  });

  it("没有真实首帧 URL 时不再伪造‘首帧=母版参考图’说明", () => {
    const r = resolveClipFrameOverride({
      storyboardFirstFrameUrl: "",
      targetLastFrameUrl: "",
      baseFirstFrame: "",
      reAnchor: true,
    });
    expect(r.firstFrameUrl).toBe("");
    expect(r.firstFrameNote).toBe("");
  });
});

describe("validateStoryPlan 解析 storyboardImageNodeId / lastFrameImageNodeId", () => {
  const executionContract = {
    videoReferenceNodeIds: [],
    assetObjectContracts: [],
    continuityMode: "editorial_cut" as const,
  };
  const base = {
    runId: "run-1",
    targetDurationSeconds: 10,
    videoModel: "doubao-seedance-2-0-260128",
  };

  it("给了两字段 → 解析进 clip", () => {
    const plan = validateStoryPlan({
      ...base,
      clips: [
        {
          ...executionContract,
          clipPrompt: "镜0",
          storyboardImageNodeId: "board-0",
          lastFrameImageNodeId: "tail-0",
        },
        {
          ...executionContract,
          clipPrompt: "镜1",
          storyboardImageNodeId: "tail-0",
          continuityMode: "bridge_frames",
        },
      ],
    });
    expect(plan.clips[0]!.storyboardImageNodeId).toBe("board-0");
    expect(plan.clips[0]!.lastFrameImageNodeId).toBe("tail-0");
  });

  it("未声明两字段时不产生虚构帧引用", () => {
    const plan = validateStoryPlan({
      ...base,
      clips: [{ ...executionContract, clipPrompt: "镜0" }],
    });
    expect("storyboardImageNodeId" in plan.clips[0]!).toBe(false);
    expect("lastFrameImageNodeId" in plan.clips[0]!).toBe(false);
  });
});

describe("validateStoryPlan 视觉故事板前置合同", () => {
  const base = {
    runId: "run-storyboard",
    targetDurationSeconds: 10,
    videoModel: "doubao-seedance-2-0-260128",
    clips: [{
      clipPrompt: "镜0",
      storyboardImageNodeId: "board-0",
      videoReferenceNodeIds: ["role-0"],
      assetObjectContracts: [],
      continuityMode: "editorial_cut",
    }],
  };

  it("保留 agents 明确声明的逐镜故事板与资产输入合同", () => {
    const plan = validateStoryPlan({
      ...base,
      visualPreproduction: {
        kind: "storyboard",
        requiredClipIndexes: [0],
        requiredAssetNodeIdsByClip: [{ clipIndex: 0, assetNodeIds: ["role-0"] }],
      },
    });
    expect(plan.visualPreproduction).toEqual({
      kind: "storyboard",
      requiredClipIndexes: [0],
      requiredAssetNodeIdsByClip: [{ clipIndex: 0, assetNodeIds: ["role-0"] }],
    });
  });

  it("拒绝缺少逐镜真实资产声明的故事板合同", () => {
    expect(() => validateStoryPlan({
      ...base,
      visualPreproduction: { kind: "storyboard", requiredClipIndexes: [0] },
    })).toThrow(/requiredAssetNodeIdsByClip/);
  });
});

describe("validateStoryPlan 解析 sceneCardNodeId / timeJumpNote（承接模板字段驱动）", () => {
  const executionContract = {
    videoReferenceNodeIds: [],
    assetObjectContracts: [],
    continuityMode: "editorial_cut" as const,
  };
  const base = {
    runId: "run-1",
    targetDurationSeconds: 10,
    videoModel: "doubao-seedance-2-0-260128",
  };

  it("透传合法字符串并 trim；空白剔除为 undefined", () => {
    const plan = validateStoryPlan({
      ...base,
      clips: [
        { ...executionContract, clipPrompt: "镜0", sceneCardNodeId: " scene-1 ", timeJumpNote: " 半月后 " },
        { ...executionContract, clipPrompt: "镜1", sceneCardNodeId: "", timeJumpNote: "   " },
      ],
    });
    expect(plan.clips[0]!.sceneCardNodeId).toBe("scene-1");
    expect(plan.clips[0]!.timeJumpNote).toBe("半月后");
    expect(plan.clips[1]!.sceneCardNodeId).toBeUndefined();
    expect(plan.clips[1]!.timeJumpNote).toBeUndefined();
  });
});
