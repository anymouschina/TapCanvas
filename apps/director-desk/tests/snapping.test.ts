import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { objectBounds, findObjectSnap } from '../src/editor/object-snapping.ts';

function box(id: string, pos: number[], rotation = 0, size = [1, 1, 1]) {
    const mesh = new Mesh(new BoxGeometry(...size as [number, number, number]), new MeshBasicMaterial());
    mesh.position.set(...pos as [number, number, number]); mesh.rotation.y = rotation;
    const bounds = objectBounds(mesh, id, id)!;
    mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); return bounds;
}
test('object snapping joins contact faces and stacks independently of grid coordinates', () => {
    const fixed = box('fixed', [.33, .5, 0]);
    const side = findObjectSnap(box('moving', [1.45, .5, 0]), [fixed], 'X')!;
    assert.ok(Math.abs(side.offset.x + .12) < 1e-6); assert.ok(Math.abs(side.offset.y) < 1e-8); assert.ok(Math.abs(side.offset.z) < 1e-8);
    const top = findObjectSnap(box('moving', [.33, 1.64, 0]), [fixed], 'Y')!;
    assert.ok(Math.abs(top.offset.y + .14) < 1e-6);
});
test('distant objects, self and non-overlapping faces do not attract objects', () => {
    const fixed = box('fixed', [0, .5, 0]);
    assert.equal(findObjectSnap(fixed, [fixed]), null);
    assert.equal(findObjectSnap(box('moving', [4, .5, 0]), [fixed]), null);
    assert.equal(findObjectSnap(box('moving', [1.1, .5, 9]), [fixed]), null);
    assert.equal(findObjectSnap(box('moving', [0, 1.1, 0]), [fixed], 'X'), null);
});
test('rotated and scaled building bounds snap in their actual orientation', () => {
    const angle = Math.PI / 4, direction = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), angle);
    const fixed = box('fixed', [0, .5, 0], angle, [2, 1, 1]);
    const moving = box('moving', direction.clone().multiplyScalar(1.62).add(new Vector3(0, .5, 0)).toArray(), angle);
    const snap = findObjectSnap(moving, [fixed], 'XZ')!;
    assert.ok(snap.offset.distanceTo(direction.clone().multiplyScalar(-.12)) < 1e-6);
    assert.ok(Math.abs(snap.offset.y) < 1e-8);
});
