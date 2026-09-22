import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene } from '../src/scenes.ts';
import { assertProject, clipLabel, clone } from '../src/model.ts';
import { applyOperationsWithResources } from '../src/automation/edits.ts';
import { BUILTIN_MOTION_RESOURCE_ID, motionPresets } from '../src/animation/motion-catalog.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
import { decodeModelBytes, readGltfDocument } from '../src/resources/model-package.ts';

test('builtin motions work in an add/motion batch, deduplicate their portable resource and keep old projects unchanged', async () => {
    const original = createScene('blank'), before = clone(original);
    const project = await applyOperationsWithResources(original, [{ operation: 'add', id: 'performer', asset: 'human-adult' },
        { operation: 'motion', id: 'performer', asset: 'human-walk-v1', time: .5 }, { operation: 'motion', id: 'performer', asset: 'human-talk-v1', time: .5 }]);
    assert.deepEqual(original, before); assert.equal(original.version, 1); assert.equal(project.version, 2); assert.equal(project.resources!.length, 1);
    assert.equal(project.resources![0].id, BUILTIN_MOTION_RESOURCE_ID); assert.equal(await modelResourceId(project.resources![0].package), BUILTIN_MOTION_RESOURCE_ID);
    const actor = project.entities.find(e => e.id === 'performer')!;
    assert.deepEqual(actor.clips.map(c => [c.start, c.end]), [[.5, 4.5], [4.5, 8.5]]); assert.equal(clipLabel(actor.clips[0]), '行走');
    assert.equal(actor.clips[0].retarget!.motion!.mode, 'inPlace'); assert.equal(actor.clips[1].retarget!.motion, undefined);
    assertProject(JSON.parse(JSON.stringify(project)));
    const further = await applyOperationsWithResources(project, [{ operation: 'motion', id: 'performer', asset: 'human-sit-enter-v1', time: 9 }]);
    assert.equal(further.resources!.length, 1); assert.equal(further.entities.find(e => e.id === 'performer')!.clips.at(-1)!.retarget!.loop, false);
});

test('motion duration schedules a full scene in one batch and preserves loop semantics and interval placement', async () => {
    const original = createScene('blank');
    const project = await applyOperationsWithResources(original, [
        { operation: 'project', patch: { duration: 24.5, fps: 24 } },
        { operation: 'add', asset: 'human-adult', id: 'seated' },
        { operation: 'motion', id: 'seated', asset: 'human-sit-idle-v1', duration: 24.5 },
        { operation: 'motion', id: 'seated', asset: 'basic-lie', time: 0, duration: 1.01 },
    ]);
    const clips = project.entities.find(e => e.id === 'seated')!.clips;
    assert.equal(clips[0].start, 0); assert.equal(clips[0].end, 24.5); assert.equal(clips[0].retarget!.loop, true);
    assert.equal(clips[1].start, 24.5); assert.equal(clips[1].end, 24.5 + 25 / 24);
    for (const duration of [0, -1, Infinity, NaN]) await assert.rejects(applyOperationsWithResources(project, [{ operation: 'motion', id: 'seated', asset: 'basic-lie', duration }]), /duration/);
    assert.equal(original.entities.some(e => e.id === 'seated'), false);
});
test('motion requests respect target locks, source identity, valid times and immutable catalog results', async () => {
    const original = createScene('blank');
    const project = await applyOperationsWithResources(original, [{ operation: 'add', id: 'performer', asset: 'human-adult' }, { operation: 'motion', id: 'performer', asset: 'human-idle-v1' }]);
    const before = clone(project);
    for (const patch of [{ asset: 'missing' }, { id: 'missing' }, { time: -1 }, { time: NaN }]) await assert.rejects(applyOperationsWithResources(project, [{ operation: 'motion', id: 'performer', asset: 'human-idle-v1', ...patch }]));
    project.entities.find(e => e.id === 'performer')!.locked = true;
    await assert.rejects(applyOperationsWithResources(project, [{ operation: 'motion', id: 'performer', asset: 'human-walk-v1' }]), /锁定/);
    project.entities.find(e => e.id === 'performer')!.locked = false; assert.deepEqual(project, before);
    const list = motionPresets(); list[0].name = 'changed'; assert.notEqual(motionPresets()[0].name, 'changed'); assert.equal(motionPresets('蹲').length, 3);
});
test('curated GLB contains only the declared motions, geometry, skin and numeric buffers without source metadata or textures', async () => {
    const project = await applyOperationsWithResources(createScene('blank'), [{ operation: 'add', id: 'performer', asset: 'human-adult' }, { operation: 'motion', id: 'performer', asset: 'human-idle-v1' }]);
    const resource = project.resources![0], data = decodeModelBytes(resource.package.files[0].data), { document } = readGltfDocument(data, resource.package.entry);
    const doc = document as Record<string, any>;
    assert.deepEqual(doc.animations.map((a: any) => a.name), motionPresets().filter(p => !p.basicAction).map(p => p.name));
    assert.equal(doc.images, undefined); assert.equal(doc.textures, undefined); assert.equal(doc.extras, undefined);
    assert.equal(resource.license, 'CC0-1.0'); assert.ok(data.length < 2_200_000);
    const strings: string[] = [];
    const visit = (value: unknown) => { if (typeof value === 'string') strings.push(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
    visit(doc);
    assert.ok(strings.every(s => !/[A-Za-z]:[\\/]|file:|[\\/](?:Users|home)[\\/]|Blender|DEF-|Samba|Cesium|test-assets/i.test(s)));
    const used = new Set<number>();
    doc.meshes.forEach((m: any) => m.primitives.forEach((p: any) => { Object.values(p.attributes).forEach(a => used.add(a as number)); used.add(p.indices); }));
    doc.skins.forEach((s: any) => used.add(s.inverseBindMatrices));
    doc.animations.forEach((a: any) => a.samplers.forEach((s: any) => { used.add(s.input); used.add(s.output); }));
    assert.equal(used.size, doc.accessors.length, 'discarded motions must not remain as unused accessors');
    const views = new Set(doc.accessors.map((a: any) => a.bufferView)); assert.equal(views.size, doc.bufferViews.length);
    let end = 0; for (const v of doc.bufferViews) { assert.ok(v.byteOffset >= end && v.byteOffset - end < 4); end = v.byteOffset + v.byteLength; }
    assert.ok(doc.buffers[0].byteLength - end < 4, 'there must be no hidden unused binary tail');
});


test('coarse presets add no material payload, preserve free intervals and reject unsupported targets atomically', async () => {
    const original = createScene('blank'), before = clone(original);
    const project = await applyOperationsWithResources(original, [
        { operation: 'add', id: 'performer', asset: 'human-adult' },
        ...['crawl', 'lie', 'fall'].map(action => ({ operation: 'motion', id: 'performer', asset: `basic-${action}`, time: 1 }))
    ]);
    assert.equal(project.version, 1); assert.equal(project.resources, undefined);
    const actor = project.entities.find(e => e.id === 'performer')!;
    assert.deepEqual(actor.clips.map(c => [c.action, c.start, c.end]), [['crawl', 1, 4], ['lie', 4, 7], ['fall', 7, 10]]);
    assert.deepEqual(original, before); assertProject(JSON.parse(JSON.stringify(project)));
    await assert.rejects(applyOperationsWithResources(original, [{ operation: 'add', id: 'prop', asset: 'chair' }, { operation: 'motion', id: 'prop', asset: 'basic-crawl' }]), /人形骨架/);
    actor.locked = true;
    await assert.rejects(applyOperationsWithResources(project, [{ operation: 'motion', id: actor.id, asset: 'basic-fall' }]), /锁定/);
});
