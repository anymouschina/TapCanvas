import { editorSelection } from '../editor/timeline-selection.ts';
import type { AppContext } from '../app-context.ts';
import { geometryCreationGuide } from '../assets/creation-mode.ts';
import { structurePorts, worldStructurePorts } from '../building/structure-ports.ts';
import { clone } from '../model.ts';
import { productionData } from '../production/notes.ts';
import { sceneResourceReport } from '../resources/render-statistics.ts';
import { resourceUsage } from '../resources/resource-usage.ts';
import { inheritedPoseAt } from '../scenes/initial-pose.ts';
import { BUILTIN_SKILL } from './skill.ts';

import { READ_SECTIONS, type ReadSection, type SceneReadOptions } from './read-sections.ts';
export type { SceneReadOptions } from './read-sections.ts';

/** Select before computing/serializing: detailed object reads never trigger global render statistics. */
export function readScene(ctx: AppContext, revision: number, args: SceneReadOptions) {
    const requested = args.sections ?? (args.resourceId ? ['resources'] : ['entities']);
    const sections = new Set<ReadSection>(requested.includes('all') ? READ_SECTIONS : requested as ReadSection[]);
    if (args.resourceId !== undefined) sections.add('resources');
    const resource = args.resourceId === undefined ? undefined : ctx.project.resources?.find(r => r.id === args.resourceId);
    if (args.resourceId !== undefined && !resource) throw Error('模型资源不存在');
    const project = ctx.project;
    const result: Record<string, unknown> = {
        revision, sceneContext: ctx.scenes?.context, name: project.name,
        duration: project.duration, fps: project.fps, aspect: project.aspect,
        time: ctx.time, cameraId: ctx.preview, selectedId: ctx.selected,
        referenceLabels: project.referenceLabels ?? false, creationMode: project.creationMode ?? 'full',
        ...(project.creationMode === 'geometry' ? { geometry: geometryCreationGuide() } : {}),
        skill: { name: BUILTIN_SKILL.name, version: BUILTIN_SKILL.version },
        sections: [...sections], entityCount: project.entities.length,
        omitted: '未请求的分区未返回，不代表内容为空；不要据此清空已有数据。',
        coordinates: '米／秒；工程 rotation 为弧度，世界 +Y 向上，人物 +Z 为前；当前动画位置应查询 spatial。图片字节未发送。',
    };
    if (sections.has('selection')) result.selection = editorSelection(project, ctx.selected);
    if (sections.has('entities')) {
        const entities = project.entities.filter(e => !args.ids || args.ids.includes(e.id));
        result.entities = entities.map(e => args.details ? {
            ...clone(e), ...(e.initialPose ? { initialPose: { active: inheritedPoseAt(e, ctx.time), nodeCount: e.initialPose.nodes.length,
                description: '接拍姿态；原始节点数组保存在工程文件中，新动作开始后不再保持' } } : {}),
        } : { id: e.id, name: e.name, asset: e.asset, kind: e.kind, color: e.color, reference: e.reference, locked: e.locked, visible: e.visible, position: e.position });
        if (args.ids) result.missingIds = args.ids.filter(id => !entities.some(e => e.id === id));
        if (args.details) result.structureModules = entities.filter(e => structurePorts(e).length).map(e => ({
            id: e.id, localPorts: structurePorts(e), worldPorts: !e.path && !e.handBinding && !e.clips.length ? worldStructurePorts(e) : [], link: e.structureLink ?? null,
        }));
    }
    if (sections.has('scene')) Object.assign(result, { scenes: ctx.scenes?.list(), room: project.room, lighting: project.lighting,
        floors: project.floors ?? [], zones: project.zones ?? [], editorView: project.editorView });
    if (sections.has('cuts')) result.cuts = project.cuts;
    // Production remains complete so the existing whole-value notes operation can safely round-trip it.
    if (sections.has('production')) result.production = clone(productionData(project));
    if (sections.has('references')) result.references = project.references.map(({ id, name }) => ({ id, name }));
    if (sections.has('resources')) {
        result.resources = (project.resources ?? []).filter(r => !resource || r.id === resource.id).map(({ package: _package, ...metadata }) => metadata);
        if (!resource) result.media = (project.media ?? []).map(({ data: _data, ...metadata }) => metadata);
        if (args.details || resource) result.resourceUsage = resourceUsage(project).filter(r => !resource || r.id === resource.id).map(r => {
            const sceneReferences = ctx.scenes?.resourceScenes(r.id) ?? [];
            return { ...r, sceneReferences, used: ctx.scenes ? sceneReferences.length > 0 : r.used };
        });
        if (resource) result.model = ctx.engine.externalModels.inspection(resource);
    }
    if (sections.has('statistics')) Object.assign(result, { resourceStatistics: sceneResourceReport(ctx.engine), mediaRuntime: ctx.engine.surfaces.textures.statistics() });
    return result;
}
