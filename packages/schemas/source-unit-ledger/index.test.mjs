import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceLines, bindSourceUnitLedgerSchema, reconstructSourceUnitLedger, sourceUnitLedgerSchema,
  inspectSourceUnitLedger, projectSourceUnitReferences, inspectSourceRelations, SourceUnitReferenceError } from './index.mjs';

const facts = { sourceId: 'source', sourceFingerprint: 'frozen', lines: buildSourceLines('  甲说：你好。\r\n\n屏幕显示售罄。\n甲心想再来。') };
const line = id => facts.lines.find(item => item.lineId === id);
const authored = {
  sourceId: facts.sourceId,
  sourceFingerprint: facts.sourceFingerprint,
  units: [
    { sourceLineId: 'source-line-1', startOffset: 0, endOffset: 3, expression: 'narration', speakerName: null, delivery: null },
    { sourceLineId: 'source-line-1', startOffset: 3, endOffset: 6, expression: 'spoken', speakerName: '甲', delivery: 'on_screen' },
    { sourceLineId: 'source-line-3', startOffset: 0, endOffset: 7, expression: 'written', speakerName: null, delivery: null },
    { sourceLineId: 'source-line-4', startOffset: 0, endOffset: 3, expression: 'narration', speakerName: null, delivery: null },
    { sourceLineId: 'source-line-4', startOffset: 3, endOffset: 6, expression: 'thought', speakerName: '甲', delivery: 'voice_over' },
  ],
};
const ledger = reconstructSourceUnitLedger(authored, facts);
const ids = ledger.units.map(unit => unit.unitId);
const ref = (unitId, startOffset, endOffset) => ({ unitId, startOffset, endOffset });
const allRefs = ledger.units.map(unit => ref(unit.unitId, 0, unit.text.length));
const full = [{ title: 'test', sourceUnitRefs: allRefs }];
const allocationValue = beats => ({ sourceId: ledger.sourceId, sourceFingerprint: ledger.sourceFingerprint, beats });
const allocationIssues = beats => inspectSourceRelations({ 'x-sourceAllocation': { ledger } }, allocationValue(beats));
const partitionSchema = bindSourceUnitLedgerSchema(facts);
const partitionIssues = candidate => inspectSourceRelations(partitionSchema, candidate);

test('line segmentation only trims layout and retains original line numbers', () => {
  assert.deepEqual(buildSourceLines(' A\r\n \nB\r C \n'), [
    { lineId: 'source-line-1', text: 'A' }, { lineId: 'source-line-3', text: 'B' }, { lineId: 'source-line-4', text: 'C' },
  ]);
  assert.deepEqual(buildSourceLines('“是对白吗？”'), [{ lineId: 'source-line-1', text: '“是对白吗？”' }]);
  assert.throws(() => buildSourceLines(null), TypeError);
});

test('Agent schema contains compact UTF-16 ranges without copying frozen source text', () => {
  const partition = partitionSchema['x-sourcePartition'];
  assert.deepEqual(partition.lines.map(item => [item.lineId, item.length]), facts.lines.map(item => [item.lineId, item.text.length]));
  assert.ok(partition.lines.every(item => !Object.hasOwn(item, 'text')));
  assert.deepEqual(partition.lines[0]?.surrogateBoundaries, []);
  const emojiFacts = { sourceId: 's', sourceFingerprint: 'f', lines: buildSourceLines('甲😀乙') };
  assert.deepEqual(bindSourceUnitLedgerSchema(emojiFacts)['x-sourcePartition'].lines[0]?.surrogateBoundaries, [2]);
  assert.ok(!('unitId' in partitionSchema.properties.units.items.anyOf[0].properties));
  assert.ok(!('text' in partitionSchema.properties.units.items.anyOf[0].properties));
});

test('host reconstructs exact frozen text and stable IDs from author-owned semantic ranges', () => {
  assert.deepEqual(partitionIssues(authored), []);
  assert.deepEqual(ledger.units.map(unit => unit.text), ['甲说：', '你好。', '屏幕显示售罄。', '甲心想', '再来。']);
  assert.deepEqual(ledger.units.map(unit => unit.sourceLineId), authored.units.map(unit => unit.sourceLineId));
  assert.equal(new Set(ids).size, ids.length);
  const changedMeaning = structuredClone(authored);
  changedMeaning.units[1] = { ...changedMeaning.units[1], expression: 'written', speakerName: null, delivery: null };
  assert.deepEqual(partitionIssues(changedMeaning), [], 'the host must not infer expression from text');
  assert.deepEqual(inspectSourceUnitLedger(ledger, facts), []);
});

test('canonical ledger preserves optional author attribution evidence from accepted source units', () => {
  const withEvidence = structuredClone(ledger);
  withEvidence.units[0].attributionEvidence = 'Source title; no speaker is present';
  assert.equal(sourceUnitLedgerSchema.properties.units.items.anyOf[1].properties.attributionEvidence.type, 'string');
  assert.ok(!sourceUnitLedgerSchema.properties.units.items.anyOf[1].required.includes('attributionEvidence'));
  assert.deepEqual(inspectSourceUnitLedger(withEvidence, facts), []);
});

test('ordered ranges reject missing lines, gaps, overlap, unknown IDs and source-line reversal', () => {
  const missing = structuredClone(authored); missing.units = missing.units.filter(unit => unit.sourceLineId !== 'source-line-3');
  assert.ok(partitionIssues(missing).some(issue => issue.message.includes('Missing source line')));
  const unknown = structuredClone(authored); unknown.units[0].sourceLineId = 'invented';
  assert.ok(partitionIssues(unknown).some(issue => issue.path === '$.units[0].sourceLineId'));
  const gap = structuredClone(authored); gap.units[1].startOffset = 4;
  assert.ok(partitionIssues(gap).some(issue => issue.message.includes('continuously')));
  const overlap = structuredClone(authored); overlap.units[1].startOffset = 2;
  assert.ok(partitionIssues(overlap).some(issue => issue.message.includes('continuously')));
  const reversed = structuredClone(authored); [reversed.units[1], reversed.units[2]] = [reversed.units[2], reversed.units[1]];
  assert.ok(partitionIssues(reversed).some(issue => issue.message.includes('line order')));
});

test('UTF-16 author ranges cannot split supplementary Unicode characters', () => {
  const emojiFacts = { sourceId: 's', sourceFingerprint: 'f', lines: buildSourceLines('甲😀乙') };
  const schema = bindSourceUnitLedgerSchema(emojiFacts);
  const candidate = { sourceId: 's', sourceFingerprint: 'f', units: [
    { sourceLineId: 'source-line-1', startOffset: 0, endOffset: 2, expression: 'narration', speakerName: null, delivery: null },
    { sourceLineId: 'source-line-1', startOffset: 2, endOffset: 4, expression: 'spoken', speakerName: '甲', delivery: 'on_screen' },
  ] };
  assert.ok(inspectSourceRelations(schema, candidate).some(issue => issue.message.includes('surrogate')));
  const valid = structuredClone(candidate);
  valid.units[0].endOffset = 1;
  valid.units[1].startOffset = 1;
  assert.deepEqual(inspectSourceRelations(schema, valid), []);
  assert.deepEqual(reconstructSourceUnitLedger(valid, emojiFacts).units.map(unit => unit.text), ['甲', '😀乙']);
});

test('bound partition facts are isolated and do not duplicate source body text', () => {
  const supplied = structuredClone(facts);
  const schema = bindSourceUnitLedgerSchema(supplied);
  supplied.lines[0].text = 'mutated';
  assert.equal(schema['x-sourcePartition'].lines[0]?.length, line('source-line-1')?.text.length);
  assert.ok(schema['x-sourcePartition'].lines.every(item => !Object.hasOwn(item, 'text')));
  assert.deepEqual(inspectSourceRelations(schema, authored), []);
  const issues = inspectSourceRelations(schema, { ...authored, sourceId: 'wrong' }, '$.payload');
  assert.equal(issues[0]?.path, '$.payload.sourceId');
  assert.equal(issues[0]?.keyword, 'x-sourcePartition');
});

test('only vocal units project dialogue and all projected facts come from their source owner', () => {
  const input = structuredClone(full);
  const before = structuredClone(input);
  const result = projectSourceUnitReferences(ledger, input);
  assert.deepEqual(result.beats[0].dialogueScript.map(item => [item.speakerName, item.text, item.delivery]), [
    ['甲', '你好。', 'on_screen'], ['甲', '再来。', 'voice_over'],
  ]);
  assert.equal(result.beats[0].title, 'test');
  assert.deepEqual(result.speechLedger.map(item => item.clipIndex), [0, 0]);
  assert.deepEqual(input, before);
});

test('a handwritten dialogueScript is explicitly rejected rather than silently overwritten', () => {
  for (const dialogueScript of [[], [{ speakerName: 'wrong', text: 'wrong' }], undefined]) {
    const beats = [{ ...full[0], dialogueScript }];
    assert.throws(() => projectSourceUnitReferences(ledger, beats), error => error instanceof SourceUnitReferenceError
      && error.issues.some(issue => issue.path === '$.beats[0].dialogueScript'));
  }
});

test('allocation binds the candidate root to the exact source identity and fingerprint', () => {
  assert.deepEqual(allocationIssues(full), []);
  for (const key of ['sourceId', 'sourceFingerprint']) {
    for (const replacement of ['other', undefined]) {
      const candidate = { ...allocationValue(full), [key]: replacement };
      const issues = inspectSourceRelations({ 'x-sourceAllocation': { ledger } }, candidate);
      assert.ok(issues.some(issue => issue.path === `$.${key}` && issue.keyword === 'x-sourceAllocation'));
    }
  }
});

test('one utterance can split across adjacent beats with exact reconstruction', () => {
  const spokenUnitId = ids[1];
  const beats = [
    { sourceUnitRefs: [allRefs[0], ref(spokenUnitId, 0, 1)] },
    { sourceUnitRefs: [ref(spokenUnitId, 1, 3), ...allRefs.slice(2)] },
  ];
  const result = projectSourceUnitReferences(ledger, beats);
  assert.equal(result.speechLedger.slice(0, 2).map(item => item.text).join(''), '你好。');
  assert.deepEqual(result.speechLedger.map(item => item.clipIndex), [0, 1, 1]);
  assert.notEqual(result.speechLedger[0]?.lineId, result.speechLedger[1]?.lineId);
});

test('an empty reaction beat between source beats preserves full ordered dialogue', () => {
  const beats = [
    { title: 'first source beat', sourceUnitRefs: allRefs.slice(0, 2) },
    { title: 'silent reaction', sourceUnitRefs: [] },
    { title: 'second source beat', sourceUnitRefs: allRefs.slice(2) },
  ];
  assert.deepEqual(allocationIssues(beats), []);
  const result = projectSourceUnitReferences(ledger, beats);
  assert.equal(result.beats.length, 3);
  assert.deepEqual(result.beats[1], { ...beats[1], dialogueScript: [] });
  assert.deepEqual(result.speechLedger.map(({ clipIndex, ...item }) => item),
    projectSourceUnitReferences(ledger, full).speechLedger.map(({ clipIndex, ...item }) => item));
  assert.deepEqual(result.speechLedger.map(item => item.clipIndex), [0, 2]);
  assert.ok(allocationIssues(beats.slice(0, 2)).some(issue => issue.message.includes('incomplete')));
});

test('all source units require complete ordered allocation', () => {
  for (const references of [allRefs.slice(1), allRefs.filter(reference => reference.unitId !== ids[2]), [...allRefs].reverse(), [...allRefs, allRefs[4]]]) {
    assert.ok(allocationIssues([{ sourceUnitRefs: references }]).length > 0);
  }
  assert.ok(allocationIssues([{ sourceUnitRefs: [] }]).some(issue => issue.message.includes('incomplete')));
  assert.ok(allocationIssues([{ sourceUnitRefs: [ref('unknown', 0, 1)] }]).some(issue => issue.message.includes('Unknown source unit')));
});

test('generic annotation inspection returns formatted issues for malformed allocation without throwing', () => {
  const issues = inspectSourceRelations({ 'x-sourceAllocation': { ledger } }, allocationValue([{ sourceUnitRefs: [] }]), '$.payload');
  assert.ok(issues.length > 0);
  assert.ok(issues.every(issue => issue.keyword === 'x-sourceAllocation' && issue.path.startsWith('$.payload')));
  assert.ok(inspectSourceRelations({ 'x-sourceAllocation': null }, {}).length > 0);
  assert.deepEqual(inspectSourceRelations({}, { dialogue: 'arbitrary' }), []);
});
