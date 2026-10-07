import assert from 'node:assert/strict';
import test from 'node:test';
import { compactRepeatedJsonSchemaEnums, resolveLocalJsonSchemaReferences } from './local-references.mjs';

test('repeated enums are losslessly shared once without rewriting instance data or mutating the source', () => {
  const values = Array.from({ length: 853 }, (_, index) => `project-node:chapter:book-${'x'.repeat(40)}:asset-${index}`);
  const field = { type: 'string', enum: values, minLength: 1 };
  const input = { type: 'object', properties: { reuse: field, generate: field, background: field },
    examples: [{ enum: values, $ref: 'this is instance data' }], $defs: { sharedEnum1: { const: 'existing-definition' } } };
  const before = JSON.stringify(input);
  const compact = compactRepeatedJsonSchemaEnums(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(compact.$defs.sharedEnum2.enum, values);
  assert.equal(compact.properties.reuse.enum, undefined);
  assert.deepEqual(compact.examples, input.examples);
  assert.equal(compact.$defs.sharedEnum1.const, 'existing-definition');
  assert.ok(JSON.stringify(compact).length < before.length * 0.6);
  assert.deepEqual(compactRepeatedJsonSchemaEnums(compact), compact);
  const resolved = resolveLocalJsonSchemaReferences(compact);
  assert.equal(resolved.properties.reuse.allOf[0], resolved.properties.generate.allOf[0], 'resolved targets share one in-memory definition');
  assert.deepEqual(resolved.properties.reuse.allOf[0].enum, values);
});

test('local references support JSON pointer escapes and sibling constraints', () => {
  const schema = { $defs: { 'a/b~c': { type: 'string', enum: ['a', 'b'] } }, $ref: '#/$defs/a~1b~0c', minLength: 2 };
  const resolved = resolveLocalJsonSchemaReferences(schema);
  assert.deepEqual(resolved.allOf[0], { type: 'string', enum: ['a', 'b'] });
  assert.equal(resolved.allOf[1].minLength, 2);
});

test('invalid, remote and recursive references fail explicitly without resolving instance data', () => {
  for (const schema of [{ $ref: 'https://example.test/schema' }, { $ref: '#/$defs/absent' },
    { $defs: { loop: { $ref: '#/$defs/loop' } }, $ref: '#/$defs/loop' },
    { $defs: { wrong: [] }, $ref: '#/$defs/wrong' }, { $ref: '#/bad~9' }]) {
    assert.throws(() => resolveLocalJsonSchemaReferences(schema));
  }
  const schema = { type: 'object', const: { $ref: 'https://example.test/instance' } };
  assert.deepEqual(resolveLocalJsonSchemaReferences(schema), schema);
});
