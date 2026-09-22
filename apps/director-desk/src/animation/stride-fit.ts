import type { Clip, Entity } from '../model.ts';
import { setPathLocomotion } from './locomotion.ts';

export interface StrideSample { phase: number; x: number; z: number }
export interface FootStrideFit { cycleDistance: number; lateralPerCycle: number; rmsError: number; relativeError: number; phaseSpan: number; samples: number }
export interface StrideEstimate {
    method: 'stance-regression'; sourceDuration: number; cycleDistance: number | null;
    quality: 'usable' | 'review' | 'unsupported'; reasons: string[];
    feet: { left: FootStrideFit; right: FootStrideFit }; asymmetry: number;
    crowd?: { sampleMember: number; count: number };
}

/** Fit local-forward contact travel against normalized phase. Inputs are measured scene meters. */
export function fitStrideFoot(samples: StrideSample[]): FootStrideFit {
    if (samples.length < 3 || samples.some(s => ![s.phase, s.x, s.z].every(Number.isFinite))) throw Error('步幅校准缺少有效足部采样');
    const mean = (key: keyof StrideSample) => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
    const phase = mean('phase'), x = mean('x'), z = mean('z'), denominator = samples.reduce((sum, s) => sum + (s.phase - phase) ** 2, 0);
    if (denominator < 1e-12) throw Error('步幅校准的采样相位必须不同');
    const slope = (key: 'x' | 'z', center: number) => samples.reduce((sum, s) => sum + (s.phase - phase) * (s[key] - center), 0) / denominator;
    const dx = slope('x', x), dz = slope('z', z), span = Math.max(...samples.map(s => s.phase)) - Math.min(...samples.map(s => s.phase));
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + (s.z - z - dz * (s.phase - phase)) ** 2, 0) / samples.length);
    return { cycleDistance: -dz, lateralPerCycle: dx, rmsError: rms, relativeError: rms / Math.max(.001, Math.abs(dz) * span), phaseSpan: span, samples: samples.length };
}

export function fitStride(left: StrideSample[], right: StrideSample[], sourceDuration: number): StrideEstimate {
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw Error('步幅校准需要有效素材时长');
    const feet = { left: fitStrideFoot(left), right: fitStrideFoot(right) };
    const distance = (feet.left.cycleDistance + feet.right.cycleDistance) / 2;
    const asymmetry = Math.abs(feet.left.cycleDistance - feet.right.cycleDistance) / Math.max(.001, Math.abs(distance));
    const reasons: string[] = [];
    const forward = Object.values(feet).every(f => f.cycleDistance >= .01 && f.cycleDistance <= 1000);
    if (!forward) reasons.push('没有稳定的正向迈步位移，可能是待机、倒退或错误的落脚区间');
    if (Object.values(feet).some(f => Math.abs(f.lateralPerCycle) > Math.max(.01, f.cycleDistance * .35))) reasons.push('动作有明显侧向迈步，不适合直接按正向路径校准');
    if (asymmetry > .2) reasons.push('左右脚估算差异超过 20%，需要检查动作或骨架比例');
    if (Object.values(feet).some(f => f.relativeError > .08)) reasons.push('支撑脚位移明显非匀速，单一每周期距离只能近似匹配');
    return { method: 'stance-regression', sourceDuration, cycleDistance: forward ? distance : null,
        quality: !forward ? 'unsupported' : reasons.length ? 'review' : 'usable', reasons, feet, asymmetry };
}

/** Apply a measured distance using existing portable clip fields, preserving the retained initial pose. */
export function applyStrideEstimate(entity: Entity, clip: Clip, estimate: StrideEstimate) {
    if (entity.locked) throw Error('对象已锁定');
    if (estimate.quality === 'unsupported' || estimate.cycleDistance === null || !Number.isFinite(estimate.cycleDistance)
        || estimate.cycleDistance < .01 || estimate.cycleDistance > 1000) throw Error('此动作无法自动校准正向步幅');
    setPathLocomotion(entity, clip, estimate.sourceDuration, estimate.cycleDistance);
    // A calibrated cycle distance denotes one full cycle, so remove any extra cadence multiplier.
    clip.speed = 1;
}
