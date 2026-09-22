import * as T from 'three';
import { cylinder } from './geometry.ts';

/** Stateless construction seed; does not depend on render order or global random. */
export function seededRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5; let v = state;
        v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61);
        return ((v ^ v >>> 14) >>> 0) / 4294967296;
    };
}
export function branch(parent: T.Object3D, material: T.Material, from: T.Vector3, to: T.Vector3, radius: number, tip = radius * .5) {
    const delta = to.clone().sub(from), part = cylinder(parent, material, tip, radius, delta.length());
    part.position.copy(from).add(to).multiplyScalar(.5); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()); return part;
}
/** Fits procedural silhouettes to declared meter dimensions without changing the root transform. */
export function fitModel(model: T.Group, width: number, height: number, depth: number) {
    model.updateMatrixWorld(true);
    const bounds = new T.Box3().setFromObject(model, true), size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
    if (Math.min(size.x, size.y, size.z) <= 0) throw new Error('白模外形没有有效尺寸');
    model.scale.set(width / size.x, height / size.y, depth / size.z);
    model.position.set(-center.x * model.scale.x, -bounds.min.y * model.scale.y, -center.z * model.scale.z);
}
