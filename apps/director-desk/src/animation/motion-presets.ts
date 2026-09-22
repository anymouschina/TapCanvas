import { clone, uid, type Project } from '../model.ts';
import { modelResourceId, type ModelResource } from '../resources/project-resources.ts';
import { canRetarget } from '../resources/retarget-animation.ts';
import { BUILTIN_MOTION_RESOURCE_ID, builtinMotionRig, motionPreset } from './motion-catalog.ts';

/** Lazy in the web build; embedded in the standalone offline helper. Never fetches an external service. */
export async function includeMotionResources(original: Project): Promise<Project> {
    if (original.resources?.some(r => r.id === BUILTIN_MOTION_RESOURCE_ID)) return original;
    const { default: packaged } = await import('./library/humanoid-v1.ts');
    const resource = structuredClone(packaged) as ModelResource;
    if (resource.id !== BUILTIN_MOTION_RESOURCE_ID || await modelResourceId(resource.package) !== resource.id) throw Error('内置动作库校验失败');
    const project = clone(original); project.version = 2; project.resources ??= []; project.resources.push(resource); return project;
}

/** Mutates only the transaction's private project. Resource loading belongs before transaction evaluation. */
export function insertBuiltinMotion(project: Project, entityId: string, presetId: string, at: number, requestedDuration?: number) {
    const entity = project.entities.find(e => e.id === entityId); if (!entity) throw Error('动作目标不存在');
    if (entity.locked) throw Error('对象已锁定'); if (!canRetarget(entity)) throw Error('内置动作需要完整人形骨架');
    const preset = motionPreset(presetId);
    if (!Number.isFinite(at) || at < 0) throw Error('动作开始时间必须为非负秒数');
    if (!preset.basicAction && !project.resources?.some(r => r.id === BUILTIN_MOTION_RESOURCE_ID)) throw Error('请通过异步工程操作准备内置动作资源');
    if (requestedDuration !== undefined && (!Number.isFinite(requestedDuration) || requestedDuration <= 0)) throw Error('动作 duration 必须是正秒数');
    const duration = Math.max(1, Math.ceil((requestedDuration ?? preset.defaultDuration) * project.fps)) / project.fps;
    let start = Math.round(at * project.fps) / project.fps;
    for (const clip of [...entity.clips].sort((a, b) => a.start - b.start)) {
        if (start + duration <= clip.start) break;
        if (start < clip.end) start = Math.ceil(clip.end * project.fps) / project.fps;
    }
    const rig = builtinMotionRig();
    entity.clips.push(preset.basicAction ? { id: uid(), action: preset.basicAction, start, end: start + duration, speed: 1 } : { id: uid(), action: 'retarget', start, end: start + duration, speed: 1,
        retarget: { resourceId: BUILTIN_MOTION_RESOURCE_ID, index: preset.index!, loop: preset.loop, rig, unitScale: 1, orientation: [0, 0, 0], blend: .2,
            ...(preset.group === '移动' ? { motion: { mode: 'inPlace', node: rig.bones.hips! } as const } : {}) } });
    entity.clips.sort((a, b) => a.start - b.start); project.duration = Math.max(project.duration, start + duration);
}
