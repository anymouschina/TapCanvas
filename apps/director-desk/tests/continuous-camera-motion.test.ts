import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { assertProject, clone, demoProject, type MotionPath } from '../src/model.ts';
import { continuousPathPosition, assertPathInterpolation } from '../src/animation/continuous-path.ts';
import { assertCameraLookPath, cameraLookAt } from '../src/animation/camera-look.ts';
import { pathPosition } from '../src/timeline.ts';
import { pathDistance } from '../src/animation/path-distance.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { splitClip, setClipRange } from '../src/clip-editing.ts';
import { curveTargets, insertCurvePause } from '../src/animation/curve-targets.ts';
import { editLocations } from '../src/automation/edit-locations.ts';
const origin: [number, number, number] = [0, 0, 0];
const route: MotionPath = { smooth: false, interpolation: 'continuous', points: [
    { time: 0, position: [0, 1, 0] }, { time: 2, position: [3, 2, 1] },
    { time: 5, position: [7, 1, 4] }, { time: 8, position: [8, 3, 8] }
] };
const sample = (p: MotionPath, t: number) => pathPosition(p, origin, t);
const near = (a: number, b: number, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b} (+/-${eps})`);
const vectorNear = (a: Vector3, b: Vector3, eps = 1e-8) => near(a.distanceTo(b), 0, eps);
const velocity = (p: MotionPath, t: number, h = 1e-4) => sample(p, t + h).sub(sample(p, t - h)).divideScalar(2 * h);

test('timed camera waypoints pass with matching nonzero velocity and acceleration on uneven segments', () => {
    for (const key of route.points) vectorNear(sample(route, key.time), new Vector3(...key.position));
    for (const t of [2, 5]) {
        const h = 1e-4, p = sample(route, t);
        const left = p.clone().sub(sample(route, t - h)).divideScalar(h);
        const right = sample(route, t + h).sub(p).divideScalar(h);
        assert.ok(left.length() > .1);
        vectorNear(left, right, 1e-6);
        const aLeft = p.clone().add(sample(route, t - 2 * h)).addScaledVector(sample(route, t - h), -2).divideScalar(h * h);
        const aRight = p.clone().add(sample(route, t + 2 * h)).addScaledVector(sample(route, t + h), -2).divideScalar(h * h);
        assert.ok(aLeft.length() < .01 && aRight.length() < .01);
        vectorNear(aLeft, aRight, .01);
    }
});

test('endpoints brake by default, explicit passage carries velocity and stop keys brake smoothly', () => {
    const p = clone(route);
    assert.ok(velocity(p, 0).length() < 1e-6 && velocity(p, 8).length() < 1e-6);
    p.points[1].stop = true; assert.ok(velocity(p, 2).length() < 1e-6);
    p.points[0].stop = false; p.points.at(-1)!.stop = false;
    const h = 1e-4;
    assert.ok(sample(p, h).sub(sample(p, 0)).divideScalar(h).length() > .1);
    assert.ok(sample(p, 8).sub(sample(p, 8 - h)).divideScalar(h).length() > .1);
    vectorNear(sample(p, -20), sample(p, 0)); vectorNear(sample(p, 80), sample(p, 8));
});

test('repeated locations hold, full reversals brake, uneven spacing stays finite without a per-frame state', () => {
    const p = clone(route); p.points[2].position = [...p.points[1].position];
    for (const t of [2, 2.3, 4.99, 5]) vectorNear(sample(p, t), sample(p, 2));
    assert.ok(velocity(p, 2).length() < 1e-6 && velocity(p, 5).length() < 1e-6);
    const reversal: MotionPath = { smooth: false, interpolation: 'continuous', points: [
        { time: 0, position: [0, 0, 0] }, { time: 1, position: [1, 0, 0] }, { time: 2, position: [0, 0, 0] }
    ] };
    assert.ok(velocity(reversal, 1).length() < 1e-6);
    p.points[1].time = .001; p.points[2].time = 200; p.points[3].time = 200.001;
    const times = [0, .0003, .001, 5, 199, 200.0001, 200.001];
    const results = times.map(t => sample(p, t).toArray());
    for (const i of [6, 1, 3, 0, 5, 2, 4]) { assert.ok(results[i].every(Number.isFinite)); assert.deepEqual(sample(p, times[i]).toArray(), results[i]); }
});

test('legacy linear/spatial/easing behavior stays opt-in, and independent look paths share continuous timing', () => {
    const p: MotionPath = { smooth: false, points: [{ time: 0, position: [0, 0, 0] }, { time: 4, position: [8, 0, 0] }] };
    near(sample(p, 1).x, 2); p.smooth = true; near(sample(p, 1).x, 2);
    p.points[1].easing = 'smooth'; near(sample(p, 1).x, 1.25);
    delete p.points[1].easing; p.interpolation = 'continuous'; near(sample(p, 1).x, .828125);
    for (const t of [0, .25, 2, 2.5, 5, 7.99, 8]) vectorNear(cameraLookAt(route, t), sample(route, t));
    assertCameraLookPath(route);
    for (const invalid of [{ ...route, interpolation: 'unknown' }, { ...route, points: [{ time: 0, position: origin, stop: 1 }] }, { ...route, points: [{ time: 0, position: origin, easing: 'smooth' }] }]) {
        assert.throws(() => assertPathInterpolation(invalid as MotionPath)); assert.throws(() => assertCameraLookPath(invalid as MotionPath));
    }
});

test('timeline splits preserve continuous source samples; moving and stretching sections retimes the same source', () => {
    const p = demoProject(), e = p.entities.find(e => e.kind === 'camera')!; e.path = clone(route);
    const before = clone(e.path), selection = { kind: 'path' as const, entityId: e.id, index: 0 };
    const right = splitClip(p, selection, 3);
    for (const t of [0, 1, 3, 3.1, 5, 8]) vectorNear(sample(e.path, t), sample(before, t));
    setClipRange(p, right, 4, 14);
    for (const t of [4, 6, 9, 13.5, 14]) vectorNear(sample(e.path, t), sample(before, 3 + (t - 4) / 2));
    vectorNear(sample(e.path, 3.5), sample(before, 3)); assertProject(p);
    const unsplit = clone(before); e.path = unsplit; setClipRange(p, selection, 2, 18);
    for (const t of [0, 1.2, 2, 5, 8]) vectorNear(sample(unsplit, 2 + t * 2), sample(before, t));
});

test('automation uses the same schema, saves exact samples, rejects incompatible easing atomically and locates the wider change', () => {
    const p = demoProject(), camera = p.entities.find(e => e.kind === 'camera')!, before = clone(p);
    const next = applyOperations(p, [{ operation: 'update', id: camera.id, patch: { path: clone(route), camera: { targetPath: clone(route), aimResponse: { duration: .4 } } } }]);
    const restored = JSON.parse(JSON.stringify(next)); assertProject(restored);
    const edited = restored.entities.find((e: { id: string }) => e.id === camera.id);
    assert.ok(edited?.path);
    for (const t of [1.33, 2, 4.7, 8]) vectorNear(sample(edited.path, t), sample(route, t));
    assert.deepEqual(p, before);
    const invalid = clone(route); invalid.points[1].easing = 'smooth';
    assert.throws(() => applyOperations(p, [{ operation: 'update', id: camera.id, patch: { color: '#123456' } }, { operation: 'update', id: camera.id, patch: { path: invalid } }]));
    assert.deepEqual(p, before);
    const after = clone(next); after.entities.find(e => e.id === camera.id)!.path!.points[1].position[0] += 1;
    const location = editLocations(next, after).find(r => r.field === '运动路径')!;
    assert.equal(location.start, 0); assert.equal(location.end, next.duration);
});

test('continuous distance follows the actual curve and cache invalidates when only interpolation changes', () => {
    const p = clone(route); delete p.interpolation;
    const legacy = pathDistance(p, 0, .5);
    p.interpolation = 'continuous'; const easedDistance = pathDistance(p, 0, .5);
    assert.ok(Math.abs(legacy - easedDistance) > .1);
    let total = 0, previous = sample(p, 0);
    for (let i = 1; i <= 20000; i++) { const at = sample(p, i * 8 / 20000); total += previous.distanceTo(at); previous = at; }
    near(pathDistance(p, 0, 8), total, .001);
    for (const t of [.01, 2, 4.5, 7.9]) near(pathDistance(p, 0, t) + pathDistance(p, t, 8), pathDistance(p, 0, 8));
    const direct = clone(p); p.sections = [{ start: 0, end: 4, from: 0, to: 8 }];
    near(pathDistance(p, 0, 2), pathDistance(direct, 0, 4));
});

test('curve display samples real continuous progress and inserted pauses create a held source interval', () => {
    const p = demoProject(), e = p.entities.find(e => e.kind === 'camera')!; e.path = clone(route); e.camera!.targetPath = clone(route);
    for (const target of curveTargets(e).filter(t => ['path', 'look'].includes(t.id))) {
        assert.ok(target.sampleContinuous);
        vectorNear(target.sampleContinuous!(1.3), sample(route, 1.3));
    }
    insertCurvePause(e, 'path', 2, 1);
    for (const t of [2, 2.2, 2.8, 3]) vectorNear(sample(e.path, t), sample(route, 2));
    assert.ok(velocity(e.path, 2).length() < 1e-6 && velocity(e.path, 3).length() < 1e-6); assertProject(p);
    e.path!.sections = [{ start: 10, end: 12, from: 0, to: 2 }];
    vectorNear(curveTargets(e).find(t => t.id === 'path')!.sampleContinuous!(1), continuousPathPosition(e.path!.points, 1));
    assert.throws(() => insertCurvePause(e, 'path', 1));
});
