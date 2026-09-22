import type { Clip, Entity } from '../model.ts';
import { isBonePath } from './rig-definition.ts';

export interface NativeMotion { mode: 'inPlace'; node: string }
export interface NativeAnimation { index: number; loop: boolean; motion?: NativeMotion }
export interface AnimationDescriptor { index: number; name: string; duration: number; tracks: number }
export interface ModelNodeDescriptor { path: string; name: string; parent: string | null; kind: string; positionAnimated: boolean; editable?: boolean; geometryId?: number }

/** Pure project validation; source existence is checked after resource loading. */
export function assertNativeClip(clip: Clip, external: boolean) {
    if (clip.action !== 'native') {
        if (clip.native !== undefined) throw Error('仅原生动画片段可包含动画来源');
        return;
    }
    const data = clip.native;
    if (!external || !data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['index', 'loop', 'motion'].includes(key)) || !Number.isSafeInteger(data.index) || data.index < 0 || typeof data.loop !== 'boolean') throw Error('原生动画需要导入模型、有效动画索引及循环设置');
    if (data.motion !== undefined) {
        const motion = data.motion;
        if (!motion || typeof motion !== 'object' || Array.isArray(motion) || Object.keys(motion).some(key => !['mode', 'node'].includes(key)) || motion.mode !== 'inPlace' || !isBonePath(motion.node)) throw Error('走位控制需要有效的源节点路径和 inPlace 模式');
    }
    if (!Number.isFinite((clip.end - clip.start) * clip.speed + (clip.offset ?? 0))) throw Error('原生动画采样范围超出可表示数值');
}
export function assertNativeBindings(entity: Entity, animations: readonly AnimationDescriptor[], nodes: readonly Pick<ModelNodeDescriptor, 'path'>[] = []) {
    for (const clip of entity.clips) if (clip.action === 'native') {
        assertNativeClip(clip, !!entity.external);
        assertAnimationBinding(clip.native!, animations, nodes);
    }
}
export function assertAnimationBinding(data: NativeAnimation, animations: readonly AnimationDescriptor[], nodes: readonly Pick<ModelNodeDescriptor, 'path'>[] = []) {
    const source = animations.find(a => a.index === data.index);
    if (!source || !Number.isFinite(source.duration) || source.duration <= 0 || source.tracks < 1) throw Error('原生动画不存在或没有可播放内容');
    if (data.motion && !nodes.some(n => n.path === data.motion!.node)) throw Error('走位参考点不存在于源模型');
}
/** Half-open timeline interval, preserving source offset across split/move/trim. */
export function nativeSample(entity: Entity, time: number) {
    const clip = entity.clips.find(c => c.action === 'native' && c.start <= time && time < c.end);
    return clip ? { index: clip.native!.index, loop: clip.native!.loop, time: (time - clip.start) * clip.speed + (clip.offset ?? 0), ...(clip.native!.motion ? { motion: { ...clip.native!.motion } } : {}) } : null;
}
export function nativeSourceTime(time: number, duration: number, loop: boolean) {
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(duration) || duration <= 0) throw Error('原生动画采样时间或时长无效');
    return loop ? time % duration : Math.min(time, duration);
}
