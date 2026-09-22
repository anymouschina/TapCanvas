import type { ModelPackage } from './model-package.ts';
import { assertResourcePackage } from './package-validation.ts';
import type { Entity, Project, Vec3 } from '../model.ts';
import { assertRigDefinition, rigStatus, type HumanoidRig, type ModelRestPose } from './rig-definition.ts';
import { assertModelNodeEdits, type ModelNodeEdits } from './model-node-edits.ts';
export interface ModelResource {
    id: string;
    name: string;
    package: ModelPackage;
    copyright: string;
    license: string;
    source: string;
}
export interface ExternalModel {
    nodeEdits?: ModelNodeEdits;
    resourceId: string;
    appearance: 'original' | 'white' | 'color';
    unitScale: number;
    orientation: Vec3;
    rig?: HumanoidRig;
    defaultPose?: ModelRestPose;
}
export const isExternalModel = (entity: Entity) => entity.asset === 'external-model';

export async function modelResourceId(data: ModelPackage): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return 'model-' + [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function assertResourceHeader(resource: ModelResource) {
    if (!resource || typeof resource.id !== 'string' || !/^model-[0-9a-f]{64}$/.test(resource.id)) throw Error('模型资源标识无效');
    if ([resource.name, resource.copyright, resource.license, resource.source].some(value => typeof value !== 'string' || value.length > 10000)) throw Error('模型资源名称或来源信息无效');
}
export function assertModelResources(project: Project) {
    if (project.resources === undefined) return;
    if (project.version !== 2 || !Array.isArray(project.resources)) throw Error('外部模型资源需要第 2 版工程格式');
    const ids = new Set<string>();
    for (const resource of project.resources) {
        assertResourceHeader(resource);
        if (ids.has(resource.id)) throw Error('模型资源标识重复');
        assertResourcePackage(resource.id, resource.package); ids.add(resource.id);
    }
}
export function assertExternalModel(entity: Entity, project: Project) {
    if (!isExternalModel(entity)) { if (entity.external !== undefined) throw Error('内置白模不能包含外部资源引用'); return; }
    const data = entity.external;
    if (project.version !== 2 || !['actor', 'prop'].includes(entity.kind) || !data || !project.resources?.some(r => r.id === data.resourceId)) throw Error('外部模型资源不存在或实体类型错误');
    if (!['original', 'white', 'color'].includes(data.appearance) || !Number.isFinite(data.unitScale) || data.unitScale <= 0 || data.unitScale > 10000 || !Array.isArray(data.orientation) || data.orientation.length !== 3 || !data.orientation.every(Number.isFinite)) throw Error('外部模型尺寸校正或显示参数无效');
    assertRigDefinition(data.rig, data.defaultPose);
    assertModelNodeEdits(data.nodeEdits);
    if (data.rig && entity.kind !== 'actor') throw Error('人形骨骼映射需用于人物实例');
    if (entity.clips.some(c => !['idle', 'native', 'retarget'].includes(c.action)) && (entity.kind !== 'actor' || !rigStatus(data.rig).complete)) throw Error('基础动作预设需要完整人形骨架');
    if (Object.keys(entity.pose).length || entity.poseKeys.some(key => Object.keys(key.pose).length) || entity.footContact || entity.assetParameters !== undefined || entity.parameters !== undefined) throw Error('导入模型不支持旧白模关节键或专用形状参数，请使用骨架默认姿态和动作片段');
}
