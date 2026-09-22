import { clone, uid, type Project } from '../model.ts';
import { assertResourceHeader, type ModelResource } from '../resources/project-resources.ts';
import { assertRigDefinition, rigStatus } from '../resources/rig-definition.ts';
import { canRetarget, type RetargetAnimation } from '../resources/retarget-animation.ts';

export interface UserMotion {
    id: string;
    name: string;
    duration: number;
    data: RetargetAnimation;
}
export interface UserMotionAsset { motion: UserMotion; resource: ModelResource }
export type UserMotionResolver = (id: string) => Promise<UserMotionAsset>;
export const userMotionId = (resourceId: string, index: number) => `user-motion:${resourceId}:${index}`;
export const isUserMotion = (id = '') => id.startsWith('user-motion:');
export function assertUserMotion(motion: UserMotion) {
    if (!motion || typeof motion.name !== 'string' || !motion.name.trim() || motion.name.length > 100
        || !Number.isFinite(motion.duration) || motion.duration <= 0 || !motion.data) throw Error('用户动作名称或时长无效');
    const data = motion.data;
    if (!/^model-[a-f0-9]{64}$/.test(data.resourceId) || !Number.isInteger(data.index) || data.index < 0
        || motion.id !== userMotionId(data.resourceId, data.index) || typeof data.loop !== 'boolean'
        || !Number.isFinite(data.unitScale) || data.unitScale <= 0 || data.unitScale > 10000
        || !Array.isArray(data.orientation) || data.orientation.length !== 3 || !data.orientation.every(Number.isFinite)) throw Error('用户动作参数无效');
    assertRigDefinition(data.rig, data.referencePose);
    if (data.motion && (data.motion.mode !== 'inPlace' || typeof data.motion.node !== 'string')) throw Error('动作走位设置无效');
}
export function includeUserMotionResource(project: Project, asset: UserMotionAsset) {
    assertUserMotion(asset.motion); assertResourceHeader(asset.resource);
    if (asset.resource.id !== asset.motion.data.resourceId) throw Error('动作和源资源不匹配');
    project.version = 2; project.resources ??= [];
    const old = project.resources.find(r => r.id === asset.resource.id);
    if (old && JSON.stringify(old.package) !== JSON.stringify(asset.resource.package)) throw Error('相同动作资源标识对应不同内容');
    if (!old) project.resources.push(clone(asset.resource));
}
/** Same portable retarget clip as built-in materials; no dependency on the local library after insertion. */
export function insertUserMotion(project: Project, entityId: string, motion: UserMotion, at: number, requestedDuration?: number) {
    assertUserMotion(motion);
    const target = project.entities.find(e => e.id === entityId);
    if (!target) throw Error('动作目标不存在');
    if (target.locked) throw Error('对象已锁定');
    if (!canRetarget(target)) throw Error('请选择内置人物、群演或已映射的导入人物');
    if (!rigStatus(motion.data.rig).complete) throw Error('请先补齐来源动作的人形骨架映射');
    if (!Number.isFinite(at) || at < 0 || (requestedDuration !== undefined && (!Number.isFinite(requestedDuration) || requestedDuration <= 0))) throw Error('动作时间或时长无效');
    const duration = Math.max(1, Math.ceil((requestedDuration ?? motion.duration) * project.fps)) / project.fps;
    let start = Math.round(at * project.fps) / project.fps;
    for (const clip of [...target.clips].sort((a, b) => a.start - b.start)) {
        if (start + duration <= clip.start) break;
        if (start < clip.end) start = Math.ceil(clip.end * project.fps) / project.fps;
    }
    target.clips.push({ id: uid(), name: motion.name, action: 'retarget', start, end: start + duration, speed: 1, retarget: clone(motion.data) });
    target.clips.sort((a, b) => a.start - b.start); project.duration = Math.max(project.duration, start + duration);
}
