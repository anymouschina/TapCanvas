import { describe, expect, it } from "vitest";

import {
  validateShotDialogueConservation,
  validateSpokenTextAbsentFromControlFields,
} from "./video-orchestrator.dialogue-conservation";

const ledger = [{
  lineId: "line-1",
  speakerName: "甲",
  text: "尸骨未寒",
  delivery: "off_screen" as const,
}];

describe("independent speech-event conservation", () => {
  it("accepts an exact whole-line event independent of visual cuts", () => {
    expect(validateShotDialogueConservation({
      clip: {
        speechEvents: [{
          speechEventId: "speech-line-1",
          lineId: "line-1",
          speakerName: "甲",
          delivery: "off_screen",
          spokenText: "尸骨未寒",
        }],
        shots: [
          { speechEventIds: ["speech-line-1"] },
          { speechEventIds: ["speech-line-1"] },
        ],
      },
      dialogueScript: ledger,
    })).toEqual([]);
  });

  it("rejects rewritten, duplicated, missing, reordered, or wrong-speaker speech", () => {
    const issues = validateShotDialogueConservation({
      clip: {
        speechEvents: [
          { speechEventId: "a", lineId: "line-1", speakerName: "乙", delivery: "on_screen", spokenText: "尸骨未" },
          { speechEventId: "b", lineId: "line-1", speakerName: "甲", delivery: "off_screen", spokenText: "寒" },
        ],
      },
      dialogueScript: ledger,
    });
    expect(issues.join("|")).toContain("重复承载");
    expect(issues.join("|")).toContain("必须逐字还原原文");
    expect(issues.join("|")).toContain("speakerName");
    expect(issues.join("|")).toContain("delivery");
  });

  it("keeps frozen spoken text out of visual and SFX control fields", () => {
    expect(validateSpokenTextAbsentFromControlFields({
      dialogueScript: ledger,
      fields: [{ path: "shots[0].visualTask", value: "用字幕显示尸骨未寒" }],
    })).toEqual([expect.stringContaining("shots[0].visualTask")]);
  });
});
