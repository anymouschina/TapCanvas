import * as T from 'three';
import type { Entity } from '../model.ts';
import type { Rig } from './human-legacy.ts';
import { samplePose } from '../timeline.ts';

/** Absolute pose sampling: seeking backwards must not accumulate joint rotations. */
export function poseAnimal(rig: Rig, e: Entity, time: number) {
    for (const joint of Object.values(rig.joints)) joint.rotation.set(0, 0, 0);
    rig.hips.position.y = rig.restHipHeight ?? 0;
    rig.hips.rotation.set(0, 0, 0);
    for (const [key, value] of Object.entries(samplePose(e, time))) {
        if (key === 'headYaw') rig.head.rotation.y = T.MathUtils.degToRad(value);
        else if (rig.joints[key]) {
            const axis = rig.poseAxes?.[key] ?? 'x';
            const sign = rig.poseSigns?.[key] ?? 1;
            rig.joints[key].rotation[axis] = T.MathUtils.degToRad(value) * sign;
        }
    }
}
