import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProject, clone } from '../src/model.ts';
import { createScene } from '../src/scenes.ts';
import { cameraLookAt, recordCameraLook, type CameraLookPath } from '../src/animation/camera-look.ts';
import { zonesAt, zoneConnections } from '../src/building/zones.ts';
import { applyOperations, changeSummary } from '../src/automation/edits.ts';
import { mergeScene } from '../src/scenes/merge-project.ts';
import { readSceneDocument, projectForScene, duplicateDocumentScene, updateDocumentScene } from '../src/scenes/sequence-project.ts';

const look: CameraLookPath = { smooth: false, points: [{ time: 1, position: [0, 1, 0] }, { time: 5, position: [8, 1, -4] }] };
function fixture() {
    const p = createScene('blank'); p.entities.find(e => e.camera)!.camera!.targetPath = clone(look);
    p.zones = [{ id: 'hall', name: '走廊', color: '#888888', min: [-2, 0, -2], max: [2, 3, 2], connectsTo: ['room'] },
        { id: 'room', name: '房间', color: '#aaaaff', min: [2, 0, -2], max: [6, 3, 2] }];
    assertProject(p); return p;
}
test('look targets hold endpoints and interpolate without overshoot or playback history', () => {
    assert.deepEqual(cameraLookAt(look, 3).toArray(), [4, 1, -2]);
    assert.deepEqual(cameraLookAt(look, 0).toArray(), look.points[0].position);
    assert.deepEqual(cameraLookAt(look, 8).toArray(), look.points[1].position);
    const smooth = { ...look, smooth: true };
    assert.deepEqual(cameraLookAt(smooth, 2).toArray(), [1.25, 1, -.625]);
    for (const t of [4.8, 1.1, 3, 2, 8, 0]) { const x = cameraLookAt(smooth, t).x; assert.ok(x >= 0 && x <= 8); }
    const recorded = recordCameraLook(look, 3.001, [2, 2, 2], 24);
    const updated = recordCameraLook(recorded, 3.002, [3, 3, 3], 24);
    assert.equal(updated.points.length, 3); assert.deepEqual(updated.points[1], { time: 3, position: [3, 3, 3] });
    assert.equal(look.points.length, 2); assert.deepEqual(recorded.points[1].position, [2, 2, 2]);
});
test('camera partial patch preserves lens, rejects invalid schedules atomically and respects locks', () => {
    const p = fixture(), camera = p.entities.find(e => e.camera)!, before = clone(p);
    const edited = applyOperations(p, [{ operation: 'update', id: camera.id, patch: { camera: { targetPath: null } } }]);
    assert.equal(edited.entities.find(e => e.camera)!.camera!.focal, camera.camera!.focal);
    for (const bad of [{ ...look, points: [...look.points, look.points[0]] }, { smooth: true, points: [] },
        { ...look, points: [{ time: 0, position: [NaN, 0, 0] }] }])
        assert.throws(() => applyOperations(p, [{ operation: 'update', id: camera.id, patch: { camera: { targetPath: bad } } }]));
    assert.deepEqual(p, before); camera.locked = true;
    assert.throws(() => applyOperations(p, [{ operation: 'update', id: camera.id, patch: { camera: { targetPath: null } } }]), /锁定/);
});
test('zones report inclusive origin membership and undirected authored links, invalid references roll back', () => {
    const p = fixture(); assert.deepEqual(zonesAt(p, [2, 1, 0]), ['hall', 'room']); assert.deepEqual(zonesAt(p, [0, 4, 0]), []);
    assert.deepEqual(zoneConnections(p, 'room'), ['hall']); assert.deepEqual(zoneConnections(p, 'hall'), ['room']);
    const empty = createScene('blank'), next = applyOperations(empty, [{ operation: 'project', patch: { zones: p.zones } }]);
    assert.equal(changeSummary(empty, next).projectChanged, true);
    for (const bad of [p.zones!.map(z => ({ ...z, connectsTo: ['missing'] })), [p.zones![0], p.zones![0]], [{ ...p.zones![1], min: [7, 0, 0] }]])
        assert.throws(() => applyOperations(empty, [{ operation: 'project', patch: { zones: bad } }]));
    assert.equal(empty.zones, undefined);
});
test('scene save, copy and edits preserve zones and look keys independently', () => {
    const p = fixture(), doc = duplicateDocumentScene(readSceneDocument(p), 'scene-main', '后段', 'second');
    const next = projectForScene(doc); next.zones![0].name = '新走廊'; next.entities.find(e => e.camera)!.camera!.targetPath!.points[0].position[0] = 9;
    const saved = readSceneDocument(JSON.parse(JSON.stringify(updateDocumentScene(doc, 'second', next))));
    assert.deepEqual(projectForScene(saved, 'scene-main').zones, p.zones);
    assert.deepEqual(projectForScene(saved, 'scene-main').entities, p.entities);
    assert.equal(projectForScene(saved).zones![0].name, '新走廊');
});
test('scene merge offsets zones, remaps their connections, and shifts or freezes look schedules', () => {
    const p = fixture(), dest = createScene('blank'), opts = { offset: [10, 2, 3] as [number, number, number], timeOffset: 7, scheduling: 'keep' as const, cuts: 'keep' as const };
    const result = mergeScene(dest, p, opts), zones = result.project.zones!;
    assert.deepEqual(zones[0].min, [8, 2, 1]); assert.deepEqual(zones[0].connectsTo, [zones[1].id]); assert.notEqual(zones[0].id, 'hall');
    const originalCamera = p.entities.find(e => e.camera)!;
    const copied = result.project.entities.find(e => e.id === result.entityIds[originalCamera.id])!.camera!.targetPath!;
    assert.deepEqual(copied.points.map(p => p.time), [8, 12]); assert.deepEqual(cameraLookAt(copied, 10).toArray(), [14, 3, 1]);
    const reset = mergeScene(dest, p, { ...opts, scheduling: 'reset' });
    assert.deepEqual(reset.project.entities.find(e => e.id === reset.entityIds[originalCamera.id])!.camera!.targetPath!.points, [{ time: 0, position: [10, 3, 3] }]);
});
