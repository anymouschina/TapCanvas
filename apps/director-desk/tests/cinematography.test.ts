import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { demoProject, assertProject, clone } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { numberAt, setNumberKey, assertAnimated } from '../src/animation/channels.ts';
import { pathPosition } from '../src/timeline.ts';
import { pathDistance } from '../src/animation/path-distance.ts';
import { CAMERA_PRESETS } from '../src/cinematography/motion-presets.ts';
import { applyCameraEffects, cameraFocal, type CameraEffects } from '../src/cinematography/camera-effects.ts';

test('speed curves change progress while preserving timed endpoints, hold and random access', () => {
    const path = { smooth: false, points: [{ time: 0, position: [0, 0, 0] as [number, number, number] }, { time: 4, position: [8, 0, 0] as [number, number, number], easing: 'ease-in' as const }] };
    assert.equal(pathPosition(path, [0, 0, 0], 2).x, 2);
    assert.equal(pathPosition(path, [0, 0, 0], 4).x, 8);
    assert.ok(Math.abs(pathDistance(path, 0, 2) - 2) < 1e-7);
    const divided = { ...path, sections: [{ start: 10, end: 12, from: 0, to: 2 }, { start: 12, end: 14, from: 2, to: 4 }] };
    for (const at of [14, 12, 10, 11, 13]) assert.deepEqual(pathPosition(divided, [0, 0, 0], at).toArray(), pathPosition(path, [0, 0, 0], at - 10).toArray());
    const hold = { keys: [{ time: 0, value: 28 }, { time: 4, value: 70, easing: 'hold' as const }] };
    assert.equal(numberAt(hold, 3.999), 28); assert.equal(numberAt(hold, 4), 70);
    const teleport = clone(path); teleport.points[1].easing = 'hold' as typeof teleport.points[1]['easing'];
    assert.equal(pathDistance(teleport, 0, 3.99999), 0); assert.equal(pathDistance(teleport, 0, 4), 0);
    const changed = setNumberKey(hold, 4, 50, 28); assert.equal(numberAt(changed, 4), 50); assert.equal(numberAt(hold, 4), 70);
    assert.throws(() => assertAnimated({ keys: [{ time: 1, value: 28 }, { time: 1, value: 30 }] }, 8, 300, 'focal'));
});

test('dolly zoom preserves target projection size, framing moves target to thirds, and roll does not accumulate', () => {
    const camera = new PerspectiveCamera(45, 16 / 9, .025, 2000), target = new Vector3(0, 1, 0);
    const effects: CameraEffects = { dollyZoom: { distance: 6, focal: 35 }, channels: { frameX: 1 / 3, roll: 12 } };
    const sample = (distance: number) => {
        camera.position.set(0, 1, distance); camera.lookAt(target); camera.setFocalLength(cameraFocal(effects, 0, 35, distance));
        applyCameraEffects(camera, effects, 0); camera.updateMatrixWorld(true);
        return { center: target.clone().project(camera), tip: target.clone().add(new Vector3(0, 1, 0)).project(camera), matrix: camera.matrixWorld.toArray() };
    };
    const a = sample(6), b = sample(12); assert.ok(Math.abs(a.center.x - 1 / 3) < 1e-8);
    assert.ok(Math.abs(a.tip.distanceTo(a.center) - b.tip.distanceTo(b.center)) < 1e-8);
    assert.deepEqual(sample(6).matrix, a.matrix);
});

test('all handheld styles produce repeatable motion, with zero effects outside their window', () => {
    for (const preset of ['breath', 'walk', 'run', 'impact', 'pov'] as const) {
        const effects: CameraEffects = { shake: { preset, amount: 1, frequency: 1, seed: 8, start: 1, end: 5 } };
        const sample = (at: number) => { const camera = new PerspectiveCamera(); camera.position.set(0, 2, 8); camera.lookAt(0, 1, 0); applyCameraEffects(camera, effects, at); camera.updateMatrixWorld(true); return camera.matrixWorld.toArray(); };
        const original = sample(0), at = sample(2); assert.notDeepEqual(at, original); sample(4); assert.deepEqual(sample(2), at);
        assert.deepEqual(sample(1), original); assert.deepEqual(sample(5), original);
    }
});

test('all camera presets use common transactional edits and editable paths/channels; locks reject atomically', () => {
    const original = demoProject(), id = original.entities.find(e => e.camera)!.id;
    for (const preset of Object.keys(CAMERA_PRESETS)) {
        for (const easing of ['smooth', 'hold', 'linear'] as const) {
            const p = applyOperations(original, [{ operation: 'camera-motion', id, asset: preset, time: 12, duration: 5, patch: { easing } }]);
            assertProject(p); assert.equal(p.duration, 17); assert.notDeepEqual(p, original);
        }
    }
    const snapshot = clone(original); original.entities.find(e => e.id === id)!.locked = true;
    assert.throws(() => applyOperations(original, [{ operation: 'camera-motion', id, asset: 'arc' }]), /锁定/);
    original.entities.find(e => e.id === id)!.locked = false; assert.deepEqual(original, snapshot);
    assert.throws(() => applyOperations(original, [{ operation: 'update', id, patch: { camera: { effects: { channels: { focal: -20 } } } } }]), /焦距/);
    assert.throws(() => applyOperations(original, [{ operation: 'update', id, patch: { camera: { effects: { focusTargetId: 'missing' } } } }]), /对焦/);
});
