import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import type { Entity, Project, Vec3 } from '../model.ts';
import { isAnimalAsset } from '../asset-catalog.ts';

export interface HandBinding { actorId: string; hand: 'left' | 'right'; offset: Vec3; rotation: Vec3 }
export interface HandFrame { position: Vector3; rotation: Quaternion }
export function canBindHand(actor: Entity, hand: 'left' | 'right') {
    return actor.kind === 'actor' && !isAnimalAsset(actor.asset) && (!actor.external || !!actor.external.rig?.bones[`${hand}Hand`]);
}
export function assertHandBinding(e: Entity, project: Project) {
    const b = e.handBinding; if (b === undefined || b === null) return;
    const v3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x));
    if (e.kind !== 'prop' || !b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['actorId', 'hand', 'offset', 'rotation'].includes(k))
        || !['left', 'right'].includes(b.hand) || !v3(b.offset) || !v3(b.rotation)) throw Error('手持绑定需要道具、左右手及有效偏移和旋转');
    const actor = project.entities.find(a => a.id === b.actorId);
    if (!actor || !canBindHand(actor, b.hand)) throw Error('手持绑定人物或对应手部骨骼不存在');
    if (e.path) throw Error('手持道具由手部驱动，请解除绑定后再设置独立路径');
}
/** Scene-meter offsets rotate with the hand. Prop scale stays independent of actor size. */
export function applyHandBinding(root: Object3D, binding: HandBinding, hand: HandFrame) {
    root.position.copy(hand.position).add(new Vector3(...binding.offset).applyQuaternion(hand.rotation));
    root.quaternion.copy(hand.rotation).multiply(new Quaternion().setFromEuler(new Euler(...binding.rotation)));
    root.updateWorldMatrix(true, true);
}
export function editBoundTransform(e: Entity, hand: HandFrame, position?: Vec3, rotation?: Vec3) {
    if (!e.handBinding) throw Error('道具尚未绑定');
    const inverse = hand.rotation.clone().invert();
    if (position) e.handBinding.offset = new Vector3(...position).sub(hand.position).applyQuaternion(inverse).toArray();
    if (rotation) {
        const local = inverse.multiply(new Quaternion().setFromEuler(new Euler(...rotation))), angles = new Euler().setFromQuaternion(local);
        e.handBinding.rotation = [angles.x, angles.y, angles.z];
    }
}
/** Explicitly freeze the evaluated current frame; no hidden attachment survives in the file. */
export function detachHandBinding(e: Entity, root: Object3D) {
    if (e.locked) throw Error('道具已锁定');
    e.position = root.position.toArray(); e.rotation = [root.rotation.x, root.rotation.y, root.rotation.z]; e.path = null; e.handBinding = null;
}
