import type { Clip, Entity } from '../model.ts';
import { retargetClipTime } from './locomotion.ts';
import { entityPosition } from '../timeline.ts';

export type FootSide = 'left' | 'right';
/** Normalized source-cycle contact intervals. End may exceed 1 for a wrapping stance. */
export interface FootPlantOptions {
    mode: 'stance'; left: [number, number]; right: [number, number];
    fade: number; maxCorrection: number;
}
export interface FootPlantPlan { side: FootSide; anchorTime: number; weight: number }
const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };

export function assertFootPlant(value: FootPlantOptions) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(k => !['mode', 'left', 'right', 'fade', 'maxCorrection'].includes(k))
        || value.mode !== 'stance' || !Number.isFinite(value.fade) || value.fade <= 0 || value.fade > .25
        || !Number.isFinite(value.maxCorrection) || value.maxCorrection < .001 || value.maxCorrection > 2) throw Error('支撑脚锁定配置无效');
    for (const side of ['left', 'right'] as const) {
        const span = value[side];
        if (!Array.isArray(span) || span.length !== 2 || !span.every(Number.isFinite) || span[0] < 0 || span[0] >= 1
            || span[1] <= span[0] || span[1] - span[0] >= 1 || value.fade * 2 > span[1] - span[0]) throw Error('落脚区间需要有效循环相位及两端淡入淡出');
    }
}

/** Reconstruct the retained clip's sampling origin, including when its earlier slice was deleted. */
export function footPlantSamplingEntity(entity: Entity, clip: Clip): Entity {
    const elapsed = clip.progressOffset ?? 0;
    if (!elapsed) return entity;
    const expanded = { ...clip, start: clip.start - elapsed, progressOffset: 0,
        offset: (clip.offset ?? 0) - (clip.retarget?.locomotion ? 0 : elapsed * clip.speed) };
    return { ...entity, clips: [...entity.clips.filter(c => c.id !== clip.id && (c.end <= expanded.start || c.start >= clip.end)), expanded].sort((a, b) => a.start - b.start) };
}

/** Invert the authored clock, never the previously rendered frame. Plateaus use first arrival. */
export function footPlantPlans(entity: Entity, clip: Clip, time: number, duration: number, phase = 0): FootPlantPlan[] {
    const options = clip.retarget?.footPlant;
    if (!options || time < clip.start || time >= clip.end) return [];
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(phase) || !Number.isFinite(time)) throw Error('支撑脚锁定需要有效素材时长、相位及工程时间');
    const origin = clip.start - (clip.progressOffset ?? 0);
    const local = (at: number) => (retargetClipTime(entity, clip, at, duration) + phase) / duration;
    const cycle = local(time), first = local(origin);
    const endTime = origin + (clip.sourceDuration ?? clip.end - clip.start);
    const boundaryFade = Math.min(.08, (endTime - origin) / 2);
    // Release the constraint before an authored action handoff; cuts retain the original envelope.
    const envelope = boundaryFade > 0 ? smooth((time - origin) / boundaryFade) * smooth((endTime - time) / boundaryFade) : 0;
    // Do not hold a foot on the far side of a path-section teleport.
    let floor = origin;
    for (const section of entity.path?.sections ?? []) if (section.start > floor && section.start <= time) {
        const before = entityPosition(entity, section.start - 1e-8), after = entityPosition(entity, section.start);
        if (before.distanceTo(after) > 1e-5) floor = section.start;
    }
    const result: FootPlantPlan[] = [];
    for (const side of ['left', 'right'] as const) {
        const [start, end] = options[side], epoch = Math.floor(cycle - start + 1e-12), from = epoch + start, to = epoch + end;
        if (cycle < from - 1e-10 || cycle >= to) continue;
        let anchorTime = origin;
        if (from > first + 1e-12) {
            if (!clip.retarget?.locomotion) anchorTime = clip.start + (from * duration - phase - (clip.offset ?? 0)) / clip.speed;
            else {
                let lo = origin, hi = time;
                for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (local(mid) < from - 1e-12) lo = mid; else hi = mid; }
                anchorTime = hi;
            }
        }
        anchorTime = Math.max(floor, anchorTime);
        const weight = smooth((cycle - from) / options.fade) * smooth((to - cycle) / options.fade) * envelope;
        if (weight > 1e-10) result.push({ side, anchorTime, weight });
    }
    return result;
}
