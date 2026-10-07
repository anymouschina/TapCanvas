import { expect, it } from 'vitest';
import { bindSourceAllocationSchema, canonicalizeSourceUnitLedger, parseSourceUnitLedger, sourceUnitLedgerFacts } from './execution.source-unit-ledger';
import { freezeWorkflowAuthoritativeSource, resolveWorkflowAuthoritativeSourceLineage } from './execution.source-lineage';
import { bindSourceUnitLedgerSchema, type SourceUnitLedger, type SourceUnitLedgerFacts } from '../../../../../packages/schemas/source-unit-ledger/index.mjs';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';
import { validateJsonSchemaStructure } from '../../../../agents-cli/src/bridge/json-schema-structural-validator';
import { chapterSpeechLedger, type ChapterBeatPlan } from './execution.video-authoring-stages';

const sources = [
  freezeWorkflowAuthoritativeSource({ sourceId: 'chapter-a', content: '甲😀\n\n乙。' }),
  freezeWorkflowAuthoritativeSource({ sourceId: 'chapter-b', content: '丙：“这不自动变成对白。”' }),
];
const deliveryContract = { canvasFacts: { authoritativeSources: sources }, dialogueScript: [{ text: 'not authoritative' }] };
function authorRanges(facts: SourceUnitLedgerFacts) {
  return { sourceId: facts.sourceId, sourceFingerprint: facts.sourceFingerprint, units: facts.lines.map((line, index) => ({
    sourceLineId: line.lineId, startOffset: 0, endOffset: line.text.length,
    ...(index === 0
      ? { expression: 'spoken', speakerName: '甲', delivery: 'off_screen' }
      : { expression: 'narration', speakerName: null, delivery: null }),
  })) };
}
function allocatedPlan(ledger: SourceUnitLedger): ChapterBeatPlan {
  return { sourceId: ledger.sourceId, sourceFingerprint: ledger.sourceFingerprint, chapterArc: {}, sourceFidelityAudit: {},
    beats: ledger.units.map(unit => ({ sourceUnitRefs: [{ unitId: unit.unitId, startOffset: 0, endOffset: unit.text.length }] })) };
}

it('freezes canonical multi-source order and namespaces colliding per-source line identities', () => {
  const before = JSON.stringify(deliveryContract);
  const facts = sourceUnitLedgerFacts(deliveryContract);
  expect({ sourceId: facts.sourceId, sourceFingerprint: facts.sourceFingerprint }).toEqual(resolveWorkflowAuthoritativeSourceLineage(sources));
  expect(facts.lines).toEqual([
    { lineId: 'source-0:source-line-1', text: '甲😀' },
    { lineId: 'source-0:source-line-3', text: '乙。' },
    { lineId: 'source-1:source-line-1', text: '丙：“这不自动变成对白。”' },
  ]);
  const reversed = sourceUnitLedgerFacts({ canvasFacts: { authoritativeSources: [...sources].reverse() } });
  expect(reversed.sourceFingerprint).not.toBe(facts.sourceFingerprint);
  expect(reversed.lines[0]?.text).toBe(facts.lines[2]?.text);
  expect(JSON.stringify(deliveryContract)).toBe(before);
});

it('rejects missing source facts and fingerprints that no longer match canonical text', () => {
  for (const contract of [{}, { canvasFacts: { authoritativeSources: [] } },
    { canvasFacts: { authoritativeSources: [{ ...sources[0], content: 'changed source body' }] } },
  ]) expect(() => sourceUnitLedgerFacts(contract)).toThrow();
});

it('reconstructs exact canonical source text from compact ranges before allocation and speech projection', () => {
  const facts = sourceUnitLedgerFacts(deliveryContract);
  const sourceSchema = bindSourceUnitLedgerSchema(facts);
  const authored = authorRanges(facts);
  expect(validateJsonSchemaStructure({ schema: sourceSchema, value: authored })).toEqual([]);
  expect(validateWorkflowToolArguments(sourceSchema, authored)).toEqual([]);
  const partition = sourceSchema['x-sourcePartition'];
  if (!partition || typeof partition !== 'object' || !('lines' in partition) || !Array.isArray(partition.lines)) throw new Error('Missing source partition lines');
  expect(partition.lines.every((line: unknown) => line !== null && typeof line === 'object' && !Object.hasOwn(line, 'text'))).toBe(true);
  const canonical = canonicalizeSourceUnitLedger({ text: JSON.stringify(authored) }, facts);
  expect(canonical.reconstructedUnits).toBe(facts.lines.length);
  const ledger = canonical.ledger;
  expect(ledger.units.map(unit => unit.text)).toEqual(facts.lines.map(line => line.text));
  expect(ledger.units.every(unit => !Object.hasOwn(unit, 'attributionEvidence'))).toBe(true);
  expect(parseSourceUnitLedger({ text: JSON.stringify(ledger) })).toEqual(ledger);
  const baseSchema = { type: 'object' };
  const bound = bindSourceAllocationSchema(baseSchema, ledger);
  expect(baseSchema).toEqual({ type: 'object' });
  expect(bound['x-sourceAllocation']).toEqual({ ledger, unitRanges: ledger.units.map(unit => ({ unitId: unit.unitId, startOffset: 0, endOffset: unit.text.length })) });
  const plan = allocatedPlan(ledger);
  expect(validateWorkflowToolArguments(bound, plan)).toEqual([]);
  expect(validateJsonSchemaStructure({ schema: bound, value: plan })).toEqual([]);
  const speech = chapterSpeechLedger(plan, ledger);
  expect(speech).toHaveLength(1);
  expect(speech[0]).toMatchObject({ speakerName: '甲', delivery: 'off_screen', text: facts.lines[0]!.text, clipIndex: 0 });
  expect(speech.some(line => line.text.includes('自动变成对白'))).toBe(false);
  expect(() => chapterSpeechLedger({ ...plan, sourceFingerprint: 'different-source' }, ledger)).toThrow('source lineage');
  expect(validateWorkflowToolArguments(bound, { ...plan, sourceId: 'different-source' }).length).toBeGreaterThan(0);
  expect(validateWorkflowToolArguments(bound, { ...plan, beats: plan.beats.slice(0, 1) }).length).toBeGreaterThan(0);
});

it('rejects hand-authored dialogue at allocation and malformed independent artifacts', () => {
  const facts = sourceUnitLedgerFacts(deliveryContract);
  const ledger = canonicalizeSourceUnitLedger(authorRanges(facts), facts).ledger;
  const plan = allocatedPlan(ledger);
  const bound = bindSourceAllocationSchema({ type: 'object' }, ledger);
  const beats = plan.beats.map((beat, index) => index === 0 ? { ...beat, dialogueScript: [] } : beat);
  expect(validateWorkflowToolArguments(bound, { ...plan, beats }).length).toBeGreaterThan(0);
  // Deliberately malformed external input: the runtime must reject this forbidden field.
  const invalidPlan = { ...plan, beats } as unknown as ChapterBeatPlan;
  expect(() => chapterSpeechLedger(invalidPlan, ledger)).toThrow('dialogueScript');
  expect(() => parseSourceUnitLedger({ text: '{broken' })).toThrow();
  expect(() => parseSourceUnitLedger({ ...ledger, dialogueScript: [] })).toThrow('source-ledger');
});
