import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProject, clone, demoProject, entity, validateProject } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { assignUnsortedFloors, editorEntityVisible, emptyEditorView, removeFloor, workingElevation } from '../src/building/floors.ts';
import { readSceneDocument, projectForScene, duplicateDocumentScene, updateDocumentScene } from '../src/scenes/sequence-project.ts';

test('track ordering is validated editor metadata, persists per scene and leaves staging untouched', () => {
    const original = demoProject(), order = [`entity:${original.entities[1].id}`, `path:${original.entities[0].id}`, 'note:removed-note'];
    const ordered = applyOperations(original, [{ operation: 'project', patch: { editorView: { ...emptyEditorView(), trackOrder: order } } }]);
    assert.deepEqual(ordered.entities, original.entities); assert.deepEqual(ordered.cuts, original.cuts);
    let document = readSceneDocument(ordered); const first = document.activeSceneId;
    document = duplicateDocumentScene(document,first,'第二场','second');
    const second = projectForScene(document); second.editorView!.trackOrder = [...order].reverse();
    document = updateDocumentScene(document,'second',second);
    const restored = readSceneDocument(JSON.parse(JSON.stringify(document)));
    assert.deepEqual(projectForScene(restored,first).editorView!.trackOrder,order);
    assert.deepEqual(projectForScene(restored,'second').editorView!.trackOrder,[...order].reverse());
    for (const invalid of [null, 'entity:one', [42], ['entity:x','entity:x'], ['cuts']]) {
        assert.throws(()=>applyOperations(original,[{operation:'project',patch:{editorView:{...emptyEditorView(),trackOrder:invalid}}}]),/轨道顺序/);
    }
});
const floors = [{ id: 'ground-floor', name: '一层', elevation: 0 }, { id: 'upper-floor', name: '二层', elevation: 3 }];
test('floor elevation edits shift members and retained routes once, keep timing, and move fixed camera targets', () => {
    const original = demoProject(); original.floors = clone(floors); original.entities.forEach(e => e.floorId = 'ground-floor');
    const p = applyOperations(original, [{ operation: 'project', patch: { floors: [{ ...floors[0], elevation: .6 }, floors[1]] } }]);
    for (const e of p.entities) {
        const before = original.entities.find(b => b.id === e.id)!;
        assert.ok(Math.abs(e.position[1] - before.position[1] - .6) < 1e-9);
        assert.equal(e.position[0], before.position[0]); assert.equal(e.position[2], before.position[2]);
        for (const [i, pt] of (e.path?.points ?? []).entries()) { assert.equal(pt.time, before.path!.points[i].time); assert.ok(Math.abs(pt.position[1] - before.path!.points[i].position[1] - .6) < 1e-9); }
        assert.deepEqual(e.path?.sections, before.path?.sections); assert.deepEqual(e.clips, before.clips);
        if (e.camera && !e.camera.targetId) assert.ok(Math.abs(e.camera.target[1] - before.camera!.target[1] - .6) < 1e-9);
    }
    const renamed = applyOperations(p, [{ operation: 'project', patch: { floors: p.floors!.map(f => ({ ...f, name: f.name + ' renamed' })) } }]); assert.deepEqual(renamed.entities, p.entities);
    const assigned = applyOperations(p, [{ operation: 'update', id: p.entities[0].id, patch: { floorId: 'upper-floor' } }]); assert.deepEqual(assigned.entities[0].position, p.entities[0].position);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
});
test('floor moves propagate connected structures and protect locked descendants without moving hand offsets', () => {
    let p = demoProject(); p.floors = clone(floors); const actor = p.entities[0]; actor.floorId = 'ground-floor';
    p = applyOperations(p, [
        { operation: 'add', asset: 'stairs', id: 'up', patch: { floorId: 'ground-floor' } },
        { operation: 'add', asset: 'ground', id: 'landing', patch: { floorId: 'ground-floor', structureLink: { parentId: 'up', parentPort: 'out', ownPort: 'in', offset: [0, 0, 0], rotation: [0, 0, 0] } } },
        { operation: 'add', asset: 'cup', id: 'held', patch: { floorId: 'ground-floor', handBinding: { actorId: actor.id, hand: 'left', offset: [0, 0, 0], rotation: [0, 0, 0] } } },
    ]);
    const ops = [{ operation: 'project', patch: { floors: [{ ...floors[0], elevation: 1 }, floors[1]] } }];
    const q = applyOperations(p, ops);
    for (const id of ['up', 'landing']) assert.ok(Math.abs(q.entities.find(e => e.id === id)!.position[1] - p.entities.find(e => e.id === id)!.position[1] - 1) < 1e-9);
    assert.deepEqual(q.entities.find(e => e.id === 'held'), p.entities.find(e => e.id === 'held'));
    p.entities.find(e => e.id === 'landing')!.locked = true; const original = JSON.stringify(p); assert.throws(() => applyOperations(p, ops), /锁定/); assert.equal(JSON.stringify(p), original);
});
test('editor hiding respects floors, explicit props and carried items while leaving production visibility untouched', () => {
    const p = demoProject(); p.floors = clone(floors); const actor = p.entities[0], held = entity('prop', 'cup', 'held'); actor.floorId = 'upper-floor'; held.floorId = 'ground-floor';
    held.handBinding = { actorId: actor.id, hand: 'left', offset: [0, 0, 0], rotation: [0, 0, 0] }; p.entities.push(held);
    p.editorView = { ...emptyEditorView(), activeFloorId: 'upper-floor', hiddenFloorIds: ['ground-floor'] };
    assert.equal(workingElevation(p), 3); assert.equal(editorEntityVisible(p, actor), true); assert.equal(editorEntityVisible(p, held), true);
    p.editorView.hiddenFloorIds = ['upper-floor']; assert.equal(editorEntityVisible(p, actor), false); assert.equal(editorEntityVisible(p, held), false);
    p.editorView.hiddenFloorIds = []; p.editorView.hiddenEntityIds = [held.id]; assert.equal(editorEntityVisible(p, held), false); assert.equal(editorEntityVisible(p, actor), true);
    assert.ok(p.entities.every(e => e.visible)); assertProject(p);
    const wall = entity('prop', 'structure-wall', 'wall'); p.entities.push(wall); p.editorView.hideWalls = true; assert.equal(editorEntityVisible(p, wall), false); assert.equal(wall.visible, true);
    p.editorView.hiddenEntityIds = [actor.id]; assert.equal(editorEntityVisible(p, held), false);
});
test('floor validation rejects invalid references; sorting and deleting organize without changing scene placement', () => {
    const p = demoProject(); p.floors = clone(floors); p.entities[0].position[1] = 4; p.entities[0].path = null; p.entities[1].locked = true;
    const before = clone(p.entities); assert.equal(assignUnsortedFloors(p), p.entities.length - 1); assert.equal(p.entities[0].floorId, 'upper-floor'); assert.equal(p.entities[1].floorId, undefined);
    for (let i = 0; i < p.entities.length; i++) assert.deepEqual(p.entities[i].position, before[i].position);
    p.editorView = { ...emptyEditorView(), activeFloorId: 'upper-floor', hiddenFloorIds: ['upper-floor'] };
    const q = clone(p); removeFloor(q, 'upper-floor'); assertProject(q); assert.equal(q.entities[0].floorId, ''); assert.equal(q.editorView!.activeFloorId, '');
    for (const patch of [{ floors: [] }, { floors: [{ ...floors[0], elevation: NaN }] }, { floors: [floors[0], floors[0]] }, { editorView: { ...emptyEditorView(), hiddenEntityIds: ['missing'] } }, { editorView: { ...emptyEditorView(), activeFloorId: 'missing' } }]) assert.throws(() => applyOperations(p, [{ operation: 'project', patch }]));
    p.entities[0].locked = true; assert.throws(() => removeFloor(p, 'upper-floor'), /锁定/); assert.doesNotThrow(() => assertProject(demoProject()));
});
