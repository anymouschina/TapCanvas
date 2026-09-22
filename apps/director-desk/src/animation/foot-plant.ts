import * as T from 'three';
import type { HumanoidSkeleton } from './humanoid-retarget.ts';
import { solveHumanoidLeg, type FootGrounding, type FootSurface, type FootVertex } from './foot-grounding.ts';
import type { FootPlantPlan } from './foot-plant-plan.ts';

export interface FootPlantState extends FootPlantPlan {
    anchorWorld: [number, number, number]; contactWorld: [number, number, number];
    requested: number; residual: number; status: 'locked' | 'blending' | 'limited' | 'no-surface';
}
export interface FootAnchor { plan: FootPlantPlan; vertex: FootVertex; world: T.Vector3 }
const position = (vertex: FootVertex) => vertex.mesh.getVertexPosition(vertex.index, new T.Vector3()).applyMatrix4(vertex.mesh.matrixWorld);
const horizontal = (a: T.Vector3, b: T.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export function captureFootAnchor(contact: FootGrounding, plan: FootPlantPlan): FootAnchor {
    const vertex = contact.contactVertex(plan.side);
    return { plan, vertex, world: position(vertex) };
}

/** Keep the actual contact vertex over its authored world anchor, retaining foot rotation and bone lengths. */
export function applyFootPlants(skeleton: HumanoidSkeleton, anchors: FootAnchor[], limit: number, surface: FootSurface) {
    const { frame, bones } = skeleton;
    const update = () => { frame.updateWorldMatrix(true, true); frame.updateMatrixWorld(true); };
    update();
    return anchors.map(anchor => {
        const { plan, vertex, world } = anchor, point = position(vertex), requested = horizontal(point, world);
        // A contact interval is not authorization to pin a foot suspended over empty space.
        const support = surface(world, .12), supported = support !== null && Math.abs(world.y - support) <= .12;
        const desired = point.clone().lerp(world, plan.weight);
        const delta = desired.clone().sub(point); delta.y = 0;
        if (delta.length() > limit) desired.copy(point).add(delta.setLength(limit));
        let reachable = true;
        if (supported) for (let i = 0; i < 3; i++) {
            const current = position(vertex); if (horizontal(current, desired) < 1e-6) break;
            const ankle = bones[`${plan.side}Foot`]!, goal = ankle.getWorldPosition(new T.Vector3());
            goal.x += desired.x - current.x; goal.z += desired.z - current.z;
            reachable = solveHumanoidLeg(skeleton, plan.side, frame.worldToLocal(goal)) && reachable;
            update();
        }
        const state: FootPlantState = { ...plan, anchorWorld: world.toArray(), contactWorld: position(vertex).toArray(),
            requested, residual: 0, status: !supported ? 'no-surface' : !reachable || requested * plan.weight > limit + 1e-6 ? 'limited' : plan.weight < 1 - 1e-6 ? 'blending' : 'locked' };
        return { anchor, state };
    });
}

/** Report the final vertex after subsequent vertical grounding, including reach/correction limits. */
export function measureFootPlants(plants: ReturnType<typeof applyFootPlants>): FootPlantState[] {
    return plants.map(({ anchor, state }) => {
        const point = position(anchor.vertex); state.contactWorld = point.toArray(); state.residual = horizontal(point, anchor.world);
        if (state.status !== 'no-surface' && state.residual > state.requested * (1 - state.weight) + 1e-4) state.status = 'limited';
        return state;
    });
}
