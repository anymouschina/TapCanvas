import { describe, expect, it } from "vitest";
import { lintNarrativePlan, buildNarrativeLintWarning } from "./video-orchestrator.narrative-lint";

describe("叙事 linter（确定性告警·喂给评审的硬半边）", () => {
  it("段7式对白超容：492字塞15s 标 too_short + 超容倍数", () => {
    const longDlg = `谢双瑶：「${"米铁权力顺从恐惧饱饿天下人都要吃不然活不下去想吃好点".repeat(12)}」`; // ~360+字
    const lint = lintNarrativePlan({
      clips: [{ clipPrompt: longDlg, durationSeconds: 15 } as never],
    });
    const over = lint.dialogueOverloads.find((o) => o.index === 0);
    expect(over).toBeTruthy();
    expect(over?.reason).toBe("too_short");
    const w = buildNarrativeLintWarning(lint) || "";
    expect(w).toContain("对白容量超载");
    expect(w).toMatch(/超容\s*[\d.]+x/);
  });

  it("季节冷热冲突：盛夏烈日 + 呵气白雾 → 告警", () => {
    const lint = lintNarrativePlan({
      clips: [
        { clipPrompt: "盛夏烈日蝉鸣，她汗流浃背洒扫", durationSeconds: 14 } as never,
        { clipPrompt: "天灰青，呵气可见鼻息白雾，赶早课", durationSeconds: 13 } as never,
      ],
    });
    expect(lint.seasonConflict).toBeTruthy();
    expect(buildNarrativeLintWarning(lint)).toContain("季节/天气冲突");
  });

  it("同角色年龄不一致：谢双瑶 14岁 vs 15-16岁", () => {
    const lint = lintNarrativePlan({
      clips: [
        { clipPrompt: "谢双瑶(14岁)登台", durationSeconds: 14, characterRoleNames: ["谢双瑶"] } as never,
        { clipPrompt: "谢双瑶 15-16岁 微胖深肤", durationSeconds: 15, characterRoleNames: ["谢双瑶"] } as never,
      ],
    });
    const c = lint.ageConflicts.find((x) => x.role === "谢双瑶");
    expect(c).toBeTruthy();
    expect(c!.ages.length).toBeGreaterThanOrEqual(2);
  });

  it("人名近似变体：李佑安 vs 李佑宁 → 告警", () => {
    const lint = lintNarrativePlan({
      clips: [
        { clipPrompt: "李佑安护涧", durationSeconds: 14, characterRoleNames: ["李佑安"] } as never,
        { clipPrompt: "李佑宁卦象", durationSeconds: 13, characterRoleNames: ["李佑宁"] } as never,
      ],
    });
    expect(lint.nameVariants.length).toBe(1);
    expect(buildNarrativeLintWarning(lint)).toContain("人名近似易混");
  });

  it("干净计划：无告警返回 null", () => {
    const lint = lintNarrativePlan({
      clips: [{ clipPrompt: "她推门走出，晨光斜照", durationSeconds: 5 } as never],
    });
    expect(buildNarrativeLintWarning(lint)).toBeNull();
  });
});
