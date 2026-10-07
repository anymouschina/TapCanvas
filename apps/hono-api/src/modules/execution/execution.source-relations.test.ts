import { expect, it } from 'vitest';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';
import { validateJsonSchemaStructure } from '../../../../agents-cli/src/bridge/json-schema-structural-validator';
import { bindSourceUnitLedgerSchema } from '../../../../../packages/schemas/source-unit-ledger/index.mjs';

const facts = { sourceId: 'source-1', sourceFingerprint: 'frozen-fingerprint', lines: [
  { lineId: 'line-a', text: 'A😀B' },
  { lineId: 'line-b', text: '他说：“不。”' },
] };
const ledger = { sourceId: facts.sourceId, sourceFingerprint: facts.sourceFingerprint, units: [
  { unitId: 'u1', sourceLineId: 'line-a', text: facts.lines[0]!.text, expression: 'spoken', speakerName: '甲', delivery: 'on_screen' },
  { unitId: 'u2', sourceLineId: 'line-b', text: facts.lines[1]!.text, expression: 'narration', speakerName: null, delivery: null },
] };
const partitionSchema = bindSourceUnitLedgerSchema(facts);
const authored = { sourceId: facts.sourceId, sourceFingerprint: facts.sourceFingerprint, units: [
  { sourceLineId: 'line-a', startOffset: 0, endOffset: 4, expression: 'spoken', speakerName: '甲', delivery: 'on_screen' },
  // The author decides semantics; the host only verifies that ranges cover frozen text.
  { sourceLineId: 'line-b', startOffset: 0, endOffset: facts.lines[1]!.text.length, expression: 'narration', speakerName: null, delivery: null },
] };
const allocationSchema = { type: 'object', 'x-sourceAllocation': { ledger } };
const allocation = { sourceId: ledger.sourceId, sourceFingerprint: ledger.sourceFingerprint, beats: [
  { sourceUnitRefs: [{ unitId: 'u1', startOffset: 0, endOffset: 1 }] },
  { sourceUnitRefs: [{ unitId: 'u1', startOffset: 1, endOffset: 4 }, { unitId: 'u2', startOffset: 0, endOffset: ledger.units[1]!.text.length }] },
] };
type Issue = Readonly<{ path: string; message: string }>;
function check(schema: Record<string, unknown>, value: unknown): Issue[] {
  const before = JSON.stringify({ schema, value });
  const hono = validateWorkflowToolArguments(schema, value);
  const agent = validateJsonSchemaStructure({ schema, value });
  expect(hono.length === 0).toBe(agent.length === 0);
  expect(JSON.stringify({ schema, value })).toBe(before);
  return hono;
}

it('both validators accept the exact frozen partition without inferring expression from prose', () => {
  expect(check(partitionSchema, authored)).toEqual([]);
  const divided = structuredClone(authored);
  divided.units.splice(0, 1,
    { sourceLineId: 'line-a', startOffset: 0, endOffset: 1, expression: 'narration', speakerName: null, delivery: null },
    { sourceLineId: 'line-a', startOffset: 1, endOffset: 4, expression: 'spoken', speakerName: '甲', delivery: 'on_screen' },
  );
  expect(check(partitionSchema, divided)).toEqual([]);
});

it('both validators reject changed source identity, omitted lines and reordered units', () => {
  const changedIdentity = { ...authored, sourceFingerprint: 'other-fingerprint' };
  expect(check(partitionSchema, changedIdentity).some(issue => issue.path.includes('sourceFingerprint'))).toBe(true);
  const changedSourceId = { ...authored, sourceId: 'other-source' };
  expect(check(partitionSchema, changedSourceId).some(issue => issue.path.includes('sourceId'))).toBe(true);
  for (const units of [authored.units.slice(0, 1), [...authored.units].reverse(),
    [authored.units[0]!, { ...authored.units[1]!, sourceLineId: 'unknown' }],
  ]) expect(check(partitionSchema, { ...authored, units }).length).toBeGreaterThan(0);
});

it('does not accept duplicated model-authored source text', () => {
  const duplicatedText = structuredClone(authored) as typeof authored & { units: Array<Record<string, unknown>> };
  duplicatedText.units[0]!.text = facts.lines[0]!.text;
  expect(check(partitionSchema, duplicatedText).length).toBeGreaterThan(0);
});

it('both validators accept only complete ordered UTF-16 ranges of the frozen units', () => {
  expect(check(allocationSchema, allocation)).toEqual([]);
  const variants = [
    [{ unitId: 'u1', startOffset: 0, endOffset: 4 }], // Missing u2.
    [{ unitId: 'unknown', startOffset: 0, endOffset: 4 }],
    [{ unitId: 'u1', startOffset: 1, endOffset: 4 }], // Gap at beginning.
    [{ unitId: 'u1', startOffset: 0, endOffset: 5 }], // Outside the exact text.
    [{ unitId: 'u1', startOffset: 0, endOffset: 2 }, { unitId: 'u1', startOffset: 2, endOffset: 4 }], // Split surrogate pair.
    [{ unitId: 'u1', startOffset: 0, endOffset: 3 }, { unitId: 'u1', startOffset: 1, endOffset: 4 }], // Overlap.
    [{ unitId: 'u2', startOffset: 0, endOffset: ledger.units[1]!.text.length }, { unitId: 'u1', startOffset: 0, endOffset: 4 }],
  ];
  for (const sourceUnitRefs of variants) {
    const issues = check(allocationSchema, { sourceId: ledger.sourceId, sourceFingerprint: ledger.sourceFingerprint, beats: [{ sourceUnitRefs }] });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(issue => issue.path.includes('sourceUnitRefs') || issue.path.includes('beats'))).toBe(true);
  }
});

it('relations retain exact nested paths through shared schema references and leave unrelated schemas untouched', () => {
  const schema = { type: 'object', properties: { artifact: { $ref: '#/$defs/partition' } }, $defs: { partition: partitionSchema } };
  expect(check(schema, { artifact: authored })).toEqual([]);
  const issues = check(schema, { artifact: { ...authored, sourceId: 'wrong-source' } });
  expect(issues.some(issue => issue.path.startsWith('$.artifact') && issue.path.includes('sourceId'))).toBe(true);
  expect(check({ type: 'object' }, { units: [{ text: 'arbitrary text, no declared source relation' }], beats: [] })).toEqual([]);
});

it('malformed frozen contracts return schema evidence and large failures share the existing issue limit', () => {
  for (const schema of [{ type: 'object', 'x-sourcePartition': null }, { type: 'object', 'x-sourceAllocation': { ledger: null } }]) {
    expect(check(schema, {}).length).toBeGreaterThan(0);
  }
  const units = Array.from({ length: 50 }, (_, index) => ({ ...authored.units[0]!, sourceLineId: `absent-${index}` }));
  expect(check(partitionSchema, { ...authored, units })).toHaveLength(32);
});
