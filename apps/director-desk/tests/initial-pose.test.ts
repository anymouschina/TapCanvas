import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { clone, entity } from '../src/model.ts';
import { assertInitialPose, inheritedPoseAt } from '../src/scenes/initial-pose.ts';
import { captureInitialPose, InitialPoseRuntime } from '../src/scenes/initial-pose-runtime.ts';
import { makeActor } from '../src/assets/actors.ts';
import { disposeTree } from '../src/assets.ts';
import { builtinHumanoidSkeleton } from '../src/animation/builtin-humanoid.ts';
import { assertInitialPoseBindings } from '../src/scenes/pose-binding-validation.ts';

test('captured local poses preserve morph weights and authored shear; reverse seeks reset before a new action', () => {
    const e = entity('actor', 'person', '人物'), root = new T.Group(), bone = new T.Bone(), shear = new T.Object3D();
    const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()); mesh.morphTargetInfluences = [0, .2];
    shear.matrixAutoUpdate = false; shear.matrix.elements[4] = .27;
    root.add(bone, mesh, shear);
    const runtime = new InitialPoseRuntime(), rest = captureInitialPose(root, e);
    bone.position.set(1, 2, 3); bone.rotation.x = .72; mesh.morphTargetInfluences[0] = .8; shear.matrix.elements[12] = 4;
    const held = captureInitialPose(root, e); e.initialPose = clone(held); assertInitialPose(e.initialPose);
    // Registration sees the model's authored rest frame, before playback begins.
    bone.position.set(0, 0, 0); bone.rotation.set(0, 0, 0); mesh.morphTargetInfluences[0] = 0; shear.matrix.elements[12] = 0;
    runtime.register(e, root); const before = captureInitialPose(root, e); assert.deepEqual(before, rest);
    e.clips = [{ id: 'walk', action: 'walk', start: 1, end: 2, speed: 1 }];
    for (const time of [0, .5, 3, 1, .1, 1.8, 0]) {
        runtime.restore(e); const active = runtime.apply(e, time);
        assert.equal(active, time < 1); assert.deepEqual(captureInitialPose(root, e).nodes, time < 1 ? held.nodes : rest.nodes);
    }
    e.position[0] += 10; e.scale[0] = 2; e.color = '#112233'; assert.equal(inheritedPoseAt(e, 0), true);
    e.height += .1; assert.equal(inheritedPoseAt(e, 0), false, 'Different geometry must not receive stale local transforms');
    const bad = clone(held); bad.nodes[0].quaternion = [0, 0, 0, 0]; assert.throws(() => assertInitialPose(bad));
    const duplicate = clone(held); duplicate.nodes.push(clone(held.nodes[0])); assert.throws(() => assertInitialPose(duplicate));
    mesh.geometry.dispose(); (mesh.material as T.Material).dispose();
});

test('retarget runtime wrist and toe anchors do not enter a continued pose', () => {
    const e = entity('actor', 'human-adult', '人物'), source = makeActor(e), target = makeActor(e);
    try {
        const rest = captureInitialPose(source.root, e);
        builtinHumanoidSkeleton(source, e);
        source.joints.rightArm.rotation.z = 1.2;
        e.initialPose = captureInitialPose(source.root, e);
        assert.equal(e.initialPose.nodes.length, rest.nodes.length);
        assertInitialPoseBindings(e, () => { throw Error('Unexpected external model'); });
        const runtime = new InitialPoseRuntime(); runtime.register(e, target.root); runtime.apply(e, 0);
        assert.ok(Math.abs(target.joints.rightArm.rotation.z - 1.2) < 1e-12);
        assert.deepEqual(captureInitialPose(target.root, e), e.initialPose);
        e.color = '#d95656'; runtime.restore(e); runtime.apply(e, 0);
        assert.deepEqual(captureInitialPose(target.root, e), e.initialPose);
    } finally { disposeTree(source.root); disposeTree(target.root); }
});
