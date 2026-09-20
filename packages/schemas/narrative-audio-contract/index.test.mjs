import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectNarrativeAudioPlan } from './index.mjs';
const line = { lineId: 'authored-1', speakerName: 'speaker', text: 'spoken', delivery: 'voice_over', sourceLineId: null, afterSourceLineId: null, sourceEvidence: [] };

test('authored occurrence identities cannot be used as source anchors', () => {
 assert.match(inspectNarrativeAudioPlan({ lines: [{ ...line, afterSourceLineId: 'authored-1' }] }, [], 'beat'), /existing dialogueScript/);
 assert.equal(inspectNarrativeAudioPlan({ lines: [{ ...line, afterSourceLineId: 'L1' }] }, [{lineId:'L1'}], 'beat'), null);
});
test('authored occurrence permits null source identity without mutating content', () => {
 const plan = { lines: [line] }; const before = structuredClone(plan);
 assert.equal(inspectNarrativeAudioPlan(plan, [], 'beat'), null);
 assert.deepEqual(plan, before);
});
test('explicit source identities must be nonempty and reference frozen dialogue', () => {
 assert.match(inspectNarrativeAudioPlan({ lines: [{ ...line, sourceLineId: '' }] }, [], 'beat'), /non-empty source identity/);
 assert.match(inspectNarrativeAudioPlan({ lines: [{ ...line, sourceLineId: 'L1' }] }, [], 'beat'), /existing dialogueScript/);
 assert.equal(inspectNarrativeAudioPlan({ lines: [{ ...line, sourceLineId: 'L1' }] }, [{ lineId: 'L1' }], 'beat'), null);
});
test('duplicates, malformed placement and invalid delivery remain structural errors', () => {
 assert.match(inspectNarrativeAudioPlan({ lines: [line, line] }, [], 'beat'), /unique/);
 assert.match(inspectNarrativeAudioPlan({ lines: [{ ...line, afterSourceLineId: '' }] }, [], 'beat'), /afterSourceLineId/);
 assert.match(inspectNarrativeAudioPlan({ lines: [{ ...line, delivery: 'unknown' }] }, [], 'beat'), /delivery/);
});
