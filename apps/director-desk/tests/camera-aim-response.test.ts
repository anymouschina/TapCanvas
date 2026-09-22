import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { assertProject, clone, demoProject, entity, type Entity, type Project } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { cameraAimResponseQuaternion } from '../src/cinematography/aim-response.ts';
import { entityPosition } from '../src/timeline.ts';
import { readSceneDocument, projectForScene } from '../src/scenes/sequence-project.ts';
import { freezeEndingCamera } from '../src/cinematography/continuity.ts';
import { applyCameraEffects } from '../src/cinematography/camera-effects.ts';

function fixture() {
    const project = demoProject(), camera = project.entities.find(e => e.camera)!;
    camera.position = [0, 1, 8]; camera.path = null;
    Object.assign(camera.camera!, { mode: 'free', aim: 'target', targetId: '', target: [0, 1, 0], targetHeight: 0, aimResponse: { duration: .8 } });
    return { project, camera };
}
function aimed(position: Vector3, target: Vector3) {
    const camera = new PerspectiveCamera(); camera.position.copy(position); camera.lookAt(target); return camera.quaternion.clone();
}
function sameRotation(a: Quaternion, b: Quaternion, tolerance = 1e-7) {
    assert.ok(a.angleTo(b) < tolerance, `orientation mismatch: ${a.angleTo(b)}`);
}
function sample(camera: Entity, project: Project, at: number, root?: Group) {
    const q = cameraAimResponseQuaternion(camera, project, at, root); assert.ok(q); return q;
}

test('aim response reduces an abrupt target change and settles exactly within its finite window', () => {
    const { project, camera } = fixture();
    camera.camera!.targetPath = { smooth: false, points: [
        { time: 0, position: [0, 1, 0] }, { time: 1, position: [0, 1, 0] },
        { time: 1.01, position: [4, 1, 0] }, { time: 3, position: [4, 1, 0] },
    ] };
    const before = aimed(new Vector3(...camera.position), new Vector3(0, 1, 0));
    const after = aimed(new Vector3(...camera.position), new Vector3(4, 1, 0));
    sameRotation(sample(camera, project, 0), before);
    const response = sample(camera, project, 1.05);
    assert.ok(response.angleTo(before) > .005);
    assert.ok(response.angleTo(before) < after.angleTo(before) * .5);
    sameRotation(sample(camera, project, 1.81), after);
    sameRotation(sample(camera, project, 20), after);
});

test('random seeking, sequential playback and fps changes sample identical aim without editing the project', () => {
    const { project, camera } = fixture();
    camera.path = { smooth: true, points: [{ time: 0, position: [0, 1, 8] }, { time: 2, position: [5, 2, 5] }, { time: 4, position: [3, 3, 0] }] };
    camera.camera!.targetPath = { smooth: true, points: [{ time: 0, position: [0, 1, 0] }, { time: 3, position: [-3, 2, -2] }] };
    const snapshot = clone(project), times = [0, .05, .3, .9, 1.2, 2.7, 3.5, 4];
    const expected = times.map(time => sample(camera, project, time).toArray());
    for (const index of [7, 1, 5, 0, 3, 6, 2, 4]) assert.deepEqual(sample(camera, project, times[index]).toArray(), expected[index]);
    assert.deepEqual(project, snapshot);
    for (const fps of [24, 30, 60]) {
        project.fps = fps;
        times.forEach((time, index) => assert.deepEqual(sample(camera, project, time).toArray(), expected[index]));
    }
});

test('free camera samples its own historical path; translated follow cameras keep stable framing', () => {
    const { project, camera } = fixture();
    camera.path = { smooth: false, points: [{ time: 0, position: [0, 1, 8] }, { time: 4, position: [8, 1, 8] }] };
    const current = aimed(entityPosition(camera, 2), new Vector3(...camera.camera!.target));
    const initial = aimed(entityPosition(camera, 0), new Vector3(...camera.camera!.target));
    const response = sample(camera, project, 2);
    assert.ok(response.angleTo(current) > .01);
    assert.ok(response.angleTo(initial) < current.angleTo(initial));

    const target = entity('actor', 'human', 'Target', [0, 1, 0]);
    target.path = { smooth: false, points: [{ time: 0, position: [0, 1, 0] }, { time: 4, position: [8, 1, 0] }] };
    project.entities.push(target);
    Object.assign(camera.camera!, { mode: 'follow', targetId: target.id, offset: [0, 0, 8], inheritRotation: false });
    sameRotation(sample(camera, project, 2), initial);
    camera.camera!.effects = { followLag: .5 };
    sameRotation(sample(camera, project, 2), aimed(new Vector3(3, 1, 8), new Vector3(4, 1, 0)));
});

test('target route sections use playback time and current posed height is retained without mutating roots', () => {
    const { project, camera } = fixture(), target = entity('actor', 'human', 'Target', [0, 1, 0]);
    target.path = { smooth: false, points: [{ time: 0, position: [0, 1, 0] }, { time: 4, position: [8, 1, 0] }] };
    project.entities.push(target); camera.camera!.targetId = target.id;
    const original = sample(camera, project, 1.5);
    target.path.sections = [{ start: 10, end: 14, from: 0, to: 4 }];
    // Scene-anchored quadrature has a small phase error after a non-grid-aligned time shift.
    sameRotation(sample(camera, project, 11.5), original, .0001);
    const root = new Group(); root.position.copy(entityPosition(target, 0)).add(new Vector3(0, .7, 0));
    const oldPosition = root.position.toArray(), oldRotation = root.rotation.toArray();
    sameRotation(sample(camera, project, 0, root), aimed(new Vector3(...camera.position), root.position));
    sample(camera, project, 12, root);
    assert.deepEqual(root.position.toArray(), oldPosition); assert.deepEqual(root.rotation.toArray(), oldRotation);
});

test('held target keeps its current hand offset while historical carrier movement drives response', () => {
    const { project, camera } = fixture(), actor = entity('actor', 'human', 'Carrier'), prop = entity('prop', 'shape-box', 'Held');
    actor.path = { smooth: false, points: [{ time: 0, position: [0, 0, 0] }, { time: 4, position: [8, 0, 0] }] };
    actor.face = 'fixed';
    prop.handBinding = { actorId: actor.id, hand: 'right', offset: [0, 0, 0], rotation: [0, 0, 0] };
    project.entities.push(actor, prop); camera.camera!.targetId = prop.id;
    const root = new Group(); root.position.set(4.5, 1.4, .3);
    const current = aimed(new Vector3(...camera.position), root.position);
    assert.ok(sample(camera, project, 2, root).angleTo(current) > .01);
    Object.assign(camera.camera!, { mode: 'follow', offset: [0, 0, 8], inheritRotation: false });
    sameRotation(sample(camera, project, 2, root), aimed(root.position.clone().add(new Vector3(0, 0, 8)), root.position));
});

test('shortest-arc quaternion response handles yaw wrap; degenerate targets remain finite', () => {
    const { project, camera } = fixture(); camera.position = [0, 1, 0];
    camera.camera!.targetPath = { smooth: false, points: [{ time: 0, position: [.1, 1, 5] }, { time: 2, position: [-.1, 1, 5] }] };
    const direction = new Vector3(0, 0, -1).applyQuaternion(sample(camera, project, 1.5));
    assert.ok(direction.z > .999);
    camera.camera!.targetPath = null; camera.camera!.target = [...camera.position];
    assert.ok(sample(camera, project, .5).toArray().every(Number.isFinite));
    camera.camera!.target = [0, 10, 0];
    assert.ok(sample(camera, project, .5).toArray().every(Number.isFinite));
});

test('fixed scene-time cells make pole crossings and half-turn source jumps continuous', () => {
    for (const [from, to, hold] of [
        [[0, 10, -1], [0, 10, 1], false],
        [[0, -10, -1], [0, -10, 1], false],
        [[0, 0, -1], [0, 0, 1], false],
        [[0, 0, -5], [0, 0, 5], true],
    ] as const) {
        const { project, camera } = fixture(); camera.position = [0, 0, 0];
        camera.camera!.targetPath = { smooth: false, points: [
            { time: 0, position: [...from] }, { time: 2, position: [...to], ...(hold ? { easing: 'hold' as const } : {}) },
        ] };
        const jump = hold ? 2 : 1, delta = .000001;
        // Every fixed grid boundary, plus the source singularity and response end.
        const step = .8 / 25, firstCell = Math.floor((jump - .1) / step);
        const times = [jump, jump + .8, ...Array.from({ length: 32 }, (_, i) => (firstCell + i) * step)];
        for (const at of times) {
            assert.ok(sample(camera, project, at - delta).angleTo(sample(camera, project, at + delta)) < .0001, `jump near ${at}`);
        }
        let previous = sample(camera, project, jump - .05);
        for (let i = 1; i <= 900; i++) {
            const q = sample(camera, project, jump - .05 + i * .001);
            assert.ok(previous.angleTo(q) < .025, `visible step near ${jump - .05 + i * .001}`);
            previous = q;
        }
        sameRotation(sample(camera, project, 2.8), aimed(new Vector3(...camera.position), new Vector3(...to)));
    }
});

test('a long horizontal turn stays continuous as the oldest quaternion sign reference changes cells', () => {
    const { project, camera } = fixture(); camera.position = [0, 0, 0]; camera.camera!.aimResponse!.duration = 2;
    camera.camera!.targetPath = { smooth: false, interpolation: 'continuous', points: [
        { time: 0, position: [0, 0, -5] },
        ...Array.from({ length: 25 }, (_, i) => ({ time: 1 + i / 16, position: [5 * Math.sin(i / 24 * Math.PI * 1.5), 0, -5 * Math.cos(i / 24 * Math.PI * 1.5)] as [number, number, number] })),
    ] };
    const step = 2 / 25, delta = .000001;
    for (let i = 1; i < 60; i++) {
        const at = i * step;
        assert.ok(sample(camera, project, at - delta).angleTo(sample(camera, project, at + delta)) < .0001, `sign reference jump at ${at}`);
    }
    const expected = sample(camera, project, 2.34).toArray();
    for (const at of [4, 1, 3, 0, 2.35]) sample(camera, project, at);
    assert.deepEqual(sample(camera, project, 2.34).toArray(), expected);
});

test('response never anticipates a source jump and settles within its configured duration', () => {
    const { project, camera } = fixture(); camera.position = [0, 0, 0];
    for (const at of [1, 1.013, 1.047]) {
        camera.camera!.targetPath = { smooth: false, points: [{ time: 0, position: [0, 0, -5] }, { time: at, position: [5, 0, 0], easing: 'hold' }] };
        sameRotation(sample(camera, project, at - .000001), new Quaternion());
        sameRotation(sample(camera, project, at + .8), aimed(new Vector3(), new Vector3(5, 0, 0)));
    }
});

test('omitted and zero response, manual aim and POV bypass all extra orientation sampling', () => {
    const { project, camera } = fixture();
    delete camera.camera!.aimResponse;
    assert.equal(cameraAimResponseQuaternion(camera, project, 1), null);
    camera.camera!.aimResponse = { duration: 0 };
    assert.equal(cameraAimResponseQuaternion(camera, project, 1), null);
    camera.camera!.aimResponse.duration = .8; camera.camera!.aim = 'manual';
    assert.equal(cameraAimResponseQuaternion(camera, project, 1), null);
    camera.camera!.mode = 'follow';
    assert.equal(cameraAimResponseQuaternion(camera, project, 1), null);
    const target = project.entities.find(e => e.kind === 'actor')!;
    camera.camera!.targetId = target.id;
    assert.ok(cameraAimResponseQuaternion(camera, project, 1));
    camera.camera!.aim = 'target'; camera.camera!.mode = 'pov';
    assert.equal(cameraAimResponseQuaternion(camera, project, 1), null);
});

test('shared camera patch validates response atomically and preserves it through project roundtrip', () => {
    const { project, camera } = fixture(), before = clone(project);
    const next = applyOperations(project, [{ operation: 'update', id: camera.id, patch: { camera: { aimResponse: { duration: 1.2 } } } }]);
    assertProject(next);
    const nextCamera = next.entities.find(e => e.id === camera.id)!;
    assert.equal(nextCamera.camera!.aimResponse!.duration, 1.2);
    assert.equal(nextCamera.camera!.focal, camera.camera!.focal);
    const roundtrip = projectForScene(readSceneDocument(JSON.parse(JSON.stringify(readSceneDocument(next)))));
    assert.deepEqual(roundtrip.entities.find(e => e.id === camera.id)!.camera, nextCamera.camera);
    for (const value of [null, [], {}, { duration: -.1 }, { duration: 2.1 }, { duration: NaN }, { duration: '1' }, { duration: 1, extra: true }])
        assert.throws(() => applyOperations(project, [{ operation: 'update', id: camera.id, patch: { camera: { aimResponse: value } } }]), /视线响应/);
    assert.deepEqual(project, before);
    camera.locked = true;
    assert.throws(() => applyOperations(project, [{ operation: 'update', id: camera.id, patch: { camera: { aimResponse: { duration: .5 } } } }]), /锁定/);
});

test('scene continuation freezes the actual responded ending view with and without optical effects', () => {
    for (const mode of ['free', 'follow'] as const) for (const withEffects of [false, true]) {
        const { project, camera } = fixture(), target = entity('actor', 'human', 'Target', [0, 1, 0]);
        target.path = { smooth: false, points: [{ time: 0, position: [0, 1, 0] }, { time: 2, position: [4, 1, 0] }] };
        project.entities.push(target);
        Object.assign(camera.camera!, { mode, targetId: target.id, offset: [0, 0, 8], inheritRotation: false });
        if (withEffects) camera.camera!.effects = { followLag: .3, channels: { pan: 3, roll: 4, offsetY: .2, focal: 50 },
            shake: { preset: 'breath', amount: 1, frequency: 1, seed: 3, start: 0, end: 3 } };
        const at = 1, actual = new PerspectiveCamera();
        actual.position.copy(mode === 'follow' ? entityPosition(target, withEffects ? at - .3 : at).add(new Vector3(0, 0, 8)) : entityPosition(camera, at));
        actual.quaternion.copy(sample(camera, project, at)); actual.setFocalLength(withEffects ? 50 : camera.camera!.focal);
        applyCameraEffects(actual, camera.camera!.effects, at);
        const inherited = clone(camera);
        inherited.path = null; inherited.position = actual.position.toArray(); inherited.rotation = [actual.rotation.x, actual.rotation.y, actual.rotation.z];
        freezeEndingCamera(inherited, actual, at);
        assert.equal(inherited.camera!.aim, 'manual'); assert.equal(inherited.camera!.mode, 'free');
        assert.equal(cameraAimResponseQuaternion(inherited, project, 0), null);
        const start = new PerspectiveCamera(); start.position.fromArray(inherited.position); start.rotation.set(...inherited.rotation);
        applyCameraEffects(start, inherited.camera!.effects, 0);
        assert.ok(start.position.distanceTo(actual.position) < 1e-10);
        sameRotation(start.quaternion, actual.quaternion);
        assert.equal(camera.camera!.aim, 'target'); assert.equal(camera.camera!.mode, mode);
    }
    for (const disabled of [undefined, { duration: 0 }]) {
        const { camera } = fixture(); camera.camera!.mode = 'follow'; camera.camera!.aimResponse = disabled;
        freezeEndingCamera(camera, new PerspectiveCamera(), 1);
        assert.equal(camera.camera!.mode, 'follow'); assert.equal(camera.camera!.aim, 'target');
    }
});
