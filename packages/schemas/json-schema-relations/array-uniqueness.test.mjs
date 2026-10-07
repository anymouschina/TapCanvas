import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectUniqueBy, inspectUniqueItems } from './array-uniqueness.mjs';

test('uniqueBy compares exact string-field tuples and reports the conflicting rows without rewriting them', () => {
  const schema = { 'x-uniqueBy': ['namespace', 'id'] };
  const rows = [{ namespace: 'a', id: '1', note: 'first' }, { namespace: 'b', id: '1' }, { namespace: 'a', id: '1', note: 'different' }];
  const before = structuredClone(rows);
  const issues = inspectUniqueBy(schema, rows, '$');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, '$[2]');
  assert.match(issues[0].message, /\$\[0\]/);
  assert.deepEqual(rows, before);
  assert.deepEqual(inspectUniqueBy({ 'x-uniqueBy': ['id'] }, [{ id: 'A' }, { id: 'a' }, { id: ' a' }], '$'), []);
});

test('uniqueBy rejects missing/non-string tuple fields and malformed declarations', () => {
  for (const fields of [[], ['id', 'id'], [null], 'id']) assert.equal(inspectUniqueBy({ 'x-uniqueBy': fields }, [], '$').length, 1);
  assert.equal(inspectUniqueBy({ 'x-uniqueBy': ['id'] }, [{}, { id: 1 }, { id: null }], '$').length, 3);
  assert.deepEqual(inspectUniqueBy({}, [{ id: 'a' }, { id: 'a' }], '$'), []);
});

test('uniqueItems uses JSON equality regardless of object key order without conflating arrays or scalar types', () => {
  assert.equal(inspectUniqueItems({ uniqueItems: true }, [{ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }], '$').length, 1);
  assert.deepEqual(inspectUniqueItems({ uniqueItems: true }, [1, '1', null, false, [1, 2], [2, 1]], '$'), []);
  assert.equal(inspectUniqueItems({ uniqueItems: true }, ['same', 'same'], '$')[0].path, '$[1]');
});
