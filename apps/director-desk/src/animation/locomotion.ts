import type { Clip, Entity } from '../model.ts';
import { pathDistance } from './path-distance.ts';

/** cycleDistance is the distance covered by a full left/right cycle, in scene meters for this actor. */
export interface PathLocomotion { mode: 'distance'; cycleDistance: number }
export function retargetClipTime(entity: Entity, clip: Clip, time: number, sourceDuration?: number) {
    const locomotion = clip.retarget?.locomotion;
    if (!locomotion) return (time - clip.start) * clip.speed + (clip.offset ?? 0);
    if (!sourceDuration || !Number.isFinite(sourceDuration) || sourceDuration <= 0) throw Error('按路程迈步需要提供动作素材时长');
    // Splits retain a relative route origin and source offset, rather than substituting elapsed seconds for meters.
    const origin = clip.start - (clip.progressOffset ?? 0);
    return (clip.offset ?? 0) + pathDistance(entity.path, origin, time) / locomotion.cycleDistance * sourceDuration * clip.speed;
}

/** Switching clocks preserves the source pose at the beginning of the retained clip. */
export function setPathLocomotion(entity: Entity, clip: Clip, sourceDuration: number, cycleDistance?: number) {
    if (!clip.retarget) throw Error('请先选择适配动作');
    const phase = retargetClipTime(entity, clip, clip.start, sourceDuration);
    clip.offset = phase; clip.progressOffset = 0;
    if (cycleDistance === undefined) delete clip.retarget.locomotion;
    else {
        clip.retarget.locomotion = { mode: 'distance', cycleDistance };
        clip.retarget.loop = true;
        clip.retarget.motion ??= { mode: 'inPlace', node: clip.retarget.rig.bones.hips! };
    }
}

/** Local mean over at most 10ms; exposes extreme cadence without silently changing authored route timing. */
export function locomotionPlaybackRate(entity: Entity, clip: Clip, time: number, sourceDuration: number) {
    const l = clip.retarget?.locomotion; if (!l) return clip.speed;
    const a = Math.max(clip.start, time - .005), b = Math.min(clip.end, time + .005);
    return b > a ? pathDistance(entity.path, a, b) / (b - a) / l.cycleDistance * sourceDuration * clip.speed : 0;
}
