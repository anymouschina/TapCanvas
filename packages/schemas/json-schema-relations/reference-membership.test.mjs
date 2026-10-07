import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectReferenceMembership } from './reference-membership.mjs';

test('checks exact frozen reference permissions without revealing other handles', () => {
  const schema = { type: 'string', 'x-referenceSource': 'documents' };
  const catalogs = { documents: ['returned-by-match', 'not-yet-read'] };
  assert.deepEqual(inspectReferenceMembership(schema, 'returned-by-match', '$.id', catalogs), []);
  assert.deepEqual(inspectReferenceMembership(schema, 'not-yet-read', '$.id', catalogs), []);
  const issues = inspectReferenceMembership(schema, 'forged', '$.id', catalogs);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].path, '$.id');
  assert.equal(JSON.stringify(issues).includes('not-yet-read'), false);
  assert.equal(inspectReferenceMembership(schema, 'returned-by-match', '$.id', { documents: [] }).length, 1);
});

test('requires declared valid runtime catalogs and leaves ordinary field types to the schema', () => {
  for (const catalogs of [{}, { documents: ['id', 'id'] }, { documents: [3] }]) {
    assert.equal(inspectReferenceMembership({ 'x-referenceSource': 'documents' }, 'id', '$', catalogs).length, 1);
  }
  assert.deepEqual(inspectReferenceMembership({ type: 'string' }, 'id', '$', undefined), []);
  assert.deepEqual(inspectReferenceMembership({ 'x-referenceSource': 'documents' }, 'id', '$', undefined), []);
  assert.deepEqual(inspectReferenceMembership({ 'x-referenceSource': 'documents' }, null, '$', { documents: [] }), []);
});
