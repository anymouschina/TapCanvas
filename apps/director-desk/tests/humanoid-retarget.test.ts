import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { HumanoidRetarget, humanoidJointTransform, type HumanoidSkeleton } from '../src/animation/humanoid-retarget.ts';
import type { HumanBone } from '../src/resources/rig-definition.ts';

function skeleton(size = 1, armsDown = false, differentAxes = false): HumanoidSkeleton {
    const frame = new T.Group(), bones: HumanoidSkeleton['bones'] = {};
    const add = (key: HumanBone, parent: HumanBone | null, position: number[]) => {
        const node = new T.Bone(); node.position.fromArray(position).multiplyScalar(size);
        (parent ? bones[parent]! : frame).add(node); bones[key] = node;
    };
    add('hips', null, [0, 1, 0]); add('spine', 'hips', [0, .1, 0]); add('head', 'spine', [0, .55, 0]);
    for (const side of ['left', 'right'] as const) {
        const s = side === 'left' ? 1 : -1;
        add(`${side}UpperArm`, 'spine', [s * .2, .4, 0]);
        add(`${side}LowerArm`, `${side}UpperArm`, armsDown ? [0, -.3, 0] : [s * .3, 0, 0]);
        add(`${side}Hand`, `${side}LowerArm`, armsDown ? [0, -.25, 0] : [s * .25, 0, 0]);
        add(`${side}UpperLeg`, 'hips', [s * .1, 0, 0]); add(`${side}LowerLeg`, `${side}UpperLeg`, [0, -.45, 0]); add(`${side}Foot`, `${side}LowerLeg`, [0, -.5, .02]);
    }
    if (differentAxes) {
        // Reparameterize local axes while preserving every joint's reference position in model space.
        for (const node of Object.values(bones)) {
            const turn = new T.Quaternion().setFromEuler(new T.Euler(.4, -.6, .2));
            node.quaternion.multiply(turn);
            for (const child of node.children) { child.position.applyQuaternion(turn.clone().invert()); child.quaternion.premultiply(turn.clone().invert()); }
        }
    }
    const reference = Object.values(bones).map(node => ({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }));
    return { frame, bones, resetReference() { for (const { node, p, q, s } of reference) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); } } };
}
const transform = (rig: HumanoidSkeleton, key: HumanBone) => humanoidJointTransform(rig.bones[key]!, rig.frame);
const direction = (rig: HumanoidSkeleton, a: HumanBone, b: HumanBone) => transform(rig, b).position.sub(transform(rig, a).position).normalize();
const close = (a: T.Vector3, b: T.Vector3) => assert.ok(a.distanceTo(b) < 1e-7, `${a.toArray()} != ${b.toArray()}`);

test('retarget aligns T pose to lowered arms with different local axes and preserves target bone lengths', () => {
    const source = skeleton(), target = skeleton(1.6, true, true);
    const reference = Object.values(target.bones).map(node => ({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }));
    const transfer = new HumanoidRetarget(source, target);
    for (const { node, p, q } of reference) { close(node.position, p); assert.ok(node.quaternion.angleTo(q) < 1e-7, 'construction must restore target reference'); }
    source.bones.leftUpperArm!.rotation.y = .5; source.bones.leftLowerArm!.rotation.z = -.7;
    source.bones.rightUpperLeg!.rotation.x = .4; source.bones.rightLowerLeg!.rotation.x = -.65;
    source.bones.hips!.position.add(new T.Vector3(2, .1, 3)); transfer.apply();
    for (const [a, b] of [['leftUpperArm', 'leftLowerArm'], ['leftLowerArm', 'leftHand'], ['rightUpperLeg', 'rightLowerLeg'], ['rightLowerLeg', 'rightFoot']] as [HumanBone, HumanBone][]) close(direction(source, a, b), direction(target, a, b));
    close(transform(target, 'hips').position, new T.Vector3(3.2, 1.76, 4.8));
    for (const { node, p, s } of reference) { if (node !== target.bones.hips) close(node.position, p); close(node.scale, s); }
});

test('retarget sampling is independent of prior seeks and actor world placement, including large coordinates', () => {
    const source = skeleton(), target = skeleton(.65, true, true), transfer = new HumanoidRetarget(source, target);
    const sample = (at: number) => {
        source.resetReference(); source.bones.hips!.rotation.y = at; source.bones.leftUpperArm!.rotation.z = -at;
        source.bones.hips!.position.x = at; transfer.apply();
        return Object.values(target.bones).flatMap(node => [...node.position.toArray(), ...node.quaternion.toArray()]);
    };
    const first = sample(.7); sample(1.1); sample(0);
    source.frame.position.set(1e12, 5e11, -1e12); source.frame.rotation.y = 1.5; source.frame.scale.set(2, 4, 3);
    target.frame.position.set(-1e12, -5e11, 1e12); target.frame.rotation.y = -.8; target.frame.scale.set(.5, 3, 1);
    assert.deepEqual(sample(.7), first);
});

test('invalid mappings and degenerate skeletons fail before applying motion', () => {
    const source = skeleton(), target = skeleton();
    assert.throws(() => new HumanoidRetarget(source, source), /独立/);
    const missing = skeleton(); delete missing.bones.leftHand; assert.throws(() => new HumanoidRetarget(source, missing), /缺少/);
    const escaped = skeleton(); escaped.bones.head!.removeFromParent(); assert.throws(() => new HumanoidRetarget(source, escaped), /坐标系/);
    const wrongParent = skeleton(); wrongParent.bones.spine!.add(wrongParent.bones.leftLowerLeg!); assert.throws(() => new HumanoidRetarget(source, wrongParent), /下方/);
    const nonuniform = skeleton(); nonuniform.bones.spine!.scale.x = 2; assert.throws(() => new HumanoidRetarget(source, nonuniform), /非等比/);
    target.bones.leftLowerLeg!.position.set(0, 0, 0);
    const zero = { ...target, resetReference() {} }; assert.throws(() => new HumanoidRetarget(source, zero), /间距/);
});

test('simplified mannequin torso retains bending from omitted source chest joints', () => {
    const source = skeleton(), target = skeleton();
    const chest = new T.Bone(), upperChest = new T.Bone();
    chest.position.y = .1; upperChest.position.y = .1; chest.add(upperChest);
    for (const node of [...source.bones.spine!.children]) { upperChest.add(node); node.position.y -= .2; }
    source.bones.spine!.add(chest); source.bones.chest = chest; source.bones.upperChest = upperChest;
    const reset = source.resetReference; source.resetReference = () => { reset(); chest.quaternion.identity(); upperChest.quaternion.identity(); };
    const transfer = new HumanoidRetarget(source, target);
    chest.rotation.x = .15; upperChest.rotation.x = .25; transfer.apply();
    assert.ok(transform(target, 'spine').rotation.angleTo(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), .4)) < 1e-7);
    close(direction(source, 'leftUpperArm', 'leftLowerArm'), direction(target, 'leftUpperArm', 'leftLowerArm'));
});
