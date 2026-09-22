import test from 'node:test';
import assert from 'node:assert/strict';
import { clone, demoProject } from '../src/model.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { ResourceRecovery } from '../src/resources/resource-recovery.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';

async function fixture() {
    const files = [{ path: 'original/prop.gltf', bytes: new TextEncoder().encode('{"asset":{"version":"2.0"},"buffers":[{"uri":"data.bin","byteLength":4}]}') }, { path: 'original/data.bin', bytes: new Uint8Array([1, 2, 3, 4]) }];
    const data = packModelFiles('original/prop.gltf', files);
    const resource = { id: await modelResourceId(data), package: data, name: '家具', copyright: 'fixture', source: 'original', license: 'test' };
    const base = demoProject(); base.version = 2; base.resources = [resource];
    const p = applyOperations(base, [{ operation: 'add', id: 'a', asset: resource.id }, { operation: 'add', id: 'b', asset: resource.id }]);
    p.entities.find(e => e.id === 'a')!.external!.nodeEdits = { '0/0': { name: '桌面', offset: [1, 2, 3] } };
    return { p, resource, files };
}

test('recovery preserves a valid project and reports absent resource users without mutating input', async () => {
    const { p, resource } = await fixture(); assert.deepEqual((await ResourceRecovery.inspect(p)).finish(), p);
    const missing = clone(p); missing.resources = []; const before = clone(missing);
    const draft = await ResourceRecovery.inspect(missing);
    assert.deepEqual(draft.problems[0].entities.map(e => e.id), ['a', 'b']); assert.equal(draft.problems[0].entry, null);
    assert.throws(() => draft.finish(), /需要恢复/); assert.deepEqual(missing, before);
    const publicProblems = draft.problems; publicProblems.length = 0; assert.equal(draft.problems.length, 1);
    await draft.restore(resource.id, resource); assert.deepEqual(draft.finish(), p);
    const result = draft.finish(); result.entities[0].position[0] += 100; assert.deepEqual(draft.finish(), p);
});

test('damaged dependencies and hash mismatch can be restored from a relocated file selection; metadata survives', async () => {
    const { p, resource, files } = await fixture();
    for (const corrupt of [
        (r: typeof resource) => { r.package.files.splice(0, 1); },
        (r: typeof resource) => { r.package.files[0].data = '!!!!'; },
        (r: typeof resource) => { r.package.files[0].data = 'BQYHCA=='; },
    ]) {
        const broken = clone(p); corrupt(broken.resources![0]); const draft = await ResourceRecovery.inspect(broken);
        assert.equal(draft.problems.length, 1); assert.equal(draft.problems[0].entry, 'original/prop.gltf');
        await draft.restoreFiles(resource.id, 'selected/renamed.gltf', files.map(f => ({ path: f.path.replace('original/', 'selected/').replace('prop.gltf', 'renamed.gltf'), bytes: f.bytes })));
        assert.deepEqual(draft.finish(), p);
    }
    const broken = clone(p); broken.resources![0].package = null as never;
    const draft = await ResourceRecovery.inspect(broken); const donor = clone(resource); donor.name = '不同备注';
    await draft.restore(resource.id, donor); donor.package.files = []; assert.deepEqual(draft.finish(), p);
});

test('unrelated invalid data never enters recovery and mismatched donors leave draft unchanged', async () => {
    const { p, resource } = await fixture();
    for (const corrupt of [
        (q: typeof p) => { q.entities[0].position = [NaN, 0, 0]; },
        (q: typeof p) => { q.cuts[0].cameraId = 'missing-camera'; },
        (q: typeof p) => { q.version = 1; },
        (q: typeof p) => { q.resources![0].name = null as never; },
        (q: typeof p) => { q.resources!.push(clone(q.resources![0])); },
        (q: typeof p) => { q.entities.find(e => e.id === 'a')!.external!.resourceId = '../invalid'; },
    ]) {
        const broken = clone(p); broken.resources![0].package = null as never; corrupt(broken);
        await assert.rejects(() => ResourceRecovery.inspect(broken));
    }
    const broken = clone(p); broken.resources = []; const draft = await ResourceRecovery.inspect(broken);
    const wrong = clone(resource); wrong.package.files[0].data = 'BQYHCA==';
    await assert.rejects(() => draft.restore(resource.id, wrong), /不匹配/); assert.equal(draft.problems.length, 1);
    await draft.restore(resource.id, resource); assert.deepEqual(draft.finish(), p);
});

test('missing motion-only resources identify clip users and keep source calibration', async () => {
    const { p, resource } = await fixture(); p.entities = p.entities.filter(e => !e.external);
    const actor = p.entities.find(e => e.kind === 'actor')!;
    actor.clips = [{ id: 'motion-source', action: 'retarget', start: 0, end: 2, speed: 1, retarget: {
        resourceId: resource.id, index: 0, loop: true, unitScale: .01, orientation: [0, 1, 0],
        rig: { version: 1, family: 'humanoid', bones: {
            hips: '0/0', spine: '0/0/0', head: '0/0/0/0',
            leftUpperArm: '0/0/0/1', leftLowerArm: '0/0/0/1/0', leftHand: '0/0/0/1/0/0',
            rightUpperArm: '0/0/0/2', rightLowerArm: '0/0/0/2/0', rightHand: '0/0/0/2/0/0',
            leftUpperLeg: '0/0/1', leftLowerLeg: '0/0/1/0', leftFoot: '0/0/1/0/0',
            rightUpperLeg: '0/0/2', rightLowerLeg: '0/0/2/0', rightFoot: '0/0/2/0/0',
        } },
    } }];
    const broken = clone(p); broken.resources = [];
    const draft = await ResourceRecovery.inspect(broken);
    assert.deepEqual(draft.problems[0].entities, []);
    assert.deepEqual(draft.problems[0].motionClips, [{ entityId: actor.id, clipId: 'motion-source' }]);
    await draft.restore(resource.id, resource); assert.deepEqual(draft.finish(), p);
});
