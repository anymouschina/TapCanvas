import { Matrix3, Object3D, Vector3 } from 'three';
import type { Entity, Vec3 } from '../model.ts';
export interface ContactAnchor { id: string; role: 'seat' | 'surface' | 'bed'; position: Vec3; normal: Vec3; forward?: Vec3 }
export const CONTACT_ROLES = { seat: '座位', surface: '承托面', bed: '床面' };
export function assertContactAnchors(entity: Entity) {
    const points = entity.contactAnchors; if (points === undefined) return;
    if (entity.kind !== 'prop' || !Array.isArray(points) || points.length > 64) throw Error('接触点仅用于道具，每个对象最多 64 个');
    const ids = new Set<string>();
    const vector = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && Number.isFinite(v));
    for (const p of points) {
        if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id) || !Object.hasOwn(CONTACT_ROLES, p.role)
            || !vector(p.position) || !vector(p.normal) || Math.abs(Math.hypot(...p.normal) - 1) > 1e-5
            || (p.forward !== undefined && (!vector(p.forward) || Math.abs(Math.hypot(...p.forward) - 1) > 1e-5 || Math.abs(new Vector3(...p.forward).dot(new Vector3(...p.normal))) > 1e-5))) throw Error('接触点标识、位置或朝向无效');
        ids.add(p.id);
    }
}
/** Entity overrides replace the generated list; omission follows current geometry parameters. */
export function contactAnchors(entity: Entity, root: Object3D): ContactAnchor[] {
    return structuredClone(entity.contactAnchors ?? root.userData.contactAnchors ?? []);
}
export function worldContactAnchors(entity: Entity, root: Object3D): ContactAnchor[] {
    root.updateWorldMatrix(true, false);
    const normal = new Matrix3().getNormalMatrix(root.matrixWorld);
    return contactAnchors(entity, root).map(a => ({ ...a, position: root.localToWorld(new Vector3(...a.position)).toArray(),
        normal: new Vector3(...a.normal).applyNormalMatrix(normal).toArray(),
        forward: new Vector3(...(a.forward ?? [0, 0, 1])).transformDirection(root.matrixWorld).toArray() }));
}
