import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { adoptModel } from '../src/resources/model-runtime.ts';
import { assertModelNodeBindings, assertModelNodeEdits } from '../src/resources/model-node-edits.ts';
import { geometryBounds } from '../src/spatial/geometry.ts';
import { meshesOf } from '../src/spatial/scene-targets.ts';
import { objectBounds } from '../src/editor/object-snapping.ts';
import { footSurfaceQuery } from '../src/animation/contact-surfaces.ts';
import { checkPathSurfaces } from '../src/spatial/path-surfaces.ts';
import { demoProject, entity } from '../src/model.ts';

function model(animated = false) {
    const scene = new T.Group(), furniture = new T.Group(), geometry = new T.BoxGeometry(1, .2, 1);
    furniture.name = 'furniture'; furniture.position.set(2, 0, 1); furniture.rotation.y = .6; furniture.scale.set(2, 1, 3); scene.add(furniture);
    const table = new T.Mesh(geometry, new T.MeshStandardMaterial()); table.name = 'table'; table.position.y = 2; furniture.add(table);
    const other = new T.Mesh(geometry, table.material); other.name = 'other'; other.position.set(-2, 0, 0); scene.add(other);
    const animations = animated ? [new T.AnimationClip('move', 2, [new T.VectorKeyframeTrack('table.position', [0, 2], [0, 2, 0, 4, 2, 0])])] : [];
    return adoptModel({ scene, scenes: [scene], cameras: [], animations }, '', []);
}

test('node hierarchy identifies shared geometry; meter offsets survive source calibration and entity transforms', () => {
    const loaded = model(), instance = loaded.instantiate(), other = loaded.instantiate(), frame = new T.Group(), entityFrame = new T.Group();
    entityFrame.rotation.y = .4; entityFrame.scale.set(2, 3, 4); entityFrame.position.set(7, 5, -9); entityFrame.add(frame); frame.add(instance.root);
    instance.root.scale.setScalar(.01); instance.root.rotation.x = -.5; entityFrame.updateMatrixWorld(true);
    const base = new T.Vector3(...instance.nodeState('0/0/0').origin), untouched = other.nodeState('0/0/0');
    instance.applyNodeEdits({ '0/0/0': { offset: [1, .2, -.3], name: '餐桌', category: '家具' } });
    const delta = new T.Vector3(1, .2, -.3).applyMatrix3(new T.Matrix3().setFromMatrix4(frame.matrixWorld));
    assert.ok(new T.Vector3(...instance.nodeState('0/0/0').origin).distanceTo(base.clone().add(delta)) < 1e-9);
    assert.deepEqual(other.nodeState('0/0/0'), untouched); assert.equal(loaded.inspection.nodes.find(n => n.path === '0/0/0')!.name, 'table');
    assert.equal(loaded.inspection.nodes.find(n => n.path === '0/0/0')!.geometryId, loaded.inspection.nodes.find(n => n.path === '0/1')!.geometryId);
    instance.restoreNodeEdits(); assert.ok(new T.Vector3(...instance.nodeState('0/0/0').origin).distanceTo(base) < 1e-9); loaded.dispose();
});

test('edits overlay native animation deterministically without renaming its track targets or accumulating transforms', () => {
    const loaded = model(true), a = loaded.instantiate(), b = loaded.instantiate();
    for (const time of [0, 1, .2, 1.8, 1, 0]) {
        a.restoreNodeEdits(); a.sampleAnimation(0, time, false); b.sampleAnimation(0, time, false);
        const before = new T.Vector3(...b.nodeState('0/0/0').origin);
        a.applyNodeEdits({ '0/0/0': { offset: [1, 0, 0], rotation: [0, .5, 0], scale: [2, 1, 1], name: '重命名桌子' } });
        assert.ok(new T.Vector3(...a.nodeState('0/0/0').origin).distanceTo(before.add(new T.Vector3(1, 0, 0))) < 1e-9);
    }
    a.restoreNodeEdits(); a.setDefaultPose(); b.setDefaultPose(); assert.deepEqual(a.nodeState('0/0/0'), b.nodeState('0/0/0')); loaded.dispose();
});

test('hidden nodes leave camera meshes, bounds, snapping, foot supports and path surface checks consistently', () => {
    const loaded = model(), instance = loaded.instantiate(); const base = geometryBounds(instance.root)!;
    const point = new T.Vector3(...instance.nodeState('0/0/0').origin); point.y = 2.1;
    const foot = footSurfaceQuery([instance.root]); assert.ok(Math.abs(foot(point, .5)! - 2.1) < 1e-6);
    const p = demoProject(); p.room.enabled = false; const prop = entity('prop', 'cube', 'surface'), actor = p.entities[0]; actor.path = { smooth: false, points: [{ time: 0, position: point.toArray() }] };
    p.entities = [actor, prop, ...p.entities.filter(e => e.camera)];
    assert.equal(checkPathSurfaces(p, new Map([[prop.id, instance.root]]), { entityId: actor.id }).points[0].status, 'on-surface');
    instance.applyNodeEdits({ '0/0': { hidden: true } });
    assert.equal(instance.nodeState('0/0/0').hidden, true); assert.equal(instance.nodeState('0/0/0').bounds, null); assert.equal(meshesOf(instance.root).length, 1);
    assert.ok(geometryBounds(instance.root)!.max.y < base.max.y); assert.ok(objectBounds(instance.root, 'root', 'root')!.corners.every(p => p.y < 1));
    assert.equal(foot(point, .5), null); assert.equal(checkPathSurfaces(p, new Map([[prop.id, instance.root]]), { entityId: actor.id }).points[0].status, 'no-surface');
    instance.applyNodeEdits(); assert.equal(meshesOf(instance.root).length, 2); assert.ok(geometryBounds(instance.root)!.equals(base)); loaded.dispose();
});

test('rig-related or sheared nodes reject geometry edits, invalid fields reject, and singular animation offsets report limitation', () => {
    const scene = new T.Group(), bone = new T.Bone(), mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()); bone.add(mesh); scene.add(bone);
    const loaded = adoptModel({ scene, scenes: [scene], cameras: [], animations: [] }, '', []);
    assertModelNodeBindings({ '0/0': { name: '手部' } }, loaded.inspection.nodes);
    assert.throws(() => assertModelNodeBindings({ '0/0/0': { offset: [1, 0, 0] } }, loaded.inspection.nodes), /骨架/);
    assert.throws(() => assertModelNodeBindings({ '0/9': {} }, loaded.inspection.nodes), /不存在/);
    for (const edits of [null, { invalid: {} }, { '0/0': { offset: [0, NaN, 0] } }, { '0/0': { scale: [1, 0, 1] } }, { '0/0': { hidden: 'yes' } }]) assert.throws(() => assertModelNodeEdits(edits as never));
    loaded.dispose();
    const shearedScene = new T.Group(), sheared = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
    sheared.matrixAutoUpdate = false; sheared.matrix.elements[4] = .4; shearedScene.add(sheared);
    const shearedModel = adoptModel({ scene: shearedScene, scenes: [shearedScene], cameras: [], animations: [] }, '', []);
    assert.equal(shearedModel.inspection.nodes.find(n => n.path === '0/0')!.editable, false); assert.throws(() => assertModelNodeBindings({ '0/0': { rotation: [0, .3, 0] } }, shearedModel.inspection.nodes)); shearedModel.dispose();
    const normal = model(), instance = normal.instantiate(); instance.root.scale.setScalar(0); instance.applyNodeEdits({ '0/0/0': { offset: [1, 0, 0] } });
    assert.equal(instance.nodeState('0/0/0').offsetLimited, true); instance.root.scale.setScalar(1); instance.applyNodeEdits({ '0/0/0': { offset: [1, 0, 0] } }); assert.equal(instance.nodeState('0/0/0').offsetLimited, false); normal.dispose();
});
