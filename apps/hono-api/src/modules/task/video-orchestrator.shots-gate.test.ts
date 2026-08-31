import { describe, expect, it } from "vitest";
import {
  SHOTS_REQUIRED_CODE,
  SHOTS_REQUIRED_GUIDANCE,
  enforceStructuredShotsAndRender,
  gateAndRenderStructuredClips,
} from "./video-orchestrator.shots-gate";

const okShot = (over: Record<string, unknown> = {}) => {
  const shot: Record<string, unknown> = {
    framing: "中近景",
    cameraMove: "缓推",
    visualTask: "看清规则宣布后的空间反应",
    action: "人羊抬手示意，众人噤声，烛光摇曳",
    durationSeconds: 7,
    ...over,
  };
  return shot;
};

const okClip = (over: Record<string, unknown> = {}) => ({
  logline: "宣布规则",
  continuity: "同一时间线连续",
  durationSeconds: 14,
  speakerBindings: [],
  speechEvents: [],
  shots: [okShot(), okShot()],
  ...over,
});

const bible = { directorTone: "密室惊悚", visualBible: "冷白硬光", hardRules: "无BGM" };

describe("enforceStructuredShotsAndRender — 结构化 shots 唯一路径", () => {
  it("纯文本 clipPrompt（无 shots）整批拒收：shots_required + 修复指引", () => {
    const rejection = enforceStructuredShotsAndRender({
      clips: [okClip(), { clipPrompt: "老八段自由文本镜头表", durationSeconds: 10 }],
      bible,
    });
    expect(rejection).not.toBeNull();
    expect(rejection!.code).toBe(SHOTS_REQUIRED_CODE);
    expect(rejection!.message).toContain("第2段");
    expect(rejection!.message).toContain(SHOTS_REQUIRED_GUIDANCE);
    // 修复指引必须教 LLM 用 shots JSON 结构重交
    expect(rejection!.message).toContain("shots:[");
    expect(rejection!.message).toContain("filmBible");
  });

  it("shots 为空数组也算无 shots（hasStructuredShots 判据）", () => {
    const rejection = enforceStructuredShotsAndRender({
      clips: [{ clipPrompt: "文本", shots: [], durationSeconds: 10 }],
      bible,
    });
    expect(rejection?.code).toBe(SHOTS_REQUIRED_CODE);
  });

  it("带 shots 但校验不合格 → shots_validation_failed 整批拒收", () => {
    const bad = okClip({ shots: [okShot({ durationSeconds: 0 })], durationSeconds: 7 });
    const rejection = enforceStructuredShotsAndRender({ clips: [bad], bible });
    expect(rejection?.code).toBe("shots_validation_failed");
    expect(rejection?.message).toContain("durationSeconds");
  });

  it("全部合格 → 返回 null 并只渲染当前 clip 执行段", () => {
    const clip = okClip();
    const rejection = enforceStructuredShotsAndRender({ clips: [clip], bible });
    expect(rejection).toBeNull();
    const prompt = String((clip as Record<string, unknown>).clipPrompt);
    expect(prompt).toContain("【SHOTS】");
    expect(prompt).not.toContain("密室惊悚");
  });

  it("filmBible 缺失不向最终视频提示词注入整章告警", () => {
    const clip = okClip();
    const rejection = enforceStructuredShotsAndRender({ clips: [clip], bible: null });
    expect(rejection).toBeNull();
    expect(String((clip as Record<string, unknown>).clipPrompt)).not.toContain("全片圣经缺失");
  });

  it("baseIndex（replaceAtIndex 场景）按全局镜号报段位", () => {
    const rejection = enforceStructuredShotsAndRender({
      clips: [{ clipPrompt: "纯文本替换段" }],
      bible,
      baseIndex: 6,
    });
    expect(rejection?.code).toBe(SHOTS_REQUIRED_CODE);
    expect(rejection?.message).toContain("第7段");
  });
});

describe("gateAndRenderStructuredClips — 最终稿只读校验", () => {
  it("对白超容拒收且不改写 writer 稿件", () => {
    const long = "字".repeat(28); // 28字 > 4s×4=16字
    const clip = okClip({
      durationSeconds: 11,
      dialoguePaceRate: 4,
      speakerBindings: [{ name: "人羊", assetKind: "character" }],
      speechEvents: [{
        speechEventId: "speech-line-1",
        lineId: "line-1",
        startOffset: 0,
        endOffset: 28,
        startSeconds: 0,
        endSeconds: 4,
        speakerName: "人羊",
        delivery: "on_screen",
        performance: "平稳宣布",
        spokenText: long,
      }],
      shots: [okShot({ speechEventIds: ["speech-line-1"], durationSeconds: 4 }), okShot()],
    });
    const detail = gateAndRenderStructuredClips({ clips: [clip], bible });
    expect(detail.rejected).toHaveLength(1);
    expect(detail.rejected[0]?.problems.join("\n")).toContain("人声事件超容");
    expect((clip.shots as Array<{ durationSeconds: number }>)[0]!.durationSeconds).toBe(4);
    expect((clip as Record<string, unknown>).durationSeconds).toBe(11);
    expect((clip as Record<string, unknown>).clipPrompt).toBeUndefined();
  });

  it("有人声时不使用宿主默认语速", () => {
    const clip = okClip({
      durationSeconds: 11,
      speakerBindings: [{ name: "人羊", assetKind: "character" }],
      speechEvents: [{
        speechEventId: "speech-line-1",
        lineId: "line-1",
        startOffset: 0,
        endOffset: 4,
        startSeconds: 0,
        endSeconds: 4,
        speakerName: "人羊",
        delivery: "on_screen",
        performance: "平稳宣布",
        spokenText: "我回来了",
      }],
      shots: [okShot({ speechEventIds: ["speech-line-1"], durationSeconds: 4 }), okShot()],
    });

    const detail = gateAndRenderStructuredClips({ clips: [clip], bible });

    expect(detail.rejected).toHaveLength(1);
    expect(detail.rejected[0]?.problems.join("\n")).toContain(
      "dialoguePaceRate 必须由 BeatSheet Agent 明确提交",
    );
    expect((clip as Record<string, unknown>).clipPrompt).toBeUndefined();
  });

  it("缺 continuity 降级为软警告，不拒收", () => {
    const clip = okClip({ continuity: "" });
    const detail = gateAndRenderStructuredClips({ clips: [clip], bible });
    expect(detail.rejected).toHaveLength(0);
    expect(detail.warnings.join()).toContain("continuity");
    expect(String((clip as Record<string, unknown>).clipPrompt)).toContain("【SHOTS】");
  });

  it("按段退回：批内只有硬伤那段被退，其余照常渲染入库", () => {
    const good = okClip();
    const bad = okClip({ shots: [okShot({ durationSeconds: 0 })], durationSeconds: 7 });
    const detail = gateAndRenderStructuredClips({
      clips: [good, bad],
      bible,
      slotNos: [3, 4],
    });
    expect(detail.rejected).toHaveLength(1);
    expect(detail.rejected[0]!.batchIndex).toBe(1);
    expect(detail.rejected[0]!.globalNo).toBe(5); // slot 4 → 全局第5段
    expect(detail.rejected[0]!.problems.join()).toContain("durationSeconds");
    expect(String((good as Record<string, unknown>).clipPrompt)).toContain("【SHOTS】");
    expect((bad as Record<string, unknown>).clipPrompt).toBeUndefined();
  });

  it("重复提交不能把结构硬伤降级入库", () => {
    const clip = okClip({
      shots: [okShot({ cameraMove: "定格后缓推", durationSeconds: 0 })],
      durationSeconds: 7,
    });
    const detail = gateAndRenderStructuredClips({
      clips: [clip],
      bible,
    });
    expect(detail.rejected).toHaveLength(1);
    // 「定格」不再是禁词，不剥不改（critic 语义层判）
    expect((clip.shots as Array<{ cameraMove: string }>)[0]!.cameraMove).toContain("定格");
    expect(detail.rejected[0]?.problems.join("\n")).toContain("durationSeconds");
    expect((clip as Record<string, unknown>).clipPrompt).toBeUndefined();
  });

  it("结构 preflight 不从动作文本推断站位图需求", () => {
    const combat = okClip({
      characterRoleNames: ["孟川", "羅鋒"],
      shots: [okShot({ action: "两人对峙，羅鋒冲向孟川，绕到其身后出手" })],
      durationSeconds: 7,
    });
    const detail = gateAndRenderStructuredClips({ clips: [combat], bible });
    expect(detail.rejected).toEqual([]);
    expect(detail.warnings.join()).not.toContain("俯视站位图");
    expect(String((combat as Record<string, unknown>).clipPrompt)).toContain("【SHOTS】");
    const bound = okClip({
      characterRoleNames: ["孟川", "羅鋒"],
      blockingFrameNodeId: "blocking-1",
      shots: [okShot({ action: "两人对峙，羅鋒冲向孟川，绕到其身后出手" })],
      durationSeconds: 7,
    });
    const detail2 = gateAndRenderStructuredClips({ clips: [bound], bible });
    expect(detail2.rejected).toEqual([]);
    expect(detail2.warnings.join()).not.toContain("俯视站位图");
  });

  it("缺 shots 结构恒拒（不可强制入库）", () => {
    const detail = gateAndRenderStructuredClips({
      clips: [{ clipPrompt: "纯文本" }],
      bible,
    });
    expect(detail.missingShots).toEqual([1]);
  });

  it("最终视频提示词超过旧写作预算仍按结构合同通过，不自动截断", () => {
    const clip = okClip({
      shots: [okShot({ action: "动作".repeat(2600), durationSeconds: 14 })],
      durationSeconds: 14,
    });
    const detail = gateAndRenderStructuredClips({
      clips: [clip],
      bible,
    });
    expect(detail.rejected).toHaveLength(0);
    expect((clip as Record<string, unknown>).clipPrompt).toEqual(expect.any(String));
  });

  it("超过供应商边界的长提示词也不由 shots 闸拦截，交由提交层按事实处理", () => {
    const clip = okClip({
      shots: [okShot({ action: "打".repeat(6000), durationSeconds: 14 })],
      durationSeconds: 14,
    });
    const detail = gateAndRenderStructuredClips({ clips: [clip], bible });
    expect(detail.rejected).toHaveLength(0);
    expect((clip as Record<string, unknown>).clipPrompt).toEqual(expect.any(String));
  });
});

describe("gateAndRenderStructuredClips — maxDurationSec 可行性（2026-07-07 ch6 复盘）", () => {
  const noDlg = (dur: number) => okShot({ durationSeconds: dur });
  it("加总超上限的段被按段退回", () => {
    const over = okClip({ durationSeconds: 24, shots: [noDlg(8), noDlg(8), noDlg(8)] });
    const detail = gateAndRenderStructuredClips({ clips: [over], bible, maxDurationSec: 15 });
    expect(detail.rejected).toHaveLength(1);
    expect(detail.rejected[0].problems.join("；")).toContain("上限");
  });
  it("不传 maxDurationSec：超长段照常通过（零回归）", () => {
    const over = okClip({ durationSeconds: 24, shots: [noDlg(8), noDlg(8), noDlg(8)] });
    const detail = gateAndRenderStructuredClips({ clips: [over], bible });
    expect(detail.rejected).toHaveLength(0);
  });
  it("所有入口都对 SpeechEvent 超容保持硬伤且不修改调用方稿件", () => {
    const spokenText = "字".repeat(28);
    const clip = okClip({
      durationSeconds: 11,
      speakerBindings: [{ name: "人羊", assetKind: "character" }],
      speechEvents: [{
        speechEventId: "speech-line-1",
        lineId: "line-1",
        startOffset: 0,
        endOffset: 28,
        startSeconds: 0,
        endSeconds: 4,
        speakerName: "人羊",
        delivery: "on_screen",
        performance: "平稳宣布",
        spokenText,
      }],
      shots: [okShot({ speechEventIds: ["speech-line-1"], durationSeconds: 4 }), okShot()],
    });
    const detail = gateAndRenderStructuredClips({ clips: [clip], bible, maxDurationSec: 15 });
    expect(detail.rejected).toHaveLength(1);
    expect((clip.shots as Array<{ durationSeconds: number }>)[0]?.durationSeconds).toBe(4);
    expect((clip as Record<string, unknown>).clipPrompt).toBeUndefined();
  });
  it("缺失 referenceImageNodeIds 的资产合同按段显式退回而不是渲染期崩溃", () => {
    const clip = okClip({
      assetObjectContracts: [{
        kind: "character",
        name: "央珍",
        referenceRole: "identity",
        forbiddenTransfer: "不迁移背景",
        identityInvariant: "身份不变",
        startState: "门内站立",
        spatialRelation: "位于门框内",
        scale: "中景",
        driver: "主动推门",
        stateChange: "走出门框",
        endState: "站在门外",
      }],
    } as unknown as Partial<ReturnType<typeof okClip>>);
    const detail = gateAndRenderStructuredClips({ clips: [clip], bible });
    expect(detail.rejected).toHaveLength(1);
    expect(detail.rejected[0]?.problems.join("；")).toContain("referenceImageNodeIds");
  });
});
