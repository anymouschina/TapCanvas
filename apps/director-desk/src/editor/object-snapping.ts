import { Box3, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { modelNodeHidden } from '../resources/model-node-visibility.ts';

export interface SnapBounds {
    id: string;
    name: string;
    corners: Vector3[];
    axes: Vector3[];
}
export interface ObjectSnap {
    offset: Vector3;
    target: SnapBounds;
    normal: Vector3;
}

/** Keep each object's orientation instead of snapping against an enlarged world AABB. */
export function objectBounds(root: Object3D, id: string, name: string): SnapBounds | null {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert(), local = new Box3();
    root.traverse(node => {
        if (!(node instanceof Mesh) || modelNodeHidden(node)) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox)
            local.union(node.geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, node.matrixWorld)));
    });
    if (local.isEmpty()) return null;
    const corners: Vector3[] = [];
    for (const x of [local.min.x, local.max.x])
        for (const y of [local.min.y, local.max.y])
            for (const z of [local.min.z, local.max.z]) corners.push(new Vector3(x, y, z).applyMatrix4(root.matrixWorld));
    return { id, name, corners, axes: [0, 1, 2].map(i => new Vector3().setFromMatrixColumn(root.matrixWorld, i).normalize()) };
}

function interval(corners: Vector3[], axis: Vector3) {
    const values = corners.map(p => p.dot(axis));
    return [Math.min(...values), Math.max(...values)];
}
function permitted(normal: Vector3, axes: string) {
    return new Vector3(axes.includes('X') ? normal.x : 0, axes.includes('Y') ? normal.y : 0, axes.includes('Z') ? normal.z : 0);
}

/** Contact faces first, then align nearby edges without moving outside the active gizmo axes. */
export function findObjectSnap(moving: SnapBounds, targets: SnapBounds[], axes = 'XYZ', threshold = .2): ObjectSnap | null {
    let best: ObjectSnap | null = null, bestDistance = Infinity, exact: ObjectSnap | null = null;
    for (const target of targets) {
        if (target.id === moving.id) continue;
        const source = target.axes.map(a => interval(moving.corners, a));
        const destination = target.axes.map(a => interval(target.corners, a));
        for (let normalIndex = 0; normalIndex < 3; normalIndex++) {
            const normal = target.axes[normalIndex], direction = permitted(normal, axes), strength = direction.lengthSq();
            if (strength < 1e-8) continue;
            // A nearby face must actually overlap on its other two dimensions.
            if (source.some((range, i) => i !== normalIndex && Math.min(range[1], destination[i][1]) - Math.max(range[0], destination[i][0]) < -1e-5)) continue;
            for (const gap of [destination[normalIndex][0] - source[normalIndex][1], destination[normalIndex][1] - source[normalIndex][0]]) {
                const offset = direction.clone().multiplyScalar(gap / strength);
                if (offset.length() > threshold + 1e-6) continue;
                const faceOffset = offset.clone();
                for (let i = 0; i < 3; i++) {
                    if (i === normalIndex) continue;
                    // Remove the primary normal from the allowed direction, preserving face contact.
                    const tangent = permitted(target.axes[i], axes);
                    tangent.addScaledVector(direction, -tangent.dot(normal) / strength);
                    const influence = tangent.dot(target.axes[i]);
                    if (Math.abs(influence) < 1e-8) continue;
                    const shifted = source[i].map(v => v + offset.dot(target.axes[i]));
                    const differences = [destination[i][0] - shifted[0], destination[i][1] - shifted[1]];
                    const edge = differences.sort((a, b) => Math.abs(a) - Math.abs(b))[0];
                    const adjustment = tangent.multiplyScalar(edge / influence);
                    if (adjustment.length() <= threshold && offset.clone().add(adjustment).length() <= threshold) offset.add(adjustment);
                }
                // Edge refinement must not take a rotated box away from the contact footprint.
                if (source.some((range, i) => i !== normalIndex && Math.min(range[1] + offset.dot(target.axes[i]), destination[i][1]) - Math.max(range[0] + offset.dot(target.axes[i]), destination[i][0]) < -1e-5)) offset.copy(faceOffset);
                const distance = offset.length();
                if (distance < 1e-6) { exact ??= { offset, target, normal }; continue; }
                if (distance < bestDistance) { bestDistance = distance; best = { offset, target, normal }; }
            }
        }
    }
    return best ?? exact;
}
