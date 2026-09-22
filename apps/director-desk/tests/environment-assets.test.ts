import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, demoProject, assertProject, clone } from '../src/model.ts';
import { PLANT_ASSETS, TERRAIN_ASSETS } from '../src/assets/catalog/environment.ts';
import { BUILDING_ASSETS } from '../src/assets/catalog/buildings.ts';
import { makeProp, disposeTree } from '../src/assets.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { assetParameters } from '../src/assets/parameters.ts';
import type { ContactAnchor } from '../src/assets/furniture/shared.ts';

const all = [...PLANT_ASSETS, ...TERRAIN_ASSETS, ...BUILDING_ASSETS];
function snapshot(root: T.Group) {
    root.updateMatrixWorld(true); const result: unknown[] = [];
    root.traverse(o => { if (o instanceof T.Mesh) result.push({ vertices: [...o.geometry.attributes.position.array], world: o.matrixWorld.toArray() }); }); return result;
}
test('24 environmental presets have finite grounded geometry, portable parameters and exact plant/terrain dimensions', () => {
    assert.equal(all.length, 24);
    for (const a of all) {
        const e = entity('prop', a.id, a.name), p = demoProject(); p.entities.push(e); assertProject(JSON.parse(JSON.stringify(p)));
        const root = makeProp(e), bounds = new T.Box3().setFromObject(root, true), size = bounds.getSize(new T.Vector3()), values = assetParameters(e);
        assert.ok(Math.abs(bounds.min.y) < 1e-6, a.id);
        root.traverse(o => { if (o instanceof T.Mesh) assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite), a.id); });
        if (a.family !== 'building-v1') for (const [i, name] of ['width', 'height', 'depth'].entries()) assert.ok(Math.abs(size.getComponent(i) - values[name]) < 1e-5, `${a.id} ${name}`);
        disposeTree(root);
    }
});
test('seeded shapes repeat exactly, vary by seed and do not depend on other model construction', () => {
    for (const a of [...PLANT_ASSETS, ...TERRAIN_ASSETS.filter(a => a.parameters?.seed)]) {
        const e = entity('prop', a.id, a.name); e.assetParameters = { seed: 271 };
        const first = makeProp(e), before = snapshot(first);
        const unrelated = makeProp(entity('prop', 'plant-grass', 'other')); disposeTree(unrelated);
        const again = makeProp(e); assert.deepEqual(snapshot(again), before, a.id);
        const changed = makeProp({ ...e, assetParameters: { seed: 272 } }); assert.notDeepEqual(snapshot(changed), before, a.id);
        for (const r of [first, again, changed]) disposeTree(r);
    }
});
test('terrain has real slopes and depressions with closed bottom faces', () => {
    const top = (root: T.Group, x: number, z = 0) => new T.Raycaster(new T.Vector3(x, 20, z), new T.Vector3(0, -1, 0)).intersectObject(root, true)[0]?.point.y;
    for (const asset of ['terrain-hill', 'terrain-ditch', 'terrain-riverbed', 'terrain-slope']) {
        const e = entity('prop', asset, asset), root = makeProp(e), p = assetParameters(e); root.updateMatrixWorld(true);
        if (asset === 'terrain-hill') assert.ok(top(root, 0)! > top(root, p.width * .45)! + p.height * .3);
        else if (asset === 'terrain-slope') assert.ok(top(root, 0, -p.depth * .4)! > top(root, 0, p.depth * .4)! + p.height * .5);
        else assert.ok(top(root, p.width * .45)! > top(root, 0)! + p.height * .5);
        const bottom = new T.Raycaster(new T.Vector3(.13, -2, .17), new T.Vector3(0, 1, 0)).intersectObject(root, true)[0];
        assert.ok(bottom && Math.abs(bottom.point.y) < 1e-6, asset);
        disposeTree(root);
    }
});
test('buildings have accessible interiors and physical floor anchors at each level', () => {
    for (const a of BUILDING_ASSETS) {
        const e = entity('prop', a.id, a.name), root = makeProp(e), p = assetParameters(e); root.updateMatrixWorld(true);
        const anchors: ContactAnchor[] = root.userData.contactAnchors;
        for (const anchor of anchors) {
            const hit = new T.Raycaster(new T.Vector3(...anchor.position).add(new T.Vector3(0, .002, 0)), new T.Vector3(0, -1, 0), 0, .004).intersectObject(root, true)[0];
            assert.ok(hit && Math.abs(hit.point.y - anchor.position[1]) < 1e-5, `${a.id} ${anchor.id}`);
        }
        if (a.id !== 'building-fortwall') {
            assert.equal(anchors.filter(a => a.id.startsWith('floor-')).length, p.levels);
            // Inspect front wall only, not the opposite wall behind the doorway.
            const ray = new T.Raycaster(new T.Vector3(0, 1.1, p.depth / 2 + 1), new T.Vector3(0, 0, -1), 0, 1 + p.thickness + .01);
            assert.equal(ray.intersectObject(root, true).length, 0, a.id);
        }
        disposeTree(root);
    }
});
test('floor count and seed edits change actual content; invalid density, seed and wall thickness roll back', () => {
    const p = demoProject(), before = clone(p);
    const cases = [ ['plant-broadleaf', { density: 4.5 }], ['plant-broadleaf', { seed: -1 }], ['terrain-rock', { roughness: 2 }], ['building-house', { depth: 1, thickness: .8 }], ['building-house', { bays: 16 }] ] as const;
    for (const [asset, values] of cases) assert.throws(() => applyOperations(p, [{ operation: 'add', asset, patch: { assetParameters: values } }]));
    assert.deepEqual(p, before);
    const next = applyOperations(p, [{ operation: 'add', asset: 'building-house', patch: { assetParameters: { levels: 4 } } }]);
    const root = makeProp(next.entities.at(-1)!);
    assert.equal((root.userData.contactAnchors as ContactAnchor[]).filter(a => a.id.startsWith('floor-')).length, 4); disposeTree(root);
});
