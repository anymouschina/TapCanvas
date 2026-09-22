import type { Project } from '../model.ts';

export function resourceUsage(project: Pick<Project, 'entities' | 'resources'>) {
    const uses = new Map<string, { entityIds: string[]; motionClips: { entityId: string; clipId: string }[] }>();
    const entry = (id: string) => { if (!uses.has(id)) uses.set(id, { entityIds: [], motionClips: [] }); return uses.get(id)!; };
    for (const e of project.entities) {
        if (e.external) entry(e.external.resourceId).entityIds.push(e.id);
        for (const c of e.clips) if (c.retarget) entry(c.retarget.resourceId).motionClips.push({ entityId: e.id, clipId: c.id });
    }
    for (const r of project.resources ?? []) entry(r.id);
    return [...uses].map(([id, refs]) => {
        const resource = project.resources?.find(r => r.id === id);
        const sourceBytes = resource?.package.files.reduce((sum, f) => sum + f.data.length / 4 * 3 - (f.data.endsWith('==') ? 2 : f.data.endsWith('=') ? 1 : 0), 0) ?? 0;
        return { id, name: resource?.name ?? id, missing: !resource, files: resource?.package.files.length ?? 0, sourceBytes,
            ...refs, used: !!(refs.entityIds.length || refs.motionClips.length) };
    });
}

/** Called within the shared editing transaction; source bytes/IDs remain immutable. */
export function editResourceMetadata(project: Project, id: string, patch: Record<string, unknown> | undefined) {
    const resource = project.resources?.find(r => r.id === id); if (!resource) throw Error('模型资源不存在');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['name', 'copyright', 'license', 'source'].includes(key))) throw Error('只允许编辑资源名称、版权、许可和来源备注');
    for (const [key, value] of Object.entries(patch)) {
        if (typeof value !== 'string' || value.length > 10000) throw Error('资源备注格式无效或过长');
        resource[key as 'name' | 'copyright' | 'license' | 'source'] = value;
    }
}

export function removeUnusedResource(project: Project, id: string) {
    const usage = resourceUsage(project).find(r => r.id === id);
    if (!usage || usage.missing) throw Error('模型资源不存在');
    if (usage.used) throw Error('资源仍被模型实例或适配动作使用，请先替换或删除引用');
    project.resources = project.resources!.filter(r => r.id !== id);
}
