import { ASSETS } from '../asset-catalog.ts';
import { assertProject, clone, entity, type Entity, type Project, type Vec3 } from '../model.ts';
import { assertLockedEntitiesUnchanged } from '../editor/invariants.ts';
import { includeMotionResources, insertBuiltinMotion } from '../animation/motion-presets.ts';
import { motionPreset } from '../animation/motion-catalog.ts';
import { includeUserMotionResource, insertUserMotion, isUserMotion, type UserMotionAsset } from '../animation/user-motion.ts';
import { syncStructureLinks } from '../building/structure-links.ts';
import { syncFloorElevations } from '../building/floors.ts';
import { removeCameraVisibilityReference } from '../scenes/camera-visibility.ts';
import { replaceProp, type ReplacePropOptions } from '../resources/replace-prop.ts';
import { editResourceMetadata, removeUnusedResource } from '../resources/resource-usage.ts';
import { parameterDefaults } from '../parametric-props.ts';
import { assertProductionShape } from '../production/validation.ts';
import { applyCameraMotion, type CameraMotionOptions } from '../cinematography/motion-presets.ts';
import { lightingPreset } from '../lighting/presets.ts';
export interface EditOperation { operation: string; id?: string; asset?: string; kind?: 'actor' | 'prop'; name?: string; position?: Vec3; time?: number; duration?: number; patch?: Record<string, unknown>; value?: unknown }
const editable = new Set(['warp','visual','field','deform','surface', 'light', 'floorId', 'structureLink', 'handBinding', 'contactAnchors', 'external', 'name', 'color', 'position', 'rotation', 'scale', 'visible', 'height', 'build', 'gender', 'path', 'face', 'faceTarget', 'clips', 'pose', 'poseKeys', 'camera', 'count', 'spacing', 'seed', 'reference', 'parameters', 'assetParameters', 'actionBlend', 'footContact']);
function patch(target: object, value: Record<string, unknown> | undefined, allowed: Set<string>) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('patch 必须是对象');
    for (const key of Object.keys(value)) { if (!allowed.has(key)) throw new Error('不允许修改字段：' + key); Object.assign(target, { [key]: clone(value[key]) }); }
}
function patchEntity(target: Entity, value: Record<string, unknown> | undefined) {
    if (value && Object.hasOwn(value, 'camera') && target.kind === 'camera') {
        const camera = value.camera;
        if (!camera || typeof camera !== 'object' || Array.isArray(camera)) throw Error('patch.camera 必须是摄影机参数对象');
        const allowedCamera = new Set(['aim', 'aimResponse', 'focal', 'target', 'targetId', 'targetHeight', 'mode', 'offset', 'inheritRotation', 'targetPath', 'hideWalls', 'hiddenEntityIds', 'effects']);
        for (const key of Object.keys(camera)) if (!allowedCamera.has(key)) throw Error('不支持摄影机字段：patch.camera.' + key);
        value = { ...value, camera: { ...target.camera, ...camera } };
    }
    const definition = ASSETS.find(a => a.id === target.asset);
    if (value && Object.hasOwn(value, 'parameters') && !Object.hasOwn(parameterDefaults, target.asset))
        throw Error(definition?.parameters ? `资产 ${target.asset} 的尺寸参数应写入 patch.assetParameters，不能使用 patch.parameters；用 director_assets 的 ids 与 details:true 查询字段和范围。`
            : `资产 ${target.asset} 不支持 patch.parameters；请查询资产详情，使用受支持字段或 patch.scale 调整尺寸。`);
    if (value && Object.hasOwn(value, 'assetParameters') && !definition?.parameters)
        throw Error(Object.hasOwn(parameterDefaults, target.asset) ? `资产 ${target.asset} 使用 patch.parameters，而非 patch.assetParameters。`
            : `资产 ${target.asset} 没有可编辑的 assetParameters；请查询资产详情或使用 patch.scale。`);
    patch(target, value, editable);
}
export function applyOperations(original: Project, operations: EditOperation[], userMotions: ReadonlyMap<string, UserMotionAsset> = new Map()): Project {
    if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new Error('每批需要 1—100 个操作');
    const project = clone(original);
    for (const [index, op] of operations.entries()) {
        try {
        if (!op || typeof op !== 'object') throw new Error('操作格式错误');
        if (op.operation === 'add') {
            const asset = ASSETS.find(a => a.id === op.asset);
            const resource = project.resources?.find(r => r.id === op.asset);
            if (!asset && !resource && op.asset !== 'camera') throw new Error('未知资产，请先查询资产目录或工程资源');
            if (op.kind !== undefined && (!resource || !['actor', 'prop'].includes(op.kind))) throw Error('kind 仅用于指定导入资源的 actor／prop 用途');
            const e = entity(resource ? op.kind ?? 'prop' : asset?.kind ?? 'camera', resource ? 'external-model' : op.asset!, op.name || resource?.name || asset?.name || '摄影机', op.position);
            if (resource) e.external = { resourceId: resource.id, appearance: 'original', unitScale: 1, orientation: [0, 0, 0] };
            if (op.id) e.id = op.id;
            if (op.patch) patchEntity(e, op.patch);
            project.entities.push(e);
        } else if (op.operation === 'update') {
            const e = project.entities.find(e => e.id === op.id); if (!e) throw new Error('对象不存在');
            if (e.locked) throw new Error('对象已锁定'); patchEntity(e, op.patch);
        } else if (op.operation === 'clear-inherited-pose') {
            const e = project.entities.find(e => e.id === op.id); if (!e) throw Error('对象不存在');
            if (e.locked) throw Error('对象已锁定'); delete e.initialPose;
        } else if (op.operation === 'remove') {
            const e = project.entities.find(e => e.id === op.id); if (!e) throw new Error('对象不存在');
            if (e.locked) throw new Error('对象已锁定');
            if (project.cuts.some(c => c.cameraId === e.id) || project.entities.some(x => x.id !== e.id && (x.faceTarget === e.id || x.camera?.targetId === e.id || x.handBinding?.actorId === e.id || x.structureLink?.parentId === e.id))) throw new Error('对象被切镜、跟随或模块连接引用，请先在同批前序操作中解除引用');
            project.entities = project.entities.filter(x => x.id !== e.id);
            removeCameraVisibilityReference(project, e.id);
            if (project.editorView) project.editorView.hiddenEntityIds = project.editorView.hiddenEntityIds.filter(id => id !== e.id);
            project.production?.notes.forEach(n => { if (n.actorId === e.id) n.actorId = ''; });
        } else if (op.operation === 'replace-prop') replaceProp(project, op.id ?? '', op.asset ?? '', op.patch as ReplacePropOptions | undefined);
        else if (op.operation === 'resource') editResourceMetadata(project, op.id ?? '', op.patch);
        else if (op.operation === 'resource-remove') removeUnusedResource(project, op.id ?? '');
        else if (op.operation === 'motion') {
            if (isUserMotion(op.asset)) {
                const asset = userMotions.get(op.asset!); if (!asset) throw Error('用户动作不可用；在线请查询用户动作库，离线请使用嵌入资源和 retarget 片段');
                insertUserMotion(project, op.id ?? '', asset.motion, op.time ?? 0, op.duration);
            } else insertBuiltinMotion(project, op.id ?? '', op.asset ?? '', op.time ?? 0, op.duration);
        }
        else if (op.operation === 'camera-motion') applyCameraMotion(project, op.id ?? '', op.asset ?? '', op.time ?? 0, op.duration ?? 5, op.patch as CameraMotionOptions | undefined);
        else if (op.operation === 'lighting-preset') project.lighting = lightingPreset(op.asset ?? '');
        else if (op.operation === 'project') patch(project, op.patch, new Set(['name', 'duration', 'fps', 'aspect', 'room', 'floors', 'zones', 'editorView', 'creationMode', 'referenceLabels', 'lighting', 'media']));
        else if (op.operation === 'cuts') project.cuts = clone(op.value) as Project['cuts'];
        else if (op.operation === 'notes') { assertProductionShape(op.value); project.production = clone(op.value); }
        else throw new Error('未知操作');
        } catch (error) { throw new Error(`operations[${index}]: ${error instanceof Error ? error.message : '操作失败'}`); }
    }
    syncFloorElevations(project, original); syncStructureLinks(project, original);
    assertLockedEntitiesUnchanged(original, project); assertProject(project); return project;
}
export async function applyOperationsWithResources(original: Project, operations: EditOperation[], userMotions: ReadonlyMap<string, UserMotionAsset> = new Map()) {
    if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw Error('每批需要 1—100 个操作');
    let prepared = operations.some(op => op?.operation === 'motion' && !isUserMotion(op.asset) && !motionPreset(op.asset ?? '').basicAction) ? await includeMotionResources(original) : original;
    if (operations.some(op => op?.operation === 'motion' && isUserMotion(op.asset))) {
        prepared = clone(prepared);
        for (const op of operations) if (op.operation === 'motion' && isUserMotion(op.asset)) {
            const asset = userMotions.get(op.asset!); if (!asset) throw Error('用户动作不可用，请重新查询用户动作库');
            includeUserMotionResource(prepared, asset);
        }
    }
    return applyOperations(prepared, operations, userMotions);
}
export function changeSummary(before: Project, after: Project) {
    const old = new Map(before.entities.map(e => [e.id, e])), fresh = new Map(after.entities.map(e => [e.id, e]));
    return { hasChanges: JSON.stringify(before) !== JSON.stringify(after), added: after.entities.filter(e => !old.has(e.id)).map(e => ({ id: e.id, name: e.name })),
        updated: after.entities.filter(e => old.has(e.id) && JSON.stringify(old.get(e.id)) !== JSON.stringify(e)).map(e => ({ id: e.id, name: e.name })),
        removed: before.entities.filter(e => !fresh.has(e.id)).map((e: Entity) => ({ id: e.id, name: e.name })),
        projectChanged: ['name', 'duration', 'fps', 'aspect', 'room', 'cuts', 'production', 'floors', 'zones', 'editorView', 'resources', 'creationMode', 'referenceLabels', 'lighting'].some(k => JSON.stringify(before[k as keyof Project]) !== JSON.stringify(after[k as keyof Project])) };
}
