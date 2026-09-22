import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { assertProject, clone, demoProject, type Clip } from '../src/model.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { sliceAction } from '../src/clip-editing.ts';
import { retargetSample, type RetargetAnimation } from '../src/resources/retarget-animation.ts';
import type { HumanoidRig } from '../src/resources/rig-definition.ts';
const rig: HumanoidRig = { version: 1, family: 'humanoid', bones: { hips: '0/0', spine: '0/0/0', head: '0/0/0/0',
    leftUpperArm: '0/0/0/1', leftLowerArm: '0/0/0/1/0', leftHand: '0/0/0/1/0/0', rightUpperArm: '0/0/0/2', rightLowerArm: '0/0/0/2/0', rightHand: '0/0/0/2/0/0',
    leftUpperLeg: '0/0/1', leftLowerLeg: '0/0/1/0', leftFoot: '0/0/1/0/0', rightUpperLeg: '0/0/2', rightLowerLeg: '0/0/2/0', rightFoot: '0/0/2/0/0' } };
async function fixture() {
    const p = demoProject(), bytes = new Uint8Array(await fs.readFile('test-assets/external/CesiumMan/CesiumMan.glb'));
    const data = packModelFiles('source.glb', [{ path: 'source.glb', bytes }]); p.version = 2;
    p.resources = [{ id: await modelResourceId(data), package: data, name: 'motion', copyright: '', source: '', license: '' }];
    const source: RetargetAnimation = { resourceId: p.resources[0].id, rig: clone(rig), orientation: [0, 0, 0], unitScale: 1, index: 0, loop: true, motion: { mode: 'inPlace', node: '0/0' } };
    const clip: Clip = { id: 'adapted', action: 'retarget', retarget: source, start: 1, end: 5, speed: 1.3, offset: .2 };
    const project = applyOperations(p, [{ operation: 'add', asset: 'human-adult', id: 'target', patch: { clips: [clip] } }]);
    return { project, clip };
}
test('portable retarget clips keep source metadata independent through split, copied actors and arbitrary sample queries', async () => {
    const { project, clip } = await fixture(), actor = project.entities.find(e => e.id === 'target')!;
    const before = retargetSample(actor, 3)!;
    actor.clips = [sliceAction(clip, 1, 2), sliceAction(clip, 2, 5)];
    assert.ok(Math.abs(retargetSample(actor, 3)!.time - before.time) < 1e-12); assert.deepEqual(retargetSample(actor, 3)!.source, before.source);
    assert.equal(retargetSample(actor, 5), null); assert.equal(retargetSample(actor, .5), null);
    const read = retargetSample(actor, 3)!; read.source.rig.bones.hips = '0/99'; read.source.orientation[0] = 1; read.source.motion!.node = '0';
    assert.deepEqual(retargetSample(actor, 3)!.source, before.source);
    const copy = clone(actor); copy.clips[0].retarget!.rig.bones.hips = '0/98'; assert.notEqual(actor.clips[0].retarget!.rig.bones.hips, '0/98');
    assertProject(JSON.parse(JSON.stringify(project)));
});
test('retarget source/target requirements reject invalid edits atomically without changing old projects', async () => {
    const { project, clip } = await fixture(), before = clone(project);
    for (const patch of [{ resourceId: 'missing' }, { rig: { ...rig, bones: { hips: '0/0' } } }, { unitScale: 0 }, { orientation: [0, NaN, 0] }, { motion: false }, { extra: 1 }]) {
        const bad = clone(clip); Object.assign(bad.retarget!, patch);
        assert.throws(() => applyOperations(project, [{ operation: 'update', id: 'target', patch: { clips: [bad] } }]));
    }
    assert.throws(() => applyOperations(project, [{ operation: 'add', asset: project.resources![0].id, kind: 'actor', patch: { clips: [clip] } }]), /完整人形/);
    assert.throws(() => applyOperations(project, [{ operation: 'add', asset: 'chair', patch: { clips: [clip] } }]), /完整人形/);
    assert.deepEqual(project, before); const old = demoProject(); assertProject(old); assert.equal(old.version, 1);
});
