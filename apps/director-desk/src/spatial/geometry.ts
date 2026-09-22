import { Box3, InstancedMesh, Matrix4, Mesh, Object3D, PerspectiveCamera, Vector2, Vector3, Vector4 } from 'three';
import { lensProjection, lensOverscan, lensScreen, overscanCamera } from '../cinematography/lens-projection.ts';
import type { Vec3 } from '../model.ts';
import { modelNodeHidden } from '../resources/model-node-visibility.ts';

export interface BoundsData { min: Vec3; max: Vec3; size: Vec3; center: Vec3 }
export interface FrameData {
    method?: 'distorted-bounds-samples';
    status: 'inside' | 'intersecting' | 'outside' | 'hidden' | 'not-rendered' | 'unknown';
    // Normalized viewport coordinates: origin top-left. Measures projected AABB, not silhouette.
    rectangle: { left: number; top: number; right: number; bottom: number } | null;
    occlusion: 'not-checked' | 'sampled';
}
export function geometryBounds(root: Object3D, excluded?: Object3D): Box3 | null {
    root.updateWorldMatrix(true, true);
    // SkinnedMesh updates its attached bind inverse in updateMatrixWorld, not updateWorldMatrix.
    root.updateMatrixWorld(true);
    const bounds = new Box3(), vertex = new Vector3();
    function visit(node: Object3D) {
        if (node === excluded || modelNodeHidden(node)) return;
        if (node instanceof Mesh) {
            const positions = node.geometry.getAttribute('position');
            if (positions && node instanceof InstancedMesh) {
                const instance = new Matrix4(), world = new Matrix4();
                const morph = node.morphTexture ? new Mesh(node.geometry, node.material) : null;
                for (let index = 0; index < node.count; index++) {
                    node.getMatrixAt(index, instance); world.multiplyMatrices(node.matrixWorld, instance);
                    if (morph) node.getMorphAt(index, morph);
                    for (let i = 0; i < positions.count; i++) {
                        (morph ?? node).getVertexPosition(i, vertex).applyMatrix4(world); bounds.expandByPoint(vertex);
                    }
                }
            } else if (positions) for (let i = 0; i < positions.count; i++) {
                node.getVertexPosition(i, vertex).applyMatrix4(node.matrixWorld);
                bounds.expandByPoint(vertex);
            }
        }
        node.children.forEach(visit);
    }
    visit(root);
    return bounds.isEmpty() ? null : bounds;
}
export function boundsData(box: Box3): BoundsData {
    return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new Vector3()).toArray(), center: box.getCenter(new Vector3()).toArray() };
}
export function boundsBox(data: BoundsData): Box3 { return new Box3(new Vector3(...data.min), new Vector3(...data.max)); }
export function boxCorners(box: Box3): Vector3[] {
    return Array.from({ length: 8 }, (_, i) => new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
}
const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
const clipPlanes = [(p: Vector4) => p.w + p.x, (p: Vector4) => p.w - p.x,
    (p: Vector4) => p.w + p.y, (p: Vector4) => p.w - p.y,
    (p: Vector4) => p.w + p.z, (p: Vector4) => p.w - p.z];

/** Clip box faces in homogeneous coordinates, including the near plane; never divide behind-camera corners. */
function pinholeFrameBounds(box: Box3 | null, camera: PerspectiveCamera): FrameData {
    const empty: FrameData = { status: 'unknown', rectangle: null, occlusion: 'not-checked' };
    if (!box || box.isEmpty()) return empty;
    camera.updateWorldMatrix(true, false);
    const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const corners = boxCorners(box).map(v => new Vector4(v.x, v.y, v.z, 1).applyMatrix4(matrix));
    const inside = corners.every(p => clipPlanes.every(plane => plane(p) >= 0));
    const points: Vector4[] = [];
    for (const face of faces) {
        let polygon = face.map(i => corners[i]);
        for (const plane of clipPlanes) {
            const next: Vector4[] = [];
            for (let i = 0; i < polygon.length; i++) {
                const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = plane(a), db = plane(b);
                if (da >= 0) next.push(a);
                if ((da >= 0) !== (db >= 0)) next.push(a.clone().lerp(b, da / (da - db)));
            }
            polygon = next;
        }
        points.push(...polygon);
    }
    // A box can enclose the entire frustum without any box face crossing it.
    if (!points.length) {
        const frustumInside = boxCorners(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)))
            .some(v => box.containsPoint(v.unproject(camera)));
        return { ...empty, status: frustumInside ? 'intersecting' : 'outside', rectangle: frustumInside ? { left: 0, top: 0, right: 1, bottom: 1 } : null };
    }
    const projected = points.filter(p => p.w > 0).map(p => [(p.x / p.w + 1) / 2, (1 - p.y / p.w) / 2]);
    if (!projected.length) return { ...empty, status: 'outside' };
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return { ...empty, status: inside ? 'inside' : 'intersecting', rectangle: {
        left: clamp(Math.min(...projected.map(p => p[0]))), top: clamp(Math.min(...projected.map(p => p[1]))),
        right: clamp(Math.max(...projected.map(p => p[0]))), bottom: clamp(Math.max(...projected.map(p => p[1])))
    } };
}

export function frameBounds(box: Box3 | null, camera: PerspectiveCamera): FrameData {
    const lens = lensProjection(camera);
    if (!lens) return pinholeFrameBounds(box, camera);
    const scale = lensOverscan(lens), base = pinholeFrameBounds(box, overscanCamera(camera, scale));
    if (!base.rectangle) return { ...base, method: 'distorted-bounds-samples' };
    const r = base.rectangle, points: Vector2[] = [];
    // Sample the conservative clipped rectangle boundary; nonlinear lens curves may bow beyond corners.
    for (let i = 0; i <= 64; i++) {
        const u = i / 64, x = r.left + (r.right - r.left) * u, y = r.top + (r.bottom - r.top) * u;
        for (const [px, py] of [[x, r.top], [x, r.bottom], [r.left, y], [r.right, y]]) points.push(lensScreen(new Vector2((px * 2 - 1) * scale, (1 - py * 2) * scale), camera.aspect, lens));
    }
    const x = points.map(p => (p.x + 1) / 2), y = points.map(p => (1 - p.y) / 2);
    const left = Math.min(...x), right = Math.max(...x), top = Math.min(...y), bottom = Math.max(...y);
    const empty = { ...base, method: 'distorted-bounds-samples' as const, status: 'outside' as const, rectangle: null };
    if (right < 0 || left > 1 || bottom < 0 || top > 1) return empty;
    return { ...base, method: 'distorted-bounds-samples', status: base.status === 'inside' && left >= 0 && right <= 1 && top >= 0 && bottom <= 1 ? 'inside' : 'intersecting',
        rectangle: { left: Math.max(0, left), top: Math.max(0, top), right: Math.min(1, right), bottom: Math.min(1, bottom) } };
}

export function boxRelationship(a: BoundsData, b: BoundsData) {
    const gap = a.min.map((v, i) => Math.max(0, v - b.max[i], b.min[i] - a.max[i]));
    const overlap = a.min.map((v, i) => Math.min(a.max[i], b.max[i]) - Math.max(v, b.min[i]));
    return { aabbGap: Math.hypot(...gap), aabbOverlap: overlap.every(v => v > 1e-6),
        aabbTouching: overlap.every(v => v >= -1e-6) && overlap.some(v => Math.abs(v) <= 1e-6) };
}
