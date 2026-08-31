import { describe, expect, it } from "vitest";
import {
  collectVisualStateAnchorRequirements,
  parseBeatContinuityLedger,
  parseVisualStateTimeline,
  validateVisualContinuityTopology,
} from "./video-orchestrator.visual-state-timeline";

const facts = (...entries: Array<[string, string]>) =>
  entries.map(([key, value]) => ({ key, value }));

describe("visual state timeline", () => {
  it("projects one state-specific anchor across its complete clip interval", () => {
    const parsed = parseVisualStateTimeline({
      version: 1,
      intervals: [{
        characterName: "角色甲",
        stateScope: "present",
        stateVersionId: "state-present-1",
        stateKey: "present-look",
        startClipIndex: 2,
        endClipIndex: 4,
        visualFacts: facts(["body.state", "visible-version-a"]),
        anchorPolicy: "state_specific",
      }],
    });

    expect(parsed.errors).toEqual([]);
    expect(collectVisualStateAnchorRequirements(parsed.value)).toEqual([{
      characterName: "角色甲",
      stateScopes: ["present"],
      stateVersionId: "state-present-1",
      stateKey: "present-look",
      clipIndexes: [2, 3, 4],
      visualFacts: [{ key: "body.state", value: "visible-version-a" }],
    }]);
  });

  it("rejects overlapping state intervals without interpreting their prose", () => {
    const parsed = parseVisualStateTimeline({
      version: 1,
      intervals: [
        {
          characterName: "角色甲",
          stateScope: "memory",
          stateVersionId: "memory-a",
          stateKey: "memory-a",
          startClipIndex: 3,
          endClipIndex: 5,
          visualFacts: [],
          anchorPolicy: "identity",
        },
        {
          characterName: "角色甲",
          stateScope: "memory",
          stateVersionId: "memory-b",
          stateKey: "memory-b",
          startClipIndex: 5,
          endClipIndex: 6,
          visualFacts: [],
          anchorPolicy: "state_specific",
        },
      ],
    });

    expect(parsed.errors.join("\n")).toContain("存在重叠区间");
  });

  it("reuses one visual state version across non-contiguous intervals and one anchor requirement", () => {
    const parsed = parseVisualStateTimeline({
      version: 1,
      intervals: [
        {
          characterName: "角色甲",
          stateScope: "present",
          stateVersionId: "state-present-1",
          stateKey: "present-look",
          startClipIndex: 0,
          endClipIndex: 1,
          visualFacts: facts(["body.state", "visible-version-a"]),
          anchorPolicy: "state_specific",
        },
        {
          characterName: "角色甲",
          stateScope: "present",
          stateVersionId: "state-present-1",
          stateKey: "present-look",
          startClipIndex: 4,
          endClipIndex: 5,
          visualFacts: facts(["body.state", "visible-version-a"]),
          anchorPolicy: "state_specific",
        },
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(collectVisualStateAnchorRequirements(parsed.value)).toEqual([{
      characterName: "角色甲",
      stateScopes: ["present"],
      stateVersionId: "state-present-1",
      stateKey: "present-look",
      clipIndexes: [0, 1, 4, 5],
      visualFacts: [{ key: "body.state", value: "visible-version-a" }],
    }]);
  });
});

describe("clip boundary continuity ledger", () => {
  it("accepts exact previous-exit to next-entry inheritance", () => {
    const first = parseBeatContinuityLedger({
      inheritsPreviousExit: false,
      entry: { stateScope: "present", facts: facts(["character.hand.contact", "held"]) },
      exit: { stateScope: "present", facts: facts(["character.hand.contact", "released"]) },
    }).value;
    const second = parseBeatContinuityLedger({
      inheritsPreviousExit: true,
      entry: { stateScope: "present", facts: facts(["character.hand.contact", "released"]) },
      exit: { stateScope: "present", facts: facts(["character.hand.contact", "resting"]) },
    }).value;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(validateVisualContinuityTopology({
      beats: [
        { clipIndex: 0, continuityLedger: first },
        { clipIndex: 1, continuityLedger: second },
      ],
    })).toEqual([]);
  });

  it("reports the exact mismatched fact key at an inherited boundary", () => {
    const first = parseBeatContinuityLedger({
      inheritsPreviousExit: false,
      entry: { stateScope: "present", facts: facts(["character.hand.side", "side-a"]) },
      exit: { stateScope: "present", facts: facts(["character.hand.side", "side-a"]) },
    }).value;
    const second = parseBeatContinuityLedger({
      inheritsPreviousExit: true,
      entry: { stateScope: "present", facts: facts(["character.hand.side", "side-b"]) },
      exit: { stateScope: "present", facts: facts(["character.hand.side", "side-b"]) },
    }).value;

    const errors = validateVisualContinuityTopology({
      beats: [
        { clipIndex: 0, continuityLedger: first },
        { clipIndex: 1, continuityLedger: second },
      ],
    });
    expect(errors.join("\n")).toContain("character.hand.side");
    expect(errors.join("\n")).toContain("side-a");
    expect(errors.join("\n")).toContain("side-b");
  });

  it("binds each clip state version to one timeline interval and its state key", () => {
    const timeline = parseVisualStateTimeline({
      version: 1,
      intervals: [{
        characterName: "角色甲",
        stateScope: "present",
        stateVersionId: "state-present-1",
        stateKey: "present-look",
        startClipIndex: 0,
        endClipIndex: 1,
        visualFacts: facts(["body.state", "visible-version-a"]),
        anchorPolicy: "state_specific",
      }],
    }).value;

    expect(validateVisualContinuityTopology({
      timeline,
      beats: [{
        clipIndex: 0,
        stateScope: "present",
        characterStateVersions: { "角色甲": { stateId: "state-present-1" } },
        characterStates: { "角色甲": "present-look" },
      }],
    })).toEqual([]);
  });

  it("reports the available deterministic scope and version when a beat misses its interval", () => {
    const timeline = parseVisualStateTimeline({
      version: 1,
      intervals: [{
        characterName: "角色甲",
        stateScope: "chapter-2",
        stateVersionId: "state-pregnant-v1",
        stateKey: "pregnant",
        startClipIndex: 0,
        endClipIndex: 2,
        visualFacts: facts(["body.state", "pregnant"]),
        anchorPolicy: "state_specific",
      }],
    }).value;

    const errors = validateVisualContinuityTopology({
      timeline,
      beats: [{
        clipIndex: 1,
        stateScope: "main-timeline",
        characterStateVersions: { "角色甲": { stateId: "pregnant" } },
        characterStates: { "角色甲": "pregnant" },
      }],
    }).join("\n");
    expect(errors).toContain('temporalContext.stateScope="main-timeline"');
    expect(errors).toContain('"stateScope":"chapter-2"');
    expect(errors).toContain('"stateVersionId":"state-pregnant-v1"');
  });
});
