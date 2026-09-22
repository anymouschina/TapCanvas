import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLockedEntitiesUnchanged } from '../src/editor/invariants.ts';
test('lock protects edits and deletion while allowing explicit unlock and independent additions', () => {
    const p = demoProject(); p.entities[0].locked = true;
    const edited = clone(p); edited.entities[0].pose.head = 20;
    assert.throws(() => assertLockedEntitiesUnchanged(p, edited));
    const deleted = clone(p); deleted.entities.shift();
    assert.throws(() => assertLockedEntitiesUnchanged(p, deleted));
    const unlocked = clone(p); unlocked.entities[0].locked = false;
    assert.doesNotThrow(() => assertLockedEntitiesUnchanged(p, unlocked));
    const independent = clone(p); independent.entities[1].height = 1.8;
    assert.doesNotThrow(() => assertLockedEntitiesUnchanged(p, independent));
});
import { createScene, SCENE_TEMPLATES } from '../src/scenes.ts';
test('every scene template is editable project data and outdoor ground is real geometry', () => {
    for (const template of SCENE_TEMPLATES) {
        const p = createScene(template.id);
        assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
        if (['bedroom', 'room'].includes(template.id)) assert.equal(p.room.enabled, true);
        else {
            assert.equal(p.room.enabled, false);
            const ground = p.entities.find(e => e.asset === 'ground');
            assert.ok(ground);
            const mesh = makeProp(ground);
            mesh.scale.set(...ground.scale); mesh.updateMatrixWorld(true);
            const box = new Box3().setFromObject(mesh);
            assert.ok(Math.abs(box.max.y) < .00001);
            const widths: Partial<Record<typeof template.id, number>> = {'light-stage':16,'dolly-hall':8,'neon-chase':12};
            assert.ok(Math.abs(box.max.x - box.min.x - (widths[template.id] ?? 40)) < .00001);
            disposeTree(mesh);
        }
    }
});
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { animateHuman, disposeTree, makeHuman, makeProp } from '../src/assets.ts';
import { configureCamera } from '../src/engine.ts';
import { ASPECTS, clone, demoProject, getFrameCount, outputSize, validateProject } from '../src/model.ts';
import { activeCameraId, addCut, entityPosition, entityYaw, pathPosition, samplePose } from '../src/timeline.ts';
test('drawing a new path holds its starting point without interrupting rendering', () => {
    const p = demoProject(), actor = p.entities[1];
    actor.path = { smooth: true, points: [{ time: 5, position: [1, 0, 2] }] };
    for (const t of [0, 5, 10]) {
        assert.deepEqual(entityPosition(actor, t).toArray(), [1, 0, 2]);
        assert.ok(Number.isFinite(entityYaw(actor, t, p)));
    }
});
test('project file roundtrip preserves units, references, timing and cuts', () => {
    const p = demoProject();
    p.references = [{ id: 'r', name: '人设', data: 'data:image/png;base64,AAAA' }];
    p.entities[0].reference = 'r';
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
});
test('asynchronous camera B has already moved two seconds when cut at t=5', () => {
    const p = demoProject(), camera = p.entities.find(e => e.name.startsWith('B ·'))!;
    const pos = entityPosition(camera, 5);
    const expected = new Vector3(2.2, 1.5, .6).lerp(new Vector3(2.2, 1.5, .15), 2 / 7);
    assert.ok(pos.distanceTo(expected) < 1e-6);
    assert.equal(activeCameraId(p, 5), camera.id);
    const before = clone(camera.path);
    addCut(p, 6, p.cuts[0].cameraId);
    assert.deepEqual(camera.path, before);
});
test('repeated waypoints hold position, including smooth paths', () => {
    const path = { smooth: true, points: [{ time: 0, position: [0, 0, 0] as [
                    number,
                    number,
                    number
                ] }, { time: 2, position: [1, 0, 0] as [
                    number,
                    number,
                    number
                ] }, { time: 4, position: [1, 0, 0] as [
                    number,
                    number,
                    number
                ] }, { time: 6, position: [2, 0, 0] as [
                    number,
                    number,
                    number
                ] }] };
    assert.deepEqual(pathPosition(path, [0, 0, 0], 3).toArray(), [1, 0, 0]);
    assert.deepEqual(pathPosition(path, [0, 0, 0], 8).toArray(), [2, 0, 0]);
});
test('scrubbing samples are independent of prior evaluation order', () => {
    const p = demoProject(), actor = p.entities[1], poseActor = p.entities[2];
    const a = entityPosition(actor, 5).toArray(), pose = samplePose(poseActor, 10);
    for (const t of [14, 0, 8, 2, 12]) {
        entityPosition(actor, t);
        samplePose(poseActor, t);
    }
    assert.deepEqual(entityPosition(actor, 5).toArray(), a);
    assert.deepEqual(samplePose(poseActor, 10), pose);
});
test('invalid import rejects dangling camera references, overlap and non-increasing paths', () => {
    const a = demoProject();
    a.cuts[0].cameraId = 'missing';
    assert.throws(() => validateProject(a));
    const b = demoProject();
    b.entities[1].clips[1].start = 1;
    assert.throws(() => validateProject(b));
    const c = demoProject();
    c.entities[1].path!.points[1].time = 0;
    assert.throws(() => validateProject(c));
    const d = demoProject();
    d.entities[0].position[0] = NaN;
    assert.throws(() => validateProject(d));
});
test('physical camera projection matches independent geometry for a 36 mm long-side gate', () => {
    const cam = new PerspectiveCamera();
    configureCamera(cam, 50, 16 / 9);
    cam.position.set(0, 1, 5);
    cam.lookAt(0, 1, 0);
    cam.updateMatrixWorld(true);
    const left = new Vector3(-.5, 1, 0).project(cam), right = new Vector3(.5, 1, 0).project(cam);
    // One metre at five metres: sensor image width = 1000 * 50 / 5000 = 10 mm.
    assert.ok(Math.abs((right.x - left.x) / 2 - 10 / 36) < 1e-10);
    assert.ok(Math.abs(cam.getFocalLength() - 50) < 1e-10);
});
test('export frame ranges are half-open and preserve requested rate', () => {
    assert.equal(getFrameCount(0, 15, 24), 360);
    assert.equal(getFrameCount(3, 33, 120), 3600);
    assert.equal(getFrameCount(0, 1, 59), 59);
    for (const aspect of ASPECTS) {
        const [w, h] = outputSize(aspect, 1920);
        assert.equal(w % 2, 0);
        assert.equal(h % 2, 0);
        const [a, b] = aspect.split(':').map(Number);
        assert.ok(Math.abs(w / h - a / b) < 1e-12);
    }
});
test('standing mannequin geometry matches declared height and touches the ground', () => {
    const e = demoProject().entities[1];
    e.clips = [];
    e.pose = {};
    e.poseKeys = [];
    const rig = makeHuman(e);
    animateHuman(rig, e, 0);
    const bounds = new Box3().setFromObject(rig.root);
    assert.ok(Math.abs(bounds.min.y) < .002);
    assert.ok(Math.abs(bounds.max.y - e.height) < .002);
    disposeTree(rig.root);
});
