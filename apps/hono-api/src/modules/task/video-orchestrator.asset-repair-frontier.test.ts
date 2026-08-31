import { describe, expect, it } from "vitest";

import { buildVideoAssetRepairProgressCursor } from "./video-orchestrator.asset-repair-frontier";

describe("buildVideoAssetRepairProgressCursor", () => {
  it("restores the exact repair mutation and its authenticated supporting tool edge", () => {
    expect(buildVideoAssetRepairProgressCursor({
      version: 3,
      runId: "run-1",
	  executionGeneration: "repair-generation-1",
      reasonCode: "authoring_asset_reference_repair_required",
      requiredAssets: [{
        kind: "scene",
        name: "卫生所手术室",
        referenceRole: "environment",
        clipIndexes: [0],
        affectedNodeIds: [],
        sourceEvidence: [],
      }],
      blockedNodeIds: [],
      retryKey: "video-asset-repair:run-1",
      nextActions: ["generate_missing_asset"],
      progress: {
        revision: 2,
        totalCount: 2,
        resolvedBindings: [{
          kind: "character",
          name: "卫生所医生",
          nodeId: "node-doctor",
        }],
      },
    })).toEqual({
      version: 1,
      graph: "video_authoring",
      scopeId: "run-1:asset_repair",
      phase: "asset_repair",
	  revision: "2",
	  executionGeneration: "repair-generation-1",
      completedUnitIds: ["asset:character:卫生所医生"],
      pendingUnitIds: ["asset:scene:卫生所手术室"],
      allowedNextActions: ["repair_assets"],
      requiredReadActions: [],
      allowedSupportingTools: [
        "tapcanvas_image_generate_to_canvas",
        "tapcanvas_image_reconcile",
      ],
    });
  });

  it("does not collapse two states of the same character into one progress unit", () => {
    const cursor = buildVideoAssetRepairProgressCursor({
      version: 3,
      runId: "run-state",
	  executionGeneration: "repair-generation-state",
      reasonCode: "authoring_asset_reference_repair_required",
      requiredAssets: [{
        kind: "character",
        name: "沈知夏",
        stateKey: "premarriage-nonpregnant",
        stateVersionId: "state-premarriage-v1",
        referenceRole: "character_state",
        clipIndexes: [3],
        affectedNodeIds: [],
        sourceEvidence: [],
      }],
      blockedNodeIds: [],
      retryKey: "video-asset-repair:run-state",
      nextActions: ["generate_missing_asset"],
      progress: {
        revision: 1,
        totalCount: 2,
        resolvedBindings: [{
          kind: "character",
          name: "沈知夏",
          stateKey: "present-pregnant",
          stateVersionId: "state-present-pregnant-v1",
          nodeId: "state-anchor-pregnant",
        }],
      },
    });

    expect(cursor.completedUnitIds).toEqual([
      "asset:character:沈知夏:state-present-pregnant-v1:present-pregnant",
    ]);
    expect(cursor.pendingUnitIds).toEqual([
      "asset:character:沈知夏:state-premarriage-v1:premarriage-nonpregnant",
    ]);
  });
});
