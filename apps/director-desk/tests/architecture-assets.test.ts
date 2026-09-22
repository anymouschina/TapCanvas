import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, demoProject, assertProject, clone } from '../src/model.ts';
import { ARCHITECTURE_ASSETS, CIRCULATION_ASSETS } from '../src/assets/catalog/architecture.ts';
import { ROAD_ASSETS } from '../src/assets/catalog/roads.ts';
import { makeProp, disposeTree } from '../src/assets.ts';
import { applyOperations } from '../src/automation/edits.ts';
import type { ContactAnchor } from '../src/assets/furniture/shared.ts';

const assets = [...ARCHITECTURE_ASSETS, ...CIRCULATION_ASSETS, ...ROAD_ASSETS];
test('24 architecture, circulation and civic presets create finite geometry and portable parameters', () => {
    assert.equal(assets.length, 24);
    for (const a of assets) {
        const e = entity('prop', a.id, a.name), p = demoProject(); p.entities.push(e);
        assertProject(JSON.parse(JSON.stringify(p)));
        const root = makeProp(e), bounds = new T.Box3().setFromObject(root, true);
        assert.ok(!bounds.isEmpty(), a.id);
        root.traverse(o => { if (o instanceof T.Mesh) assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite), a.id); });
        if (a.family !== 'road-v1') assert.ok(Math.abs(bounds.min.y) < 1e-6, `${a.id}: ${bounds.min.y}`);
        disposeTree(root);
    }
});
test('wall holes and opening doors leave real raycast openings', () => {
    const wall = entity('prop', 'structure-wall', 'wall'); wall.assetParameters = { openingWidth: 1.2, openingHeight: 2.1, sill: .5 };
    const w = makeProp(wall); w.updateMatrixWorld(true);
    const ray = new T.Raycaster(new T.Vector3(0, 1.5, 3), new T.Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(w, true).length, 0);
    ray.ray.origin.y = .2; assert.ok(ray.intersectObject(w, true).length > 0);
    ray.ray.origin.y = 2.8; assert.ok(ray.intersectObject(w, true).length > 0);
    const door = entity('prop', 'structure-door', 'door');
    const closed = makeProp(door); closed.updateMatrixWorld(true);
    ray.ray.origin.set(.15, 1, 3); assert.ok(ray.intersectObject(closed, true).length > 0);
    door.assetParameters = { opening: 90 }; const opened = makeProp(door); opened.updateMatrixWorld(true);
    assert.equal(ray.intersectObject(opened, true).length, 0);
    assert.ok(new T.Box3().setFromObject(opened, true).getSize(new T.Vector3()).z > .8);
    for (const o of [w, closed, opened]) disposeTree(o);
});
test('all registered support points lie on real surfaces with matching normals', () => {
    for (const a of assets) {
        const root = makeProp(entity('prop', a.id, a.name)); root.updateMatrixWorld(true);
        for (const anchor of root.userData.contactAnchors ?? []) {
            const ray = new T.Raycaster(new T.Vector3(...anchor.position).add(new T.Vector3(0, .002, 0)), new T.Vector3(0, -1, 0), 0, .004);
            const hit = ray.intersectObject(root, true)[0];
            assert.ok(hit, `${a.id} ${anchor.id}`);
            assert.ok(hit.face, `${a.id} ${anchor.id} face`);
            assert.ok(Math.abs(hit.point.y - anchor.position[1]) < 1e-5, `${a.id} ${anchor.id}: ${hit.point.y}`);
            const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            assert.ok(normal.dot(new T.Vector3(...anchor.normal)) > .999, `${a.id} ${anchor.id} normal`);
        }
        disposeTree(root);
    }
});
test('turning stairs preserve individual tread heights and spiral keeps a real inner void', () => {
    for (const style of ['straight', 'l', 'u', 'crest']) {
        const e = entity('prop', 'structure-stairs-' + style, style); e.assetParameters = { steps: 11, rise: .17, tread: .3, landing: 1.5 };
        const root = makeProp(e), anchors: ContactAnchor[] = root.userData.contactAnchors;
        assert.equal(anchors.filter(a => a.id.startsWith('a-')).length, 11);
        assert.ok(Math.abs(anchors.find(a => a.id === 'a-10')!.position[1] - 1.87) < 1e-8);
        if (style !== 'straight') assert.ok(Math.abs(anchors.find(a => a.id === 'b-10')!.position[1] - (style === 'crest' ? .17 : 3.74)) < 1e-8);
        disposeTree(root);
    }
    const root = makeProp(entity('prop', 'structure-stairs-spiral', 'spiral')); root.updateMatrixWorld(true);
    assert.equal(new T.Raycaster(new T.Vector3(.2, 10, 0), new T.Vector3(0, -1, 0)).intersectObject(root, true).length, 0);
    assert.equal(root.userData.contactAnchors.length, 18); disposeTree(root);
});
test('roads extend in actual geometry, curbs rise above road and curved roads retain empty center', () => {
    const e = entity('prop', 'road-straight', 'road'); e.assetParameters = { length: 35 };
    const root = makeProp(e), b = new T.Box3().setFromObject(root, true);
    assert.ok(Math.abs(b.max.z - b.min.z - 35) < 1e-6); disposeTree(root);
    const curb = makeProp(entity('prop', 'road-curb', 'curb'));
    assert.ok(Math.abs(new T.Box3().setFromObject(curb, true).max.y - .18) < 1e-6); disposeTree(curb);
    const curve = makeProp(entity('prop', 'road-curve', 'curve')); curve.updateMatrixWorld(true);
    assert.equal(new T.Raycaster(new T.Vector3(1, 10, 1), new T.Vector3(0, -1, 0)).intersectObject(curve, true).length, 0); disposeTree(curve);
});
test('invalid openings, turns, dense rungs and impossible dimensions reject atomic edits', () => {
    const p = demoProject(), before = clone(p);
    const cases = [
        ['structure-wall', { openingWidth: 6 }], ['structure-wall', { openingWidth: 1, sill: 2 }], ['structure-door', { frame: .6 }],
        ['structure-stairs-l', { landing: .5 }], ['structure-stairs-spiral', { width: 2 }], ['structure-stairs-spiral', { steps: 2 }],
        ['structure-ladder', { height: .5, steps: 30 }], ['structure-railing', { posts: 100 }], ['road-curve', { radius: 2 }],
        ['road-junction', { length: 3 }], ['road-busstop', { width: .2 }],
    ] as const;
    for (const [asset, values] of cases) assert.throws(() => applyOperations(p, [{ operation: 'add', asset, patch: { assetParameters: values } }]));
    assert.deepEqual(p, before);
});
