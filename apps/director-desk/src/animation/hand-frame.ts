import { Quaternion, Vector3 } from 'three';
import type { Entity } from '../model.ts';
import type { Rig } from '../assets/human-legacy.ts';
import { humanShape } from '../assets/human-parameters.ts';
import type { HandFrame } from './hand-binding.ts';

export function builtinHandFrame(actor: Entity, rig: Rig, hand: 'left' | 'right'): HandFrame {
    // Match the anatomical mapping used by imported skeletons and the shared retarget adapter.
    const joint = rig.joints[hand === 'left' ? 'rightElbow' : 'leftElbow'];
    const shape = humanShape(actor), center = shape ? -(shape.proportions.forearm + .045) : -.277;
    joint.updateWorldMatrix(true, false);
    return { position: joint.localToWorld(new Vector3(0, center, shape ? .012 : .01)), rotation: joint.getWorldQuaternion(new Quaternion()).normalize() };
}
