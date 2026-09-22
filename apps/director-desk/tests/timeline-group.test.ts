import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, assertProject } from '../src/model.ts';
import { createTimelineGroupDrag } from '../src/editor/timeline-group-drag.ts';
import { clearTimelineSelection, setSelectedClips, toggleSelectedClip, selectedClips, setSelectedTimeRange, editorSelection } from '../src/editor/timeline-selection.ts';
import type { TimelineSelection } from '../src/clip-editing.ts';

function fixture() {
    const p = demoProject(); p.duration = 20;
    const actors = p.entities.filter(e => e.kind === 'actor').slice(0, 2);
    actors.forEach((e, i) => { e.path = null; e.clips = [{ id: `picked-${i}`, action: 'walk', speed: 1, start: 1 + i, end: 3 + i }, { id: `fixed-${i}`, action: 'idle', speed: 1, start: 7 + i, end: 9 + i }]; });
    const selected: TimelineSelection[] = actors.map(e => ({ kind: 'action', entityId: e.id, id: e.clips[0].id }));
    return { p, actors, selected };
}
test('group drag preserves spacing, clamps all objects together, and repeated inputs are absolute', () => {
    const { p, actors, selected } = fixture(), before = actors.map(e => ({ ...e.clips[1] }));
    const drag = createTimelineGroupDrag(p, selected, selected[0]);
    drag.apply(2, false); assert.deepEqual(actors.map(e => e.clips[0].start), [3, 4]);
    drag.apply(1, false); assert.deepEqual(actors.map(e => e.clips[0].start), [2, 3]);
    drag.apply(20, false); assert.deepEqual(actors.map(e => e.clips[0].end), [7, 8]);
    drag.apply(-20, false); assert.deepEqual(actors.map(e => e.clips[0].start), [0, 1]);
    assert.deepEqual(actors.map(e => e.clips[1]), before); assertProject(p);
});
test('group resize clamps at the next item and minimum frame, preserving starts and resources', () => {
    const { p, actors, selected } = fixture(), source = p.resources;
    const drag = createTimelineGroupDrag(p, selected, selected[0]);
    drag.apply(2, true); assert.deepEqual(actors.map(e => e.clips[0].end), [5, 6]);
    drag.apply(20, true); assert.deepEqual(actors.map(e => e.clips[0].end), [7, 8]);
    drag.apply(-20, true); actors.forEach(e => assert.ok(Math.abs(e.clips[0].end - e.clips[0].start - 1 / p.fps) < 1e-8));
    assert.equal(p.resources, source); assertProject(p);
});
test('path and action group timing stays aligned and can extend scene duration', () => {
    const { p, actors, selected } = fixture(); actors.forEach(e => e.clips.splice(1));
    actors[0].path = { smooth: false, points: [{ time: 1, position: [0, 0, 0] }, { time: 3, position: [5, 0, 0] }] };
    selected.push({ kind: 'path', entityId: actors[0].id, index: 0 });
    const drag = createTimelineGroupDrag(p, selected, selected[0]);
    for (const d of [4, 10, 1, 20]) drag.apply(d, false);
    assert.deepEqual(actors[0].path.points.map(p => p.time), [21, 23]);
    assert.equal(actors[0].clips[0].start, 21); assert.equal(p.duration, 24); assertProject(p);
});
test('selected adjacent clips move together and locks reject before mutation', () => {
    const { p, actors, selected } = fixture();
    actors[0].clips[1].start = 3; actors[0].clips[1].end = 5;
    selected.push({ kind: 'action', entityId: actors[0].id, id: actors[0].clips[1].id });
    createTimelineGroupDrag(p, selected, selected[0]).apply(2, false);
    assert.deepEqual(actors[0].clips.map(c => [c.start, c.end]), [[3, 5], [5, 7]]);
    actors[1].locked = true; const before = JSON.stringify(p);
    assert.throws(() => createTimelineGroupDrag(p, selected, selected[0]), /锁定/); assert.equal(JSON.stringify(p), before);
});
test('cut groups reorder without changing shot lengths, and resize their own lengths only', () => {
    const { p } = fixture(); const camera = p.cuts[0].cameraId;
    p.cuts = [0, 2, 5, 9].map(time => ({ time, cameraId: camera })); p.duration = 14;
    const selected: TimelineSelection[] = [{ kind: 'cut', index: 0 }, { kind: 'cut', index: 1 }];
    const drag = createTimelineGroupDrag(p, selected, selected[0]);
    assert.deepEqual(drag.apply(20, false), [{ kind: 'cut', index: 2 }, { kind: 'cut', index: 3 }]);
    assert.deepEqual(p.cuts.map(c => c.time), [0, 4, 9, 11]); assert.equal(p.duration, 14);
    drag.apply(1, true); assert.deepEqual(p.cuts.map(c => c.time), [0, 3, 7, 11]); assert.equal(p.duration, 16);
    assertProject(p);
});
test('selection is explicit, excludes unrelated inspector selection for time windows, and clears without changing project', () => {
    const { p, actors, selected } = fixture(); clearTimelineSelection();
    setSelectedClips(selected); toggleSelectedClip(selected[1]); assert.equal(selectedClips().length, 1);
    let scope = editorSelection(p, actors[1].id); assert.deepEqual(scope.entityIds, [actors[0].id]); assert.equal(scope.clips[0].start, 1);
    setSelectedClips([]); setSelectedTimeRange({ start: 4, end: 8 });
    scope = editorSelection(p, actors[1].id); assert.deepEqual(scope.entityIds, []); assert.equal(scope.scope, 'time');
    clearTimelineSelection(); assert.deepEqual(editorSelection(p, actors[1].id).entityIds, [actors[1].id]);
    assert.equal(Object.hasOwn(p, 'selection'), false);
});
