import { projectSourceUnitReferences, type SourceUnitLedger, type SourceUnitBeat } from "../../../../../packages/schemas/source-unit-ledger/index.mjs";
import { inspectBlockingCharacterCoverage } from "../../../../../packages/schemas/blocking-plan-contract/index.mjs";
import { inspectClipReferenceSelection } from "../../../../../packages/schemas/clip-reference-selection/index.mjs";
import { chapterBeatPlanSchema, chapterAssetPlanSchema, clipDesignSchema } from "../../../../../packages/schemas/video-authoring-stages/schema.mjs";
import { projectChapterAssetSources } from "./execution.chapter-asset-source";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";

/** Typed transport between independently persisted authoring stages.
 * All creative fields come from agents; this module only joins exact identities.
 */
type Facts = Readonly<Record<string, unknown>>;
type AdjacentBeatFacts = Readonly<Record<string, unknown> & {
	sourceUnitRefs?: readonly Readonly<{ unitId: string }>[];
}>;

/**
 * Source allocation references are host lineage, not adjacent Clip design
 * facts. The current beat keeps its complete references; neighbouring beats
 * retain an exact, countable identity summary so a Clip author can see the
 * handoff boundary without receiving another copy of the chapter ledger.
 */
function projectAdjacentBeat(beat: AdjacentBeatFacts): Facts {
	const sourceUnitRefs = beat.sourceUnitRefs;
	if (!sourceUnitRefs) return beat;
	const { sourceUnitRefs: _sourceUnitRefs, ...facts } = beat;
	return {
		...facts,
		sourceUnitRefSummary: {
			count: sourceUnitRefs.length,
			unitIds: sourceUnitRefs.map((reference) => reference.unitId),
			readPolicy: "parent_chapter_plan_source_unit_refs",
		},
	};
}
export type ChapterBeatPlan = Readonly<{
  sourceId: string;
  sourceFingerprint: string;
  chapterArc: Facts;
  sourceFidelityAudit: Facts;
  beats: readonly SourceUnitBeat[];
}>;
export type ChapterAssetPlan = Readonly<{
  objectRegistry: readonly Facts[];
  backgroundPlans: readonly Readonly<{ objectId: string; plan: Facts }>[];
}>;
export type ClipDesign = Readonly<{
  clipIndex: number;
  beat: Facts;
  blockingPlan: Facts;
  /** Directive windows are local clip seconds at this authoring boundary. */
  timing: Readonly<{
    transitionFromPrevious: string;
    transitionToNext: string;
    temporalDirectives: readonly Readonly<{
      startSeconds: number;
      endSeconds: number;
      kind: string;
      reason: string;
    }>[];
  }>;
}>;

function duration(beat: Facts, index: number): number {
  const value = beat.durationSeconds;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`chapter_plan.beats[${index}].durationSeconds must be positive`);
  }
  return value;
}

export function buildClipDesignInputs(plan: ChapterBeatPlan, assets: ChapterAssetPlan, ledger: SourceUnitLedger) {
  if (plan.beats.length === 0) throw new Error("chapter_plan.beats must be non-empty");
  const projected = projectChapterSource(plan, ledger);
  const speechLedger = projected.speechLedger;
  const sources = projectChapterAssetSources(assets.objectRegistry);
  return projected.beats.map((beat, clipIndex) => ({
    clipIndex,
    sourceId: plan.sourceId,
    sourceFingerprint: plan.sourceFingerprint,
    chapterArc: plan.chapterArc,
    beat,
		previousBeat: clipIndex > 0 ? projectAdjacentBeat(projected.beats[clipIndex - 1]!) : null,
		nextBeat: clipIndex + 1 < plan.beats.length ? projectAdjacentBeat(projected.beats[clipIndex + 1]!) : null,
    objectRegistry: sources.objectRegistry,
    backgroundPlans: assets.backgroundPlans.map(item => ({ objectId: item.objectId, displayName: item.plan.displayName })),
    speechLedger: speechLedger.filter(line => line.clipIndex === clipIndex),
  }));
}

/** Source speech is projected from an independently persisted source artifact. */
function projectChapterSource(plan: ChapterBeatPlan, ledger: SourceUnitLedger) {
  if (plan.sourceId !== ledger.sourceId || plan.sourceFingerprint !== ledger.sourceFingerprint) {
    throw new Error("Chapter source lineage must match the frozen source ledger");
  }
  return projectSourceUnitReferences(ledger, plan.beats);
}

export function chapterSpeechLedger(plan: ChapterBeatPlan, ledger: SourceUnitLedger) {
  return projectChapterSource(plan, ledger).speechLedger;
}

export function assembleDesignedBeatSheet(
  plan: ChapterBeatPlan,
  assets: ChapterAssetPlan,
  designs: readonly ClipDesign[],
  ledger: SourceUnitLedger,
) {
  if (plan.beats.length === 0) throw new Error("chapter_plan.beats must be non-empty");
  const byIndex = new Map<number, ClipDesign>();
  for (const design of designs) {
    if (!Number.isInteger(design.clipIndex) || design.clipIndex < 0 || design.clipIndex >= plan.beats.length) {
      throw new Error(`clip_design.clipIndex out of range: ${design.clipIndex}`);
    }
    if (byIndex.has(design.clipIndex)) throw new Error(`duplicate clip_design: ${design.clipIndex}`);
    byIndex.set(design.clipIndex, design);
  }
  const sources = projectChapterAssetSources(assets.objectRegistry);
  let cursor = 0;
  const projected = projectChapterSource(plan, ledger);
  const assembled = projected.beats.map((beat, clipIndex) => {
    const design = byIndex.get(clipIndex);
    if (!design) throw new Error(`missing clip_design: ${clipIndex}`);
    const collisions = Object.keys(design.beat).filter(key => Object.hasOwn(beat, key));
    if (collisions.length) throw new Error(`clip_design[${clipIndex}] redefines chapter facts: ${collisions.join(",")}`);
    const { backgroundObjectId, ...blockingFacts } = design.blockingPlan;
    const backgrounds = assets.backgroundPlans.filter(item => item.objectId === backgroundObjectId);
    if (backgrounds.length !== 1) throw new Error(`clip_design[${clipIndex}].backgroundObjectId must resolve one shared background: ${String(backgroundObjectId)}`);
    const durationSeconds = duration(beat, clipIndex);
    const startSeconds = cursor;
    cursor = Math.round((cursor + durationSeconds) * 1e6) / 1e6;
    const clipId = `${plan.sourceFingerprint}:clip:${clipIndex}`;
    const temporalDirectives = design.timing.temporalDirectives.map((directive, index) => {
      if (!Number.isFinite(directive.startSeconds) || !Number.isFinite(directive.endSeconds)
        || directive.startSeconds < 0 || directive.endSeconds <= directive.startSeconds
        || directive.endSeconds > durationSeconds) {
        throw new Error(`clip_design[${clipIndex}].temporalDirectives[${index}] outside local clip interval`);
      }
      return { ...directive, startSeconds: startSeconds + directive.startSeconds, endSeconds: startSeconds + directive.endSeconds };
    });
    const { sourceUnitRefs: _sourceUnitRefs, ...beatFacts } = beat;
    return {
      beat: { ...beatFacts, ...design.beat, clipIndex, clipId } as Facts & { clipIndex: number; clipId: string },
      blockingPlan: { ...blockingFacts, backgroundPlan: backgrounds[0]!.plan, clipIndex, durationSeconds },
      segment: { ...design.timing, temporalDirectives, clipId, startSeconds, endSeconds: cursor },
    };
  });
  return {
    protocolVersion: "tapcanvas.beat-sheet/v2",
    ...plan,
    // Allocations carry the host-derived complete ranges (startOffset cursor),
    // never the author's reduced submission form, so persisted BeatSheets stay
    // self-contained for every downstream consumer.
    sourceCoveragePlan: { speechLedger: projected.speechLedger, sourceUnitLedger: ledger, sourceUnitAllocations: projected.beats.map((beat, clipIndex) => ({ clipIndex, sourceUnitRefs: beat.sourceUnitRefs })) },
    objectRegistry: sources.objectRegistry,
    assetPlans: sources.assetPlans,
    beats: assembled.map(item => item.beat),
    blockingPlans: assembled.map(item => item.blockingPlan),
    sequenceControlPlan: {
      protocolVersion: "tapcanvas.sequence-control-plan/v1",
      totalDurationSeconds: cursor,
      segments: assembled.map(item => item.segment),
    },
  };
}

function parseStageArtifact(value: unknown, schema: Record<string, unknown>, label: string): unknown {
  const text = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).text : undefined;
  const parsed: unknown = typeof text === "string" ? JSON.parse(text) : value;
  const issues = validateWorkflowToolArguments(schema, parsed);
  if (issues.length) throw new Error(`${label}: ${issues.map(issue => issue.message).join(" | ")}`);
  return parsed;
}
export const parseChapterBeatPlan = (value: unknown): ChapterBeatPlan =>
  parseStageArtifact(value, chapterBeatPlanSchema, "chapter-plan") as ChapterBeatPlan;
export const parseChapterAssetPlan = (value: unknown): ChapterAssetPlan =>
  parseStageArtifact(value, chapterAssetPlanSchema, "chapter-assets") as ChapterAssetPlan;
export const parseClipDesign = (value: unknown): ClipDesign =>
  parseStageArtifact(value, clipDesignSchema, "clip-design") as ClipDesign;

/** Validate the same object/placement relationships before accepting each author. */
export function validateClipDesignReferences(design: ClipDesign, registry: readonly Facts[]): void {
  const objects = new Map(registry.map(object => [object.objectId, object]));
  const states = design.beat.objectStates as readonly Facts[];
  const names: string[] = [];
  let hasScene = false;
  for (const [index, state] of states.entries()) {
    const object = objects.get(state.objectId);
    if (!object) throw new Error(`clip-design.objectStates[${index}].objectId is not registered`);
    const error = inspectClipReferenceSelection(state, object, `clip-design.objectStates[${index}]`);
    if (error) throw new Error(error);
    if (object.kind === 'scene') hasScene = true;
    if (object.kind === 'character' && typeof object.name === 'string') names.push(object.name);
  }
  if (!hasScene) throw new Error('clip-design.objectStates must reference a scene object from its frozen objectRegistry');
  const coverage = inspectBlockingCharacterCoverage(names,
    design.blockingPlan.characters as readonly { name: string }[], 'clip-design.blockingPlan');
  if (coverage) throw new Error(coverage);
}
