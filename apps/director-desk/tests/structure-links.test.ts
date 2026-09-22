import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Raycaster, Vector3 } from 'three';
import { assertProject, clone, demoProject, entity, validateProject, type Entity, type Vec3 } from '../src/model.ts';
import { makeProp, disposeTree } from '../src/assets.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { structurePorts, worldStructurePorts } from '../src/building/structure-ports.ts';
import { syncStructureLinks, disconnectStructure, captureStructureEdits } from '../src/building/structure-links.ts';
const link = (parentId: string, parentPort = 'out', ownPort = 'in') => ({ parentId, parentPort, ownPort, offset: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 });
const close = (a: number[], b: number[], eps = 1e-7) => assert.ok(new Vector3(...a).distanceTo(new Vector3(...b)) < eps, `${a} != ${b}`);
function fixture() {
    return applyOperations(demoProject(), [
        { operation: 'add', asset: 'stairs', id: 'up' },
        { operation: 'add', asset: 'structure-slab', id: 'platform', patch: { assetParameters: { width: 1.2, depth: 2, height: .2 }, structureLink: link('up') } },
        { operation: 'add', asset: 'stairs', id: 'down', patch: { structureLink: link('platform', 'out', 'out') } },
    ]);
}
function aligned(child: Entity, parent: Entity) {
    const a = worldStructurePorts(parent).find(p => p.id === child.structureLink!.parentPort)!, b = worldStructurePorts(child).find(p => p.id === child.structureLink!.ownPort)!;
    close(a.position, b.position); close(a.outward, b.outward.map(n => -n));
}
test('persistent stairs-platform-descending stairs chain updates geometry, surfaces and independent scales', () => {
    const p = fixture(), source = clone(p), q = applyOperations(p, [
        { operation: 'update', id: 'up', patch: { parameters: { rise: .25, steps: 10 }, position: [2, 1, 3], rotation: [.1, .7, -.15], scale: [1.2, 1.5, .8] } },
        { operation: 'update', id: 'platform', patch: { assetParameters: { width: 2.4, depth: 3, height: .3 }, scale: [.8, 1, 1.2] } },
    ]);
    const up = q.entities.find(e => e.id === 'up')!, platform = q.entities.find(e => e.id === 'platform')!, down = q.entities.find(e => e.id === 'down')!;
    aligned(platform, up); aligned(down, platform); assert.deepEqual(down.scale, [1, 1, 1]); assert.deepEqual(p, source);
    const root = makeProp(platform); root.position.fromArray(platform.position); root.rotation.set(...platform.rotation); root.scale.fromArray(platform.scale); root.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, .31, 0).applyMatrix4(root.matrixWorld), new Vector3(0, -1, 0).transformDirection(root.matrixWorld));
    const hit = ray.intersectObject(root, true)[0]; assert.ok(hit); close(hit.point.toArray(), new Vector3(0, .3, 0).applyMatrix4(root.matrixWorld).toArray()); disposeTree(root);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(q))), JSON.parse(JSON.stringify(q)));
    const snapshot = JSON.stringify(q); for (let i = 0; i < 10; i++) { syncStructureLinks(q); assertProject(q); } assert.equal(JSON.stringify(q), snapshot);
});
test('direct world edits become relative adjustments, child size changes keep the selected edge, detach preserves placement', () => {
    let p = fixture(); const platform = p.entities.find(e => e.id === 'platform')!, target: Vec3 = [4, 2, -3], rotation: Vec3 = [.3, .6, -.2];
    p = applyOperations(p, [{ operation: 'update', id: platform.id, patch: { position: target, rotation } }]);
    const moved = p.entities.find(e => e.id === platform.id)!; close(moved.position, target); close(moved.rotation, rotation);
    const originalOffset = clone(moved.structureLink), port = worldStructurePorts(moved).find(p => p.id === 'in')!;
    const q = applyOperations(p, [{ operation: 'update', id: platform.id, patch: { scale: [2, 1.5, .6] } }]);
    close(worldStructurePorts(q.entities.find(e => e.id === platform.id)!).find(p => p.id === 'in')!.position, port.position);
    assert.deepEqual(q.entities.find(e => e.id === platform.id)!.structureLink, originalOffset);
    const e = q.entities.find(e => e.id === platform.id)!, before = clone(e); disconnectStructure(e); syncStructureLinks(q); close(e.position, before.position); close(e.rotation, before.rotation);
    assertProject(q);
    const drag = fixture(), snapshot = captureStructureEdits(drag), item = drag.entities.find(e => e.id === 'platform')!;
    item.position = target; syncStructureLinks(drag, snapshot); close(item.position, target); assertProject(drag);
});
test('locked descendants, invalid links and cycles roll back; removing parent requires explicit detach', () => {
    const p = fixture(), down = p.entities.find(e => e.id === 'down')!; down.locked = true;
    const original = JSON.stringify(p);
    assert.throws(() => applyOperations(p, [{ operation: 'update', id: 'up', patch: { parameters: { rise: .3 } } }]), /锁定/); assert.equal(JSON.stringify(p), original);
    assert.doesNotThrow(() => applyOperations(p, [{ operation: 'update', id: 'up', patch: { name: 'renamed' } }]));
    for (const patch of [{ structureLink: link('down') }, { structureLink: link('missing') }, { structureLink: link('platform', 'missing') }, { structureLink: { ...link('platform'), offset: [0, NaN, 0] } }, { path: { smooth: false, points: [{ time: 0, position: [0, 0, 0] }] } }])
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: 'up', patch }]));
    assert.throws(() => applyOperations(p, [{ operation: 'remove', id: 'up' }]), /引用/);
    const q = applyOperations(p, [{ operation: 'update', id: 'platform', patch: { structureLink: null } }, { operation: 'remove', id: 'up' }]);
    close(q.entities.find(e => e.id === 'down')!.position, down.position); assertProject(q);
    const stale = clone(p); stale.entities.find(e => e.id === 'up')!.parameters = { rise: .4 }; assert.throws(() => assertProject(stale), /连接位置/);
    assert.doesNotThrow(() => assertProject(demoProject()));
});
test('all supported module ports exist at actual geometry edges and chain alignment handles curves and nonuniform scale', () => {
    const ids = ['stairs', 'ground', 'road', 'wall', 'structure-stairs-straight', 'structure-stairs-crest', 'structure-stairs-l', 'structure-stairs-u', 'structure-stairs-spiral', 'structure-ramp', 'structure-slab', 'structure-wall', 'structure-beam', 'structure-railing', 'road-straight', 'road-junction', 'road-curve', 'road-sidewalk', 'road-curb', 'road-parking', 'road-bridge'];
    for (const id of ids) {
        const a = entity('prop', id, id), root = makeProp(a), box = new Box3().setFromObject(root, true).expandByScalar(.00001);
        for (const port of structurePorts(a)) assert.ok(box.containsPoint(new Vector3(...port.position)), `${id} ${port.id} outside geometry bounds`);
        disposeTree(root);
        // Verify port positions and outward directions under real rotations/scales, rather than just copied root positions.
        const p = demoProject(); a.rotation = [.2, -.7, .1]; a.scale = [1.5, 1.2, .7]; const b = entity('prop', id, 'next'); b.scale = [.8, .9, 1.3]; b.structureLink = link(a.id); p.entities.push(a, b); syncStructureLinks(p); assertProject(p); aligned(b, a);
    }
    for (const layout of ['crest', 'return'] as const) { const p = demoProject(), a = entity('prop', 'stairs', 'stairs'), b = entity('prop', 'stairs', 'next'); a.parameters = { layout }; b.structureLink = link(a.id); p.entities.push(a, b); syncStructureLinks(p); aligned(b, a); assertProject(p); }
    assert.equal(structurePorts(entity('prop', 'chair', 'chair')).length, 0);
});
