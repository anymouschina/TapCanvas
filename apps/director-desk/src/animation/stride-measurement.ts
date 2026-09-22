import * as T from 'three';
import type { HumanoidSkeleton } from './humanoid-retarget.ts';
import { FootGrounding } from './foot-grounding.ts';
import { assertFootPlant, type FootPlantOptions } from './foot-plant-plan.ts';
import { fitStride, type StrideSample } from './stride-fit.ts';

/** Runs synchronously on an instance; always restores its exact pose, including on sampling failure. */
export function measureStride(skeleton: HumanoidSkeleton, profile: FootPlantOptions, duration: number, sample: (phase: number) => void) {
    assertFootPlant(profile);
    const { frame } = skeleton, snapshot: { node: T.Object3D; p: T.Vector3; q: T.Quaternion; s: T.Vector3 }[] = [];
    frame.traverse(node => snapshot.push({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }));
    try {
        const feet = new FootGrounding(skeleton), samples: Record<'left' | 'right', StrideSample[]> = { left: [], right: [] };
        frame.updateWorldMatrix(true, true);
        const scale = frame.getWorldScale(new T.Vector3());
        for (const side of ['left', 'right'] as const) {
            const [begin, end] = profile[side], from = begin + profile.fade, to = end - profile.fade;
            if (to - from < 1e-5) throw Error('落脚区间没有足够的稳定支撑阶段，无法估算步幅');
            // The same physical vertex is tracked throughout the stable part of the stance.
            // Picking the lowest vertex anew each sample would mistake heel/toe switching for sliding.
            sample(from); const vertex = feet.contactVertex(side);
            for (let i = 0; i <= 24; i++) {
                const phase = from + (to - from) * i / 24; sample(phase);
                frame.updateWorldMatrix(true, true); frame.updateMatrixWorld(true);
                const point = frame.worldToLocal(vertex.mesh.getVertexPosition(vertex.index, new T.Vector3()).applyMatrix4(vertex.mesh.matrixWorld));
                samples[side].push({ phase, x: point.x * scale.x, z: point.z * scale.z });
            }
        }
        return fitStride(samples.left, samples.right, duration);
    } finally {
        for (const { node, p, q, s } of snapshot) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); node.updateMatrix(); }
        frame.updateWorldMatrix(true, true); frame.updateMatrixWorld(true);
    }
}
