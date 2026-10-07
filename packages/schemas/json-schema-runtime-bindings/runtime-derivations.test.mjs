import assert from 'node:assert/strict';
import test from 'node:test';
import {
  materializeRuntimeBoundJson,
  projectRuntimeBoundJsonSchema,
  RuntimeBindingSchemaError,
  runtimeDerivedOutputPaths,
  runtimeOwnedOutputPaths,
} from './index.mjs';

function makeSchema() {
  const sourceRange = {
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
  const eventItem = eventIdField => ({
    type: 'object',
    properties: {
      [eventIdField]: { type: 'string' },
      startSeconds: { type: 'number' },
      endSeconds: { type: 'number' },
      sourceRanges: { type: 'array', items: sourceRange },
    },
    required: [eventIdField, 'startSeconds', 'endSeconds', 'sourceRanges'],
  });

  return {
    type: 'object',
    properties: {
      protocolVersion: { type: 'string', const: 'sequence/v1' },
      wholeFilmIntent: { type: 'string' },
      totalDurationSeconds: { type: 'number' },
      storyEvents: { type: 'array', items: eventItem('eventId') },
      speechEvents: {
        type: 'array',
        items: {
          ...eventItem('speechEventId'),
          properties: {
            ...eventItem('speechEventId').properties,
            text: { type: 'string' },
          },
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
          required: ['boundaryId', 'timeSeconds'],
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
          },
          required: ['durationSeconds', 'startBoundaryId', 'endBoundaryId', 'storyEventIds', 'speechEventIds', 'authoredNote'],
        },
      },
    },
    required: ['protocolVersion', 'wholeFilmIntent', 'totalDurationSeconds', 'storyEvents', 'speechEvents', 'boundaries', 'clips'],
    'x-runtimeBindingTables': {
      sources: { '0': { sourceId: 'source:a', sourceFingerprint: 'sha:a' } },
    },
    'x-runtimeDerivations': [
      { op: 'sum', valuesPath: ['clips', '*', 'durationSeconds'], outputPath: ['totalDurationSeconds'] },
      { op: 'prefixSums', valuesPath: ['clips', '*', 'durationSeconds'], outputPath: ['boundaries', '*', 'timeSeconds'], initial: 0, includeTerminal: true },
      { op: 'indexReference', targetPath: ['clips'], outputField: 'startBoundaryId', sourcePath: ['boundaries'], sourceIdField: 'boundaryId', offset: 0 },
      { op: 'indexReference', targetPath: ['clips'], outputField: 'endBoundaryId', sourcePath: ['boundaries'], sourceIdField: 'boundaryId', offset: 1 },
      { op: 'intervalReferences', targetPath: ['clips'], outputField: 'storyEventIds', eventsPath: ['storyEvents'], eventIdField: 'eventId', startField: 'startSeconds', endField: 'endSeconds', durationField: 'durationSeconds', match: 'overlap' },
      { op: 'intervalReferences', targetPath: ['clips'], outputField: 'speechEventIds', eventsPath: ['speechEvents'], eventIdField: 'speechEventId', startField: 'startSeconds', endField: 'endSeconds', durationField: 'durationSeconds', match: 'containedByExactlyOne' },
    ],
  };
}

function authoredCandidate() {
  return {
    protocolVersion: 'sequence/v1',
    wholeFilmIntent: 'authored intent',
    storyEvents: [
      { eventId: 'opening', startSeconds: 0, endSeconds: 2, sourceRanges: [] },
      { eventId: 'impact', startSeconds: 3, endSeconds: 5, sourceRanges: [{ sourceIndex: 0, startOffset: 1, endOffset: 5 }] },
      { eventId: 'ending', startSeconds: 8, endSeconds: 9, sourceRanges: [] },
    ],
    speechEvents: [
      { speechEventId: 'line-a', startSeconds: 1, endSeconds: 2, text: 'authored speech A', sourceRanges: [] },
      { speechEventId: 'line-b', startSeconds: 7, endSeconds: 8, text: 'authored speech B', sourceRanges: [] },
    ],
    boundaries: [
      { boundaryId: 'b0' },
      { boundaryId: 'b1', authoredScore: 7 },
      { boundaryId: 'b2' },
    ],
    clips: [
      { durationSeconds: 4, authoredNote: 'first clip' },
      { durationSeconds: 6, authoredNote: 'second clip' },
    ],
  };
}

test('projects and materializes the four declared timeline relations without changing authored facts', () => {
  const schema = makeSchema();
  const originalSchema = structuredClone(schema);
  const candidate = authoredCandidate();
  const originalCandidate = structuredClone(candidate);
  const projected = projectRuntimeBoundJsonSchema(schema);
  const result = materializeRuntimeBoundJson(candidate, schema);

  assert.deepEqual(schema, originalSchema);
  assert.deepEqual(candidate, originalCandidate);
  assert.deepEqual(projected.required, ['protocolVersion', 'wholeFilmIntent', 'storyEvents', 'speechEvents', 'boundaries', 'clips']);
  assert.equal(Object.hasOwn(projected.properties, 'totalDurationSeconds'), false);
  assert.equal(Object.hasOwn(projected.properties.boundaries.items.properties, 'timeSeconds'), false);
  assert.equal(Object.hasOwn(projected.properties.clips.items.properties, 'startBoundaryId'), false);
  assert.equal(Object.hasOwn(projected, 'x-runtimeDerivations'), false);
  assert.deepEqual(result.issues, []);
  assert.equal(result.value.totalDurationSeconds, 10);
  assert.deepEqual(result.value.boundaries.map(({ boundaryId, timeSeconds }) => [boundaryId, timeSeconds]), [
    ['b0', 0], ['b1', 4], ['b2', 10],
  ]);
  assert.deepEqual(result.value.clips.map(({ startBoundaryId, endBoundaryId, storyEventIds, speechEventIds }) => ({
    startBoundaryId, endBoundaryId, storyEventIds, speechEventIds,
  })), [
    { startBoundaryId: 'b0', endBoundaryId: 'b1', storyEventIds: ['opening', 'impact'], speechEventIds: ['line-a'] },
    { startBoundaryId: 'b1', endBoundaryId: 'b2', storyEventIds: ['impact', 'ending'], speechEventIds: ['line-b'] },
  ]);
  assert.deepEqual(result.value.storyEvents[1].sourceRanges[0], {
    sourceIndex: 0, startOffset: 1, endOffset: 5, sourceId: 'source:a', sourceFingerprint: 'sha:a',
  });
  assert.deepEqual(result.value.speechEvents.map(({ text }) => text), ['authored speech A', 'authored speech B']);
});

test('exposes derived and bound output paths with array wildcards', () => {
  const schema = makeSchema();
  assert.deepEqual(runtimeDerivedOutputPaths(schema), [
    ['totalDurationSeconds'],
    ['boundaries', '*', 'timeSeconds'],
    ['clips', '*', 'startBoundaryId'],
    ['clips', '*', 'endBoundaryId'],
    ['clips', '*', 'storyEventIds'],
    ['clips', '*', 'speechEventIds'],
  ]);
  assert.deepEqual(runtimeOwnedOutputPaths(schema), [
    ['storyEvents', '*', 'sourceRanges', '*', 'sourceId'],
    ['storyEvents', '*', 'sourceRanges', '*', 'sourceFingerprint'],
    ['speechEvents', '*', 'sourceRanges', '*', 'sourceId'],
    ['speechEvents', '*', 'sourceRanges', '*', 'sourceFingerprint'],
    ...runtimeDerivedOutputPaths(schema),
  ]);
});

test('keeps conflicting authored derived values and reports their exact output paths', () => {
  const candidate = authoredCandidate();
  candidate.totalDurationSeconds = 999;
  candidate.clips[0].startBoundaryId = 'wrong';
  const result = materializeRuntimeBoundJson(candidate, makeSchema());

  assert.equal(result.value.totalDurationSeconds, 999);
  assert.equal(result.value.clips[0].startBoundaryId, 'wrong');
  assert.ok(result.issues.some(issue => issue.path === '$["totalDurationSeconds"]'));
  assert.ok(result.issues.some(issue => issue.path === '$["clips"][0]["startBoundaryId"]'));
  assert.equal(result.value.clips[1].startBoundaryId, 'b1');
});

test('rejects duplicate, bound-field, and unknown derivation declarations as schema errors', () => {
  const duplicate = makeSchema();
  duplicate['x-runtimeDerivations'].push({ op: 'sum', valuesPath: ['clips', '*', 'durationSeconds'], outputPath: ['totalDurationSeconds'] });
  assert.throws(() => projectRuntimeBoundJsonSchema(duplicate), error => (
    error instanceof RuntimeBindingSchemaError && error.code === 'invalid_metadata'
  ));

  const bindingConflict = makeSchema();
  bindingConflict['x-runtimeDerivations'] = [{
    op: 'sum', valuesPath: ['clips', '*', 'durationSeconds'], outputPath: ['storyEvents', '*', 'sourceRanges', '*', 'sourceId'],
  }];
  assert.throws(() => projectRuntimeBoundJsonSchema(bindingConflict), RuntimeBindingSchemaError);

  const unknown = makeSchema();
  unknown['x-runtimeDerivations'] = [{ op: 'guessFromText', outputPath: ['wholeFilmIntent'] }];
  assert.throws(() => projectRuntimeBoundJsonSchema(unknown), error => (
    error instanceof RuntimeBindingSchemaError && error.code === 'invalid_metadata'
  ));
});

test('reports malformed intervals, zero durations, and out-of-range references without rewriting facts', () => {
  const zeroDuration = authoredCandidate();
  zeroDuration.clips[0].durationSeconds = 0;
  const zeroResult = materializeRuntimeBoundJson(zeroDuration, makeSchema());
  assert.ok(zeroResult.issues.some(issue => issue.message.includes('duration must be positive')));
  assert.equal(zeroResult.value.clips[0].durationSeconds, 0);

  const invalidEvent = authoredCandidate();
  invalidEvent.storyEvents[0].endSeconds = invalidEvent.storyEvents[0].startSeconds;
  const eventResult = materializeRuntimeBoundJson(invalidEvent, makeSchema());
  assert.ok(eventResult.issues.some(issue => issue.message.includes('positive length')));
  assert.equal(eventResult.value.storyEvents[0].endSeconds, 0);

  const outOfRange = makeSchema();
  outOfRange['x-runtimeDerivations'] = [{
    op: 'indexReference', targetPath: ['clips'], outputField: 'startBoundaryId', sourcePath: ['boundaries'], sourceIdField: 'boundaryId', offset: 5,
  }];
  const referenceResult = materializeRuntimeBoundJson(authoredCandidate(), outOfRange);
  assert.ok(referenceResult.issues.some(issue => issue.message.includes('out of bounds')));
});

import { describeIntervalContainmentFailure } from './runtime-derivations-evaluator.mjs';

test('interval containment failure names the event, crossing windows and the fix', () => {
  const windows = [{ start: 0, end: 15 }, { start: 15, end: 30 }, { start: 30, end: 45 }];
  const crossing = describeIntervalContainmentFailure({ start: 13.5, end: 16.2, windows });
  assert.match(crossing, /\[13\.5, 16\.2\]/);
  assert.match(crossing, /overlaps 2 windows \(#0 \[0, 15\], #1 \[15, 30\]\)/);
  assert.match(crossing, /Target windows: #0 \[0, 15\]; #1 \[15, 30\]; #2 \[30, 45\]/);
  assert.match(crossing, /split it at the window boundary/);
  const outside = describeIntervalContainmentFailure({ start: 50, end: 52, windows });
  assert.match(outside, /outside every target window \(total span \[0, 45\]\)/);
});

import { describeDerivedValueConflict } from './runtime-derivations-evaluator.mjs';

test('derived value conflicts keep the original wording and say the field is runtime-owned', () => {
  const message = describeDerivedValueConflict(['e1', 'e2']);
  assert.match(message, /^Candidate value conflicts with the runtime-derived value/);
  assert.match(message, /derived: \["e1","e2"\]/);
  assert.match(message, /runtime-owned: omit it from the candidate/);
  assert.ok(describeDerivedValueConflict('x'.repeat(500)).length < 400, 'long expected values are truncated');
});

test('derived item count mismatches state the exact count to provide', () => {
  const candidate = authoredCandidate();
  const expected = candidate.boundaries.length;
  candidate.boundaries = candidate.boundaries.slice(0, -1);
  const issues = materializeRuntimeBoundJson(candidate, makeSchema()).issues;
  const mismatch = issues.find(issue => /does not match derived count/.test(issue.message));
  assert.ok(mismatch, 'removing a boundary must trigger the count mismatch');
  assert.match(mismatch.message, new RegExp(`provide exactly ${expected} items in \\$\\.boundaries`));
  assert.match(mismatch.message, /derived from clips\.\w+: \d+ items? plus one terminal entry/);
});
