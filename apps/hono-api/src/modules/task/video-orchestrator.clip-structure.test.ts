import { describe, it, expect } from "vitest";
import {
  findClipStructureViolations,
  buildClipStructureBlockMessage,
  countClipBeats,
  detectBridgeFrameRoles,
  buildBridgeContinuityNote,
  buildExitStateRelayNote,
  buildStoryRecapNote,
  resolveRelaySceneChanged,
} from "./video-orchestrator.clip-structure";

// 最小 clip 构造（结构闸只读 clipPrompt/storyboardPrompt/durationSeconds/structureReviewed）
const clip = (over: Record<string, unknown>) =>
  ({ clipPrompt: "", storyboardPrompt: "", ...over }) as never;

describe("clip 结构闸（治 ch1051 欠拆镜）", () => {
  it("时长超单镜上限(15s) → 违规", () => {
    const v = findClipStructureViolations({ clips: [clip({ durationSeconds: 36, clipPrompt: "一个镜头" })] }, { maxDuration: 15 });
    expect(v).toHaveLength(1);
    expect(v[0].reasons.join()).toMatch(/超过单镜上限/);
  });

  it("一镜 5 句对白 → 违规", () => {
    const p = "01『汤家？』02『好了不起么？』03『你！』04『试试手段』05『定要清算』";
    const v = findClipStructureViolations({ clips: [clip({ durationSeconds: 12, clipPrompt: p })] }, { maxDuration: 15 });
    expect(v[0]?.reasons.join()).toMatch(/句独立对白/);
  });

  it("一张多格设计板塞一条 clip（五格连续演出）→ 违规", () => {
    const v = findClipStructureViolations(
      { clips: [clip({ durationSeconds: 12, clipPrompt: "按设计板04五格连续演出：动作连贯" })] },
      { maxDuration: 15 },
    );
    expect(v[0]?.reasons.join()).toMatch(/独立节拍/);
  });

  it("ch1051 实测形态（33s + 3句 + 五格）→ 多条违规", () => {
    const p = "按设计板04五格连续演出：01『汤家？好了不起么？』02『那我就试试你汤家的手段！』03『你！』";
    const v = findClipStructureViolations({ clips: [clip({ durationSeconds: 33, clipPrompt: p })] }, { maxDuration: 15 });
    expect(v[0].reasons.length).toBeGreaterThanOrEqual(2); // 时长 + 节拍（+对白）
  });

  it("合规 clip（≤15s + 1句 + 单节拍）→ 不拦", () => {
    const v = findClipStructureViolations(
      { clips: [clip({ durationSeconds: 8, clipPrompt: "方源画左持剑掠向画右，他冷声说：『汤家？』" })] },
      { maxDuration: 15 },
    );
    expect(v).toHaveLength(0);
    expect(buildClipStructureBlockMessage({ clips: [clip({ durationSeconds: 8, clipPrompt: "单镜" })] }, { maxDuration: 15 })).toBeNull();
  });

  it("structureReviewed:true → 豁免", () => {
    const v = findClipStructureViolations(
      { clips: [clip({ durationSeconds: 36, clipPrompt: "按设计板五格演出", structureReviewed: true })] },
      { maxDuration: 15 },
    );
    expect(v).toHaveLength(0);
  });

  it("countClipBeats 数得出 N格 与 01/02 枚举", () => {
    expect(countClipBeats(clip({ clipPrompt: "按设计板04五格连续演出" }))).toBe(5);
    expect(countClipBeats(clip({ clipPrompt: "01 起手 02 推进 03 收势" }))).toBe(3);
    expect(countClipBeats(clip({ clipPrompt: "一个连续动作镜头" }))).toBe(0);
  });
});

describe("共享桥接帧·双参考（跨镜连续动作·零运行时尾帧·2026-06-22）", () => {
  const bclip = (over: Record<string, unknown>) => over as never;

  it("前镜 lastFrameImageNodeId === 后镜 storyboardImageNodeId → 桥接对", () => {
    const roles = detectBridgeFrameRoles([
      bclip({ continuityMode: "editorial_cut", lastFrameImageNodeId: "bridge-1" }),
      bclip({ continuityMode: "bridge_frames", storyboardImageNodeId: "bridge-1" }),
    ]);
    expect(roles[0]).toEqual({ isBridgeTail: true, isBridgeHead: false });
    expect(roles[1]).toEqual({ isBridgeTail: false, isBridgeHead: true });
  });

  it("不共享节点 id → 非桥接（独立并发镜各锚自己的多机位关键帧）", () => {
    const roles = detectBridgeFrameRoles([
      bclip({ continuityMode: "editorial_cut", storyboardImageNodeId: "angle-A", lastFrameImageNodeId: "kf-1" }),
      bclip({ continuityMode: "bridge_frames", storyboardImageNodeId: "angle-B", lastFrameImageNodeId: "kf-2" }),
    ]);
    expect(roles.every((r) => !r.isBridgeTail && !r.isBridgeHead)).toBe(true);
  });

  it("链式三镜桥接：中镜既是上一对的后半段、又是下一对的前半段", () => {
    const roles = detectBridgeFrameRoles([
      bclip({ continuityMode: "editorial_cut", lastFrameImageNodeId: "b1" }),
      bclip({ continuityMode: "bridge_frames", storyboardImageNodeId: "b1", lastFrameImageNodeId: "b2" }),
      bclip({ continuityMode: "bridge_frames", storyboardImageNodeId: "b2" }),
    ]);
    expect(roles[1]).toEqual({ isBridgeTail: true, isBridgeHead: true });
  });

  it("空/缺字段不误判桥接", () => {
    const roles = detectBridgeFrameRoles([
      bclip({ continuityMode: "editorial_cut" }),
      bclip({ continuityMode: "editorial_cut", storyboardImageNodeId: "" }),
    ]);
    expect(roles.every((r) => !r.isBridgeTail && !r.isBridgeHead)).toBe(true);
  });

  it("提示词补强：后半段镜=继续同一动作；前半段镜=收束到桥接帧不落幅；非桥接=空", () => {
    expect(buildBridgeContinuityNote({ isBridgeHead: true, isBridgeTail: false })).toMatch(/继续上一镜的同一个连续动作/);
    expect(buildBridgeContinuityNote({ isBridgeHead: true, isBridgeTail: false })).toMatch(/不重新起势|绝不重新起势/);
    expect(buildBridgeContinuityNote({ isBridgeHead: false, isBridgeTail: true })).toMatch(/收束到与下一镜共享的【桥接帧】/);
    expect(buildBridgeContinuityNote({ isBridgeHead: false, isBridgeTail: true })).toMatch(/不要稳定落幅/);
    expect(buildBridgeContinuityNote({ isBridgeHead: false, isBridgeTail: false })).toBe("");
  });
});

describe("buildStoryRecapNote（前情提要·2026-07-10 用户拍板）", () => {
  const clips = [
    { logline: "孟川背靠祭坛滑坐，邪物随雾退去" },
    { logline: "混元金斗渡清灵之气疗伤，识海获传承" },
    { title: "第二转突破" },
    { logline: "破境天仙，肉身玉化升华" },
  ];
  it("首镜返回空串（无前情）", () => {
    expect(buildStoryRecapNote(clips, 0)).toBe("");
  });
  it("拼各镜 logline（缺 logline 回退 title）并带禁重演口径", () => {
    const note = buildStoryRecapNote(clips, 3);
    expect(note).toContain("前情提要");
    expect(note).toContain("镜1:孟川背靠祭坛滑坐");
    expect(note).toContain("镜3:第二转突破");
    expect(note).toContain("禁在本镜画出/回放");
  });
  it("超预算折叠更早的镜", () => {
    const long = Array.from({ length: 12 }, (_, i) => ({
      logline: `第${i + 1}镜发生了一段相当长的剧情描述用来撑爆前情提要的总预算限制字数字数字数`,
    }));
    const note = buildStoryRecapNote(long, 12);
    expect(note).toContain("略）");
    expect(note).toContain("镜12:");
    expect(note.length).toBeLessThan(500);
  });
  it("全部前镜无 logline/title → 空串", () => {
    expect(buildStoryRecapNote([{}, {}], 2)).toBe("");
  });
});

describe("buildExitStateRelayNote", () => {
  it("上镜有 exitState 时产出承接注解", () => {
    const note = buildExitStateRelayNote("甲立于案前、剑指乙,乙仍端坐");
    expect(note).toContain("【承接上镜退出态】甲立于案前");
    expect(note).toContain("不要重置状态");
  });
  it("空/非字符串返回空串", () => {
    expect(buildExitStateRelayNote("")).toBe("");
    expect(buildExitStateRelayNote(undefined)).toBe("");
    expect(buildExitStateRelayNote("   ")).toBe("");
  });
});

describe("buildExitStateRelayNote — 场景切换软化（2026-07-06 seedance-2.0 调研折入）", () => {
  it("同场景：既成状态+防重演+运动残势措辞", () => {
    const s = buildExitStateRelayNote("孟川盘坐光阵中央，金光渐起");
    expect(s).toContain("既成状态");
    expect(s).toContain("禁止重演");
    expect(s).toContain("运动残势");
  });
  it("场景切换：只承接剧情/角色状态，不对齐光线构图", () => {
    const s = buildExitStateRelayNote("孟川盘坐光阵中央", { sceneChanged: true });
    expect(s).toContain("场景已切换");
    expect(s).toContain("不必对齐上镜的光线");
    expect(s).toContain("禁止重演");
  });
});

describe("buildExitStateRelayNote — 时间跳跃口径（2026-07-07 ch6 复盘：『半月后』误套姿态精确连续）", () => {
  it("timeJump：只承接长期状态，不对齐姿态/光线/残势", () => {
    const s = buildExitStateRelayNote("孟川浮上水面大口喘气", { timeJump: "半月后" });
    expect(s).toContain("时间跳跃");
    expect(s).toContain("半月后");
    expect(s).toContain("长期状态");
    expect(s).not.toContain("运动残势");
    expect(s).toContain("禁止重演");
  });
  it("timeJump 优先于 sceneChanged", () => {
    const s = buildExitStateRelayNote("x", { sceneChanged: true, timeJump: "三日后" });
    expect(s).toContain("时间跳跃");
    expect(s).not.toContain("场景已切换");
  });
  it("无 exitState 时 timeJump 也返回空串（行为对齐）", () => {
    expect(buildExitStateRelayNote("", { timeJump: "半月后" })).toBe("");
  });
});

describe("resolveRelaySceneChanged — 显式 sceneCardNodeId 优先于推导", () => {
  it("两镜都显式声明：不同=true / 相同=false（覆盖推导值）", () => {
    expect(
      resolveRelaySceneChanged({ prevSceneCardNodeId: "s1", currSceneCardNodeId: "s2", inferredChanged: false }),
    ).toBe(true);
    expect(
      resolveRelaySceneChanged({ prevSceneCardNodeId: "s1", currSceneCardNodeId: "s1", inferredChanged: true }),
    ).toBe(false);
  });
  it("任一缺省：回退推导值", () => {
    expect(
      resolveRelaySceneChanged({ prevSceneCardNodeId: "", currSceneCardNodeId: "s2", inferredChanged: true }),
    ).toBe(true);
    expect(
      resolveRelaySceneChanged({ prevSceneCardNodeId: undefined, currSceneCardNodeId: undefined, inferredChanged: false }),
    ).toBe(false);
  });
});
