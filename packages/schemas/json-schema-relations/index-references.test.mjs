import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectIndexReferences } from './index-references.mjs';

const schema = { 'x-indexReferences': [{ values: ['references', '*', 'index'], collection: ['items'] }] };
test('checks actual collection length, zero-based integer identity and precise source path', () => {
  for (const index of [-1, 2, 0.5, '1', null]) {
    const value = { items: [{}, {}], references: [{ index }] };
    const before = structuredClone(value);
    assert.equal(inspectIndexReferences(schema, value, '$')[0].path, '$.references[0].index');
    assert.deepEqual(value, before);
  }
  assert.deepEqual(inspectIndexReferences(schema, { items: [{}, {}], references: [{ index: 0 }, { index: 1 }] }, '$'), []);
  assert.deepEqual(inspectIndexReferences(schema, { items: [], references: [] }, '$'), []);
  assert.equal(inspectIndexReferences(schema, { items: [], references: [{ index: 0 }] }, '$').length, 1);
});
test('malformed declarations and unresolved collection paths report structural issues', () => {
  for (const relation of [null, {}, { values: [], collection: ['items'] }, { values: ['index'], collection: ['*'] }]) {
    assert.equal(inspectIndexReferences({ 'x-indexReferences': [relation] }, {}, '$').length, 1);
  }
  assert.equal(inspectIndexReferences(schema, { references: [] }, '$')[0].path, '$.items');
});
