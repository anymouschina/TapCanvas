import { describe, expect, it } from "vitest";

import {
  buildBeatSheetRepairActions,
  resolveBeatSheetRepairTargets,
} from "./video-orchestrator.repair-targets";

describe("BeatSheet repair target projection", () => {
  it("projects arbitrary validator paths to durable graph node addresses", () => {
    expect(resolveBeatSheetRepairTargets([
      "beats[7].assetObjectContracts[2].kind 无效",
      "beats[1].sceneName 必填",
      "beats[7].durationBudget 无效",
    ])).toEqual({ header: false, clipIndexes: [1, 7], continuityClipIndexes: [] });
  });

  it("marks non-beat or malformed paths as header/graph repair evidence", () => {
    expect(resolveBeatSheetRepairTargets([
      "meta.videoModel 缺失",
      "beats[x].sceneName 必填",
    ])).toEqual({ header: true, clipIndexes: [], continuityClipIndexes: [] });
  });

  it("separates deterministic inherited-boundary targets from other beat repairs", () => {
    expect(resolveBeatSheetRepairTargets([
      "beats[2].continuityLedger.entry.stateScope 必须等于上一 beat exit.stateScope",
      "beats[2].continuityLedger.entry.facts 的姿态未逐字承接上一 beat exit",
      "beats[2].characterStateVersions.沈知夏 必须命中 visualStateTimeline",
      "beats[0].continuityLedger.inheritsPreviousExit 必须为 false",
    ])).toEqual({
      header: false,
      clipIndexes: [0, 2],
      continuityClipIndexes: [2],
    });
  });

  it("exposes only operations that can act on the projected repair dimensions", () => {
    expect(buildBeatSheetRepairActions({
      header: false,
      clipIndexes: [1, 2],
      continuityClipIndexes: [],
    })).toEqual([
      "preflight_get_beat",
      "preflight_patch_beat",
      "preflight_commit",
    ]);
    expect(buildBeatSheetRepairActions({
      header: true,
      clipIndexes: [2],
      continuityClipIndexes: [2],
    })).toEqual([
      "preflight_get_header",
      "preflight_patch_header",
      "preflight_get_beat",
      "preflight_patch_beat",
      "preflight_repair_continuity",
      "preflight_commit",
    ]);
  });
});
