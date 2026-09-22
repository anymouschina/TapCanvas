import test from 'node:test';
import assert from 'node:assert/strict';
import { entity, clone, type Clip, type MotionPath } from '../src/model.ts';
import { pathPosition } from '../src/timeline.ts';
import { pathDistance } from '../src/animation/path-distance.ts';
import { retargetClipTime, setPathLocomotion, locomotionPlaybackRate } from '../src/animation/locomotion.ts';
import { sliceAction } from '../src/clip-editing.ts';
import { applyOperationsWithResources, applyOperations } from '../src/automation/edits.ts';
import { createScene } from '../src/scenes.ts';
const near = (a: number, b: number, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const route: MotionPath = { smooth: false, points: [
    { time: 0, position: [0, 0, 0] }, { time: 2, position: [0, 0, 2] }, { time: 4, position: [0, 0, 2] },
    { time: 5, position: [0, 3, 6] }, { time: 8, position: [0, 3, 0] }
] };

test('route meters follow real 3D placement, holds, section retiming and mutation without counting cuts as steps', () => {
    const p = clone(route);
    near(pathDistance(p, -100, 100), 13); near(pathDistance(p, 2.1, 3.9), 0); near(pathDistance(p, 4, 5), 5);
    near(pathDistance(p, 5, 4), -5); near(pathDistance(null, 0, 100), 0);
    p.sections = [{ start: 1, end: 3, from: 0, to: 2 }, { start: 6, end: 8, from: 5, to: 8 }];
    near(pathDistance(p, 0, 10), 8); near(pathDistance(p, 3, 6), 0); near(pathDistance(p, 6, 7), 3);
    p.points[4].position = [0, 3, -6]; near(pathDistance(p, 6, 7), 6); // Same object, cache must invalidate.
    p.sections[1].end = 10; near(pathDistance(p, 6, 7), 3);
    assert.throws(() => pathDistance(p, NaN, 2));
});

test('smooth arc-length matches a dense independent placement trace and remains additive across arbitrary seeks', () => {
    const p: MotionPath = { smooth: true, points: [
        { time: 0, position: [0, 0, 0] }, { time: .8, position: [4, 2, 1] },
        { time: 3.2, position: [-2, 1, 4] }, { time: 5, position: [3, 0, -2] }
    ] };
    let total = 0, previous = pathPosition(p, [0, 0, 0], 0);
    for (let i = 1; i <= 50000; i++) { const v = pathPosition(p, [0, 0, 0], i / 10000); total += v.distanceTo(previous); previous = v; }
    near(pathDistance(p, 0, 5), total, .001);
    for (const t of [3.3, .01, 4.99, .801, 2.1]) near(pathDistance(p, 0, t) + pathDistance(p, t, 5), pathDistance(p, 0, 5));
});

test('distance clock preserves full body phase across repeated action cuts, holds and source-clock switches', async () => {
    const p = await applyOperationsWithResources(createScene('blank'), [{ operation: 'add', asset: 'human-adult', id: 'walker' }, { operation: 'motion', id: 'walker', asset: 'human-walk-v1', time: 0 }]);
    const e = p.entities.find(e => e.id === 'walker')!; e.path = clone(route);
    const c = e.clips[0]; c.end = 8; c.offset = .17; c.speed = 1.2;
    setPathLocomotion(e, c, 2, 2);
    const original = clone(c), expected = (t: number) => .17 + pathDistance(e.path, 0, t) * 1.2;
    near(retargetClipTime(e, c, 2, 2), retargetClipTime(e, c, 4, 2));
    near(locomotionPlaybackRate(e, c, 3, 2), 0);
    near(locomotionPlaybackRate(e, c, 4.5, 2), 6, 1e-8);
    const pieces: Clip[] = [sliceAction(c, 0, 1.3), sliceAction(c, 1.3, 8)];
    const right = pieces.pop()!; pieces.push(sliceAction(right, 1.3, 4.2), sliceAction(right, 4.2, 8));
    for (const t of [6.2, 1.3, 0, 3.8, 4.2, 7.9]) { const piece = pieces.find(c => c.start <= t && t < c.end)!; near(retargetClipTime(e, piece, t, 2), expected(t)); }
    const retained = pieces[2], beginning = retargetClipTime(e, retained, retained.start, 2);
    setPathLocomotion(e, retained, 2); near(retargetClipTime(e, retained, retained.start, 2), beginning);
    setPathLocomotion(e, retained, 2, 2); near(retargetClipTime(e, retained, retained.start, 2), beginning);
    assert.throws(() => retargetClipTime(e, original, 2), /素材时长/);
    const stationary = entity('actor', 'person', 'stationary'); stationary.clips = [original];
    near(retargetClipTime(stationary, original, 7, 2), original.offset!);
    // Bad AI/offline edits cannot admit invalid or incompatible locomotion metadata.
    p.duration = 8; const before = clone(p);
    for (const patch of [{ locomotion: { mode: 'distance', cycleDistance: 0 } }, { locomotion: { mode: 'distance', cycleDistance: Infinity } },
        { locomotion: { mode: 'distance', cycleDistance: 1, unused: 1 } }, { loop: false }, { motion: undefined }]) {
        const bad = clone(c); Object.assign(bad.retarget!, patch);
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: e.id, patch: { clips: [bad] } }]));
    }
    assert.deepEqual(p, before);
});
