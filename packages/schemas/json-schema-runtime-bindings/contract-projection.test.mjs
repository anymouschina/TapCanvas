import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRuntimeBoundJsonOutputContract } from './index.mjs';

function makeContract() {
  const range = {
    type: 'object',
    properties: {
      sourceIndex: { type: 'integer', enum: [0] },
      startOffset: { type: 'integer' },
      endOffset: { type: 'integer' },
      sourceId: { type: 'string' },
      sourceFingerprint: { type: 'string' },
    },
    required: ['sourceIndex', 'startOffset', 'endOffset', 'sourceId', 'sourceFingerprint'],
    'x-runtimeBindings': {
      table: 'sources',
      selector: 'sourceIndex',
      fields: { sourceId: 'sourceId', sourceFingerprint: 'sourceFingerprint' },
    },
  };
  return {
    kind: 'json',
    submissionPolicy: 'record_and_fail',
    jsonSchema: {
      type: 'object',
      properties: {
        protocolVersion: { type: 'string' },
        totalDurationSeconds: { type: 'number' },
        authorNote: { type: 'string' },
        sourceRanges: { type: 'array', items: range },
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              eventId: { type: 'string' },
              start: { type: 'number' },
              end: { type: 'number' },
            },
            required: ['eventId', 'start', 'end'],
          },
        },
        boundaries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              boundaryId: { type: 'string' },
              timeSeconds: { type: 'number' },
              authoredScore: { type: 'number' },
            },
            required: ['boundaryId', 'timeSeconds', 'authoredScore'],
          },
        },
        clips: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              durationSeconds: { type: 'number' },
              startBoundaryId: { type: 'string' },
              endBoundaryId: { type: 'string' },
              storyEventIds: { type: 'array', items: { type: 'string' } },
              speechEventIds: { type: 'array', items: { type: 'string' } },
              authoredNote: { type: 'string' },
              authoredTags: { type: 'array', items: { type: 'string' } },
            },
            required: ['durationSeconds', 'startBoundaryId', 'endBoundaryId', 'storyEventIds', 'speechEventIds', 'authoredNote'],
          },
        },
      },
      required: ['protocolVersion', 'totalDurationSeconds', 'sourceRanges', 'boundaries', 'clips'],
      'x-runtimeBindingTables': { sources: { '0': { sourceId: 's0', sourceFingerprint: 'fp0' } } },
      'x-runtimeDerivations': [
        { op: 'sum', valuesPath: ['clips', '*', 'durationSeconds'], outputPath: ['totalDurationSeconds'] },
        { op: 'prefixSums', valuesPath: ['clips', '*', 'durationSeconds'], outputPath: ['boundaries', '*', 'timeSeconds'], initial: 0, includeTerminal: true },
        { op: 'indexReference', targetPath: ['clips'], outputField: 'startBoundaryId', sourcePath: ['boundaries'], sourceIdField: 'boundaryId', offset: 0 },
        { op: 'indexReference', targetPath: ['clips'], outputField: 'endBoundaryId', sourcePath: ['boundaries'], sourceIdField: 'boundaryId', offset: 1 },
        { op: 'intervalReferences', targetPath: ['clips'], outputField: 'storyEventIds', eventsPath: ['events'], eventIdField: 'eventId', startField: 'start', endField: 'end', durationField: 'durationSeconds', match: 'overlap' },
        { op: 'intervalReferences', targetPath: ['clips'], outputField: 'speechEventIds', eventsPath: ['events'], eventIdField: 'eventId', startField: 'start', endField: 'end', durationField: 'durationSeconds', match: 'containedByExactlyOne' },
      ],
    },
    requiredStringFields: ['protocolVersion', 'authorNote'],
    requiredNumberFields: ['totalDurationSeconds', 'authoredNumber'],
    requiredObjectFields: ['totalDurationSeconds', 'authoredObject'],
    requiredObjectArrayFields: ['totalDurationSeconds', 'clips'],
    requiredArrayFields: ['totalDurationSeconds', 'clips', 'boundaries'],
    allowedFields: ['protocolVersion', 'totalDurationSeconds', 'authorNote', 'clips'],
    allowedTopLevelFields: ['protocolVersion', 'totalDurationSeconds', 'authorNote', 'clips'],
    exactStringFields: { protocolVersion: 'v1', totalDurationSeconds: 'host-owned' },
    expectedArrayLengths: { totalDurationSeconds: 1, clips: 2, boundaries: 3 },
    requiredNonEmptyStringPaths: ['clips[].startBoundaryId', 'clips[].authoredNote', 'sourceRanges[].sourceId', 'sourceRanges[].startOffset'],
    requiredObjectPaths: ['clips[].startBoundaryId', 'authorMetadata'],
    requiredArrayPaths: ['clips[].storyEventIds', 'clips[].authoredTags'],
    optionalNonEmptyStringPaths: ['clips[].endBoundaryId', 'clips[].authoredNote'],
    exactStringPaths: {
      'clips[].startBoundaryId': 'b0',
      'sourceRanges[].sourceFingerprint': 'fp0',
      'sourceRanges[].startOffset': '1',
    },
    arrayItemRequiredStringFields: { clips: ['startBoundaryId', 'authoredNote'] },
    arrayItemStringFormats: { clips: { startBoundaryId: 'asset-role-v1', authoredNote: 'asset-role-v1' } },
    arrayItemRequiredStringArrayFields: { clips: ['storyEventIds', 'authoredTags'] },
    arrayItemRequiredNonEmptyStringArrayFields: { clips: ['speechEventIds', 'authoredTags'] },
    arrayItemAllowedFields: { clips: ['durationSeconds', 'startBoundaryId', 'endBoundaryId', 'storyEventIds', 'speechEventIds', 'authoredNote', 'authoredTags'] },
    arrayItemExactNumberFields: {
      boundaries: [{ timeSeconds: 0 }, { timeSeconds: 4, authoredScore: 7 }, { timeSeconds: 10 }],
    },
    arrayItemNumberAllowedValues: { boundaries: { timeSeconds: [0, 4, 10], authoredScore: [7] } },
    arrayItemExactStringFields: {
      clips: [{ startBoundaryId: 'b0' }, { endBoundaryId: 'b2', authoredNote: 'keep row two' }],
    },
    arrayItemExactStringArrayFields: {
      clips: [{ storyEventIds: ['event-a'] }, { speechEventIds: ['line-b'], authoredTags: ['keep'] }],
    },
    unrelatedMetadata: { retain: true },
  };
}

test('projects schema and auxiliary output rules for every declared host-owned path', () => {
  const contract = makeContract();
  const original = structuredClone(contract);
  const projected = projectRuntimeBoundJsonOutputContract(contract);

  assert.deepEqual(contract, original);
  assert.equal(Object.hasOwn(projected.jsonSchema.properties, 'totalDurationSeconds'), false);
  assert.equal(Object.hasOwn(projected.jsonSchema.properties.clips.items.properties, 'startBoundaryId'), false);
  assert.equal(Object.hasOwn(projected.jsonSchema.properties.sourceRanges.items.properties, 'sourceId'), false);
  assert.deepEqual(projected.requiredNumberFields, ['authoredNumber']);
  assert.deepEqual(projected.requiredStringFields, ['protocolVersion', 'authorNote']);
  assert.deepEqual(projected.allowedFields, ['protocolVersion', 'authorNote', 'clips']);
  assert.deepEqual(projected.allowedTopLevelFields, ['protocolVersion', 'authorNote', 'clips']);
  assert.deepEqual(projected.exactStringFields, { protocolVersion: 'v1' });
  assert.deepEqual(projected.expectedArrayLengths, { clips: 2, boundaries: 3 });
  assert.deepEqual(projected.requiredNonEmptyStringPaths, [
    'clips[].authoredNote', 'sourceRanges[].startOffset',
  ]);
  assert.deepEqual(projected.requiredObjectPaths, ['authorMetadata']);
  assert.deepEqual(projected.requiredArrayPaths, ['clips[].authoredTags']);
  assert.deepEqual(projected.optionalNonEmptyStringPaths, ['clips[].authoredNote']);
  assert.deepEqual(projected.exactStringPaths, { 'sourceRanges[].startOffset': '1' });
  assert.deepEqual(projected.arrayItemRequiredStringFields, { clips: ['authoredNote'] });
  assert.deepEqual(projected.arrayItemStringFormats, { clips: { authoredNote: 'asset-role-v1' } });
  assert.deepEqual(projected.arrayItemRequiredStringArrayFields, { clips: ['authoredTags'] });
  assert.deepEqual(projected.arrayItemRequiredNonEmptyStringArrayFields, { clips: ['authoredTags'] });
  assert.deepEqual(projected.arrayItemAllowedFields, { clips: ['durationSeconds', 'authoredNote', 'authoredTags'] });
  assert.deepEqual(projected.arrayItemExactNumberFields, {
    boundaries: [{}, { authoredScore: 7 }, {}],
  });
  assert.deepEqual(projected.arrayItemNumberAllowedValues, { boundaries: { authoredScore: [7] } });
  assert.deepEqual(projected.arrayItemExactStringFields, {
    clips: [{}, { authoredNote: 'keep row two' }],
  });
  assert.deepEqual(projected.arrayItemExactStringArrayFields, {
    clips: [{}, { authoredTags: ['keep'] }],
  });
  assert.deepEqual(projected.unrelatedMetadata, { retain: true });
});

test('removes nested constraints below a host-owned object path but keeps sibling author paths', () => {
  const contract = {
    jsonSchema: {
      type: 'object',
      required: ['frozenObject'],
      'x-runtimeBindingTables': { rows: { only: { objectValue: { frozenId: 'id' } } } },
      properties: {
        frozenObject: {
          type: 'object',
          properties: { selector: { type: 'string', enum: ['only'] }, frozenId: { type: 'string' }, authoredNote: { type: 'string' } },
          required: ['selector', 'frozenId', 'authoredNote'],
          'x-runtimeBindings': { table: 'rows', selector: 'selector', fields: { frozenId: 'objectValue' } },
        },
      },
    },
    exactStringPaths: { 'frozenObject.frozenId': 'id', 'frozenObject.authoredNote': 'keep' },
    requiredNonEmptyStringPaths: ['frozenObject.frozenId', 'frozenObject.authoredNote'],
  };
  const projected = projectRuntimeBoundJsonOutputContract(contract);
  assert.deepEqual(projected.exactStringPaths, { 'frozenObject.authoredNote': 'keep' });
  assert.deepEqual(projected.requiredNonEmptyStringPaths, ['frozenObject.authoredNote']);
});
