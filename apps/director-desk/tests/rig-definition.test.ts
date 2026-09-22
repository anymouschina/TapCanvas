import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { assertRigBindings, assertRigDefinition, suggestHumanoidRig, type BoneDescriptor, type HumanoidRig } from '../src/resources/rig-definition.ts';
import { adoptModel } from '../src/resources/model-runtime.ts';
import { geometryBounds } from '../src/spatial/geometry.ts';

test('numbered joint mapping follows actual hierarchy instead of misleading suffixes; ambiguous roots remain unresolved', () => {
    const bones: BoneDescriptor[] = [
        { path: '0/0', name: 'Skeleton_torso_joint_1', parent: null }, { path: '0/0/0', name: 'torso_joint_2', parent: '0/0' },
        { path: '0/0/0/0', name: 'torso_joint_3', parent: '0/0/0' },
        { path: '0/0/0/0/0', name: 'Skeleton_arm_joint_L__4_', parent: '0/0/0/0' },
        { path: '0/0/0/0/0/0', name: 'Skeleton_arm_joint_L__3_', parent: '0/0/0/0/0' },
        { path: '0/0/0/0/0/0/0', name: 'Skeleton_arm_joint_L__2_', parent: '0/0/0/0/0/0' }
    ];
    const suggestion = suggestHumanoidRig(bones);
    assert.equal(suggestion.rig.bones.leftUpperArm, bones[3].path); assert.equal(suggestion.rig.bones.leftHand, bones[5].path);
    assert.equal(suggestion.complete, false); assert.ok(suggestion.missing.includes('head'));
    const duplicate = suggestHumanoidRig([{ path: '0/0', name: 'mixamorigHips', parent: null }, { path: '0/0/0', name: 'mixamorigHips', parent: '0/0' }]);
    assert.equal(duplicate.rig.bones.hips, '0/0');
    const ambiguous = suggestHumanoidRig([{ path: '0/0', name: 'Hips', parent: null }, { path: '0/1', name: 'Hips', parent: null }]);
    assert.equal(ambiguous.rig.bones.hips, undefined); assert.equal(ambiguous.candidates.hips!.length, 2);
});

test('mapping and default pose reject duplicate, reversed, missing and invalid bone references', () => {
    const rig: HumanoidRig = { version: 1, family: 'humanoid', bones: { hips: '0/0', spine: '0/0/1', head: '0/0/1/2' } };
    assertRigDefinition(rig, { '0/0/1': [.1, .2, .3] });
    assert.throws(() => assertRigDefinition({ ...rig, bones: { hips: '0/0', head: '0/0' } }, undefined), /重复/);
    assert.throws(() => assertRigDefinition({ ...rig, bones: { hips: '0/0', spine: '0/1' } }, undefined), /下方/);
    assert.throws(() => assertRigBindings(rig, undefined, [{ path: '0/0', name: 'hips', parent: null }]), /不存在/);
    for (const pose of [{ invalid: [0, 0, 0] }, { '0/0': [NaN, 0, 0] }, { '0/0': [0, 0] }, { '0/0': [7, 0, 0] }]) assert.throws(() => assertRigDefinition(undefined, pose as never));
    assert.throws(() => assertRigDefinition({ ...rig, unexpected: true } as HumanoidRig, undefined), /格式/);
});

test('default pose deforms actual skin vertices, resets deterministically and never changes another instance', () => {
    const group = new T.Group(), root = new T.Bone(), joint = new T.Bone(), endpoint = new T.Bone();
    root.name = 'hips'; joint.name = 'joint'; endpoint.name = 'endpoint'; joint.position.x = 1; endpoint.position.y = 1; root.add(joint); joint.add(endpoint); group.add(root);
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0], 3));
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)); geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new T.SkinnedMesh(geometry, new T.MeshStandardMaterial()); group.add(mesh); group.updateMatrixWorld(true); mesh.bind(new T.Skeleton([root, joint, endpoint]));
    const source = adoptModel({ scene: group, scenes: [group], cameras: [], animations: [] }, '', []), a = source.instantiate(), b = source.instantiate();
    const rig: HumanoidRig = { version: 1, family: 'humanoid', bones: { hips: '0/0', spine: '0/0/0', head: '0/0/0/0' } };
    const aNodes = a.humanoidNodes(rig), bNodes = b.humanoidNodes(rig);
    assert.notEqual(aNodes.hips, root); assert.notEqual(aNodes.hips, bNodes.hips);
    assert.throws(() => a.humanoidNodes({ ...rig, bones: { hips: '0/99' } }), /不存在/);
    const original = geometryBounds(b.root)!.clone();
    a.setDefaultPose({ '0/0/0': [0, 0, Math.PI / 2] }); const changed = geometryBounds(a.root)!;
    assert.ok(aNodes.spine!.quaternion.angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), Math.PI / 2)) < 1e-7);
    assert.equal(bNodes.spine!.quaternion.angleTo(new T.Quaternion()), 0); assert.equal(joint.quaternion.angleTo(new T.Quaternion()), 0);
    assert.ok(changed.min.distanceTo(new T.Vector3(0, -1, 0)) < 1e-6); assert.ok(changed.max.distanceTo(new T.Vector3(1, 0, 0)) < 1e-6);
    assert.deepEqual(geometryBounds(b.root), original); assert.ok(a.bonePosition('0/0/0/0').length() < 1e-6);
    a.setDefaultPose({ '0/0/0': [0, 0, Math.PI / 2] }); assert.deepEqual(geometryBounds(a.root), changed);
    a.setDefaultPose(); assert.deepEqual(geometryBounds(a.root), original);
    assert.throws(() => a.setDefaultPose({ '0/999': [0, 0, 0] }), /不存在/); assert.deepEqual(geometryBounds(a.root), original);
    source.dispose(); assert.throws(() => a.setDefaultPose(), /释放/); assert.throws(() => a.humanoidNodes(rig), /释放/);
});
