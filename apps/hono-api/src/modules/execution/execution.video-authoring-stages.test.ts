import { describe, expect, it } from "vitest";
import { parseChapterBeatPlan, validateClipDesignReferences, assembleDesignedBeatSheet, buildClipDesignInputs, type ChapterBeatPlan, type ClipDesign } from "./execution.video-authoring-stages";
const plan: ChapterBeatPlan = {
  sourceId: "chapter", sourceFingerprint: "source-hash", chapterArc: { endingHook: null },
  sourceCoveragePlan: { speechLedger: [] }, sourceFidelityAudit: { sourceBeatLedger: [] },
  beats: [{ durationSeconds: 10, sourceSpan: "first source" }, { durationSeconds: 15, sourceSpan: "second source" }],
};
const assets = { objectRegistry: [{ objectId: "hero" }], assetPlans: [], backgroundPlans: [{ objectId: "scene", plan: { assetId: "background" } }] };
const design = (clipIndex: number): ClipDesign => ({ clipIndex, beat: { visualIntent: `design-${clipIndex}` }, blockingPlan: { characters: [], backgroundObjectId: "scene" },
  timing: { transitionFromPrevious: "continuous", transitionToNext: "continuous", temporalDirectives: [{ startSeconds: 1, endSeconds: 4, kind: "action", reason: "authored" }] } });
describe("independently persisted video authoring stages", () => {
  it("joins out-of-order clip completions by exact identity without rewriting chapter facts", () => {
    const before = structuredClone(plan);
    const result = assembleDesignedBeatSheet(plan, assets, [design(1), design(0)]);
    expect(result.beats.map(beat => beat.visualIntent)).toEqual(["design-0", "design-1"]);
    expect(result.sequenceControlPlan.segments[1].temporalDirectives[0]).toMatchObject({ startSeconds: 11, endSeconds: 14 });
    expect(result.sequenceControlPlan.totalDurationSeconds).toBe(25);
    expect(result.sourceCoveragePlan).toBe(plan.sourceCoveragePlan);
    expect(plan).toEqual(before);
  });
  it("supplies adjacent chapter facts and shared identities to each isolated clip", () => {
    const inputs = buildClipDesignInputs(plan, assets);
    expect(inputs[0].previousBeat).toBeNull();
    expect(inputs[0].nextBeat).toBe(plan.beats[1]);
    expect(inputs[1].objectRegistry).toBe(assets.objectRegistry);
    expect(inputs[1].nextBeat).toBeNull();
  });
  it("rejects missing, duplicate and out-of-scope completions instead of silently pairing by arrival order", () => {
    expect(() => assembleDesignedBeatSheet(plan, assets, [design(0)])).toThrow("missing clip_design: 1");
    expect(() => assembleDesignedBeatSheet(plan, assets, [design(0), design(0)])).toThrow("duplicate");
    expect(() => assembleDesignedBeatSheet(plan, assets, [design(2)])).toThrow("out of range");
  });
  it("preserves frozen beat facts and rejects invalid authored local timing", () => {
    expect(() => assembleDesignedBeatSheet(plan, assets, [{ ...design(0), beat: { durationSeconds: 20 } }, design(1)])).toThrow("redefines chapter facts");
    const invalid = design(0);
    expect(() => assembleDesignedBeatSheet(plan, assets, [{ ...invalid, timing: { ...invalid.timing, temporalDirectives: [{ startSeconds: 0, endSeconds: 11, kind: "action", reason: "authored" }] } }, design(1)])).toThrow("outside local clip interval");
  });
});

import { stagedAuthoringFixture } from "./test-fixtures/video-authoring-stages";

it("rejects dangling speech indices at chapter author acceptance before splitting clips", () => {
  const { chapter } = stagedAuthoringFixture();
  const invalid = { ...chapter, sourceCoveragePlan: { speechLedger: [{
    lineId: 'line-1', speakerName: 'speaker', text: 'speech', delivery: 'on_screen', clipIndex: chapter.beats.length,
  }] } };
  expect(() => parseChapterBeatPlan(invalid)).toThrow('sourceCoveragePlan.speechLedger[0].clipIndex');
  invalid.sourceCoveragePlan.speechLedger[0].clipIndex = 0;
  expect(parseChapterBeatPlan(invalid).sourceCoveragePlan).toEqual(invalid.sourceCoveragePlan);
});
import { applyWorkflowArtifactJsonObjectContract, validateWorkflowAgentOutput } from "./execution.agent-output-contract";

it("accepts the staged transport through the existing full BeatSheet consumer", () => {
  const { chapter, shared, clip } = stagedAuthoringFixture();
  const assembled = assembleDesignedBeatSheet(chapter, shared, [clip]);
  const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", {
    requiredStringFields: ["sourceId", "sourceFingerprint", "protocolVersion"],
    requiredArrayFields: ["beats", "objectRegistry", "assetPlans", "blockingPlans"], allowedFields: Object.keys(assembled),
  });
  const checked = validateWorkflowAgentOutput({ rawText: JSON.stringify(assembled), encoding: "json_object", artifactType: "tapcanvas.beat-sheet/v2", jsonObjectContract: contract });
  expect(checked).toMatchObject({ ok: true });
});


it("scopes the original speech ledger to its exact clip without losing or rewriting lines", () => {
  const lines = [{ lineId: "a", clipIndex: 0, text: "第一句" }, { lineId: "b", clipIndex: 1, text: "第二句" }];
  const inputs = buildClipDesignInputs({ ...plan, sourceCoveragePlan: { speechLedger: lines } }, assets);
  expect(inputs[0].speechLedger).toEqual([lines[0]]);
  expect(inputs[1].speechLedger).toEqual([lines[1]]);
  expect(inputs.flatMap(input => input.speechLedger)).toEqual(lines);
});

import { bindClipDesignSchema } from "../../../../../packages/schemas/video-authoring-stages/schema.mjs";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";

it("binds clip index, registered identities and provider clock to the schema before authoring", () => {
  const { clip } = stagedAuthoringFixture();
  const schema = bindClipDesignSchema({ speechLineIds: [], clipIndex: 0, durationSeconds: 10, objectIds: ["scene"], backgroundObjectIds: ["scene"] });
  expect(validateWorkflowToolArguments(schema, clip)).toEqual([]);
  expect(validateWorkflowToolArguments(schema, { ...clip, clipIndex: 1 }).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(schema, { ...clip, blockingPlan: { ...clip.blockingPlan, backgroundObjectId: "invented" } }).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(schema, { ...clip, timing: { ...clip.timing, temporalDirectives: [{ startSeconds: 1, endSeconds: 11, kind: "action", reason: "authored" }] } }).length).toBeGreaterThan(0);
});

it("repairs mismatched placement and reference handles before clip assembly without dropping authored content", () => {
  const { shared, clip } = stagedAuthoringFixture();
  const invalid = { ...clip, blockingPlan: { ...clip.blockingPlan, characters: [{ name: '未声明角色', at: [0.2, 0.3] }] } };
  const original = structuredClone(invalid);
  expect(() => validateClipDesignReferences(invalid, shared.objectRegistry)).toThrow('extra=[未声明角色]');
  expect(invalid).toEqual(original);
  expect(() => validateClipDesignReferences(clip, shared.objectRegistry)).not.toThrow();
  const references = { ...clip, beat: { ...clip.beat, objectStates: [{ objectId: 'scene', referenceAssetIds: ['unknown'], referenceImageNodeIds: [] }] } };
  expect(() => validateClipDesignReferences(references, shared.objectRegistry)).toThrow("outside this object's registry");
});

it('requires frozen background membership in the author schema, not only the later assembly', () => {
  const { clip } = stagedAuthoringFixture();
  const schema = bindClipDesignSchema({ speechLineIds: [], clipIndex: 0, durationSeconds: 10, objectIds: ['scene', 'hero'], backgroundObjectIds: ['scene'] });
  const objectStates = clip.beat.objectStates;
  if (!Array.isArray(objectStates)) throw new Error('fixture objectStates must be an array');
  const invalid = { ...clip, beat: { ...clip.beat, objectStates: objectStates.map((state: unknown) => {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('fixture state must be an object');
    return { ...state, objectId: 'hero' };
  }) } };
  expect(validateWorkflowToolArguments(schema, invalid).some(issue => issue.path.includes('objectStates'))).toBe(true);
  expect(validateWorkflowToolArguments(schema, clip)).toEqual([]);
});

it('binds narrative source identities to this clip speech ledger while allowing authored nulls', () => {
  const { clip } = stagedAuthoringFixture();
  const schema = bindClipDesignSchema({ speechLineIds: ['L1'], clipIndex: 0, durationSeconds: 10, objectIds: ['scene'], backgroundObjectIds: ['scene'] });
  const line = { lineId: 'spoken-1', speakerName: 'speaker', text: 'words', delivery: 'on_screen', sourceLineId: null, afterSourceLineId: null, sourceEvidence: [] };
  const withLine = (sourceLineId: string | null) => ({ ...clip, beat: { ...clip.beat, narrativeAudioPlan: { strategy: 'mixed', rationale: 'source and authored speech', lines: [{ ...line, sourceLineId }] } } });
  expect(validateWorkflowToolArguments(schema, withLine(null))).toEqual([]);
  expect(validateWorkflowToolArguments(schema, withLine('L1'))).toEqual([]);
  expect(validateWorkflowToolArguments(schema, withLine('story-event-1')).some(issue => issue.path.endsWith('sourceLineId'))).toBe(true);
  const base = withLine(null);
  const badAnchor = { ...base, beat: { ...base.beat, narrativeAudioPlan: {
    ...base.beat.narrativeAudioPlan, lines: [{ ...line, afterSourceLineId: 'spoken-1' }],
  } } };
  expect(validateWorkflowToolArguments(schema, badAnchor).some(issue => issue.path.endsWith('afterSourceLineId'))).toBe(true);
});

it('rejects zero-width story event intervals at the chapter author boundary', () => {
 const invalid = structuredClone(stagedAuthoringFixture().chapter);
 const beat = invalid.beats[0] as Record<string, unknown>;
 beat.storyEvents = [{ sourceBeatId: 'event', event: 'action', exitState: 'done', startSeconds: 2, endSeconds: 2 }];
 expect(() => parseChapterBeatPlan(invalid)).toThrow('must satisfy gt');
});
