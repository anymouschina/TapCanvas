import * as T from 'three';
import { humanoidJointTransform, type HumanoidSkeleton } from './humanoid-retarget.ts';

export interface FootGroundingOptions { mode: 'preventPenetration'; maxCorrection: number; maxPelvisLift?: number }
export type FootSurface = (point: T.Vector3, reach: number) => number | null;
export type FootVertex = { mesh: T.Mesh; index: number };
type Vertex = FootVertex;
type Side = 'left' | 'right';
export interface GroundedFoot {
    side: Side;
    status: 'clear' | 'corrected' | 'limited' | 'no-surface';
    requested: number;
    residual: number;
    ankleWorld: [number, number, number];
}
export interface FootGroundingState {
    mode: 'preventPenetration'; feet: GroundedFoot[];
    pelvis?: { requested: number; lift: number; limit: number; positionWorld: [number, number, number] };
}
const sides: Side[] = ['left', 'right'];

function setRotation(node: T.Object3D, frame: T.Object3D, rotation: T.Quaternion) {
    const parent = humanoidJointTransform(node.parent!, frame).rotation;
    node.quaternion.copy(parent.invert().multiply(rotation)).normalize(); node.updateMatrix();
}

/** Three-dimensional two-bone solve in calibrated model space; preserves lengths and the incoming knee plane. */
export function solveHumanoidLeg(skeleton: HumanoidSkeleton, side: Side, goal: T.Vector3) {
    const { frame, bones } = skeleton, hip = bones[`${side}UpperLeg`]!, knee = bones[`${side}LowerLeg`]!, ankle = bones[`${side}Foot`]!;
    const at = (n: T.Object3D) => humanoidJointTransform(n, frame);
    const a = at(hip), b = at(knee), c = at(ankle), upper = a.position.distanceTo(b.position), lower = b.position.distanceTo(c.position);
    if (Math.min(upper, lower) < 1e-6) throw Error('脚底修正需要有效腿长');
    const direction = goal.clone().sub(a.position), rawDistance = direction.length();
    if (rawDistance < 1e-8) return false;
    direction.divideScalar(rawDistance);
    const distance = T.MathUtils.clamp(rawDistance, Math.abs(upper - lower) + 1e-7, upper + lower - 1e-7);
    const pole = b.position.clone().sub(a.position); pole.addScaledVector(direction, -pole.dot(direction));
    if (pole.lengthSq() < 1e-10) {
        pole.set(0, 0, 1).addScaledVector(direction, -direction.z);
        if (pole.lengthSq() < 1e-10) pole.set(1, 0, 0).addScaledVector(direction, -direction.x);
    }
    pole.normalize();
    const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upper * upper - along * along));
    const desiredKnee = a.position.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    const end = a.position.clone().addScaledVector(direction, distance);
    const swing = new T.Quaternion().setFromUnitVectors(b.position.clone().sub(a.position).normalize(), desiredKnee.clone().sub(a.position).normalize());
    setRotation(hip, frame, swing.multiply(a.rotation));
    const nextKnee = at(knee), nextAnkle = at(ankle);
    swing.setFromUnitVectors(nextAnkle.position.clone().sub(nextKnee.position).normalize(), end.clone().sub(nextKnee.position).normalize());
    setRotation(knee, frame, swing.multiply(nextKnee.rotation));
    // Keep the source foot orientation; solving the leg must not silently flatten or twist the shoe.
    setRotation(ankle, frame, c.rotation);
    frame.updateWorldMatrix(true, true); frame.updateMatrixWorld(true);
    return Math.abs(rawDistance - distance) < 1e-5;
}

function footVertices(skeleton: HumanoidSkeleton, side: Side): Vertex[] {
    const foot = skeleton.bones[`${side}Foot`]!, descendants = new Set<T.Object3D>(); foot.traverse(n => descendants.add(n));
    const result: Vertex[] = [];
    skeleton.frame.traverse(node => {
        if (!(node instanceof T.Mesh)) return;
        const position = node.geometry.getAttribute('position'); if (!position) return;
        if (node instanceof T.SkinnedMesh) {
            const indices = node.geometry.getAttribute('skinIndex'), weights = node.geometry.getAttribute('skinWeight'); if (!indices || !weights) return;
            const related = new Set(node.skeleton.bones.flatMap((bone, index) => descendants.has(bone) ? [index] : []));
            for (let i = 0; i < position.count; i++) {
                let weight = 0;
                for (let j = 0; j < Math.min(4, indices.itemSize, weights.itemSize); j++) if (related.has(indices.getComponent(i, j))) weight += weights.getComponent(i, j);
                if (weight >= .5) result.push({ mesh: node, index: i });
            }
        } else if (descendants.has(node)) for (let i = 0; i < position.count; i++) result.push({ mesh: node, index: i });
    });
    if (!result.length) throw Error('脚底修正未找到' + (side === 'left' ? '左' : '右') + '脚独立网格或足部蒙皮权重');
    return result;
}

/** Foot geometry is instance-owned. No history-dependent contact cache or source animation edits. */
export class FootGrounding {
    private skeleton: HumanoidSkeleton;
    private vertices: Record<Side, Vertex[]>;
    constructor(skeleton: HumanoidSkeleton) {
        this.skeleton = skeleton;
        this.vertices = { left: footVertices(skeleton, 'left'), right: footVertices(skeleton, 'right') };
    }
    private samples(side: Side) {
        const chosen: T.Vector3[] = [], point = new T.Vector3();
        const extrema = [[1, 1], [0, 1], [0, -1], [2, 1], [2, -1]] as const;
        // Representative real surface vertices; only five allocations, even for a dense imported shoe.
        for (const { mesh, index } of this.vertices[side]) {
            mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
            extrema.forEach(([axis, sign], i) => {
                if (!chosen[i]) chosen[i] = point.clone();
                else if (point.getComponent(axis) * sign < chosen[i].getComponent(axis) * sign) chosen[i].copy(point);
            });
        }
        return chosen;
    }
    contactPoint(side: Side) {
        const { frame, bones } = this.skeleton; frame.updateWorldMatrix(true, true); frame.updateMatrixWorld(true);
        const world = this.samples(side)[0], local = bones[`${side}Foot`]!.worldToLocal(world.clone());
        return { local: local.toArray(), world: world.toArray() };
    }
    contactVertex(side: Side): FootVertex {
        this.skeleton.frame.updateWorldMatrix(true, true); this.skeleton.frame.updateMatrixWorld(true);
        const point = new T.Vector3(); let lowest = Infinity, chosen = this.vertices[side][0];
        for (const vertex of this.vertices[side]) {
            vertex.mesh.getVertexPosition(vertex.index, point).applyMatrix4(vertex.mesh.matrixWorld);
            if (point.y < lowest) { lowest = point.y; chosen = vertex; }
        }
        return chosen;
    }
    apply(options: FootGroundingOptions, surface: FootSurface): FootGroundingState {
        const { frame, bones } = this.skeleton; frame.updateWorldMatrix(true, true); frame.updateMatrixWorld(true);
        const inspect = (side: Side) => {
            const supports = this.samples(side).map(point => ({ point, height: surface(point, options.maxCorrection) })).filter(s => s.height !== null);
            return { supports, requested: Math.max(0, ...supports.map(s => s.height! - s.point.y)) };
        };
        const initial = { left: inspect('left'), right: inspect('right') };
        const requestedLift = Math.max(initial.left.requested, initial.right.requested);
        const pelvisLift = Math.min(requestedLift, options.maxCorrection, options.maxPelvisLift ?? 0);
        if (pelvisLift > 1e-6) {
            // Move the body in world vertical, even when its parent is tilted or non-uniformly scaled.
            // The scene root/path stays authored; the next animation sample restores the original hip pose.
            const hips = bones.hips!, goal = hips.getWorldPosition(new T.Vector3()); goal.y += pelvisLift;
            hips.position.copy(hips.parent!.worldToLocal(goal)); hips.updateMatrix();
            frame.updateWorldMatrix(true, true); frame.updateMatrixWorld(true);
        }
        const feet: GroundedFoot[] = [];
        for (const side of sides) {
            const ankle = bones[`${side}Foot`]!, { supports, requested } = pelvisLift > 1e-6 ? inspect(side) : initial[side];
            let reachable = true;
            if (requested > 1e-6) {
                const goal = ankle.getWorldPosition(new T.Vector3()); goal.y += Math.min(requested, options.maxCorrection);
                frame.worldToLocal(goal); reachable = solveHumanoidLeg(this.skeleton, side, goal);
            }
            // Re-query the corrected real geometry. Skin weights and nearby support heights may differ after the solve.
            const after = requested > 1e-6 ? this.samples(side).map(point => ({ point, height: surface(point, options.maxCorrection) })).filter(s => s.height !== null) : supports;
            const residual = after.length ? Math.max(0, ...after.map(s => s.height! - s.point.y)) : requested;
            feet.push({ side, status: !supports.length ? 'no-surface' : !reachable || residual > 1e-4 ? 'limited' : initial[side].requested <= 1e-6 ? 'clear' : 'corrected',
                requested: initial[side].requested, residual, ankleWorld: ankle.getWorldPosition(new T.Vector3()).toArray() });
        }
        return { mode: 'preventPenetration', feet, ...(options.maxPelvisLift !== undefined ? { pelvis: {
            requested: requestedLift, lift: pelvisLift > 1e-6 ? pelvisLift : 0, limit: options.maxPelvisLift, positionWorld: bones.hips!.getWorldPosition(new T.Vector3()).toArray()
        } } : {}) };
    }
}
