import manifest from './library/humanoid-v1-manifest.json' with { type: 'json' };
import { ACTIONS, type Action, type Clip } from '../model.ts';
import type { HumanoidRig } from '../resources/rig-definition.ts';
import { footPlantProfile } from './foot-plant-presets.ts';
import type { FootPlantOptions } from './foot-plant-plan.ts';

export interface MotionPreset { id: string; name: string; sourceClip?: string; index?: number; basicAction?: Action; duration: number; loop: boolean; defaultDuration: number; group: string; footPlant?: FootPlantOptions }
export const BUILTIN_MOTION_RESOURCE_ID = manifest.resourceId;
export function motionPresets(query = ''): MotionPreset[] {
    const term = query.trim().toLowerCase();
    const basic: MotionPreset[] = Object.entries(ACTIONS).filter(([action]) => action !== 'idle').map(([action, name]) => ({ id: `basic-${action}`, name, basicAction: action as Action, duration: 3, defaultDuration: 3, loop: false, group: '基础姿态' }));
    return structuredClone([...manifest.presets.map(p => ({ ...p, ...(footPlantProfile(p.id) ? { footPlant: footPlantProfile(p.id) } : {}) })), ...basic]
        .filter(p => `${p.id} ${p.name} ${p.sourceClip ?? ''} ${p.group}`.toLowerCase().includes(term)));
}
export function motionPreset(id: string): MotionPreset {
    const preset = motionPresets().find(p => p.id === id); if (!preset) throw Error('未知内置动作预设'); return preset;
}
export function builtinMotionRig(): HumanoidRig { return structuredClone(manifest.rig) as HumanoidRig; }
export function builtinMotionName(clip: Clip) {
    return clip.retarget?.resourceId === BUILTIN_MOTION_RESOURCE_ID ? manifest.presets.find(p => p.index === clip.retarget!.index)?.name : undefined;
}
export function builtinFootPlant(clip: Clip): FootPlantOptions | undefined {
    const data = clip.retarget; if (data?.resourceId !== BUILTIN_MOTION_RESOURCE_ID) return;
    return motionPresets().find(p => p.index === data.index)?.footPlant;
}
