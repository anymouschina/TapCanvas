import { Matrix3, Object3D, Raycaster, Vector3 } from 'three';
import type { ContactAnchor } from '../assets/contact-anchors.ts';
import { geometryBounds } from '../spatial/geometry.ts';

/** Sample actual upward-facing surfaces. This proposes a contact, not a semantic recognition result. */
export function estimateContact(root: Object3D, role: ContactAnchor['role']): ContactAnchor {
    root.updateWorldMatrix(true, true);
    const bounds = geometryBounds(root); if (!bounds) throw Error('对象没有可测量的表面');
    const size = bounds.getSize(new Vector3()), ray = new Raycaster(), hits: Vector3[] = [];
    ray.ray.direction.set(0, -1, 0); ray.far = size.y + .02;
    for (const x of [.3, .5, .7]) for (const z of [.4, .55, .7]) {
        ray.ray.origin.set(bounds.min.x + size.x * x, bounds.max.y + .01, bounds.min.z + size.z * z);
        const hit = ray.intersectObject(root, true).find(h => h.face && h.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(h.object.matrixWorld)).y > .95);
        if (hit) hits.push(hit.point);
    }
    if (!hits.length) throw Error('未找到平缓承托面，请手动添加接触点');
    const tolerance = Math.max(.005, size.y * .015);
    const center = bounds.getCenter(new Vector3());
    const best = [...hits].sort((a, b) => hits.filter(h => Math.abs(h.y - b.y) <= tolerance).length - hits.filter(h => Math.abs(h.y - a.y) <= tolerance).length
        || Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z))[0];
    const normal = new Vector3(0, 1, 0).applyNormalMatrix(new Matrix3().getNormalMatrix(root.matrixWorld.clone().invert()));
    return { id: crypto.randomUUID(), role, position: root.worldToLocal(best.clone()).toArray(), normal: normal.toArray() };
}
