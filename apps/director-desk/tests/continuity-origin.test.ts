import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { clone, demoProject, getFrameCount, entity } from '../src/model.ts';
import { assertSceneDocument, duplicateDocumentScene, projectForScene, readSceneDocument, removeDocumentScene, updateDocumentScene } from '../src/scenes/sequence-project.ts';
import { continuitySummary, sceneContentHash } from '../src/scenes/continue-scene.ts';
import { editIndependentScene, readIndependentScene } from '../src/automation/scene-tools.ts';
import { validateToolInput } from '../src/automation/validate.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
import { ResourceRecovery } from '../src/resources/resource-recovery.ts';
import { SceneSession } from '../src/scenes/sequence-session.ts';

test('predecessor evidence stays immutable when its source is edited, renamed, copied or deleted', async () => {
    let doc = duplicateDocumentScene(readSceneDocument(demoProject()), 'scene-main', '下一场', 'b');
    const source = doc.scenes[0], frameIndex = getFrameCount(0, source.state.duration, source.state.fps) - 1;
    doc.scenes[1].origin = { version: 1, sceneId: source.id, sceneName: source.name, sourceHash: await sceneContentHash(source.state), frameIndex,
        time: frameIndex / source.state.fps, fps: source.state.fps, duration: source.state.duration, state: clone(source.state), notes: [], objects: [], cameraId: source.state.cuts[0].cameraId };
    assertSceneDocument(doc); const origin = clone(doc.scenes[1].origin);
    assert.equal((await continuitySummary(doc)).origin!.sourceStatus, 'unchanged');
    const future = clone(doc);
    future.scenes[1].origin!.notes.push({ id: 'future-note', start: 20, end: 22, actorId: source.state.entities[0].id, story: '尚未发生', dialogue: '', action: '', emotion: '' });
    const summary = await continuitySummary(future); assert.equal(summary.origin!.notes.length, 0); assert.equal(summary.origin!.notStartedNotes.length, 1);
    const project = projectForScene(doc, source.id); project.entities[0].position[0] += 10; doc = updateDocumentScene(doc, source.id, project);
    assert.equal((await continuitySummary(doc)).origin!.sourceStatus, 'changed'); assert.deepEqual(doc.scenes[1].origin, origin);
    doc = editIndependentScene(doc, { action: 'copy', sceneId: 'b', name: '副本', newSceneId: 'c' });
    doc.scenes[2].state.entities[0].position[1] += 1; assert.deepEqual(doc.scenes[1].origin, origin); assert.deepEqual(doc.scenes[2].origin, origin);
    doc = removeDocumentScene(doc, source.id); assert.equal((await continuitySummary(doc)).origin!.sourceStatus, 'deleted');
    assert.deepEqual(readIndependentScene(doc, 'b').origin, { sceneId: origin.sceneId, sceneName: origin.sceneName, time: origin.time, frameIndex });
    const broken = clone(doc); broken.scenes[0].origin!.frameIndex--; assert.throws(() => assertSceneDocument(broken), /快照/);
    const before = clone(doc); assert.throws(() => editIndependentScene(doc, { action: 'reorder', sceneIds: ['b', 'b'] })); assert.deepEqual(doc, before);
    validateToolInput('director_scene', { action: 'continue', name: '下一场', revision: 1, requestId: 'r1' });
    validateToolInput('director_continuity', { sceneId: 'b', offset: 0, limit: 50 });
});

test('sources referenced only by predecessor snapshots remain recoverable and cannot be cleared as unused', async () => {
    const p = demoProject(), bytes = new Uint8Array(await fs.readFile('test-assets/external/kenney-furniture/Models/GLTF format/chair.glb'));
    const model = packModelFiles('chair.glb', [{ path: 'chair.glb', bytes }]), id = await modelResourceId(model);
    p.version = 2; p.resources = [{ id, name: '椅子', package: model, source: 'Kenney', license: 'CC0', copyright: '' }];
    const prop = entity('prop', 'external-model', '椅子'); prop.external = { resourceId: id, appearance: 'white', unitScale: 1, orientation: [0, 0, 0] }; p.entities.push(prop);
    let doc = duplicateDocumentScene(readSceneDocument(p), 'scene-main', '下一场', 'b'); const source = doc.scenes[0];
    doc.scenes[1].origin = { version: 1, sceneId: source.id, sceneName: source.name, sourceHash: await sceneContentHash(source.state), frameIndex: 359, time: 359 / 24,
        fps: 24, duration: 15, state: clone(source.state), notes: [], objects: [], cameraId: source.state.cuts[0].cameraId };
    doc = removeDocumentScene(doc, 'scene-main');
    let edit = projectForScene(doc); edit.entities = edit.entities.filter(e => e.id !== prop.id); doc = updateDocumentScene(doc, 'b', edit);
    edit = projectForScene(doc); edit.resources = []; assert.throws(() => updateDocumentScene(doc, 'b', edit), /资源不存在/);
    assert.equal(new SceneSession(doc).resourceScenes(id).length, 1);
    const broken = clone(doc); broken.resources = []; const recovery = await ResourceRecovery.inspectDocument(broken);
    assert.equal(recovery.problems.length, 1); assert.match(recovery.problems[0].entities[0].name, /接拍来源/);
    await recovery.restore(id, p.resources[0]); assert.deepEqual(recovery.finish(), doc);
});
