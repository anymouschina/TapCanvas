import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject } from '../src/model.ts';
import { notesText, productionData, putNote, safeFilename } from '../src/production/notes.ts';
import { blobCrc32, createZip } from '../src/production/zip.ts';
import { productionEntries } from '../src/production/bundle.ts';
import { duplicateDocumentScene, projectForScene, readSceneDocument } from '../src/scenes/sequence-project.ts';
import { scenePromptFile } from '../src/production/prompts.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { SceneSession } from '../src/scenes/sequence-session.ts';
test('production metadata roundtrips without changing legacy projects; bad links and note times rejected', () => {
    const legacy = demoProject(); assert.equal(validateProject(legacy).production, undefined);
    const p = structuredClone(legacy); putNote(p, { id: 'note-1', start: 1, end: 3, actorId: p.entities[0].id, story: '接头', emotion: '警惕', dialogue: '不是说好，一个人来？', action: '抬手' });
    assert.deepEqual(validateProject(p), p); assert.match(notesText(p), /不是说好，一个人来？/);
    const invalid = structuredClone(p); assert.ok(invalid.production); invalid.production.notes[0].actorId = 'missing'; assert.throws(() => validateProject(invalid));
    invalid.production.notes[0].actorId = ''; invalid.production.notes[0].end = 0; assert.throws(() => validateProject(invalid));
    const wrong = structuredClone(p); assert.ok(wrong.production); wrong.production.sceneReferenceIds = ['missing']; assert.throws(() => validateProject(wrong));
    assert.deepEqual(productionData(legacy).notes, []); assert.equal(legacy.production, undefined);
    assert.equal(safeFilename('../CON:*'), '.._CON__'); assert.equal(safeFilename('CON'), '_CON');
    assert.equal(safeFilename('a'.repeat(99) + '.more'), 'a'.repeat(99));
});
test('ZIP uses correct CRC, UTF-8 names, central offsets and cancel semantics', async () => {
    assert.equal(await blobCrc32(new Blob(['123456789'])), 0xcbf43926);
    const files = [{ name: '目录/台词.txt', data: new Blob(['林岚：你好']) }, { name: 'empty.txt', data: new Blob([]) }];
    const zip = new Uint8Array(await (await createZip(files)).arrayBuffer()), view = new DataView(zip.buffer);
    assert.equal(view.getUint32(0, true), 0x04034b50); assert.equal(view.getUint16(6, true), 0x800);
    const end = zip.length - 22; assert.equal(view.getUint32(end, true), 0x06054b50); assert.equal(view.getUint16(end + 10, true), 2);
    const central = view.getUint32(end + 16, true); assert.equal(view.getUint32(central, true), 0x02014b50);
    assert.equal(new TextDecoder().decode(zip.slice(30, 30 + view.getUint16(26, true))), files[0].name);
    await assert.rejects(() => createZip([{ name: '../bad', data: new Blob([]) }]));
    for (const name of ['C:/bad', 'file:stream', 'bad\u0000name', 'a\\b'])
        await assert.rejects(() => createZip([{ name, data: new Blob([]) }]));
    await assert.rejects(() => createZip([files[0], files[0]]));
    const a = new AbortController(); a.abort(); await assert.rejects(() => createZip(files, a.signal), { name: 'AbortError' });
});
test('production bundle contains original editable project, references and dialogue exactly once', async () => {
    const p = demoProject(); p.references = [{ id: 'ref-1', name: '角色.png', data: 'data:image/png;base64,aGVsbG8=' }]; p.entities[0].reference = 'ref-1';
    putNote(p, { id: 'note-1', start: 1, end: 7, actorId: p.entities[0].id, story: '', emotion: '', dialogue: '保持完整台词', action: '' });
    const entries = await productionEntries(p); const source = JSON.parse(await entries.find(e => e.name.endsWith('.director'))!.data.text());
    assert.deepEqual(source, p); assert.equal(entries.filter(e => e.name.startsWith('参考图/')).length, 1);
    const text = await entries.find(e => e.name === '剧情与台词.txt')!.data.text(); assert.equal(text.match(/保持完整台词/g)?.length, 1);
    const manifest = JSON.parse(await entries.find(e => e.name === '素材对应关系.json')!.data.text()); assert.equal(manifest.video, null);
    assert.equal(manifest.characters[0].referenceId, 'ref-1');
});

test('multi-scene delivery retains the whole editable document and identifies the active media scene', async () => {
    const document = duplicateDocumentScene(readSceneDocument(demoProject()), 'scene-main', '第二段', 'b');
    const entries = await productionEntries(projectForScene(document), undefined, document);
    assert.deepEqual(JSON.parse(await entries.find(e => e.name.endsWith('.director'))!.data.text()), document);
    const manifest = JSON.parse(await entries.find(e => e.name === '素材对应关系.json')!.data.text());
    assert.equal(manifest.sceneId, 'b'); assert.equal(manifest.sceneName, '第二段'); assert.match(manifest.scope, /全部戏段/);
    assert.match(await entries.find(e => e.name === '使用说明.txt')!.data.text(), /当前戏段/);
});

test('complete scene prompt uses shared notes edits, roundtrips and undo without altering other scenes', () => {
    const first = demoProject();
    first.production = { fixedPrompt: '项目风格', sceneReferenceIds: [], notes: [], promptText: '前段成稿' };
    const session = new SceneSession(duplicateDocumentScene(readSceneDocument(first), 'scene-main', '下一场', 'b'));
    const transaction = session.begin(), original = structuredClone(transaction.project.production!);
    const promptText = '视频参考固定头：参考本场视频\n视频固定头：9:16 短剧\ncut1:\n[0—24.5 秒]\n人物甲：“原文台词。”';
    const edited = applyOperations(transaction.project, [{ operation: 'notes', value: { ...original, promptText } }]);
    session.commit(transaction, edited);
    assert.equal(session.project().production?.promptText, promptText);
    assert.equal(session.project('scene-main').production?.promptText, '前段成稿');
    assert.deepEqual(new SceneSession(JSON.parse(JSON.stringify(session.exportDocument()))).exportDocument(), session.exportDocument());
    session.undo(); assert.deepEqual(session.project().production, original);
    session.redo(); assert.equal(session.project().production?.promptText, promptText);
    for (const promptText of [null, {}, 1, 'x'.repeat(100001)]) {
        assert.throws(() => applyOperations(edited, [{ operation: 'notes', value: { ...original, promptText } }]), /promptText/);
    }
    assert.equal(edited.production?.promptText, promptText, 'failed updates leave the original document intact');
});

test('prompt TXT preserves authored contents; bundle exports separate scenes with safe unique names and honest missing entries', async () => {
    const project = demoProject();
    assert.equal(scenePromptFile(project), undefined);
    const content = '视频参考固定头：参考本场视频（待上传）\n视频固定头：21:9 电影，24.5 秒\ncut1:\n[0—24.5 秒]\n人物甲：“只说一次。”\n';
    project.production = { fixedPrompt: '', sceneReferenceIds: [], notes: [], promptText: content };
    const standalone = scenePromptFile(project, 'CON')!;
    assert.equal(standalone.name, '_CON-视频提示词.txt');
    assert.equal(await standalone.data.text(), content);
    assert.deepEqual([...new Uint8Array(await standalone.data.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf]);
    let doc = duplicateDocumentScene(readSceneDocument(project), 'scene-main', '同名', 'b');
    doc.scenes[0].name = '同名'; doc.scenes[1].state.production!.promptText = '下一场\ncut1:\n[0—10 秒]';
    doc = duplicateDocumentScene(doc, 'b', '未完成', 'c'); doc.scenes[2].state.production!.promptText = '  ';
    const entries = await productionEntries(projectForScene(doc), undefined, doc);
    const prompts = entries.filter(e => e.name.startsWith('逐场提示词/'));
    assert.deepEqual(prompts.map(e => e.name), ['逐场提示词/0001-同名-视频提示词.txt', '逐场提示词/0002-同名-视频提示词.txt']);
    assert.equal(await prompts[0].data.text(), content);
    assert.equal((await prompts[0].data.text()).match(/只说一次/g)?.length, 1);
    assert.equal(await prompts[1].data.text(), doc.scenes[1].state.production!.promptText);
    const manifest = JSON.parse(await entries.find(e => e.name === '素材对应关系.json')!.data.text());
    assert.equal(manifest.promptFiles[2].file, null); assert.equal(manifest.video, null);
    await createZip(entries);
});
