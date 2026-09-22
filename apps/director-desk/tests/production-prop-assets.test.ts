import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity, demoProject, assertProject, clone } from '../src/model.ts';
import { INDUSTRIAL_ASSETS, THEMED_ASSETS, VEHICLE_ASSETS } from '../src/assets/catalog/production-props.ts';
import { makeProp, disposeTree } from '../src/assets.ts';
import { assetParameters } from '../src/assets/parameters.ts';
import { geometryBounds } from '../src/spatial/geometry.ts';
import { applyOperations } from '../src/automation/edits.ts';
import type { ContactAnchor } from '../src/assets/contact-anchors.ts';

const all = [...INDUSTRIAL_ASSETS, ...THEMED_ASSETS, ...VEHICLE_ASSETS];
test('24 production props are grounded and match declared full-model dimensions', () => {
    assert.equal(all.length, 24);
    for (const a of all) {
        const e = entity('prop', a.id, a.name), p = demoProject(); p.entities.push(e); assertProject(JSON.parse(JSON.stringify(p)));
        const root = makeProp(e), bounds = new T.Box3().setFromObject(root, true), size = bounds.getSize(new T.Vector3()), values = assetParameters(e);
        assert.ok(Math.abs(bounds.min.y) < 1e-6, a.id);
        for (const [i, key] of ['width', 'height', 'depth'].entries()) assert.ok(Math.abs(size.getComponent(i) - values[key]) < 1e-5, `${a.id} ${key}: ${size.getComponent(i)}`);
        root.traverse(o => { if (o instanceof T.Mesh) assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite), a.id); }); disposeTree(root);
    }
});
test('every seat and support point remains on real geometry after size normalization', () => {
    for (const a of all) {
        const e = entity('prop', a.id, a.name); if (a.id === 'theme-altar') e.assetParameters = { steps: 12 };
        const root = makeProp(e); root.updateMatrixWorld(true);
        const anchors: ContactAnchor[] = root.userData.contactAnchors;
        for (const anchor of anchors) {
            const ray = new T.Raycaster(new T.Vector3(...anchor.position).add(new T.Vector3(0, .002, 0)), new T.Vector3(0, -1, 0), 0, .004);
            const hit = ray.intersectObject(root, true)[0];
            assert.ok(hit && Math.abs(hit.point.y - anchor.position[1]) < 1e-5, `${a.id} ${anchor.id}: ${hit?.point.y}`);
        }
        disposeTree(root);
    }
});
test('container opening clears the door without stretching it along the long container axis', () => {
    const e = entity('prop', 'industrial-container', 'container'), closed = makeProp(e); closed.updateMatrixWorld(true);
    const bounds = geometryBounds(closed)!;
    const ray = new T.Raycaster(new T.Vector3(.3, 1.1, bounds.max.z + 1), new T.Vector3(0, 0, -1), 0, 1.2);
    assert.ok(ray.intersectObject(closed, true).length > 0);
    e.assetParameters = { opening: 90 }; const opened = makeProp(e); opened.updateMatrixWorld(true);
    assert.equal(ray.intersectObject(opened, true).length, 0);
    const extension = geometryBounds(opened)!.max.z - bounds.max.z;
    assert.ok(extension > .9 && extension < 1.3, `Door physical width instead of container depth: ${extension}`);
    disposeTree(closed); disposeTree(opened);
});
test('pipe is hollow and canopy/flag toggles change visible geometry without enlarging the remaining frame', () => {
    const pipe = makeProp(entity('prop', 'industrial-pipeline', 'pipe')); pipe.updateMatrixWorld(true);
    const center = geometryBounds(pipe)!.getCenter(new T.Vector3());
    const ray = new T.Raycaster(center.clone().add(new T.Vector3(10, 0, 0)), new T.Vector3(-1, 0, 0)); assert.equal(ray.intersectObject(pipe, true).length, 0); disposeTree(pipe);
    for (const [asset, key] of [['theme-stall', 'canopy'], ['theme-flagpole', 'flag'], ['theme-ring', 'ropes']]) {
        const e = entity('prop', asset, asset), on = makeProp(e), off = makeProp({ ...e, assetParameters: { [key]: 0 } });
        const visible = (root: T.Group) => { let count = 0; root.traverseVisible(o => { if (o instanceof T.Mesh) count++; }); return count; };
        assert.ok(visible(off) < visible(on)); assert.deepEqual(off.children[0].scale.toArray(), on.children[0].scale.toArray());
        if (key !== 'ropes') assert.ok(geometryBounds(off)!.getSize(new T.Vector3()).length() < geometryBounds(on)!.getSize(new T.Vector3()).length());
        disposeTree(on); disposeTree(off);
    }
});
test('seat, rack and platform counts survive edits; unsupported options roll back atomically', () => {
    const p = demoProject(), before = clone(p);
    for (const [asset, values, expected] of [['vehicle-bus', { seats: 24 }, 24], ['theme-weaponrack', { slots: 8 }, 8], ['industrial-scaffold', { levels: 4 }, 4]] as const) {
        const next = applyOperations(p, [{ operation: 'add', asset, patch: { assetParameters: values } }]);
        const root = makeProp(next.entities.at(-1)!); assert.equal(root.userData.contactAnchors.filter((a: { role: string }) => asset !== 'vehicle-bus' || a.role === 'seat').length, expected); disposeTree(root);
    }
    for (const [asset, values] of [['theme-ring', { ropes: .5 }], ['theme-stall', { canopy: 2 }], ['vehicle-sedan', { seats: 2.5 }], ['vehicle-bicycle', { depth: .2 }], ['industrial-scaffold', { height: .2, levels: 8 }]] as const)
        assert.throws(() => applyOperations(p, [{ operation: 'add', asset, patch: { assetParameters: values } }]));
    assert.deepEqual(p, before);
});
