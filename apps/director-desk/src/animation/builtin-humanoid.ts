import * as T from 'three';
import type { Entity } from '../model.ts';
import type { Rig } from '../assets/human-legacy.ts';
import { humanShape } from '../assets/human-parameters.ts';
import type { HumanoidSkeleton } from './humanoid-retarget.ts';

/** Create once on an unanimated mannequin. Geometry-free wrist/toe anchors preserve its existing mesh. */
export function builtinHumanoidSkeleton(rig: Rig, entity: Entity): HumanoidSkeleton {
    const shape = humanShape(entity);
    const bones: HumanoidSkeleton['bones'] = { hips: rig.hips, spine: rig.joints.torso, head: rig.head };
    for (const side of ['left', 'right'] as const) {
        // Legacy pose fields call -X "left" while imported +Z-facing anatomical rigs call +X left.
        // Adapt here without changing stored legacy keyframes or procedural actions.
        const legacy = side === 'left' ? 'right' : 'left';
        const upperArm = rig.joints[`${legacy}Arm`], lowerArm = rig.joints[`${legacy}Elbow`];
        const upperLeg = rig.joints[`${legacy}Hip`], lowerLeg = rig.joints[`${legacy}Knee`], foot = rig.joints[`${legacy}Ankle`];
        const hand = new T.Group(), toes = new T.Group();
        // These runtime anchors are absent when a continued scene has no retarget clip.
        hand.userData.directorPoseHelper = toes.userData.directorPoseHelper = true;
        hand.name = `retarget-${side}-wrist`; hand.position.y = -(shape?.proportions.forearm ?? .225); lowerArm.add(hand);
        toes.name = `retarget-${side}-toes`; toes.position.z = .12; foot.add(toes);
        Object.assign(bones, { [`${side}UpperArm`]: upperArm, [`${side}LowerArm`]: lowerArm, [`${side}Hand`]: hand,
            [`${side}UpperLeg`]: upperLeg, [`${side}LowerLeg`]: lowerLeg, [`${side}Foot`]: foot, [`${side}Toes`]: toes });
    }
    const reference = [...new Set([rig.hips, ...Object.values(rig.joints), ...Object.values(bones)])].map(node => ({ node,
        position: node.position.clone(), rotation: node.quaternion.clone(), scale: node.scale.clone() }));
    return { frame: rig.root, bones, resetReference() {
        for (const { node, position, rotation, scale } of reference) { node.position.copy(position); node.quaternion.copy(rotation); node.scale.copy(scale); node.updateMatrix(); }
    } };
}
