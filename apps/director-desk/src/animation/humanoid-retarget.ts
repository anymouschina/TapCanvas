import * as T from 'three';
import { assertRigDefinition, HUMAN_BONES, REQUIRED_HUMAN_BONES, type HumanBone } from '../resources/rig-definition.ts';

/** Renderer-owned joints, in a calibrated frame that excludes the actor's scene placement. */
export interface HumanoidSkeleton {
    frame: T.Object3D;
    bones: Partial<Record<HumanBone, T.Object3D>>;
    resetReference(): void;
}
type Reference = { position: T.Vector3; rotation: T.Quaternion };
const children: Partial<Record<HumanBone, HumanBone[]>> = {
    hips: ['spine'], spine: ['chest', 'upperChest', 'neck', 'head'], chest: ['upperChest', 'neck', 'head'], upperChest: ['neck', 'head'], neck: ['head'],
    leftShoulder: ['leftUpperArm'], leftUpperArm: ['leftLowerArm'], leftLowerArm: ['leftHand'],
    rightShoulder: ['rightUpperArm'], rightUpperArm: ['rightLowerArm'], rightLowerArm: ['rightHand'],
    leftUpperLeg: ['leftLowerLeg'], leftLowerLeg: ['leftFoot'], leftFoot: ['leftToes'],
    rightUpperLeg: ['rightLowerLeg'], rightLowerLeg: ['rightFoot'], rightFoot: ['rightToes']
};

function chain(node: T.Object3D, frame: T.Object3D) {
    const result: T.Object3D[] = [];
    let current: T.Object3D | null = node;
    while (current && current !== frame) { result.push(current); current = current.parent; }
    if (!current) throw Error('人形骨骼不在指定的模型坐标系内');
    return result;
}
/** Local composition avoids cancellation at large scene coordinates and stale matrixWorld values. */
export function humanoidJointTransform(node: T.Object3D, frame: T.Object3D): Reference {
    const matrix = new T.Matrix4(), rotation = new T.Quaternion();
    for (const current of chain(node, frame)) {
        if (current.matrixAutoUpdate) current.updateMatrix();
        matrix.premultiply(current.matrix); rotation.premultiply(current.quaternion);
    }
    return { position: new T.Vector3().setFromMatrixPosition(matrix), rotation: rotation.normalize() };
}
function setFrameRotation(node: T.Object3D, frame: T.Object3D, rotation: T.Quaternion) {
    const parent = humanoidJointTransform(node.parent!, frame).rotation;
    node.quaternion.copy(parent.invert().multiply(rotation)).normalize(); node.updateMatrix();
}
function framePositionToLocal(node: T.Object3D, frame: T.Object3D, position: T.Vector3) {
    const matrix = new T.Matrix4();
    for (const parent of chain(node.parent!, frame)) { if (parent.matrixAutoUpdate) parent.updateMatrix(); matrix.premultiply(parent.matrix); }
    if (Math.abs(matrix.determinant()) < 1e-12) throw Error('人形骨骼父级缩放不可为零');
    return position.clone().applyMatrix4(matrix.invert());
}
function validate(skeleton: HumanoidSkeleton) {
    for (const key of REQUIRED_HUMAN_BONES) if (!skeleton.bones[key]) throw Error('动作适配缺少骨骼：' + HUMAN_BONES[key]);
    const seen = new Set<T.Object3D>();
    const paths: Partial<Record<HumanBone, string>> = {};
    for (const [key, node] of Object.entries(skeleton.bones) as [HumanBone, T.Object3D][]) {
        if (node === skeleton.frame || seen.has(node)) throw Error('动作适配骨骼重复或引用模型根节点');
        seen.add(node);
        const ancestors = chain(node, skeleton.frame);
        paths[key] = '0/' + [...ancestors].reverse().map(ancestor => ancestor.parent!.children.indexOf(ancestor)).join('/');
        for (const ancestor of ancestors) {
            if (![...ancestor.position.toArray(), ...ancestor.quaternion.toArray(), ...ancestor.scale.toArray()].every(Number.isFinite)
                || ancestor.scale.toArray().some(v => v <= 0)) throw Error('动作适配需要有限变换及正缩放');
            const scale = ancestor.scale.toArray();
            if (Math.max(...scale) - Math.min(...scale) > Math.max(...scale) * 1e-5) throw Error('动作适配暂不支持骨骼层级内的非等比缩放；人物整体缩放可保留在场景根节点');
        }
    }
    assertRigDefinition({ version: 1, family: 'humanoid', bones: paths }, undefined);
}
function legLength(skeleton: HumanoidSkeleton) {
    let total = 0;
    for (const side of ['left', 'right'] as const) {
        const p = (key: HumanBone) => humanoidJointTransform(skeleton.bones[key]!, skeleton.frame).position;
        const upper = p(`${side}UpperLeg`).distanceTo(p(`${side}LowerLeg`)), lower = p(`${side}LowerLeg`).distanceTo(p(`${side}Foot`));
        if (Math.min(upper, lower) < 1e-6) throw Error('动作适配腿部关节间距无效');
        total += upper + lower;
    }
    return total / 2;
}

/**
 * Transfer frame-space rotation deltas after anatomical reference-pose alignment.
 * Target bone translations/scales stay authored; only hip displacement scales by leg length.
 * This does not solve foot contact, stride matching or differences in anatomical twist axes.
 * Recreate after changing calibration, mapping, reference pose or body proportions.
 */
export class HumanoidRetarget {
    private source: HumanoidSkeleton;
    private target: HumanoidSkeleton;
    private keys: HumanBone[];
    private sourceKeys = new Map<HumanBone, HumanBone>();
    private sourceReference = new Map<HumanBone, Reference>();
    private targetReference = new Map<HumanBone, Reference>();
    private aligned = new Map<T.Object3D, T.Quaternion>();
    readonly translationScale: number;

    constructor(source: HumanoidSkeleton, target: HumanoidSkeleton) {
        validate(source); validate(target);
        if (Object.values(source.bones).some(node => Object.values(target.bones).includes(node))) throw Error('动作来源和目标必须使用独立骨骼实例');
        this.source = source; this.target = target;
        this.keys = (Object.keys(HUMAN_BONES) as HumanBone[]).filter(key => source.bones[key] && target.bones[key])
            .sort((a, b) => chain(target.bones[a]!, target.frame).length - chain(target.bones[b]!, target.frame).length);
        const torso: HumanBone[] = ['spine', 'chest', 'upperChest'];
        for (const key of this.keys) {
            let from = key;
            if (torso.includes(key)) for (const next of torso.slice(torso.indexOf(key) + 1)) {
                if (target.bones[next]) break;
                if (source.bones[next]) from = next;
            }
            // A one-joint mannequin torso must retain motion accumulated through the source chest chain.
            this.sourceKeys.set(key, from);
        }
        source.resetReference(); target.resetReference();
        try {
            this.translationScale = legLength(target) / legLength(source);
            for (const key of this.keys) this.sourceReference.set(key, humanoidJointTransform(source.bones[this.sourceKeys.get(key)!]!, source.frame));
            // A downward arm and a T-pose arm need a reference swing before motion deltas are meaningful.
            for (const key of this.keys) {
                const child = children[key]?.find(k => source.bones[k] && target.bones[k]);
                if (!child) continue;
                const node = target.bones[key]!, current = humanoidJointTransform(node, target.frame);
                const targetDirection = humanoidJointTransform(target.bones[child]!, target.frame).position.sub(current.position);
                const sourceDirection = humanoidJointTransform(source.bones[child]!, source.frame).position.sub(this.sourceReference.get(key)!.position);
                if (Math.min(targetDirection.length(), sourceDirection.length()) < 1e-6) throw Error('动作适配参考姿态存在重合关节：' + HUMAN_BONES[key]);
                const swing = new T.Quaternion().setFromUnitVectors(targetDirection.normalize(), sourceDirection.normalize());
                setFrameRotation(node, target.frame, swing.multiply(current.rotation));
            }
            for (const key of this.keys) {
                const node = target.bones[key]!;
                this.targetReference.set(key, humanoidJointTransform(node, target.frame)); this.aligned.set(node, node.quaternion.clone());
            }
        } finally { target.resetReference(); }
    }

    /** Source must already be sampled at the desired time. Every application is independent of prior seeks. */
    apply() {
        const { source, target } = this;
        // Snapshot before resetting the target, so its update never changes what is read from the source.
        const current = new Map(this.keys.map(key => [key, humanoidJointTransform(source.bones[this.sourceKeys.get(key)!]!, source.frame)]));
        target.resetReference();
        for (const [node, rotation] of this.aligned) node.quaternion.copy(rotation);
        for (const key of this.keys) {
            const delta = current.get(key)!.rotation.clone().multiply(this.sourceReference.get(key)!.rotation.clone().invert());
            setFrameRotation(target.bones[key]!, target.frame, delta.multiply(this.targetReference.get(key)!.rotation));
        }
        const hip = target.bones.hips!, displacement = current.get('hips')!.position.clone().sub(this.sourceReference.get('hips')!.position).multiplyScalar(this.translationScale);
        hip.position.copy(framePositionToLocal(hip, target.frame, this.targetReference.get('hips')!.position.clone().add(displacement)));
        hip.updateMatrix(); target.frame.updateWorldMatrix(true, true);
    }
}
