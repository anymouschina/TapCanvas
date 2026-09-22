import type { FootPlantOptions } from './foot-plant-plan.ts';

// Contact intervals measured on the pinned CC0 source with inspect-motion-contacts.mjs.
// Conservative stance windows; they do not infer contact for arbitrary imported clips.
const windows: Record<string, [number, number, number, number]> = {
    'human-walk-v1': [.02, .52, .52, 1.02],
    'human-jog-v1': [.045, .17, .545, .67],
    'human-crouch-walk-v1': [0, .5, .52, 1],
};
export function footPlantProfile(id: string): FootPlantOptions | undefined {
    const w = windows[id];
    return w ? { mode: 'stance', left: [w[0], w[1]], right: [w[2], w[3]], fade: .04, maxCorrection: .25 } : undefined;
}
