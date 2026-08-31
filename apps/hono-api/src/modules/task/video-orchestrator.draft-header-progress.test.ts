import { describe, expect, it } from "vitest";

import {
  assertDraftHeaderPatch,
  assertDraftHeaderRequiredFrontierAdvanced,
  readMissingDraftHeaderFields,
  readNextDraftHeaderPatchField,
} from "./video-orchestrator.draft-header-progress";

describe("BeatSheet incremental header frontier", () => {
  it("reports only execution-critical missing fields", () => {
    const header = {
      version: 2,
      storyFactsContext: { mode: "task_context" },
      meta: { executionScope: "media_delivery", videoModel: "model-a", deliveryScope: "full_chapter" },
    };
    expect(readMissingDraftHeaderFields(header)).toEqual([
      "sourceCoveragePlan",
      "meta.aspect",
      "meta.resolution",
    ]);
    expect(readNextDraftHeaderPatchField(header)).toBe("sourceCoveragePlan");
  });

  it("groups missing executable meta leaves into one structural meta patch", () => {
    const header = {
      sourceCoveragePlan: {},
      filmBible: {},
      adaptationStrategy: {},
      castManifest: [],
      meta: { executionScope: "media_delivery", videoModel: "model-a", deliveryScope: "full_chapter" },
    };
    expect(readNextDraftHeaderPatchField(header)).toBe("meta");
    expect(() => assertDraftHeaderPatch({ meta: { aspect: "16:9", resolution: "480p" } })).not.toThrow();
  });

  it("accepts multi-section patches and rejects only structural unknowns", () => {
    expect(() => assertDraftHeaderPatch({
      visualStateTimeline: { version: 1, intervals: [] },
      filmBible: {},
      castManifest: [],
      meta: { aspect: "16:9", resolution: "480p" },
    })).not.toThrow();
    expect(() => assertDraftHeaderPatch({})).toThrow(/patch_empty/);
    expect(() => assertDraftHeaderPatch({ inventedSection: {} })).toThrow(/unknown_fields/);
  });

  it("does not mint progress when optional metadata leaves the required frontier untouched", () => {
    const current = {
      meta: { executionScope: "media_delivery", aspect: "16:9", resolution: "480p" },
    };
    expect(() => assertDraftHeaderRequiredFrontierAdvanced({
      current,
      next: {
        ...current,
        filmBible: { directorTone: "restrained" },
      },
    })).toThrow(/required=sourceCoveragePlan/);
    expect(() => assertDraftHeaderRequiredFrontierAdvanced({
      current,
      next: {
        ...current,
        sourceCoveragePlan: { spans: [], speechLedger: [] },
      },
    })).not.toThrow();
  });

  it("requires the first missing executable meta leaf before a later one can count as progress", () => {
    const current = {
      sourceCoveragePlan: {},
      meta: { executionScope: "media_delivery" },
    };
    expect(() => assertDraftHeaderRequiredFrontierAdvanced({
      current,
      next: {
        ...current,
        meta: { executionScope: "media_delivery", resolution: "480p" },
      },
    })).toThrow(/required=meta\.aspect/);
  });
});
