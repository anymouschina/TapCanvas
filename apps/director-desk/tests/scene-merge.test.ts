import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { assertProject, clone, demoProject, entity, validateProject } from '../src/model.ts';
import { createScene } from '../src/scenes.ts';
import { mergeScene, type MergeSceneOptions } from '../src/scenes/merge-project.ts';
import { portableRoom } from '../src/scenes/portable-room.ts';
import { shotEntityVisible } from '../src/scenes/camera-visibility.ts';
import { makeRoom } from '../src/assets/room.ts';
import { makeProp } from '../src/assets/props.ts';
import { disposeTree } from '../src/assets/dispose.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { entityPosition, entityYaw } from '../src/timeline.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
const opts: MergeSceneOptions = { offset: [10, 3, -7], timeOffset: 5, scheduling: 'keep', cuts: 'keep' };

test('portable room keeps real mesh geometry/materials, doors and windows, and maps camera/editor hiding', () => {
    const p = demoProject(), cam = p.entities.find(e => e.camera)!; cam.camera!.hideWalls = ['north', 'ceiling'];
    const original = clone(p), converted = portableRoom(p), room = makeRoom(p);
    assert.deepEqual(p, original); assert.equal(converted.room.enabled, false);
    const roots = converted.entities.filter(e => e.asset === 'room-part').map(makeProp);
    const meshes = (root: T.Object3D) => { root.updateMatrixWorld(true); const result: unknown[] = []; root.traverse(node => {
        if (node instanceof T.Mesh) result.push({ position: [...node.geometry.attributes.position.array], normal: [...node.geometry.attributes.normal.array], index: node.geometry.index && [...node.geometry.index.array], matrix: node.matrixWorld.toArray(), color: node.material.color.toArray(), roughness: node.material.roughness, shadow: [node.castShadow, node.receiveShadow] });
    }); return result; };
    assert.deepEqual(roots.flatMap(meshes), meshes(room.group));
    const copiedCamera = converted.entities.find(e => e.id === cam.id)!.camera!;
    assert.deepEqual(copiedCamera.hideWalls, []);
    for (const e of converted.entities.filter(e => e.asset === 'room-part')) assert.equal(shotEntityVisible(converted, e, copiedCamera), ![1, 5].includes(e.assetParameters!.part));
    assert.equal(converted.editorView!.hiddenEntityIds.length, 1); assertProject(converted);
    assert.deepEqual(portableRoom(converted), converted);
    roots.forEach(disposeTree); disposeTree(room.group);
});

test('merge remaps same-project IDs, all relationships and retained route clocks, preserving both inputs', () => {
    let source = demoProject(); source.floors = [{ id: 'floor', name: '一层', elevation: 0 }]; source.entities.forEach(e => e.floorId = 'floor');
    const actor = source.entities[1]; actor.path!.sections = [{ start: 3, end: 7, from: 2, to: 6 }];
    source.references = [{ id: 'reference', name: '角色', data: 'data:image/png;base64,YQ==' }]; actor.reference = 'reference';
    source.production = { fixedPrompt: '自然表演', sceneReferenceIds: ['reference'], notes: [{ id: 'note', start: 1, end: 3, actorId: actor.id, story: '相遇', emotion: '', dialogue: '', action: '' }] };
    source = applyOperations(source, [{ operation: 'add', id: 'held', asset: 'cup', patch: { handBinding: { actorId: actor.id, hand: 'left', offset: [.1, 0, 0], rotation: [0, .2, 0] } } },
        { operation: 'add', id: 'parent', asset: 'stairs' }, { operation: 'add', id: 'child', asset: 'ground', patch: { structureLink: { parentId: 'parent', parentPort: 'out', ownPort: 'in', offset: [0, 0, 0], rotation: [0, 0, 0] } } }]);
    source.entities[0].locked = true; const original = clone(source), result = mergeScene(source, source, opts), p = result.project;
    assert.deepEqual(source, original); assert.deepEqual(p.entities.slice(0, source.entities.length), source.entities); assert.deepEqual(p.cuts, source.cuts); assert.deepEqual(p.room, source.room);
    assert.equal(p.references.length, 1); assert.equal(p.production!.notes.length, 2);
    const copied = p.entities.find(e => e.id === result.entityIds[actor.id])!;
    for (const t of [0, 2.9, 3, 4.2, 7, 9, 15]) {
        const a = entityPosition(copied, t + opts.timeOffset), b = entityPosition(actor, t).add(new T.Vector3(...opts.offset)); assert.ok(a.distanceTo(b) < 1e-8);
    }
    assert.deepEqual(copied.path!.sections, [{ start: 8, end: 12, from: 7, to: 11 }]);
    const held = p.entities.find(e => e.id === result.entityIds.held)!; assert.equal(held.handBinding!.actorId, copied.id); assert.deepEqual(held.handBinding!.offset, [.1, 0, 0]);
    assert.equal(p.entities.find(e => e.id === result.entityIds.child)!.structureLink!.parentId, result.entityIds.parent);
    assert.notEqual(copied.floorId, 'floor'); assert.equal(p.floors!.find(f => f.id === copied.floorId)!.elevation, 3);
    assert.equal(p.production!.notes[1].actorId, copied.id); assert.equal(p.production!.notes[1].start, 6);
    const sourceCamera = source.entities.find(e => e.camera?.targetId === actor.id)!;
    assert.equal(p.entities.find(e => e.id === result.entityIds[sourceCamera.id])!.camera!.targetId, copied.id);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
});

test('cut insertion replaces only its interval, restores original camera, while reset clears scheduling explicitly', () => {
    const target = demoProject(); target.duration = 40;
    const source = demoProject(); source.duration = 12; source.cuts = source.cuts.filter(c => c.time < 12);
    const result = mergeScene(target, source, { ...opts, cuts: 'insert' });
    assert.deepEqual(result.project.cuts.map(c => c.time), [0, 5, 10, 15, 17]);
    assert.equal(result.project.cuts.at(-1)!.cameraId, target.cuts.at(-1)!.cameraId);
    assert.equal(result.project.duration, 40);
    const reset = mergeScene(target, source, { ...opts, scheduling: 'reset' });
    const actor = source.entities[1], copy = reset.project.entities.find(e => e.id === reset.entityIds[actor.id])!;
    assert.deepEqual(copy.position, entityPosition(actor, 0).add(new T.Vector3(...opts.offset)).toArray()); assert.equal(copy.rotation[1], entityYaw(actor, 0, source));
    for (const e of reset.project.entities.slice(target.entities.length)) { assert.equal(e.path, null); assert.deepEqual(e.clips, []); assert.deepEqual(e.poseKeys, []); }
    assert.deepEqual(reset.project.cuts, target.cuts); assert.equal(reset.project.duration, 40);
    assert.throws(() => mergeScene(target, source, { ...opts, scheduling: 'reset', cuts: 'insert' }));
});

test('portable resource dedupe rejects ID/content collisions and keeps licenses and source references', async () => {
    const data = packModelFiles('cube.obj', [{ path: 'cube.obj', bytes: new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n') }]);
    const source = createScene('blank'); source.version = 2;
    source.resources = [{ id: await modelResourceId(data), name: 'shape', package: data, copyright: 'author', license: 'CC0', source: 'fixture' }];
    const prop = entity('prop', 'external-model', 'shape'); prop.external = { resourceId: source.resources[0].id, appearance: 'original', unitScale: 1, orientation: [0, 0, 0] }; source.entities.push(prop);
    const dest = clone(source); dest.resources![0].source = 'another source';
    const result = mergeScene(dest, source, opts); assert.equal(result.project.resources!.length, 1); assert.equal(result.reusedResources, 1); assert.equal(result.addedResources, 0);
    assert.ok(result.project.resources![0].source.includes('another source\nfixture'));
    const fresh = mergeScene(createScene('blank'), source, opts); assert.equal(fresh.addedResources, 1); assert.equal(fresh.project.version, 2);
    const bad = clone(source); bad.resources![0].package.files[0].data = btoa('v 0 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3\n');
    assert.throws(() => mergeScene(dest, bad, opts), /冲突/);
});

test('per-camera hidden references validate, hide held props and protect locked camera edits on removal', () => {
    let p = demoProject(); const actor = p.entities[0], cam = p.entities.find(e => e.camera)!;
    const held = entity('prop', 'cup', 'held'); held.handBinding = { actorId: actor.id, hand: 'left', offset: [0, 0, 0], rotation: [0, 0, 0] }; p.entities.push(held);
    cam.camera!.hiddenEntityIds = [actor.id]; assert.equal(shotEntityVisible(p, held, cam.camera), false); assert.equal(shotEntityVisible(p, actor), true);
    for (const ids of [['missing'], [cam.id], [actor.id, actor.id]]) { const bad = clone(p); bad.entities.find(e => e.id === cam.id)!.camera!.hiddenEntityIds = ids; assert.throws(() => assertProject(bad)); }
    cam.camera!.hiddenEntityIds = [held.id]; cam.locked = true; assert.throws(() => applyOperations(p, [{ operation: 'remove', id: held.id }]), /锁定/);
    cam.locked = false; p = applyOperations(p, [{ operation: 'remove', id: held.id }]); assert.deepEqual(p.entities.find(e => e.id === cam.id)!.camera!.hiddenEntityIds, []);
});
