import { Object3D, Quaternion, Vector3 } from 'three';
import { zonesAt } from '../building/zones.ts';
import { inheritedPoseAt } from '../scenes/initial-pose.ts';
import { isAnimalAsset } from '../asset-catalog.ts';
import { worldContactAnchors } from '../assets/contact-anchors.ts';
import { worldStructurePorts } from '../building/structure-ports.ts';
import { staticStructure } from '../building/structure-links.ts';
import { shotEntityVisible } from '../scenes/camera-visibility.ts';
import type { Engine } from '../engine.ts';
import type { Action, Entity, Vec3 } from '../model.ts';
import { nativeSample, nativeSourceTime } from '../resources/native-animation.ts';
import { crowdAnimationPhase } from '../resources/retarget-animation.ts';
import { retargetClipTime, locomotionPlaybackRate } from '../animation/locomotion.ts';
import { activeClip, sampledAction } from '../timeline.ts';
import type { FootGroundingState } from '../animation/foot-grounding.ts';
import type { MotionTransitionPlan } from '../animation/transition-plan.ts';
import type { FootPlantState } from '../animation/foot-plant.ts';
import { visibilityChecks, type VisibilityResult } from './visibility.ts';
import { boundsData, boxRelationship, frameBounds, geometryBounds, type BoundsData, type FrameData } from './geometry.ts';

export interface SpatialOptions { time?: number; cameraId?: string; includeCrowdMembers?: boolean; occlusionKeys?: string[] }
export interface SpatialObject {
    zoneIds?: string[];
    key: string;
    entityId: string | null;
    floorId?: string;
    memberIndex: number | null;
    handBinding?: Entity['handBinding'];
    structureLink?: Entity['structureLink'];
    structurePorts?: ReturnType<typeof worldStructurePorts>;
    rotationRadians?: Vec3;
    name: string;
    kind: Entity['kind'] | 'crowd-member' | 'room';
    asset: string;
    enabled: boolean;
    origin: Vec3;
    forward: Vec3;
    headingDegrees: number | null;
    action: Action | 'native' | 'retarget' | 'held' | null;
    inheritedPose?: { active: boolean; nodeCount: number };
    nativeAnimation?: { index: number; name: string; sourceTime: number; duration: number; loop: boolean; motion: 'source' | 'inPlace'; rootMotion?: { node: string; anchorWorld: Vec3; removedWorld: Vec3 } };
    retargetAnimation?: { resourceId: string; index: number; name: string; sourceTime: number; duration: number; loop: boolean; motion: 'source' | 'inPlace'; locomotion?: { mode: 'distance'; cycleDistance: number; playbackRate: number; warning: 'too-fast' | 'too-slow' | null } };
    bounds: BoundsData | null;
    footGrounding?: FootGroundingState;
    footPlant?: FootPlantState[];
    motionTransition?: MotionTransitionPlan;
    framing: FrameData;
    visibility?: VisibilityResult;
    contactAnchors?: { id: string; role: string; position: Vec3; normal: Vec3 }[];
}
export interface SpatialReport {
    format: 'director-spatial-report'; version: 1;
    projectName: string; time: number; duration: number; fps: number; aspect: string;
    coordinates: { unit: 'meter'; timeUnit: 'second'; angleUnit: 'degree'; axes: string; origin: string; forward: string; screen: string };
    camera: { id: string; name: string; position: Vec3; forward: Vec3; focal: number; hiddenWalls: string[]; hiddenEntityIds: string[]; hiddenHeadEntityId: string | null };
    counts: { entities: number; people: number; enabledPeople: number; animals?: number; enabledAnimals?: number; crowdMembersIncluded: boolean };
    objects: SpatialObject[];
    floors?: Engine['project']['floors'];
    zones?: Engine['project']['zones'];
    limitations: string[];
}

/** Read an already sampled scene. Query orchestration/restoration belongs to Engine. */
export function collectSpatialReport(engine: Engine, cameraId: string, includeCrowdMembers: boolean, occlusionKeys: string[] = []): SpatialReport {
    const p = engine.project, cameraEntity = engine.cameraEntity(cameraId), config = cameraEntity.camera!;
    const camera = engine.getShotCamera(cameraId), objects: SpatialObject[] = [];
    const hiddenHeadId = config.mode === 'pov' && engine.rigs.has(config.targetId) ? config.targetId : null;
    const direction = (root: Object3D) => new Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new Quaternion())).normalize();
    function item(root: Object3D, data: Pick<SpatialObject, 'key' | 'entityId' | 'memberIndex' | 'name' | 'kind' | 'asset' | 'enabled' | 'action'>, forward = direction(root), excluded?: Object3D) {
        const entity = p.entities.find(e => e.id === data.entityId);
        const enabled = data.enabled && (!entity || shotEntityVisible(p, entity, config));
        const box = data.kind === 'camera' || entity?.light ? null : geometryBounds(root);
        const shotBox = excluded ? geometryBounds(root, excluded) : box;
        const framing: FrameData = data.kind === 'camera' || entity?.light ? { status: 'not-rendered', rectangle: null, occlusion: 'not-checked' }
            : !enabled ? { status: 'hidden', rectangle: null, occlusion: 'not-checked' } : frameBounds(shotBox, camera);
        const contactAnchors = entity?.kind === 'prop' ? worldContactAnchors(entity, root) : undefined;
        const ports = entity && staticStructure(entity) ? worldStructurePorts(entity) : [];
        objects.push({ ...data, enabled, ...(ports.length ? { structurePorts: ports, structureLink: entity?.structureLink ? structuredClone(entity.structureLink) : null } : {}), ...(entity?.handBinding ? { handBinding: structuredClone(entity.handBinding), rotationRadians: [root.rotation.x, root.rotation.y, root.rotation.z] as Vec3 } : {}), contactAnchors, origin: root.getWorldPosition(new Vector3()).toArray(), forward: forward.toArray(),
            headingDegrees: Math.hypot(forward.x, forward.z) < 1e-7 ? null : Math.atan2(forward.x, forward.z) * 180 / Math.PI,
            bounds: box ? boundsData(box) : null, framing });
        if (entity?.floorId) objects.at(-1)!.floorId = entity.floorId;
        if (p.zones?.length) objects.at(-1)!.zoneIds = zonesAt(p, objects.at(-1)!.origin);
        if (entity?.initialPose) {
            const active = inheritedPoseAt(entity, engine.time);
            objects.at(-1)!.inheritedPose = { active, nodeCount: entity.initialPose.nodes.length };
            if (active) objects.at(-1)!.action = 'held';
        }
    }
    for (const e of p.entities) {
        const root = e.kind === 'camera' ? engine.cameras.get(e.id)! : engine.models.get(e.id)!;
        const rig = engine.rigs.get(e.id);
        item(root, { key: `entity:${e.id}`, entityId: e.id, memberIndex: null, name: e.name, kind: e.kind, asset: e.asset, enabled: e.visible,
            action: e.kind === 'actor' || e.kind === 'crowd' ? sampledAction(e, engine.time).action : null },
            e.kind === 'camera' ? root.getWorldDirection(new Vector3()) : direction(rig?.hips ?? root), hiddenHeadId === e.id ? rig?.head : undefined);
        const sample = e.external ? nativeSample(e, engine.time) : null;
        if (sample) {
            const source = engine.externalModels.inspection(p.resources!.find(r => r.id === e.external!.resourceId)!).animations.find(a => a.index === sample.index)!;
            const object = objects.at(-1)!; object.action = 'native';
            object.nativeAnimation = { index: sample.index, name: source.name, sourceTime: nativeSourceTime(sample.time, source.duration, sample.loop), duration: source.duration, loop: sample.loop, motion: sample.motion?.mode ?? 'source', ...(sample.motion ? { rootMotion: engine.externalModels.motionState(e.id)! } : {}) };
        }
        const retarget = activeClip(e, engine.time);
        const annotateRetarget = (phase = 0) => {
            if (!retarget?.retarget) return;
            const data = retarget.retarget, source = engine.externalModels.inspection(p.resources!.find(r => r.id === data.resourceId)!).animations.find(a => a.index === data.index)!;
            const rate = locomotionPlaybackRate(e, retarget, engine.time, source.duration);
            objects.at(-1)!.retargetAnimation = { resourceId: data.resourceId, index: data.index, name: source.name, duration: source.duration,
                sourceTime: nativeSourceTime(retargetClipTime(e, retarget, engine.time, source.duration) + (data.loop ? phase : 0), source.duration, data.loop), loop: data.loop, motion: data.motion?.mode ?? 'source',
                ...(data.locomotion ? { locomotion: { ...data.locomotion, playbackRate: rate, warning: rate > 3 ? 'too-fast' : rate > 1e-6 && rate < .25 ? 'too-slow' : null } } : {}) };
        };
        annotateRetarget();
        const contact = engine.externalModels.humanContactState(e.id); if (contact) objects.at(-1)!.footGrounding = contact;
        const plants = engine.externalModels.humanPlantState(e.id); if (plants) objects.at(-1)!.footPlant = plants;
        const transition = engine.externalModels.motionTransitionState(e.id); if (transition) objects.at(-1)!.motionTransition = transition;
        if (includeCrowdMembers && e.kind === 'crowd') engine.crowdRigs.get(e.id)!.forEach((r, index) => { item(r.root, {
            key: `crowd:${e.id}:${index}`, entityId: e.id, memberIndex: index, name: `${e.name} / 第 ${index + 1} 人`,
            kind: 'crowd-member', asset: 'person', enabled: e.visible, action: sampledAction(e, engine.time).action
        }, direction(r.hips)); annotateRetarget(crowdAnimationPhase(e.seed, index));
            const contact = engine.externalModels.humanContactState(`${e.id}:${index}`); if (contact) objects.at(-1)!.footGrounding = contact;
            const plants = engine.externalModels.humanPlantState(`${e.id}:${index}`); if (plants) objects.at(-1)!.footPlant = plants;
            const transition = engine.externalModels.motionTransitionState(`${e.id}:${index}`); if (transition) objects.at(-1)!.motionTransition = transition;
        });
    }
    const wallNames: Record<string, string> = { north: '北墙（−Z）', south: '南墙（+Z）', east: '东墙（+X）', west: '西墙（−X）', ceiling: '天花板' };
    if (p.room.enabled) {
        for (const [side, root] of engine.walls) item(root, { key: `room:${side}`, entityId: null, memberIndex: null, name: wallNames[side],
            kind: 'room', asset: side, enabled: !config.hideWalls.includes(side), action: null });
        const wallRoots = new Set<Object3D>(engine.walls.values());
        const floor = engine.roomGroup.children.find(root => !wallRoots.has(root));
        if (floor) item(floor, { key: 'room:floor', entityId: null, memberIndex: null, name: '房间地板', kind: 'room', asset: 'floor', enabled: true, action: null });
    }
    if (occlusionKeys.some(key => !objects.some(o => o.key === key && o.kind !== 'camera'))) throw new Error('遮挡查询对象不存在，或对象是摄影机');
    const visibility = visibilityChecks(engine, cameraId, occlusionKeys);
    for (const object of objects) if (visibility.has(object.key)) { object.visibility = visibility.get(object.key); object.framing.occlusion = 'sampled'; }
    const people = p.entities.filter(e => (e.kind === 'actor' || e.kind === 'crowd') && !isAnimalAsset(e.asset));
    const animals = p.entities.filter(e => isAnimalAsset(e.asset));
    return {
        format: 'director-spatial-report', version: 1, projectName: p.name, time: engine.time, duration: p.duration, fps: p.fps, aspect: p.aspect,
        coordinates: { unit: 'meter', timeUnit: 'second', angleUnit: 'degree', axes: '右手坐标系；+Y 向上；+X、+Z 为世界轴，不能直接解释成画面右侧或人物前方。',
            origin: '对象根节点位置；摄影机使用实际取景位置；不是包围盒中心，也不保证是脚底。',
            forward: '内置人物为当前髋部局部 +Z 的世界方向（包含转身动作）；摄影机为光轴 −Z；道具和导入模型为根节点局部 +Z，不推断源骨骼或模型的语义正面。headingDegrees 从世界 +Z 朝 +X 为正。',
            screen: 'rectangle 为裁切到画幅内的包围盒投影；左上角 (0,0)，右下角 (1,1)。' },
        camera: { id: cameraEntity.id, name: cameraEntity.name, position: camera.getWorldPosition(new Vector3()).toArray(), forward: camera.getWorldDirection(new Vector3()).toArray(),
            focal: camera.getFocalLength(), hiddenWalls: [...config.hideWalls], hiddenEntityIds: [...(config.hiddenEntityIds ?? [])], hiddenHeadEntityId: hiddenHeadId },
        counts: { entities: p.entities.length, people: people.reduce((sum, e) => sum + (e.kind === 'crowd' ? e.count : 1), 0),
            enabledPeople: people.filter(e => shotEntityVisible(p, e, config)).reduce((sum, e) => sum + (e.kind === 'crowd' ? e.count : 1), 0), animals: animals.length, enabledAnimals: animals.filter(e => shotEntityVisible(p, e, config)).length, crowdMembersIncluded: includeCrowdMembers },
        objects, floors: p.floors ? structuredClone(p.floors) : undefined, zones: p.zones ? structuredClone(p.zones) : undefined,
        limitations: ['边界为当前几何顶点的世界轴对齐包围盒，包含姿态、旋转和缩放；群演组边界包含成员之间的空隙。', '开启镜头畸变时，入画范围为畸变后包围边界采样估计；遮挡射线使用同一畸变的逆投影。景深模糊不算几何遮挡。',
            '包围盒重叠仅表示可能接近或相交，不是身体或道具碰撞结论。',
            '入画检查包围盒与摄影机视锥；仅 visibility 字段存在的对象进行了身体和脸部朝向／射线采样检查，其他对象遮挡未检查。采样结果不代表像素面积或画面美感。',
            '仅检查指定时刻；没有进行整段路径碰撞或自动避障检查。']
    };
}

export function spatialRelationship(report: SpatialReport, aKey: string, bKey: string) {
    if (aKey === bKey) throw new Error('请选择两个不同对象');
    const a = report.objects.find(o => o.key === aKey), b = report.objects.find(o => o.key === bKey);
    if (!a || !b) throw new Error('比较对象不在此报告中，请重新查询');
    const delta = new Vector3(...b.origin).sub(new Vector3(...a.origin));
    const forward = new Vector3(a.forward[0], 0, a.forward[2]);
    const horizontal = Math.hypot(delta.x, delta.z);
    const dot = forward.lengthSq() > 1e-12 && horizontal > 1e-6 ? forward.normalize().dot(new Vector3(delta.x, 0, delta.z).normalize()) : null;
    return { aKey, bKey, deltaWorld: delta.toArray() as Vec3, originDistance: delta.length(), groundDistance: horizontal, heightDifference: delta.y,
        angleFromAForward: dot === null ? null : Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI,
        bounds: a.bounds && b.bounds ? boxRelationship(a.bounds, b.bounds) : null,
        obstruction: 'not-checked' as const };
}
