import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterAssetPlanSchema } from '../video-authoring-stages/schema.mjs';
import { inspectReferenceFactEquality, REFERENCE_FACT_EQUALITY_KEYWORD } from './reference-facts.mjs';

const schema = chapterAssetPlanSchema.properties.objectRegistry.items;
const facts = { project_image: {
  'body-a-front': { physicalIdentityKey: 'body-a' },
  'body-a-back': { physicalIdentityKey: 'body-a' },
  'body-b': { physicalIdentityKey: 'body-b' },
  'unknown-null': { physicalIdentityKey: null },
  'unknown-missing': {},
} };
const object = imageSource => ({ kind: 'character', physicalIdentityKey: 'body-a', imageSource });
const inspect = value => inspectReferenceFactEquality(schema, value, '$.objects[2]', facts);

test('known same-body reuse preserves distinct views and the complete input', () => {
  const value = object({ mode: 'reuse', assetIds: ['body-a-front', 'body-a-back'] });
  const before = structuredClone({ value, facts, schema });
  assert.deepEqual(inspect(value), { issues: [], observations: [] });
  assert.deepEqual({ value, facts, schema }, before);
  assert.equal(value.imageSource.assetIds.length, 2);
});

test('a known different body in reuse is a precise reference issue, independent of names', () => {
  const value = { ...object({ mode: 'reuse', assetIds: ['body-a-front', 'body-b'] }), name: 'same display name' };
  const result = inspect(value);
  assert.equal(result.issues.length, 1);
  assert.equal(result.observations.length, 0);
  assert.equal(result.issues[0].path, '$.objects[2]["imageSource"]["assetIds"][1]');
  assert.match(result.issues[0].message, /body-b/);
  assert.match(result.issues[0].message, /body-a/);
});

test('generation identity inputs compare bodies; style, layout and content do not', () => {
  const value = object({ mode: 'generate', referenceAssetBindings: [
    { assetId: 'body-b', role: 'style' },
    { assetId: 'body-b', role: 'layout' },
    { assetId: 'body-b', role: 'content' },
    { assetId: 'body-a-front', role: 'identity' },
    { assetId: 'body-b', role: 'identity' },
  ] });
  const result = inspect(value);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].path, '$.objects[2]["imageSource"]["referenceAssetBindings"][4]["assetId"]');
  assert.equal(result.observations.length, 0);
});

test('unknown source identity yields observations only, with no guessed or default identity', () => {
  const result = inspect(object({ mode: 'reuse', assetIds: ['unknown-null', 'unknown-missing'] }));
  assert.equal(result.issues.length, 0);
  assert.equal(result.observations.length, 2);
  assert.ok(result.observations.every(item => item.code === 'reference_fact_unknown'));
  assert.match(result.observations[0].message, /no identity was inferred/);
  const emptyCatalog = inspectReferenceFactEquality(schema, object({ mode: 'reuse', assetIds: ['not-in-catalog'] }), '$', {});
  assert.equal(emptyCatalog.issues.length, 0, 'handle existence remains the bound enum validator responsibility');
  assert.equal(emptyCatalog.observations.length, 1);
});

test('non-character objects and unrelated contracts do not acquire identity constraints', () => {
  assert.deepEqual(inspect({ kind: 'scene', physicalIdentityKey: 'body-a', imageSource: { mode: 'reuse', assetIds: ['body-b'] } }), { issues: [], observations: [] });
  assert.deepEqual(inspectReferenceFactEquality({}, object({ mode: 'reuse', assetIds: ['body-b'] }), '$', facts), { issues: [], observations: [] });
  assert.deepEqual(inspect(object({ mode: 'generate', referenceAssetBindings: [] })), { issues: [], observations: [] });
});

test('the relation is generic to exact string facts and does not normalize them', () => {
  const generic = { [REFERENCE_FACT_EQUALITY_KEYWORD]: [{ ownerField: 'tenant', referencePath: ['attachmentIds', '*'], catalog: 'documents', factField: 'tenantKey', unknownFact: 'observe' }] };
  const referenceFacts = { documents: { a: { tenantKey: 'ORG' }, b: { tenantKey: 'org' } } };
  const result = inspectReferenceFactEquality(generic, { tenant: 'ORG', attachmentIds: ['a', 'b'] }, '$', referenceFacts);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].path, '$["attachmentIds"][1]');
});

test('catalog and field selection only sees own properties', () => {
  const inherited = Object.create({ 'body-a-front': { physicalIdentityKey: 'body-b' } });
  const result = inspectReferenceFactEquality(schema, object({ mode: 'reuse', assetIds: ['body-a-front'] }), '$', { project_image: inherited });
  assert.equal(result.issues.length, 0);
  assert.equal(result.observations.length, 1);
});

test('malformed declarative relations fail as schema issues rather than silently choosing a rule', () => {
  const valid = schema[REFERENCE_FACT_EQUALITY_KEYWORD][0];
  for (const relation of [null, {}, { ...valid, referencePath: [] }, { ...valid, unknownFact: 'reject' }, { ...valid, extraRule: true }, { ...valid, when: [{ path: ['kind'], equals: 'character', unknown: true }] }]) {
    const result = inspectReferenceFactEquality({ [REFERENCE_FACT_EQUALITY_KEYWORD]: [relation] }, {}, '$', facts);
    assert.equal(result.issues.length, 1);
    assert.equal(result.observations.length, 0);
  }
});
