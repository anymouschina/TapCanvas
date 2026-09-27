import { type SourceUnitLedger } from "../../../../../packages/schemas/source-unit-ledger/index.mjs";
import { projectChapterAssetSources } from "./execution.chapter-asset-source";
import { describe, expect, it } from "vitest";
import { chapterSpeechLedger, parseChapterBeatPlan, parseChapterAssetPlan, validateClipDesignReferences, assembleDesignedBeatSheet, buildClipDesignInputs, type ChapterBeatPlan, type ClipDesign } from "./execution.video-authoring-stages";
const plan: ChapterBeatPlan = {
  sourceId: "chapter", sourceFingerprint: "source-hash", chapterArc: { endingHook: null },
  sourceFidelityAudit: { sourceBeatLedger: [] },
  beats: [{ durationSeconds: 10, sourceSpan: "first source", sourceUnitRefs: [{ unitId: "u0", startOffset: 0, endOffset: 3 }] }, { durationSeconds: 15, sourceSpan: "second source", sourceUnitRefs: [{ unitId: "u1", startOffset: 0, endOffset: 3 }] }],
};
const ledger: SourceUnitLedger = { sourceId: 'chapter', sourceFingerprint: 'source-hash', units: [0, 1].map(i => ({ unitId: `u${i}`, sourceLineId: `l${i}`, text: '门打开', expression: 'narration', speakerName: null, delivery: null })) };
const assets = { objectRegistry: [{ objectId: "hero", kind: "character", name: "人物", physicalIdentityKey: "hero", identityInvariant: "同一人", referenceRole: "identity", imageSource: { mode: "reuse", assetIds: ["hero-image"] } }], backgroundPlans: [{ objectId: "scene", plan: { assetId: "background" } }] };
const design = (clipIndex: number): ClipDesign => ({ clipIndex, beat: { visualIntent: `design-${clipIndex}` }, blockingPlan: { characters: [], backgroundObjectId: "scene" },
  timing: { transitionFromPrevious: "continuous", transitionToNext: "continuous", temporalDirectives: [{ startSeconds: 1, endSeconds: 4, kind: "action", reason: "authored" }] } });
describe("independently persisted video authoring stages", () => {
  it("joins out-of-order clip completions by exact identity without rewriting chapter facts", () => {
    const before = structuredClone(plan);
    const result = assembleDesignedBeatSheet(plan, assets, [design(1), design(0)], ledger);
    expect(result.beats.map(beat => beat.visualIntent)).toEqual(["design-0", "design-1"]);
    expect(result.sequenceControlPlan.segments[1].temporalDirectives[0]).toMatchObject({ startSeconds: 11, endSeconds: 14 });
    expect(result.sequenceControlPlan.totalDurationSeconds).toBe(25);
    expect(result.sourceCoveragePlan).toMatchObject({ speechLedger: [], sourceUnitLedger: ledger });
    expect(plan).toEqual(before);
  });
  it("supplies adjacent chapter facts and shared identities to each isolated clip", () => {
    const inputs = buildClipDesignInputs(plan, assets, ledger);
    expect(inputs[0].previousBeat).toBeNull();
    expect(inputs[0].nextBeat).toMatchObject({
      durationSeconds: plan.beats[1]!.durationSeconds,
      sourceSpan: plan.beats[1]!.sourceSpan,
      sourceUnitRefSummary: { count: 1, unitIds: ["u1"], readPolicy: "parent_chapter_plan_source_unit_refs" },
    });
    expect(inputs[0].nextBeat).not.toHaveProperty("sourceUnitRefs");
    expect(inputs[1].objectRegistry).toEqual(projectChapterAssetSources(assets.objectRegistry).objectRegistry);
    expect(inputs[1].nextBeat).toBeNull();
    expect(inputs[1].beat.sourceUnitRefs).toEqual(plan.beats[1]!.sourceUnitRefs);
  });
  it("rejects missing, duplicate and out-of-scope completions instead of silently pairing by arrival order", () => {
    expect(() => assembleDesignedBeatSheet(plan, assets, [design(0)], ledger)).toThrow("missing clip_design: 1");
    expect(() => assembleDesignedBeatSheet(plan, assets, [design(0), design(0)], ledger)).toThrow("duplicate");
    expect(() => assembleDesignedBeatSheet(plan, assets, [design(2)], ledger)).toThrow("out of range");
  });
  it("preserves frozen beat facts and rejects invalid authored local timing", () => {
    expect(() => assembleDesignedBeatSheet(plan, assets, [{ ...design(0), beat: { durationSeconds: 20 } }, design(1)], ledger)).toThrow("redefines chapter facts");
    const invalid = design(0);
    expect(() => assembleDesignedBeatSheet(plan, assets, [{ ...invalid, timing: { ...invalid.timing, temporalDirectives: [{ startSeconds: 0, endSeconds: 11, kind: "action", reason: "authored" }] } }, design(1)], ledger)).toThrow("outside local clip interval");
  });
});

import { stagedAuthoringFixture } from "./test-fixtures/video-authoring-stages";

it("rejects independently indexed speech ledgers at chapter author acceptance", () => {
  const { chapter } = stagedAuthoringFixture();
  const invalid = { ...chapter, sourceCoveragePlan: { speechLedger: [{
    lineId: 'line-1', speakerName: 'speaker', text: 'speech', delivery: 'on_screen', clipIndex: chapter.beats.length,
  }] } };
  expect(() => parseChapterBeatPlan(invalid)).toThrow('sourceCoveragePlan');
  expect(parseChapterBeatPlan(chapter)).toEqual(chapter);
});
import { applyWorkflowArtifactJsonObjectContract, validateWorkflowAgentOutput } from "./execution.agent-output-contract";

it("accepts the staged transport through the existing full BeatSheet consumer", () => {
  const { chapter, shared, clip, ledger } = stagedAuthoringFixture();
  const assembled = assembleDesignedBeatSheet(chapter, shared, [clip], ledger);
  const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", {
    requiredStringFields: ["sourceId", "sourceFingerprint", "protocolVersion"],
    requiredArrayFields: ["beats", "objectRegistry", "assetPlans", "blockingPlans"], allowedFields: Object.keys(assembled),
  });
  const checked = validateWorkflowAgentOutput({ rawText: JSON.stringify(assembled), encoding: "json_object", artifactType: "tapcanvas.beat-sheet/v2", jsonObjectContract: contract });
  expect(checked, JSON.stringify(checked)).toMatchObject({ ok: true });
});


it("projects dialogue and speaker only from the independent frozen ledger", () => {
  const speechLedger: SourceUnitLedger = { ...ledger, units: ledger.units.map((unit, i) => ({ ...unit, expression: 'spoken', speakerName: `speaker-${i}`, delivery: 'on_screen', text: '同句话' })) };
  const inputs = buildClipDesignInputs(plan, assets, speechLedger);
  expect(inputs[0].speechLedger).toMatchObject([{ speakerName: 'speaker-0', text: '同句话', clipIndex: 0 }]);
  expect(inputs[1].speechLedger).toMatchObject([{ speakerName: 'speaker-1', text: '同句话', clipIndex: 1 }]);
  expect(assembleDesignedBeatSheet(plan, assets, [design(1), design(0)], speechLedger).sourceCoveragePlan.speechLedger).toEqual(inputs.flatMap(input => input.speechLedger));
  expect(() => chapterSpeechLedger({ ...plan, beats: [plan.beats[0]] }, speechLedger)).toThrow();
  expect(() => chapterSpeechLedger({ ...plan, beats: [...plan.beats].reverse() }, speechLedger)).toThrow();
  expect(() => chapterSpeechLedger(plan, { ...speechLedger, sourceFingerprint: 'other-source' })).toThrow('lineage');
});

it('freezes chapter-authored entry exit and pace against per-clip rewrites', () => {
  const { chapter, shared, clip, ledger } = stagedAuthoringFixture();
  const result = assembleDesignedBeatSheet(chapter, shared, [clip], ledger);
  expect(result.beats[0]).toMatchObject({ startKeyframe: '关闭的门', endKeyframe: '打开的门', dialoguePaceRate: 4 });
  for (const field of ['startKeyframe', 'endKeyframe', 'dialoguePaceRate', 'dialogueScript']) {
    expect(() => assembleDesignedBeatSheet(chapter, shared, [{ ...clip, beat: { ...clip.beat, [field]: 'changed' } }], ledger)).toThrow('redefines chapter facts');
  }
});

import { bindClipDesignSchema } from "../../../../../packages/schemas/video-authoring-stages/schema.mjs";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";

it("binds clip index, registered identities and provider clock to the schema before authoring", () => {
  const { clip } = stagedAuthoringFixture();
  const schema = bindClipDesignSchema({ speechLineIds: [], clipIndex: 0, durationSeconds: 10, objectIds: ["scene"], sceneObjectIds: ["scene"], backgroundObjectIds: ["scene"] });
  expect(validateWorkflowToolArguments(schema, clip)).toEqual([]);
  expect(validateWorkflowToolArguments(schema, { ...clip, clipIndex: 1 }).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(schema, { ...clip, blockingPlan: { ...clip.blockingPlan, backgroundObjectId: "invented" } }).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(schema, { ...clip, timing: { ...clip.timing, temporalDirectives: [{ startSeconds: 1, endSeconds: 11, kind: "action", reason: "authored" }] } }).length).toBeGreaterThan(0);
});

it("repairs mismatched placement and reference handles before clip assembly without dropping authored content", () => {
  const { shared, clip } = stagedAuthoringFixture();
  const invalid = { ...clip, blockingPlan: { ...clip.blockingPlan, characters: [{ name: '未声明角色', at: [0.2, 0.3] }] } };
  const original = structuredClone(invalid);
  expect(() => validateClipDesignReferences(invalid, projectChapterAssetSources(shared.objectRegistry).objectRegistry)).toThrow('extra=[未声明角色]');
  expect(invalid).toEqual(original);
  expect(() => validateClipDesignReferences(clip, projectChapterAssetSources(shared.objectRegistry).objectRegistry)).not.toThrow();
  const references = { ...clip, beat: { ...clip.beat, objectStates: [{ objectId: 'scene', referenceAssetIds: ['unknown'], referenceImageNodeIds: [] }] } };
  expect(() => validateClipDesignReferences(references, projectChapterAssetSources(shared.objectRegistry).objectRegistry)).toThrow("outside this object's registry");
});

it('requires frozen scene membership in the author schema, not only the later assembly', () => {
  const { clip } = stagedAuthoringFixture();
  const schema = bindClipDesignSchema({ speechLineIds: [], clipIndex: 0, durationSeconds: 10, objectIds: ['scene', 'hero'], sceneObjectIds: ["scene"], backgroundObjectIds: ['scene'] });
  const invalid = { ...clip, beat: { ...clip.beat, objectStates: clip.beat.objectStates.map(state => ({ ...state, objectId: 'hero' })) } };
  expect(validateWorkflowToolArguments(schema, invalid).some(issue => issue.path.includes('objectStates'))).toBe(true);
  expect(validateWorkflowToolArguments(schema, clip)).toEqual([]);
});

it('binds narrative source identities to this clip speech ledger while allowing authored nulls', () => {
  const { clip } = stagedAuthoringFixture();
  const schema = bindClipDesignSchema({ speechLineIds: ['L1'], clipIndex: 0, durationSeconds: 10, objectIds: ['scene'], sceneObjectIds: ["scene"], backgroundObjectIds: ['scene'] });
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


it('keeps registered scenes and background plan identities separate across authoring and assembly', () => {
  const { clip, shared, chapter, ledger } = stagedAuthoringFixture();
  const value = { ...clip, blockingPlan: { ...clip.blockingPlan, backgroundObjectId: 'background-day' } };
  const schema = bindClipDesignSchema({ speechLineIds: [], clipIndex: 0, durationSeconds: 10,
    objectIds: ['scene'], sceneObjectIds: ['scene'], backgroundObjectIds: ['background-day'] });
  expect(validateWorkflowToolArguments(schema, value)).toEqual([]);
  const distinctAssets = { ...shared, backgroundPlans: shared.backgroundPlans.map(background => ({ ...background, objectId: 'background-day' })) };
  const assembled = assembleDesignedBeatSheet(chapter, distinctAssets, [value], ledger);
  expect(validateWorkflowAgentOutput({ encoding: 'json_object', artifactType: 'tapcanvas.beat-sheet/v2', rawText: JSON.stringify(assembled), jsonObjectContract: applyWorkflowArtifactJsonObjectContract('tapcanvas.beat-sheet/v2', { requiredStringFields: ['sourceId', 'sourceFingerprint', 'protocolVersion'], requiredArrayFields: ['beats', 'objectRegistry', 'assetPlans', 'blockingPlans'], allowedFields: Object.keys(assembled) }) }).ok).toBe(true);
  expect(() => validateClipDesignReferences(value, projectChapterAssetSources(shared.objectRegistry).objectRegistry)).not.toThrow();
  const inventedState = { ...value, beat: { ...value.beat, objectStates: value.beat.objectStates.map(state => ({ ...state, objectId: 'background-day' })) } };
  expect(validateWorkflowToolArguments(schema, inventedState).length).toBeGreaterThan(0);
  expect(() => bindClipDesignSchema({ speechLineIds: [], clipIndex: 0, durationSeconds: 10,
    objectIds: ['scene'], sceneObjectIds: ['unregistered'], backgroundObjectIds: ['background-day'] })).toThrow('scene IDs');
});

it('namespaces duplicate background plans by their frozen asset identity before Clip authoring', () => {
  const duplicate = {
    objectRegistry: [{ objectId: 'scene', kind: 'scene', name: '广场', physicalIdentityKey: null, referenceRole: 'environment', identityInvariant: '同一空间', imageSource: { mode: 'reuse', assetIds: ['scene-image'] } }],
    backgroundPlans: [
      { objectId: 'scene', plan: { assetId: 'day-background', displayName: '白天', prompt: 'day', negativePrompt: 'none', referenceAssetBindings: [] } },
      { objectId: 'scene', plan: { assetId: 'night-background', displayName: '夜间', prompt: 'night', negativePrompt: 'none', referenceAssetBindings: [] } },
    ],
  };
  const parsed = parseChapterAssetPlan(duplicate);
  expect(parsed.backgroundPlans.map((item) => item.objectId)).toEqual([
    'scene::background::day-background::0',
    'scene::background::night-background::1',
  ]);
  expect(new Set(parsed.backgroundPlans.map((item) => item.objectId)).size).toBe(2);
});
