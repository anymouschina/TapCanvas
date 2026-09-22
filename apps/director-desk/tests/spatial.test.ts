import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { boundsData, boxRelationship, frameBounds, geometryBounds } from '../src/spatial/geometry.ts';
import { spatialRelationship, type SpatialReport, type SpatialObject } from '../src/spatial/report.ts';

const box = (min: number[], max: number[]) => new Box3(new Vector3(...min), new Vector3(...max));
function camera() { const c = new PerspectiveCamera(90, 1, 1, 10); c.updateMatrixWorld(true); return c; }
test('actual bounds include each instanced transform and independent morph weights', () => {
    const geometry = new BoxGeometry(1, 1, 1), material = new MeshBasicMaterial();
    const target = geometry.attributes.position.clone();
    for (let i = 0; i < target.count; i++) target.setY(i, target.getY(i) + 2);
    geometry.morphAttributes.position = [target];
    const root = new Group(), instances = new InstancedMesh(geometry, material, 2); root.add(instances); root.position.x = 10;
    instances.setMatrixAt(0, new Matrix4().makeTranslation(-2, 0, 0));
    instances.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0).multiply(new Matrix4().makeScale(2, 1, 1)));
    const proxy = new Mesh(geometry, material); proxy.morphTargetInfluences![0] = 0; instances.setMorphAt(0, proxy);
    proxy.morphTargetInfluences![0] = .5; instances.setMorphAt(1, proxy);
    const bounds = geometryBounds(root)!;
    assert.deepEqual(bounds.min.toArray(), [7.5, -.5, -.5]); assert.deepEqual(bounds.max.toArray(), [14, 1.5, .5]);
    instances.count = 1; assert.deepEqual(geometryBounds(root)!.max.toArray(), [8.5, .5, .5]);
    instances.count = 0; assert.equal(geometryBounds(root), null);
    instances.dispose(); geometry.dispose(); material.dispose();
});
test('framing distinguishes inside, outside behind lens, near/far clipping and screen sides', () => {
    const c = camera();
    const full = frameBounds(box([-1, -1, -5], [1, 1, -3]), c);
    assert.equal(full.status, 'inside');
    assert.ok(Math.abs(full.rectangle!.left - 1 / 3) < 1e-8);
    assert.ok(Math.abs(full.rectangle!.right - 2 / 3) < 1e-8);
    assert.equal(full.occlusion, 'not-checked');
    assert.equal(frameBounds(box([-1, -1, 2], [1, 1, 3]), c).status, 'outside');
    assert.equal(frameBounds(box([20, -1, -5], [22, 1, -3]), c).status, 'outside');
    assert.equal(frameBounds(box([-1, -1, -12], [1, 1, -11]), c).status, 'outside');
    assert.equal(frameBounds(box([-1, -1, -11], [1, 1, -9]), c).status, 'intersecting');
    const crossing = frameBounds(box([-.5, -.5, -2], [.5, .5, .5]), c);
    assert.equal(crossing.status, 'intersecting');
    for (const [key, value] of Object.entries({ left: .25, top: .25, right: .75, bottom: .75 }))
        assert.ok(Math.abs(crossing.rectangle![key as keyof NonNullable<typeof crossing.rectangle>] - value) < 1e-8);
    const right = frameBounds(box([3, 1, -5], [7, 2, -3]), c);
    assert.equal(right.status, 'intersecting'); assert.equal(right.rectangle!.right, 1); assert.ok(right.rectangle!.top < .5);
});
test('frustum contained in a large object is intersecting; narrow aspect and rotated camera are respected', () => {
    const c = camera();
    assert.deepEqual(frameBounds(box([-100, -100, -100], [100, 100, 100]), c).rectangle, { left: 0, top: 0, right: 1, bottom: 1 });
    const target = box([2, -.1, -4], [2.5, .1, -3]);
    assert.equal(frameBounds(target, c).status, 'inside');
    c.aspect = .3; c.updateProjectionMatrix();
    assert.equal(frameBounds(target, c).status, 'outside');
    c.aspect = 1; c.updateProjectionMatrix(); c.lookAt(0, 0, 5); c.updateMatrixWorld(true);
    assert.equal(frameBounds(box([-1, -1, 3], [1, 1, 5]), c).status, 'inside');
    assert.equal(frameBounds(null, c).status, 'unknown');
});
test('actual vertex bounds include hierarchy, rotation and scale; explicit exclusion handles POV heads', () => {
    const root = new Group(), body = new Mesh(new BoxGeometry(2, 2, 4), new MeshBasicMaterial());
    root.add(body); root.position.set(5, 0, 2); root.rotation.y = Math.PI / 2; root.scale.set(2, 1, 1);
    const bounds = geometryBounds(root)!;
    assert.ok(bounds.min.distanceTo(new Vector3(3, -1, 0)) < 1e-8);
    assert.ok(bounds.max.distanceTo(new Vector3(7, 1, 4)) < 1e-8);
    const head = new Group(); head.position.y = 4; head.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())); root.add(head);
    assert.equal(geometryBounds(root)!.max.y, 4.5);
    head.visible = false; // A previous preview must not change physical scene measurements.
    assert.equal(geometryBounds(root)!.max.y, 4.5);
    assert.equal(geometryBounds(root, head)!.max.y, 1);
});
test('AABB gap distinguishes separated, touching and overlapping volumes', () => {
    const a = boundsData(box([0, 0, 0], [1, 1, 1]));
    assert.deepEqual(boxRelationship(a, boundsData(box([4, 5, 1], [5, 6, 2]))), { aabbGap: 5, aabbOverlap: false, aabbTouching: false });
    assert.deepEqual(boxRelationship(a, boundsData(box([1, 0, 0], [2, 1, 1]))), { aabbGap: 0, aabbOverlap: false, aabbTouching: true });
    assert.equal(boxRelationship(a, boundsData(box([.5, .5, .5], [2, 2, 2]))).aabbOverlap, true);
});
test('relationship uses explicit origins, signed height and body-relative horizontal angle', () => {
    const a = { key: 'a', origin: [0, 1, 0], forward: [0, 0, 1], bounds: null } as SpatialObject;
    const b = { key: 'b', origin: [3, 5, 0], forward: [0, 0, -1], bounds: null } as SpatialObject;
    const report = { objects: [a, b] } as SpatialReport;
    const r = spatialRelationship(report, 'a', 'b');
    assert.equal(r.originDistance, 5); assert.equal(r.groundDistance, 3); assert.equal(r.heightDifference, 4);
    assert.equal(r.angleFromAForward, 90); assert.equal(r.obstruction, 'not-checked');
    assert.equal(spatialRelationship(report, 'b', 'a').heightDifference, -4);
    b.origin = [0, 5, 0]; assert.equal(spatialRelationship(report, 'a', 'b').angleFromAForward, null);
    assert.throws(() => spatialRelationship(report, 'a', 'a')); assert.throws(() => spatialRelationship(report, 'a', 'missing'));
});
