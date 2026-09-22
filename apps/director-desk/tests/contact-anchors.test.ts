import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, clone, demoProject, assertProject } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { contactAnchors, worldContactAnchors } from '../src/assets/contact-anchors.ts';
import { makeProp, disposeTree } from '../src/assets.ts';
import { makeHuman, scaleHuman } from '../src/assets/humanoid.ts';
import { sampleHumanAction } from '../src/assets/human-animation.ts';
import { seatedPlacement } from '../src/editor/seat-placement.ts';
import { estimateContact } from '../src/editor/contact-estimation.ts';
import { geometryBounds } from '../src/spatial/geometry.ts';

test('contact overrides are portable, independently cloned, validated and respect object locks', () => {
    const p = demoProject(), chair = p.entities.find(e => e.asset === 'chair')!;
    const points = [{ id: 'custom-seat', role: 'seat', position: [.02, .5, .01], normal: [0, 1, 0], forward: [1, 0, 0] }];
    const next = applyOperations(p, [{ operation: 'update', id: chair.id, patch: { contactAnchors: points } }]);
    assertProject(JSON.parse(JSON.stringify(next))); assert.equal(chair.contactAnchors, undefined);
    for (const invalid of [[{ ...points[0], normal: [0, 0, 0] }], [...points, ...points], [{ ...points[0], position: [NaN, 0, 0] }], [{ ...points[0], forward: [0, 1, 0] }]])
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: chair.id, patch: { contactAnchors: invalid } }]), /接触点/);
    const locked = clone(next); locked.entities.find(e => e.id === chair.id)!.locked = true;
    assert.throws(() => applyOperations(locked, [{ operation: 'update', id: chair.id, patch: { contactAnchors: [] } }]), /锁定/);
    const root = makeProp(chair), copy = contactAnchors(chair, root); copy[0].position[1] = 9;
    assert.equal(contactAnchors(chair, root)[0].position[1], .45); disposeTree(root);
});

test('legacy contacts remain on real surfaces; transformed local points and estimates use current geometry', () => {
    for (const asset of ['chair', 'bench', 'bed', 'sofa', 'table', 'desk', 'furniture-chair', 'furniture-sofa']) {
        const e = entity('prop', asset, asset), root = makeProp(e); root.updateWorldMatrix(true, true);
        for (const point of contactAnchors(e, root)) {
            const ray = new T.Raycaster(new T.Vector3(...point.position).add(new T.Vector3(0, .001, 0)), new T.Vector3(0, -1, 0));
            assert.ok(Math.abs(ray.intersectObject(root, true)[0].point.y - point.position[1]) < 1e-5, `${asset}/${point.id}`);
        }
        root.position.set(2, 1, -3); root.rotation.y = .6; root.scale.set(1.2, 1.5, .8); root.updateWorldMatrix(true, true);
        const local = contactAnchors(e, root)[0], world = worldContactAnchors(e, root)[0];
        assert.ok(new T.Vector3(...world.position).distanceTo(root.localToWorld(new T.Vector3(...local.position))) < 1e-8);
        const proposed = estimateContact(root, 'seat');
        const at = root.localToWorld(new T.Vector3(...proposed.position));
        const hit = new T.Raycaster(at.clone().add(new T.Vector3(0, .001, 0)), new T.Vector3(0, -1, 0)).intersectObject(root, true)[0];
        assert.ok(hit && hit.point.distanceTo(at) < 1e-5); disposeTree(root);
    }
});

test('seat placement aligns real pelvis contact across proportions and seat heights without mutating input', () => {
    for (const asset of ['person', 'human-adult', 'human-dwarf', 'human-giant']) for (const height of [.35, .65]) {
        const e = entity('actor', asset, asset), original = clone(e);
        const placement = seatedPlacement(e, { id: 'seat', role: 'seat', position: [2, height, 3], normal: [0, 1, 0], forward: [1, 0, 0] });
        assert.deepEqual(e, original); e.clips = [{ id: 'sit', action: 'sit', start: 0, end: 3, speed: 1 }];
        const rig = makeHuman(e); scaleHuman(rig, e); sampleHumanAction(rig, e, 1); rig.root.position.fromArray(placement.position); rig.root.rotation.y = placement.yaw; rig.root.updateWorldMatrix(true, true);
        const pelvis = rig.hips.children.filter(n => n instanceof T.Mesh).map(n => geometryBounds(n)!);
        assert.ok(Math.abs(Math.min(...pelvis.map(b => b.min.y)) - height) < 1e-7, `${asset}/${height}`);
        assert.ok(Math.abs(rig.hips.getWorldPosition(new T.Vector3()).x - 2) < 1e-7); disposeTree(rig.root);
    }
});
