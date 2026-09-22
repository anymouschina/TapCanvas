import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { adoptModel } from '../src/resources/model-runtime.ts';
import { demoProject, clone, assertProject } from '../src/model.ts';
import { packModelFiles } from '../src/resources/model-package.ts';
import { modelResourceId } from '../src/resources/project-resources.ts';
import { applyOperationsWithResources } from '../src/automation/edits.ts';
import { userMotionId, type UserMotionAsset } from '../src/animation/user-motion.ts';
import { assertRigDefinition, type HumanoidRig } from '../src/resources/rig-definition.ts';

test('animated skeletons load without meshes; malformed/empty sources still fail', () => {
    const root = new T.Group(), hips = new T.Bone(), hand = new T.Bone(); hips.name = 'Hips'; hand.name = 'Hand';
    hips.position.y = 1; hand.position.set(1, .5, 0); hips.add(hand); root.add(hips);
    const animation = new T.AnimationClip('wave', 1, [new T.QuaternionKeyframeTrack('Hand.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, .70710678, .70710678])]);
    const model = adoptModel({ scene: root, scenes: [root], cameras: [], animations: [animation] }, '', []);
    assert.equal(model.inspection.meshes, 0); assert.equal(model.inspection.bones.length, 2);
    const instance = model.instantiate(), path = model.inspection.bones.find(b => b.name === 'Hand')!.path;
    const rig: HumanoidRig = { version: 1, family: 'humanoid', bones: { leftHand: path } };
    const bone = instance.humanoidNodes(rig).leftHand!;
    instance.sampleAnimation(0, .5, false); const rotation = bone.quaternion.clone();
    assert.ok(Math.abs(rotation.z) > .1);
    instance.sampleAnimation(0, 0, false); assert.equal(bone.quaternion.z, 0);
    instance.sampleAnimation(0, .5, false); assert.deepEqual(rotation.toArray(), bone.quaternion.toArray());
    instance.dispose(); model.dispose();
    const empty = new T.Group(); assert.throws(() => adoptModel({ scene: empty, scenes: [empty], animations: [], cameras: [] }, '', []), /骨架|网格/);
});

const rig: HumanoidRig = { version: 1, family: 'humanoid', bones: { hips: '0/0', spine: '0/0/0', head: '0/0/0/0',
    leftUpperArm: '0/0/0/1', leftLowerArm: '0/0/0/1/0', leftHand: '0/0/0/1/0/0', rightUpperArm: '0/0/0/2', rightLowerArm: '0/0/0/2/0', rightHand: '0/0/0/2/0/0',
    leftUpperLeg: '0/0/1', leftLowerLeg: '0/0/1/0', leftFoot: '0/0/1/0/0', rightUpperLeg: '0/0/2', rightLowerLeg: '0/0/2/0', rightFoot: '0/0/2/0/0' } };
async function asset(): Promise<UserMotionAsset> {
    const bytes = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }));
    const data = packModelFiles('motion.gltf', [{ path: 'motion.gltf', bytes }]), id = await modelResourceId(data);
    return { resource: { id, name: 'test', package: data, copyright: '', license: 'CC0', source: '' },
        motion: { id: userMotionId(id, 0), name: '动作', duration: 1.1, data: { resourceId: id, index: 0, unitScale: 1, orientation: [0, 0, 0], loop: false, rig: clone(rig) } } };
}
test('user motions share atomic editing, same-batch targets, portable resources, timing and locks', async () => {
    assertRigDefinition(rig, undefined);
    const source = await asset(), map = new Map([[source.motion.id, source]]), before = demoProject();
    const operations = [{ operation: 'add', asset: 'human-adult', id: 'new-person' },
        { operation: 'motion', id: 'new-person', asset: source.motion.id, time: 1, duration: 4 },
        { operation: 'motion', id: 'new-person', asset: source.motion.id, time: 1, duration: 2 }];
    const after = await applyOperationsWithResources(before, operations, map);
    const clips = after.entities.find(e => e.id === 'new-person')!.clips;
    assert.deepEqual(clips.map(c => [c.start, c.end]), [[1, 5], [5, 7]]);
    assert.equal(after.resources!.length, 1); assert.equal(before.resources, undefined);
    assert.equal(clips[0].name, '动作');
    assertProject(JSON.parse(JSON.stringify(after)));
    source.motion.data.loop = true; assert.equal(clips[0].retarget!.loop, false);
    after.entities.find(e => e.id === 'new-person')!.locked = true;
    await assert.rejects(applyOperationsWithResources(after, [operations[1]], map), /锁定/);
    await assert.rejects(applyOperationsWithResources(before, operations), /用户动作/);
    source.motion.data.rig.bones = {}; await assert.rejects(applyOperationsWithResources(before, operations, map), /补齐/);
});
