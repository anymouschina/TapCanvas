import assert from 'node:assert/strict';
import test from 'node:test';
import {
  materializeRuntimeBoundJson,
  projectRuntimeBoundJsonSchema,
  projectRuntimeBoundJsonValueForAuthor,
  RuntimeBindingSchemaError,
} from './index.mjs';

const makeRangeSchema = (sourceIndexes, rows = {
  '0': { sourceId: 'source:chapter-a', sourceFingerprint: 'sha-a' },
}) => ({
  type: 'object',
  properties: {
    ranges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceIndex: { type: 'integer', enum: sourceIndexes },
          startOffset: { type: 'integer', minimum: 0 },
          endOffset: { type: 'integer', minimum: 1 },
          sourceId: { type: 'string', enum: Object.values(rows).map(row => row.sourceId) },
          sourceFingerprint: { type: 'string', enum: Object.values(rows).map(row => row.sourceFingerprint) },
          note: { type: 'string' },
        },
        required: ['sourceIndex', 'startOffset', 'endOffset', 'sourceId', 'sourceFingerprint'],
        additionalProperties: false,
        'x-runtimeBindings': {
          table: 'sources',
          selector: 'sourceIndex',
          fields: { sourceId: 'sourceId', sourceFingerprint: 'sourceFingerprint' },
        },
      },
    },
  },
  required: ['ranges'],
  'x-runtimeBindingTables': { sources: rows },
});

test('author value projection preserves heterogeneous tuple and prefix-item author fields', () => {
  const bound = { type: 'object', properties: { id: { type: 'string' }, value: { type: 'string' } },
    required: ['id', 'value'], 'x-runtimeBindings': { table: 'rows', selector: 'id', fields: { value: 'value' } } };
  const authored = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] };
  for (const arraySchema of [{ items: [bound, authored] }, { prefixItems: [bound, authored] }, { prefixItems: [authored], items: bound }]) {
    const schema = { type: 'object', properties: { rows: { type: 'array', ...arraySchema } },
      'x-runtimeBindingTables': { rows: { x: { value: 'host' } } } };
    const isTailBinding = Boolean(arraySchema.items && !Array.isArray(arraySchema.items));
    const delivery = { rows: isTailBinding ? [{ value: 'AUTHOR' }, { id: 'x', value: 'host' }]
      : [{ id: 'x', value: 'host' }, { value: 'AUTHOR' }] };
    const original = structuredClone(delivery);
    const projected = projectRuntimeBoundJsonValueForAuthor(delivery, schema);
    assert.deepEqual(projected, { rows: isTailBinding ? [{ value: 'AUTHOR' }, { id: 'x' }]
      : [{ id: 'x' }, { value: 'AUTHOR' }] });
    assert.deepEqual(materializeRuntimeBoundJson(projected, schema), { value: delivery, issues: [] });
    assert.deepEqual(delivery, original);
  }
});

test('projects machine-owned fields and required entries while preserving author schema', () => {
  const schema = makeRangeSchema([0]);
  const original = structuredClone(schema);
  const projected = projectRuntimeBoundJsonSchema(schema);
  const range = projected.properties.ranges.items;

  assert.deepEqual(Object.keys(range.properties), ['sourceIndex', 'startOffset', 'endOffset', 'note']);
  assert.deepEqual(range.required, ['sourceIndex', 'startOffset', 'endOffset']);
  assert.deepEqual(range.properties.sourceIndex.enum, [0]);
  assert.equal(Object.hasOwn(projected, 'x-runtimeBindingTables'), false);
  assert.equal(Object.hasOwn(range, 'x-runtimeBindings'), false);
  assert.deepEqual(schema, original);
});

test('materializes one-source identity fields from the frozen selector table', () => {
  const schema = makeRangeSchema([0]);
  const authored = { ranges: [{ sourceIndex: 0, startOffset: 2, endOffset: 7, note: 'keep this' }] };
  const before = structuredClone(authored);
  const result = materializeRuntimeBoundJson(authored, schema);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value, {
    ranges: [{ sourceIndex: 0, startOffset: 2, endOffset: 7, note: 'keep this', sourceId: 'source:chapter-a', sourceFingerprint: 'sha-a' }],
  });
  assert.deepEqual(authored, before);
  assert.notEqual(result.value, authored);
});

test('selects exact rows for multiple frozen sources', () => {
  const rows = {
    '0': { sourceId: 'source:a', sourceFingerprint: 'fingerprint-a' },
    '1': { sourceId: 'source:b', sourceFingerprint: 'fingerprint-b' },
  };
  const schema = makeRangeSchema([0, 1], rows);
  const result = materializeRuntimeBoundJson({ ranges: [
    { sourceIndex: 1, startOffset: 10, endOffset: 14 },
    { sourceIndex: 0, startOffset: 0, endOffset: 4 },
  ] }, schema);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value.ranges.map(({ sourceId, sourceFingerprint }) => [sourceId, sourceFingerprint]), [
    ['source:b', 'fingerprint-b'],
    ['source:a', 'fingerprint-a'],
  ]);
});

test('recurses through nested arrays and objects', () => {
  const nestedRows = { '0': { sourceId: 'nested', sourceFingerprint: 'nested-fp' } };
  const rangeSchema = makeRangeSchema([0], nestedRows).properties.ranges.items;
  const schema = {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: { ranges: { type: 'array', items: rangeSchema } },
              },
            },
          },
        },
      },
    },
    'x-runtimeBindingTables': { sources: nestedRows },
  };
  const result = materializeRuntimeBoundJson({ events: [{ groups: [{ ranges: [
    { sourceIndex: 0, startOffset: 1, endOffset: 5 },
  ] }] }] }, schema);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value.events[0].groups[0].ranges[0], {
    sourceIndex: 0,
    startOffset: 1,
    endOffset: 5,
    sourceId: 'nested',
    sourceFingerprint: 'nested-fp',
  });
});

test('materializes bindings in tuple item schemas from index zero', () => {
  const rows = { '0': { sourceId: 'tuple-source', sourceFingerprint: 'tuple-fp' } };
  const boundRange = makeRangeSchema([0], rows).properties.ranges.items;
  const schema = {
    type: 'object',
    properties: { tuple: { type: 'array', items: [boundRange, { type: 'string' }] } },
    'x-runtimeBindingTables': { sources: rows },
  };
  const result = materializeRuntimeBoundJson({
    tuple: [{ sourceIndex: 0, startOffset: 3, endOffset: 8 }, 'tail'],
  }, schema);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value.tuple, [{
    sourceIndex: 0,
    startOffset: 3,
    endOffset: 8,
    sourceId: 'tuple-source',
    sourceFingerprint: 'tuple-fp',
  }, 'tail']);
});

test('unknown selector returns a candidate issue without inventing a row', () => {
  const authored = { ranges: [{ sourceIndex: 4, startOffset: 1, endOffset: 3 }] };
  const result = materializeRuntimeBoundJson(authored, makeRangeSchema([0]));

  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].path, /sourceIndex/u);
  assert.match(result.issues[0].message, /Unknown runtime binding selector/u);
  assert.deepEqual(result.value, authored);
  assert.equal(Object.hasOwn(result.value.ranges[0], 'sourceId'), false);
});

test('a conflicting authored machine value is reported and never overwritten', () => {
  const authored = { ranges: [{
    sourceIndex: 0,
    startOffset: 1,
    endOffset: 3,
    sourceId: 'author-supplied-wrong-id',
  }] };
  const result = materializeRuntimeBoundJson(authored, makeRangeSchema([0]));

  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /conflicts/u);
  assert.equal(result.value.ranges[0].sourceId, 'author-supplied-wrong-id');
  assert.equal(Object.hasOwn(result.value.ranges[0], 'sourceFingerprint'), false);
});

test('matching preexisting binding values are idempotent', () => {
  const authored = { ranges: [{
    sourceIndex: 0,
    startOffset: 1,
    endOffset: 3,
    sourceId: 'source:chapter-a',
    sourceFingerprint: 'sha-a',
  }] };
  const result = materializeRuntimeBoundJson(authored, makeRangeSchema([0]));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value, authored);
});

test('invalid metadata and table values fail explicitly as schema errors', () => {
  const missingTable = makeRangeSchema([0]);
  missingTable.properties.ranges.items['x-runtimeBindings'].table = 'missing';
  assert.throws(() => projectRuntimeBoundJsonSchema(missingTable), error => (
    error instanceof RuntimeBindingSchemaError && error.code === 'invalid_metadata'
  ));

  const missingColumn = makeRangeSchema([0]);
  missingColumn['x-runtimeBindingTables'].sources['0'].sourceFingerprint = undefined;
  assert.throws(() => materializeRuntimeBoundJson({}, missingColumn), error => (
    error instanceof RuntimeBindingSchemaError && error.code === 'invalid_metadata'
  ));

  assert.throws(() => projectRuntimeBoundJsonSchema([]), error => (
    error instanceof RuntimeBindingSchemaError && error.code === 'invalid_schema'
  ));
});

test('binding metadata cannot silently bind an undeclared or enum-incompatible selector', () => {
  const undeclared = makeRangeSchema([0]);
  delete undeclared.properties.ranges.items.properties.sourceIndex;
  assert.throws(() => projectRuntimeBoundJsonSchema(undeclared), RuntimeBindingSchemaError);

  const incompatible = makeRangeSchema([1]);
  assert.throws(() => projectRuntimeBoundJsonSchema(incompatible), error => (
    error instanceof RuntimeBindingSchemaError && error.code === 'invalid_metadata'
  ));
});

test('bindings under conditional schema branches are explicitly unsupported', () => {
  const rows = { '0': { sourceId: 'nested', sourceFingerprint: 'nested-fp' } };
  const boundRange = makeRangeSchema([0], rows).properties.ranges.items;
  const schema = {
    type: 'object',
    properties: {
      payload: {
        anyOf: [{ type: 'array', items: boundRange }],
      },
    },
    'x-runtimeBindingTables': { sources: rows },
  };

  assert.throws(() => projectRuntimeBoundJsonSchema(schema), error => (
    error instanceof RuntimeBindingSchemaError
      && error.code === 'invalid_metadata'
      && error.path.includes('anyOf')
  ));
});

test('bindings hidden in local reference definitions are explicitly unsupported', () => {
  const rows = { '0': { sourceId: 'nested', sourceFingerprint: 'nested-fp' } };
  const boundObject = {
    type: 'object',
    properties: {
      sourceIndex: { type: 'integer', enum: [0] },
      sourceId: { type: 'string', enum: ['nested'] },
      sourceFingerprint: { type: 'string', enum: ['nested-fp'] },
    },
    required: ['sourceIndex', 'sourceId', 'sourceFingerprint'],
    'x-runtimeBindings': { table: 'sources', selector: 'sourceIndex', fields: {
      sourceId: 'sourceId', sourceFingerprint: 'sourceFingerprint',
    } },
  };
  const schema = {
    type: 'object',
    properties: { payload: { $ref: '#/$defs/range' } },
    $defs: { range: boundObject },
    'x-runtimeBindingTables': { sources: rows },
  };

  assert.throws(() => projectRuntimeBoundJsonSchema(schema), error => (
    error instanceof RuntimeBindingSchemaError
      && error.code === 'invalid_metadata'
      && error.path.includes('$defs')
  ));
});

test('ordinary union and reference schemas remain unchanged and example data is not scanned', () => {
  const schema = {
    type: 'object',
    properties: {
      payload: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/plain' }] },
      sample: { const: { 'x-runtimeBindings': { table: 'not-a-schema-table' } }, examples: [{ 'x-runtimeBindingTables': {} }] },
    },
    $defs: { plain: { type: 'object', properties: { value: { type: 'string' } } } },
  };

  assert.deepEqual(projectRuntimeBoundJsonSchema(schema), schema);
});

test('hides declared runtime-only metadata from author projection while retaining the immutable contract', () => {
  const privateFacts = { 'private-handle': { tenant: 'tenant-a' } };
  const schema = { type: 'object', properties: {
    id: { anyOf: [{ type: 'string', 'x-privateConstraint': privateFacts,
      'x-runtimeOnlyKeywords': ['x-privateConstraint'] }, { type: 'null' }] },
  }, $defs: { opaque: { type: 'string', 'x-privateConstraint': privateFacts,
    'x-runtimeOnlyKeywords': ['x-privateConstraint'] } },
  'x-privateCatalog': privateFacts, 'x-runtimeOnlyKeywords': ['x-privateCatalog'] };
  const before = structuredClone(schema);
  const author = projectRuntimeBoundJsonSchema(schema);
  assert.equal(JSON.stringify(author).includes('private-handle'), false);
  assert.equal(JSON.stringify(author).includes('x-runtimeOnlyKeywords'), false);
  assert.deepEqual(author.properties.id.anyOf, [{ type: 'string' }, { type: 'null' }]);
  assert.deepEqual(author.$defs.opaque, { type: 'string' });
  assert.deepEqual(schema, before);
  for (const hidden of [['x-privateCatalog', 'x-privateCatalog'], [''], 'x-privateCatalog']) {
    assert.throws(() => projectRuntimeBoundJsonSchema({ ...schema, 'x-runtimeOnlyKeywords': hidden }), RuntimeBindingSchemaError);
  }
});
