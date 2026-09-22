import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { sampleVisibility } from '../src/spatial/visibility.ts';
import type { SceneTarget } from '../src/spatial/scene-targets.ts';
import { pathCheckTimes, rangeSampleTimes, sweptBoxOverlap } from '../src/spatial/range.ts';
const box = (x: number, y = 0, z = 0) => new Box3(new Vector3(x - .3, y, z - .3), new Vector3(x + .3, y + 1.7, z + .3));
test('swept boxes detect fast crossings between disjoint endpoints, respect height and support contact', () => {
    const crossing = sweptBoxOverlap(box(-2), box(2), box(0), box(0));
    assert.ok(crossing && crossing[0] > .3 && crossing[1] < .7);
    assert.equal(sweptBoxOverlap(box(-2, 3), box(2, 3), box(0), box(0)), null);
    assert.equal(sweptBoxOverlap(box(0), box(0), new Box3(new Vector3(-10, -1, -10), new Vector3(10, 0, 10)), new Box3(new Vector3(-10, -1, -10), new Vector3(10, 0, 10))), null);
    assert.ok(sweptBoxOverlap(box(-2), box(2), box(2), box(-2)));
});
test('range sampling includes endpoints and critical times, rejects invalid or excessive ranges', () => {
    assert.deepEqual(rangeSampleTimes(1, 2, 2, [.5, 1.25, 2, 3]), [1, 1.25, 1.5, 2]);
    assert.throws(() => rangeSampleTimes(1, 0, 24)); assert.throws(() => rangeSampleTimes(0, 1, NaN));
    assert.throws(() => rangeSampleTimes(0, 1000, 120));
});
test('trimmed and retimed paths include internal waypoints at their playback times', () => {
    const times = pathCheckTimes({ smooth: false, points: [0, 2, 5, 10].map(time => ({ time, position: [time, 0, 0] })),
        sections: [{ start: 20, end: 24, from: 1, to: 5 }, { start: 30, end: 40, from: 5, to: 10 }] });
    assert.deepEqual(times, [20, 24, 21, 30, 40]);
    assert.deepEqual(rangeSampleTimes(20, 24, 1, times), [20, 21, 22, 23, 24]);
});
test('visibility raycasts distinguish clear, blocked, partially blocked and behind-target geometry', () => {
    const camera = new PerspectiveCamera(50, 16 / 9, .1, 100); camera.position.set(0, 1, 5); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
    function target(key: string, width: number, x: number, z: number): SceneTarget {
        const root = new Mesh(new BoxGeometry(width, 2, .2), new MeshBasicMaterial()); root.position.set(x, 1, z); root.updateMatrixWorld(true);
        return { key, name: key, entityId: key, root, meshes: [root], person: false };
    }
    const person = target('person', 1, 0, 0), wall = target('wall', 3, 0, 2);
    assert.equal(sampleVisibility(camera, person.meshes, [person]).status, 'unblocked-samples');
    const blocked = sampleVisibility(camera, person.meshes, [person, wall]);
    assert.equal(blocked.status, 'blocked-samples'); assert.equal(blocked.blockers[0].key, 'wall'); assert.ok(blocked.targetSamples > 0);
    wall.root.position.z = -2; wall.root.updateMatrixWorld(true);
    assert.equal(sampleVisibility(camera, person.meshes, [person, wall]).status, 'unblocked-samples');
    const partial = target('partial', .5, .3, 2);
    assert.equal(sampleVisibility(camera, person.meshes, [person, partial]).status, 'partly-blocked-samples');
    person.root.position.z = 10; person.root.updateMatrixWorld(true);
    assert.equal(sampleVisibility(camera, person.meshes, [person, wall]).status, 'out-of-frame');
});
