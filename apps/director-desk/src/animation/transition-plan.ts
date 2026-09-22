import type { Clip, Entity } from '../model.ts';
import { ACTIONS } from '../model.ts';

export interface MotionTransitionPlan {
    start: number; duration: number; weight: number;
    fromClipId: string | null; toClipId: string | null;
    fromTime: number;
}
const before = (e: Entity, time: number) => e.clips.filter(c => c.end <= time).reduce<Clip | undefined>((a, b) => !a || b.end > a.end ? b : a, undefined);
const active = (e: Entity, time: number) => e.clips.find(c => c.start <= time && time < c.end);

/** Opt-in material transitions. Retained fragments keep their original transition origin after a cut. */
function transitionWindow(entity: Entity, time: number) {
    const current = active(entity, time), last = before(entity, time);
    const start = current ? current.start - (current.progressOffset ?? 0) : last?.end ?? 0;
    if (start <= 0 || time < start) return null;
    const fromTime = Math.max(0, start - Math.min(1e-8, Math.max(1e-10, start * 1e-9)));
    const outgoing = active(entity, fromTime);
    const basic = (clip?: Clip) => clip && clip.action !== 'idle' && Object.hasOwn(ACTIONS, clip.action);
    const duration = Math.min(current?.retarget?.blend ?? outgoing?.retarget?.blend ?? (entity.external && (basic(current) || basic(outgoing)) ? entity.actionBlend ?? .2 : 0),
        current ? current.sourceDuration ?? current.end - current.start : Infinity);
    if (duration <= 0) return null;
    return { start, duration, fromTime, outgoing, current };
}
export const usesMaterialTransition = (entity: Entity, time: number) => transitionWindow(entity, time) !== null;
export function motionTransitionAt(entity: Entity, time: number): MotionTransitionPlan | null {
    const window = transitionWindow(entity, time); if (!window) return null;
    const { start, duration, fromTime, outgoing, current } = window;
    if (time >= start + duration) return null;
    const t = Math.max(0, Math.min(1, (time - start) / duration)), weight = t * t * (3 - 2 * t);
    // Negligible endpoint differences must not recursively visit a whole chain of completed transitions.
    if (weight >= 1 - 1e-12) return null;
    return { start, duration, weight, fromTime, fromClipId: outgoing?.id ?? null, toClipId: current?.id ?? null };
}

export function transitionGroundingAt(entity: Entity, time: number) {
    const current = active(entity, time);
    if (current?.retarget) return current.retarget.grounding;
    const transition = motionTransitionAt(entity, time);
    return transition ? entity.clips.find(c => c.id === transition.fromClipId)?.retarget?.grounding : undefined;
}
