import type { Clip, Entity, Project, Vec3 } from '../model.ts';
import { isAnimalAsset } from '../asset-catalog.ts';
import { assertNativeClip, type NativeMotion } from './native-animation.ts';
import { assertRigDefinition, rigStatus, type HumanoidRig, type ModelRestPose } from './rig-definition.ts';
import { retargetClipTime, type PathLocomotion } from '../animation/locomotion.ts';
import type { FootGroundingOptions } from '../animation/foot-grounding.ts';
import { assertFootPlant, type FootPlantOptions } from '../animation/foot-plant-plan.ts';

/** Independent copy of the source calibration/reference; no live dependency on a scene actor. */
export interface RetargetAnimation {
    resourceId: string;
    index: number;
    loop: boolean;
    unitScale: number;
    orientation: Vec3;
    rig: HumanoidRig;
    referencePose?: ModelRestPose;
    motion?: NativeMotion;
    locomotion?: PathLocomotion;
    grounding?: FootGroundingOptions;
    footPlant?: FootPlantOptions;
    blend?: number;
}
export const canRetarget = (e: Pick<Entity, 'kind' | 'asset' | 'external'>) =>
    ['actor', 'crowd'].includes(e.kind) && !isAnimalAsset(e.asset) && (!e.external || rigStatus(e.external.rig).complete);

export function assertRetargetClip(clip: Clip, entity: Entity, project: Project) {
    if (clip.action !== 'retarget') {
        if (clip.retarget !== undefined) throw Error('仅适配动作片段可包含 retarget 来源');
        return;
    }
    const data = clip.retarget;
    if (!canRetarget(entity)) throw Error('适配动作需要完整人形骨架，不支持道具或动物');
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['resourceId', 'index', 'loop', 'unitScale', 'orientation', 'rig', 'referencePose', 'motion', 'locomotion', 'grounding', 'footPlant', 'blend'].includes(k))) throw Error('适配动作来源格式无效');
    if (project.version !== 2 || !project.resources?.some(r => r.id === data.resourceId)) throw Error('适配动作资源不存在');
    assertNativeClip({ ...clip, action: 'native', native: { index: data.index, loop: data.loop, ...(data.motion !== undefined ? { motion: data.motion } : {}) } }, true);
    if (!Number.isFinite(data.unitScale) || data.unitScale <= 0 || data.unitScale > 10000 || !Array.isArray(data.orientation) || data.orientation.length !== 3 || !data.orientation.every(Number.isFinite)) throw Error('适配动作的单位或朝向校正无效');
    assertRigDefinition(data.rig, data.referencePose);
    if (!rigStatus(data.rig).complete) throw Error('适配动作来源需要完整人形映射');
    if (data.locomotion !== undefined) {
        const l = data.locomotion;
        if (!l || typeof l !== 'object' || Array.isArray(l) || Object.keys(l).some(k => !['mode', 'cycleDistance'].includes(k))
            || l.mode !== 'distance' || !Number.isFinite(l.cycleDistance) || l.cycleDistance < .01 || l.cycleDistance > 1000
            || !data.loop || data.motion?.mode !== 'inPlace') throw Error('按路程迈步需要循环、路径控制及 0.01—1000 米的每周期距离');
    }
    if (data.grounding !== undefined) {
        const g = data.grounding;
        if (!g || typeof g !== 'object' || Array.isArray(g) || Object.keys(g).some(k => !['mode', 'maxCorrection', 'maxPelvisLift'].includes(k))
            || g.mode !== 'preventPenetration' || !Number.isFinite(g.maxCorrection) || g.maxCorrection < .001 || g.maxCorrection > 2) throw Error('足部防穿透需要 preventPenetration 模式及 0.001—2 米的修正范围');
        if (g.maxPelvisLift !== undefined && (!Number.isFinite(g.maxPelvisLift) || g.maxPelvisLift < 0 || g.maxPelvisLift > 2)) throw Error('身体上抬额度需为 0—2 米');
    }
    if (data.blend !== undefined && (!Number.isFinite(data.blend) || data.blend < 0 || data.blend > 2)) throw Error('素材衔接时长需为 0—2 秒');
    if (data.footPlant !== undefined) {
        assertFootPlant(data.footPlant);
        if (!data.loop || data.motion?.mode !== 'inPlace' || !data.grounding) throw Error('支撑脚锁定需要循环、路径控制及足部防穿透');
    }
}
export function retargetSample(entity: Entity, time: number, sourceDuration?: number) {
    const clip = entity.clips.find(c => c.action === 'retarget' && c.start <= time && time < c.end);
    return clip ? { clipId: clip.id, time: retargetClipTime(entity, clip, time, sourceDuration), source: structuredClone(clip.retarget!) } : null;
}
export function crowdAnimationPhase(seed: number, index: number) { const v = Math.sin((seed + index) * 127.1 + 311.7) * 43758.5453; return (v - Math.floor(v)) * 5; }
