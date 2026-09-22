import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { assertProject, clone, demoProject, validateProject } from '../src/model.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { validateToolInput } from '../src/automation/validate.ts';
async function prepared() {
    const p = demoProject(); const bytes = new Uint8Array(await fs.readFile('test-assets/external/RiggedFigure/RiggedFigure.glb'));
    const data = packModelFiles('figure.glb', [{ path: 'figure.glb', bytes }]);
    p.version = 2; p.resources = [{ id: await modelResourceId(data), name: 'figure', package: data, copyright: '', license: 'CC-BY-4.0', source: 'Khronos sample fixture' }]; return p;
}
test('version 1 stays unchanged; version 2 external actor/prop instances share portable source data', async () => {
    const legacy = demoProject(); assert.deepEqual(validateProject(legacy), legacy); assert.equal(legacy.version, 1);
    const p = await prepared(), asset = p.resources![0].id;
    const next = applyOperations(p, [{ operation: 'add', asset, id: 'imported-actor', kind: 'actor' }, { operation: 'add', asset, id: 'imported-prop', kind: 'prop', patch: { position: [2, 0, 0] } }]);
    assertProject(next); assert.equal(next.resources!.length, 1); assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next))), next);
    const a = next.entities.at(-2)!, b = next.entities.at(-1)!; assert.equal(a.kind, 'actor'); assert.equal(b.kind, 'prop'); assert.equal(a.external!.resourceId, b.external!.resourceId);
    a.external!.appearance = 'color'; assert.equal(b.external!.appearance, 'original'); assert.equal(p.entities.some(e => e.asset === 'external-model'), false);
});
test('bad resource references and unavailable body actions fail atomically', async () => {
    const p = await prepared(), asset = p.resources![0].id;
    const base = applyOperations(p, [{ operation: 'add', asset, id: 'external-actor', kind: 'actor' }]), before = clone(base);
    for (const external of [{ resourceId: 'missing', appearance: 'white', unitScale: 1, orientation: [0, 0, 0] }, { resourceId: asset, appearance: 'white', unitScale: 0, orientation: [0, 0, 0] }])
        assert.throws(() => applyOperations(base, [{ operation: 'update', id: 'external-actor', patch: { external } }]));
    assert.throws(() => applyOperations(base, [{ operation: 'update', id: 'external-actor', patch: { clips: [{ id: 'walk', action: 'walk', start: 0, end: 2, speed: 1 }] } }]), /完整人形骨架/);
    const oldFormat = clone(base); oldFormat.version = 1; assert.throws(() => assertProject(oldFormat), /第 2 版/);
    const missing = clone(base); missing.resources = []; assert.throws(() => assertProject(missing), /不存在/);
    const duplicates = clone(base); duplicates.resources!.push(clone(duplicates.resources![0])); assert.throws(() => assertProject(duplicates), /重复/);
    const locked = clone(base); locked.entities.at(-1)!.locked = true; assert.throws(() => applyOperations(locked, [{ operation: 'update', id: 'external-actor', patch: { color: '#aabbcc' } }]), /锁定/);
    assert.deepEqual(base, before);
});
test('tool contract accepts existing source IDs and restricts external instance kind', async () => {
    const p = await prepared();
    const request = { revision: 1, requestId: 'resource-test', operations: [{ operation: 'add', asset: p.resources![0].id, kind: 'actor' }] };
    validateToolInput('director_apply', request);
    assert.throws(() => validateToolInput('director_apply', { ...request, operations: [{ ...request.operations[0], kind: 'crowd' }] }));
    assert.throws(() => applyOperations(p, [{ operation: 'add', asset: 'person', kind: 'prop' }]));
});
