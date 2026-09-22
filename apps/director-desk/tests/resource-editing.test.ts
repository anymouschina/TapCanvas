import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { assertProject, clone, demoProject, entity } from '../src/model.ts';
import { applyOperations, changeSummary } from '../src/automation/edits.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
import { resourceUsage } from '../src/resources/resource-usage.ts';
import { validateToolInput } from '../src/automation/validate.ts';
async function fixture() {
    const p = demoProject(), bytes = new Uint8Array(await fs.readFile('test-assets/external/RiggedFigure/RiggedFigure.glb'));
    const data = packModelFiles('figure.glb', [{ path: 'figure.glb', bytes }]);
    p.version = 2; p.resources = [{ id: await modelResourceId(data), name: 'figure', package: data, copyright: 'fixture', license: 'CC-BY-4.0', source: 'Khronos sample fixture' }];
    return { p, asset: p.resources[0].id, bytes };
}

test('local prop replacement keeps references, hand transform and route identity; clears obsolete geometry settings', async () => {
    let { p, asset } = await fixture(); const actor = p.entities[0], camera = p.entities.find(e => e.camera)!;
    p = applyOperations(p, [{ operation: 'add', asset: 'cup', id: 'held', patch: { handBinding: { actorId: actor.id, hand: 'right', offset: [.1, .2, .3], rotation: [.4, .5, .6] } } }]);
    p.entities.find(e => e.id === camera.id)!.camera!.targetId = 'held';
    const e = p.entities.find(e => e.id === 'held')!; e.contactAnchors = [{ id: 'top', role: 'surface', position: [0, .2, 0], normal: [0, 1, 0] }];
    e.scale = [2, 3, 4]; e.rotation = [.3, .6, .9]; const before = clone(p);
    const q = applyOperations(p, [{ operation: 'replace-prop', id: 'held', asset, patch: { unitScale: .01, orientation: [-Math.PI / 2, 0, 0], appearance: 'color' } }]);
    const replaced = q.entities.find(e => e.id === 'held')!;
    for (const key of ['id', 'name', 'color', 'position', 'rotation', 'scale', 'path', 'handBinding', 'floorId'] as const) assert.deepEqual(replaced[key], e[key]);
    assert.equal(replaced.contactAnchors, undefined); assert.equal(replaced.external!.resourceId, asset); assert.equal(replaced.external!.unitScale, .01); assert.equal(q.entities.find(e => e.id === camera.id)!.camera!.targetId, 'held');
    assert.deepEqual(p, before); assertProject(q);
    const movable = entity('prop', 'table', 'movable', [3, 0, 2]); movable.path = { smooth: false, points: [{ time: 0, position: [3, 0, 2] }, { time: 4, position: [5, 1, 2] }] }; q.entities.push(movable);
    const next = applyOperations(q, [{ operation: 'replace-prop', id: movable.id, asset: 'chair' }]); assert.deepEqual(next.entities.at(-1)!.path, movable.path);
    const invalid = clone(q); invalid.entities.find(e => e.id === 'held')!.locked = true; assert.throws(() => applyOperations(invalid, [{ operation: 'replace-prop', id: 'held', asset: 'cup' }]), /锁定/);
    assert.throws(() => applyOperations(q, [{ operation: 'replace-prop', id: actor.id, asset: 'cup' }]), /对象/);
});

test('native animations require explicit clearing for different source; calibration errors and unsupported structure links roll back', async () => {
    const { p, asset } = await fixture();
    const q = applyOperations(p, [{ operation: 'add', id: 'native', asset }, { operation: 'update', id: 'native', patch: { clips: [{ id: 'native-clip', action: 'native', native: { index: 0, loop: true }, start: 0, end: 2, speed: 1 }] } }]);
    assert.throws(() => applyOperations(q, [{ operation: 'replace-prop', id: 'native', asset: 'chair' }]), /原生动画/);
    assert.deepEqual(applyOperations(q, [{ operation: 'replace-prop', id: 'native', asset }]).entities.at(-1)!.clips, q.entities.at(-1)!.clips);
    const cleared = applyOperations(q, [{ operation: 'replace-prop', id: 'native', asset: 'chair', patch: { animation: 'clear' } }]); assert.deepEqual(cleared.entities.at(-1)!.clips, []); assert.equal(cleared.entities.at(-1)!.external, undefined);
    for (const patch of [{ unitScale: 0 }, { unitScale: null }, { orientation: [NaN, 0, 0] }, { appearance: 'missing' }, { position: [0, 0, 0] }]) assert.throws(() => applyOperations(q, [{ operation: 'replace-prop', id: 'native', asset, patch }]));
    const linked = applyOperations(p, [{ operation: 'add', id: 'up', asset: 'stairs' }, { operation: 'add', id: 'landing', asset: 'ground', patch: { structureLink: { parentId: 'up', parentPort: 'out', ownPort: 'in', offset: [0, 0, 0], rotation: [0, 0, 0] } } }]);
    assert.throws(() => applyOperations(linked, [{ operation: 'replace-prop', id: 'up', asset: 'chair' }]));
    assert.doesNotThrow(() => applyOperations(linked, [{ operation: 'update', id: 'landing', patch: { structureLink: null } }, { operation: 'replace-prop', id: 'up', asset: 'chair' }]));
});

test('resource usage counts bytes once, protects external and motion references, and exposes missing references', async () => {
    const { p, asset, bytes } = await fixture(); const q = applyOperations(p, [{ operation: 'add', id: 'a', asset }, { operation: 'add', id: 'b', asset }]);
    const usage = resourceUsage(q)[0]; assert.deepEqual(usage.entityIds, ['a', 'b']); assert.equal(usage.sourceBytes, bytes.length); assert.equal(usage.used, true);
    assert.throws(() => applyOperations(q, [{ operation: 'resource-remove', id: asset }]), /使用/);
    // The inspector also accepts damaged drafts so a later repair UI can locate missing sources.
    const broken = clone(q); broken.resources = []; assert.equal(resourceUsage(broken)[0].missing, true);
    const motionDraft = clone(p); motionDraft.entities[0].clips = [{ id: 'motion', action: 'retarget', retarget: { resourceId: asset } as never, start: 0, end: 2, speed: 1 }];
    assert.deepEqual(resourceUsage(motionDraft)[0].motionClips, [{ entityId: motionDraft.entities[0].id, clipId: 'motion' }]);
    const cleaned = applyOperations(q, [{ operation: 'remove', id: 'a' }, { operation: 'remove', id: 'b' }, { operation: 'resource-remove', id: asset }]); assert.deepEqual(cleaned.resources, []); assertProject(cleaned);
});

test('metadata-only changes preserve immutable source package and are reported through the shared tool contract', async () => {
    const { p, asset } = await fixture(), before = clone(p);
    const operations = [{ operation: 'resource', id: asset, patch: { name: '新名称', license: '许可备注' } }];
    validateToolInput('director_apply', { revision: 1, requestId: 'metadata', operations });
    const next = applyOperations(p, operations); assert.equal(next.resources![0].name, '新名称'); assert.deepEqual(next.resources![0].package, p.resources![0].package); assert.deepEqual(next.entities, p.entities);
    assert.equal(changeSummary(p, next).projectChanged, true); assert.deepEqual(p, before);
    assert.throws(() => applyOperations(p, [{ operation: 'resource', id: asset, patch: { package: {} } }]), /只允许/);
    validateToolInput('director_apply', { revision: 1, requestId: 'replace', operations: [{ operation: 'replace-prop', id: 'prop', asset: 'chair' }, { operation: 'resource-remove', id: asset }] });
});
