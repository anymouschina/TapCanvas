import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INPUT_OUTPUT_RELATIONS_KEYWORD,
  bindInputOutputRelations,
  inspectInputOutputRelations,
} from './input-output.mjs';

const declaration = (overrides = {}) => ({
  inputPort: 'frozen-prefix',
  inputIndex: 0,
  inputPath: ['sourceUnitRefs'],
  outputPath: ['beats', 0, 'sourceUnitRefs'],
  optional: true,
  ...overrides,
});

test('binds declared input paths to an immutable value for an output path', () => {
  const schema = { type: 'object', [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration()] };
  const refs = [{ unitId: 'unit-a' }, { unitId: 'unit-b', endOffset: 4 }];
  const bound = bindInputOutputRelations(schema, { 'frozen-prefix': [{ sourceUnitRefs: refs }] });

  assert.notEqual(bound, schema);
  assert.deepEqual(bound[INPUT_OUTPUT_RELATIONS_KEYWORD], [{
    inputPort: 'frozen-prefix',
    inputIndex: 0,
    inputPath: ['sourceUnitRefs'],
    outputPath: ['beats', 0, 'sourceUnitRefs'],
    expectedValue: refs,
  }]);
  refs[0].unitId = 'mutated-after-binding';
  assert.equal(bound[INPUT_OUTPUT_RELATIONS_KEYWORD][0].expectedValue[0].unitId, 'unit-a');
  assert.deepEqual(schema[INPUT_OUTPUT_RELATIONS_KEYWORD], [declaration()], 'binding must not mutate the authored schema');
});

test('an absent optional input omits the bound relation while a required input remains explicit', () => {
  const schema = { type: 'object', [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration()] };
  assert.deepEqual(bindInputOutputRelations(schema, {})[INPUT_OUTPUT_RELATIONS_KEYWORD], []);
  assert.throws(
    () => bindInputOutputRelations({ type: 'object', [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration({ optional: false })] }, {}),
    /requires input port "frozen-prefix"/u,
  );
});

test('binding reports missing input items and paths instead of disabling the relation', () => {
  const schema = { type: 'object', [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration()] };
  assert.throws(() => bindInputOutputRelations(schema, { 'frozen-prefix': [] }), /has no item at index 0/u);
  assert.throws(() => bindInputOutputRelations(schema, { 'frozen-prefix': [{}] }), /missing declared relation path/u);
  assert.throws(() => bindInputOutputRelations({ [INPUT_OUTPUT_RELATIONS_KEYWORD]: [{}] }, {}), /invalid declaration/u);
});

test('compares nested JSON values structurally without depending on object key order', () => {
  const schema = bindInputOutputRelations({
    type: 'object',
    [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration()],
  }, { 'frozen-prefix': [{ sourceUnitRefs: [{ unitId: 'unit-a', endOffset: 4 }] }] });

  assert.deepEqual(inspectInputOutputRelations(schema, {
    beats: [{ sourceUnitRefs: [{ endOffset: 4, unitId: 'unit-a' }] }],
  }), []);

  const issues = inspectInputOutputRelations(schema, {
    beats: [{ sourceUnitRefs: [{ unitId: 'unit-a' }, { unitId: 'unit-b' }] }],
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.path, '$.beats[0].sourceUnitRefs');
  assert.match(issues[0]?.message ?? '', /must structurally equal frozen input frozen-prefix\[0\]\.sourceUnitRefs/u);
});

test('a relation with no output path value is rejected and malformed or unbound relations are reported', () => {
  const bound = bindInputOutputRelations({
    type: 'object',
    [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration()],
  }, { 'frozen-prefix': [{ sourceUnitRefs: [] }] });
  assert.equal(inspectInputOutputRelations(bound, { beats: [] })[0]?.path, '$.beats[0].sourceUnitRefs');
  assert.match(inspectInputOutputRelations({
    [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration()],
  }, {})[0]?.message ?? '', /invalid or unbound/u);
  assert.match(inspectInputOutputRelations({
    [INPUT_OUTPUT_RELATIONS_KEYWORD]: null,
  }, {})[0]?.message ?? '', /invalid x-inputOutputRelations schema/u);
});

test('rejects non-JSON bound facts and over-deep paths at the contract boundary', () => {
  const schema = { [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration()] };
  assert.throws(() => bindInputOutputRelations(schema, { 'frozen-prefix': [{ sourceUnitRefs: [undefined] }] }), /must resolve to a JSON value/u);
  assert.throws(() => bindInputOutputRelations({
    [INPUT_OUTPUT_RELATIONS_KEYWORD]: [declaration({ inputPath: Array(33).fill('part') })],
  }, { 'frozen-prefix': [{}] }), /invalid declaration/u);
});
