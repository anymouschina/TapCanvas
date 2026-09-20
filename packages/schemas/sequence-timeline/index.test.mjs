import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSequenceTimeline } from './index.mjs';
test('derives contiguous coordinates without changing authored duration, transition or directive facts', () => {
 const source={beats:[{durationSeconds:15},{durationSeconds:10}],sequenceControlPlan:{totalDurationSeconds:99,segments:[{startSeconds:7,endSeconds:3,transitionToNext:'转身',temporalDirectives:[]},{startSeconds:3,endSeconds:0,temporalDirectives:[{startSeconds:16,endSeconds:17,kind:'move',reason:'明确动作'}]}]}};
 const next=compileSequenceTimeline(source);
 assert.deepEqual(next.sequenceControlPlan.segments.map(s=>[s.startSeconds,s.endSeconds]),[[0,15],[15,25]]);
 assert.equal(next.sequenceControlPlan.totalDurationSeconds,25);
 assert.equal(next.beats,source.beats);
 assert.equal(next.sequenceControlPlan.segments[1].temporalDirectives,source.sequenceControlPlan.segments[1].temporalDirectives);
 assert.equal(source.sequenceControlPlan.totalDurationSeconds,99);
 assert.equal(compileSequenceTimeline(next),next);
});
test('does not invent missing duration or segment facts',()=>{
 for(const source of [{beats:[{durationSeconds:-1}],sequenceControlPlan:{segments:[{}]}},{beats:[{durationSeconds:15}],sequenceControlPlan:{segments:[]}}]) assert.equal(compileSequenceTimeline(source),source);
});
