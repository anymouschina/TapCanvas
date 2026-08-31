import { describe, expect, it } from "vitest";

import {
  buildSourceCoverageCommitRepair,
  buildSpeechLedgerCommitRepair,
} from "./video-orchestrator.commit-repair";

describe("BeatSheet commit repair descriptors", () => {
  it("addresses source coverage failures only to the header", () => {
    expect(buildSourceCoverageCommitRepair(["span 断裂"])).toMatchObject({
      code: "source_coverage_plan_invalid",
      targets: {
        header: true,
        clipIndexes: [],
      },
      actions: ["preflight_get_header", "preflight_patch_header", "preflight_commit"],
      issues: ["sourceCoveragePlan: span 断裂"],
    });
  });

  it("exposes both ledger owners without choosing a semantic repair locally", () => {
    expect(buildSpeechLedgerCommitRepair({
      issues: ["line count mismatch"],
      expectedBeatCount: 3,
    })).toMatchObject({
      code: "source_speech_ledger_mismatch",
      targets: {
        header: true,
        clipIndexes: [0, 1, 2],
        continuityClipIndexes: [],
      },
      actions: [
        "preflight_get_header",
        "preflight_patch_header",
        "preflight_get_beat",
        "preflight_patch_beat",
        "preflight_commit",
      ],
    });
  });

  it("derives the repair fan-out from the dynamic beat count", () => {
    const descriptor = buildSpeechLedgerCommitRepair({
      issues: ["mismatch"],
      expectedBeatCount: 5,
    });
    expect(descriptor.targets.clipIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(descriptor.issues.filter((issue) => issue.startsWith("beats["))).toHaveLength(5);
  });
});
