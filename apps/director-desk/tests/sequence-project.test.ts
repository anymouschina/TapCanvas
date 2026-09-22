import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { assertProject, clone, demoProject, entity } from '../src/model.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
import { readIndependentScene } from '../src/automation/scene-tools.ts';
import { addDocumentScene, assertSceneDocument, duplicateDocumentScene, listDocumentScenes, projectForScene, readSceneDocument,
    removeDocumentScene, renameDocumentScene, reorderDocumentScenes, switchDocumentScene, updateDocumentScene } from '../src/scenes/sequence-project.ts';

test('scene query keeps reference identity without sending image payloads or changing the saved document', () => {
    const p = demoProject();
    p.references = [{ id: 'reference-a', name: '角色参考', data: 'data:image/png;base64,AAAA' }];
    p.entities[0].reference = 'reference-a';
    const document = readSceneDocument(p), before = clone(document), result = readIndependentScene(document);
    assert.deepEqual(result.project.references, [{ id: 'reference-a', name: '角色参考' }]);
    assert.equal(result.project.entities[0].reference, 'reference-a');
    assert.equal(JSON.stringify(result).includes('data:image/'), false);
    assert.deepEqual(document, before);
});

test('legacy scene migration and duplicate/edit/switch preserve independent data and cross-scene identities', () => {
    const old = demoProject(), oldCopy = clone(old), first = readSceneDocument(old);
    assert.equal(first.version, 3); assert.equal(first.name, old.name); assert.equal(first.activeSceneId, 'scene-main');
    assert.deepEqual(first.scenes[0].state.entities, old.entities); assert.deepEqual(old, oldCopy);
    const second = duplicateDocumentScene(first, 'scene-main', '第二场', 'scene-b'), originalA = clone(second.scenes[0]);
    const b = projectForScene(second); b.entities[0].position[0] += 5; b.entities[0].clips[0].end = 6;
    b.entities[1].path!.points[0].position[2] -= 2; b.entities[2].poseKeys[0].pose.head = 17;
    b.duration = 21; b.production = { fixedPrompt: '第二场备注', notes: [], sceneReferenceIds: [] };
    const edited = updateDocumentScene(second, 'scene-b', b);
    assert.deepEqual(edited.scenes[0], originalA); assert.deepEqual(second.scenes[1].state, originalA.state);
    assert.deepEqual(edited.scenes[1].state.entities.map(e => e.id), originalA.state.entities.map(e => e.id));
    const switched = switchDocumentScene(edited, 'scene-main'); assert.deepEqual(switched.scenes, edited.scenes);
    assert.deepEqual(projectForScene(switched).entities, old.entities); assert.equal(projectForScene(switched, 'scene-b').duration, 21);
    assert.deepEqual(readSceneDocument(JSON.parse(JSON.stringify(edited))), edited);
    const projected = projectForScene(edited); projected.entities[0].name = '本地副本'; assert.notEqual(edited.scenes[1].state.entities[0].name, projected.entities[0].name);
    assert.throws(() => assertProject(edited), /格式或版本/, 'Old single-scene reader must reject version 3 rather than discard other scenes');
});

test('scene creation, ordering, naming and removal are atomic and keep at least one valid active scene', () => {
    const first = readSceneDocument(demoProject()), before = clone(first);
    let doc = addDocumentScene(first, demoProject(), '另一个场景', 'other');
    doc = renameDocumentScene(doc, 'other', '第三场'); doc = reorderDocumentScenes(doc, ['other', 'scene-main']);
    assert.deepEqual(listDocumentScenes(doc).map(s => [s.id, s.name, s.active]), [['other', '第三场', true], ['scene-main', '第一场', false]]);
    assert.equal(listDocumentScenes(doc)[0].people, 4); assert.ok(listDocumentScenes(doc)[0].cameras >= 1);
    const deleted = removeDocumentScene(doc, 'other'); assert.equal(deleted.activeSceneId, 'scene-main'); assert.equal(deleted.scenes.length, 1);
    for (const operation of [() => removeDocumentScene(first, 'scene-main'), () => switchDocumentScene(first, 'missing'),
        () => duplicateDocumentScene(first, 'scene-main', '重复', 'scene-main'), () => renameDocumentScene(first, 'scene-main', ' '),
        () => reorderDocumentScenes(doc, ['other', 'other']), () => reorderDocumentScenes(doc, ['other'])]) assert.throws(operation);
    assert.deepEqual(first, before);
});

test('shared sources are stored once; cross-scene deletion and in-place content replacement are rejected', async () => {
    const p = demoProject(), bytes = new Uint8Array(await fs.readFile('test-assets/external/kenney-furniture/Models/GLTF format/chair.glb'));
    const data = packModelFiles('chair.glb', [{ path: 'chair.glb', bytes }]), id = await modelResourceId(data);
    p.version = 2; p.resources = [{ id, name: '椅子', package: data, source: 'Kenney', copyright: '', license: 'CC0' }];
    const prop = entity('prop', 'external-model', '椅子'); prop.external = { resourceId: id, appearance: 'white', unitScale: 1, orientation: [0, 0, 0] }; p.entities.push(prop);
    let doc = addDocumentScene(readSceneDocument(p), p, '第二场', 'second'); assert.equal(doc.resources.length, 1);
    assert.ok(doc.scenes.every(scene => !('resources' in scene.state)));
    const b = projectForScene(doc); b.entities = b.entities.filter(e => e.id !== prop.id); b.resources = [];
    const before = clone(doc); assert.throws(() => updateDocumentScene(doc, 'second', b), /资源不存在/); assert.deepEqual(doc, before);
    const changed = projectForScene(doc); changed.resources![0].package.entry = './chair.glb';
    assert.throws(() => updateDocumentScene(doc, 'second', changed), /原地改写/); assert.throws(() => addDocumentScene(doc, changed, '错误来源'), /不同内容/);
    const notes = projectForScene(doc); notes.resources![0].license = '补充许可备注'; doc = updateDocumentScene(doc, 'second', notes);
    assert.equal(projectForScene(doc, 'scene-main').resources![0].license, '补充许可备注'); assert.deepEqual(doc.resources[0].package, data);
});

test('inactive scene validation cannot borrow references from another scene or bypass locks and malformed fields', () => {
    const first = readSceneDocument(demoProject()), doc = duplicateDocumentScene(first, 'scene-main', '第二场', 'second');
    const broken = clone(doc), target = broken.scenes[1].state.entities[0].id;
    broken.scenes[1].state.entities = broken.scenes[1].state.entities.filter(e => e.id !== target);
    broken.scenes[1].state.entities.find(e => e.camera)!.camera!.targetId = target; broken.activeSceneId = 'scene-main';
    assert.throws(() => assertSceneDocument(broken), /目标不存在/);
    const nested = clone(doc); (nested.scenes[0].state as unknown as Record<string, unknown>).resources = [];
    assert.throws(() => assertSceneDocument(nested), /嵌套工程/);
    const missing = clone(doc); missing.activeSceneId = 'absent'; assert.throws(() => assertSceneDocument(missing), /当前戏段/);
    const locked = clone(doc); locked.scenes[1].state.entities[0].locked = true;
    const edit = projectForScene(locked); edit.entities[0].position[0] += 2; assert.throws(() => updateDocumentScene(locked, 'second', edit), /锁定/);
    const unknown = Object.assign(demoProject(), { customUnknown: 1 }); assert.throws(() => readSceneDocument(unknown), /不能静默丢弃/);
});
