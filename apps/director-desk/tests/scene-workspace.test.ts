import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { clone, demoProject, entity } from '../src/model.ts';
import { SceneWorkspace } from '../src/scenes/scene-workspace.ts';
import { duplicateDocumentScene, readSceneDocument, switchDocumentScene } from '../src/scenes/sequence-project.ts';
import { ResourceRecovery } from '../src/resources/resource-recovery.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';

test('editor history restores selection on undo, redo and rollback', () => {
    let project=demoProject(),selected=project.entities[0].id;
    const history=new SceneWorkspace(project,()=>({time:0,preview:'program',selected}));
    history.begin(project);project.name='Changed';selected=project.entities[1].id;history.commit(project);
    project=history.undo(project)!;assert.equal(history.restoredSelection,project.entities[0].id);selected=history.restoredSelection!;
    project=history.redo(project)!;assert.equal(history.restoredSelection,project.entities[1].id);selected=history.restoredSelection!;
    history.begin(project);selected=project.entities[2].id;history.rollback();assert.equal(history.restoredSelection,project.entities[1].id);
});

test('transaction snapshot isolates working edits and preserves the exact starting state on rollback', t => {
    const project=demoProject(),history=new SceneWorkspace(project,()=>({time:0,preview:'program',selected:project.entities[0].id}));
    const committed=history.document();project.name='Working state';
    project.references=[{id:'test-ref',name:'Reference',data:'data:image/png;base64,AAAA'}];
    const before=clone(project),nativeClone=globalThis.structuredClone;let projectCopies=0;
    t.mock.method(globalThis,'structuredClone',(value:unknown)=>{if((value as {format?:string})?.format==='director-desk')projectCopies++;return nativeClone(value);});
    history.begin(project);assert.equal(projectCopies,1,'begin copies the full project once, including resource packages');
    project.entities[0].position[0]+=10;project.references[0].name='Edited';
    assert.deepEqual(history.pending,before);assert.notEqual(history.pending,project);
    assert.deepEqual(history.rollback(),before);assert.deepEqual(history.document(),committed);
    const working=history.project();history.begin(working);const replacement=clone(working);replacement.name='Replaced';history.commit(replacement);
    replacement.entities[0].position[0]+=20;assert.notDeepEqual(history.project(),replacement,'committed snapshots are isolated from replacement objects');
    assert.deepEqual(history.undo(replacement),working);
    assert.equal(history.redo(working)!.name,'Replaced');
});

test('editor adapter preserves scene names, project title, selection/time and document history across independent edits', () => {
    let project = demoProject(), view = { time: 3, preview: 'program', selected: project.entities[0].id };
    const workspace = new SceneWorkspace(project, () => view), initial = workspace.document();
    const a = workspace.context.sceneId;
    project = workspace.replace(duplicateDocumentScene(initial, a, 'B', 'scene-b'), workspace.context, '复制');
    view = workspace.restoredView!; assert.equal(view.time, 0); assert.equal(workspace.undoStack.length, 1);
    workspace.begin(project); project.entities[0].position[0] += 7; project.name = '工程新名'; workspace.commit(project);
    const b = clone(project);
    assert.equal(workspace.list()[1].name, 'B'); assert.equal(workspace.document().name, '工程新名');
    assert.deepEqual(workspace.document().scenes[0].state, initial.scenes[0].state);
    project = workspace.replace(switchDocumentScene(workspace.document(), a), workspace.context, '切换');
    assert.equal(workspace.restoredView!.time, 3); view = workspace.restoredView!;
    project = workspace.undo(project)!; view = workspace.restoredView!; assert.equal(workspace.context.sceneId, 'scene-b'); assert.deepEqual(project, b);
    project = workspace.undo(project)!; view = workspace.restoredView!; assert.equal(project.name, initial.name);
    project = workspace.redo(project)!; view = workspace.restoredView!; assert.deepEqual(project, b);
    workspace.begin(project); project.entities[0].position[0] = 100;
    assert.throws(() => workspace.replace(workspace.document(), workspace.context, '禁止切换'), /完成或取消/);
    project = workspace.rollback()!; assert.deepEqual(project, b); assert.equal(workspace.pending, null);
    assert.deepEqual(readSceneDocument(JSON.parse(JSON.stringify(workspace.document()))), workspace.document());
    view = { ...view, time: 8 };
    const replacement = readSceneDocument(demoProject()); replacement.name = '另一个工程';
    project = workspace.replace(replacement, workspace.context, '打开', true); assert.equal(workspace.restoredView!.time, 0);
    view = workspace.restoredView!;
    project = workspace.undo(project)!; assert.equal(workspace.restoredView!.time, 8); assert.deepEqual(project, b);
});

test('multi-scene recovery includes inactive-only models, restores once and rejects damaged scene structure before intake', async () => {
    const source = demoProject(), bytes = new Uint8Array(await fs.readFile('test-assets/external/kenney-furniture/Models/GLTF format/chair.glb'));
    const data = packModelFiles('chair.glb', [{ path: 'chair.glb', bytes }]), id = await modelResourceId(data);
    source.version = 2; source.resources = [{ id, name: '椅子', package: data, source: 'Kenney', copyright: '', license: 'CC0' }];
    const prop = entity('prop', 'external-model', '椅子'); prop.external = { resourceId: id, appearance: 'white', unitScale: 1, orientation: [0, 0, 0] }; source.entities.push(prop);
    const document = duplicateDocumentScene(readSceneDocument(source), 'scene-main', '非当前场', 'b');
    document.activeSceneId = 'scene-main';
    const externalIds = new Set(document.scenes[0].state.entities.filter(e => e.external).map(e => e.id));
    document.scenes[0].state.entities = document.scenes[0].state.entities.filter(e => !externalIds.has(e.id));
    const damaged = clone(document); damaged.resources = [];
    const draft = await ResourceRecovery.inspectDocument(damaged);
    assert.equal(draft.problems.length, 1); assert.ok(draft.problems[0].entities.every(e => e.name.startsWith('非当前场 / ')));
    assert.throws(() => draft.finish(), /需要恢复/);
    await draft.restore(document.resources[0].id, document.resources[0]); assert.deepEqual(draft.finish(), document);
    const broken = clone(damaged); broken.scenes[1].state.cuts[0].cameraId = 'missing-camera';
    await assert.rejects(() => ResourceRecovery.inspectDocument(broken), /摄影机|机位|切镜/);
    const unknown = { ...damaged, unrelated: true }; await assert.rejects(() => ResourceRecovery.inspectDocument(unknown), /格式无效/);
});
