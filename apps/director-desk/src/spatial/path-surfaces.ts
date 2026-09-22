import { Matrix3, Raycaster, type Object3D } from 'three';
import type { Entity, MotionPath, Project, Vec3 } from '../model.ts';
import { pathPosition } from '../timeline.ts';
import { geometryBounds } from './geometry.ts';
import type { Engine } from '../engine.ts';
import { modelNodeHidden } from '../resources/model-node-visibility.ts';

export const ROOM_FLOOR_SURFACE = '@room-floor';
export function pathSurfaceModels(engine: Pick<Engine, 'models' | 'roomGroup' | 'walls'>): Map<string, Object3D> {
    const models: Map<string, Object3D> = new Map(engine.models), walls = new Set<Object3D>(engine.walls.values());
    const floor = engine.roomGroup.children.find(root => !walls.has(root)); if (floor) models.set(ROOM_FLOOR_SURFACE, floor);
    return models;
}

export interface PathSurfaceOptions { entityId: string; surfaceId?: string; clearance?: number; tolerance?: number }
export interface PathSurfacePoint {
    sourceTime: number; waypointIndex: number | null; position: Vec3;
    status: 'on-surface' | 'above' | 'below' | 'ambiguous' | 'no-surface';
    candidates: { entityId: string; height: number }[]; suggested: Vec3 | null;
}
export interface PathSurfaceReport {
    entityId: string; options: PathSurfaceOptions; pathSnapshot: string; surfaceSnapshot: string;
    points: PathSurfacePoint[]; ignoredMovingIds: string[]; limitations: string[];
}
const surfaceKey = (project: Project) => JSON.stringify([project.room, project.entities.filter(e => e.kind === 'prop').map(e => [e.id, e.visible, e.asset, e.position, e.rotation, e.scale, e.parameters, e.assetParameters, e.external, e.path, e.clips, e.handBinding])]);
export function pathSurfaceSamples(path: MotionPath) {
    const curve = { smooth: path.smooth, interpolation: path.interpolation, points: path.points }, ranges = path.sections?.map(s => [s.from, s.to]) ?? [[path.points[0].time, path.points.at(-1)!.time]];
    const times = new Set<number>();
    for (const [start, end] of ranges) {
        const critical = [start, ...path.points.filter(p => p.time > start && p.time < end).map(p => p.time), end];
        for (let i = 0; i < critical.length; i++) {
            times.add(critical[i]); if (!i) continue;
            const a = critical[i - 1], b = critical[i], length = pathPosition(curve, [0, 0, 0], a).distanceTo(pathPosition(curve, [0, 0, 0], b));
            const steps = Math.max(4, Math.ceil(length / .1));
            if (steps + times.size > 2000) throw Error('本次路线表面检查超过 2000 个采样点，请分段检查或缩短路线');
            for (let j = 1; j < steps; j++) times.add(a + (b - a) * j / steps);
        }
    }
    return [...times].sort((a, b) => a - b).map(sourceTime => {
        const index = path.points.findIndex(p => Math.abs(p.time - sourceTime) < 1e-8);
        return { sourceTime, waypointIndex: index < 0 ? null : index, position: pathPosition(curve, [0, 0, 0], sourceTime).toArray() as Vec3 };
    });
}
/** Static building surfaces only. Read actual geometry without mutating scene, time or project. */
export function checkPathSurfaces(project: Project, models: Map<string, Object3D>, options: PathSurfaceOptions): PathSurfaceReport {
    const entity = project.entities.find(e => e.id === options.entityId), clearance = options.clearance ?? 0, tolerance = options.tolerance ?? .03;
    if (!entity?.path || entity.handBinding) throw Error('请选择有独立路径的对象');
    if (!Number.isFinite(clearance) || clearance < 0 || clearance > 100 || !Number.isFinite(tolerance) || tolerance < .001 || tolerance > 1) throw Error('净空需为 0—100 米，容差需为 0.001—1 米');
    const candidates = project.entities.filter(e => e.kind === 'prop' && !e.light && e.visible && e.id !== entity.id && (!options.surfaceId || e.id === options.surfaceId));
    const floor = project.room.enabled && (!options.surfaceId || options.surfaceId === ROOM_FLOOR_SURFACE) ? models.get(ROOM_FLOOR_SURFACE) : undefined;
    if (!candidates.length && !floor) throw Error('未找到指定的可见承托对象');
    const moving = (e: Entity) => !!e.path || !!e.handBinding || e.clips.some(c => c.action === 'native' || c.action === 'retarget');
    const ignoredMovingIds = candidates.filter(moving).map(e => e.id);
    const surfaces = candidates.filter(e => !moving(e)).map(e => { const root = models.get(e.id); if (!root) throw Error('承托模型尚未准备'); root.updateWorldMatrix(true, true); return { id: e.id, root, bounds: geometryBounds(root) }; });
    if (floor) { floor.updateWorldMatrix(true, true); surfaces.push({ id: ROOM_FLOOR_SURFACE, root: floor, bounds: geometryBounds(floor) }); }
    if (!surfaces.length) throw Error('此检查只处理静态建筑表面，请选择没有路径、手持或素材动画的承托道具');
    const ray = new Raycaster(); ray.ray.direction.set(0, -1, 0);
    const points: PathSurfacePoint[] = pathSurfaceSamples(entity.path).map(sample => {
        const hits: { entityId: string; height: number }[] = [], [x, y, z] = sample.position;
        for (const { id, root, bounds } of surfaces) {
            if (!bounds || x < bounds.min.x - 1e-6 || x > bounds.max.x + 1e-6 || z < bounds.min.z - 1e-6 || z > bounds.max.z + 1e-6) continue;
            ray.far = bounds.max.y - bounds.min.y + .02;
            const cast = (dx: number, dz: number) => {
                ray.ray.origin.set(x + dx, bounds.max.y + .01, z + dz);
                for (const h of ray.intersectObject(root, true)) {
                    if (modelNodeHidden(h.object)) continue;
                    if (!h.face || h.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(h.object.matrixWorld)).y < .5) continue;
                    if (!hits.some(v => v.entityId === id && Math.abs(v.height - h.point.y) < .001)) hits.push({ entityId: id, height: h.point.y });
                }
            };
            cast(0, 0);
            // Float32 mesh edges can leave numerical seams far smaller than the stated meter tolerance.
            if (!hits.some(h => h.entityId === id)) { cast(.00001, 0); cast(-.00001, 0); cast(0, .00001); cast(0, -.00001); }
        }
        hits.sort((a, b) => Math.abs(a.height + clearance - y) - Math.abs(b.height + clearance - y));
        const best = hits[0], on = best && Math.abs(best.height + clearance - y) <= tolerance;
        const levels: number[] = []; for (const hit of hits) if (!levels.some(y => Math.abs(y - hit.height) < .001)) levels.push(hit.height);
        const status = !best ? 'no-surface' : on ? 'on-surface' : levels.length > 1 ? 'ambiguous' : y > best.height + clearance ? 'above' : 'below';
        return { ...sample, candidates: hits, status, suggested: best && status !== 'ambiguous' ? [x, best.height + clearance, z] : null };
    });
    return { entityId: entity.id, options: { ...options, clearance, tolerance }, pathSnapshot: JSON.stringify(entity.path), surfaceSnapshot: surfaceKey(project), points, ignoredMovingIds,
        limitations: ['检查路径根位置与真实向上表面，不是人体脚底 IK 或全身碰撞。', '按源曲线检查实际保留区间；sourceTime 为源路线时间，分割后的播放时间可能不同。', '段内采样不能证明连续路径始终可通行；跨台阶可能需要增加途经点。', '只修正已有途经点的 Y，不更改时间、XZ、曲线模式或切片；多层歧义和缺失表面不自动修正。', '包含可见静态道具与启用的真实房间地板；不使用无实体地面平面。仅在本次所选对象范围内查找承托面。'] };
}
export function applyPathSurfaceCorrections(project: Project, report: PathSurfaceReport) {
    const entity = project.entities.find(e => e.id === report.entityId);
    if (!entity || JSON.stringify(entity.path) !== report.pathSnapshot || surfaceKey(project) !== report.surfaceSnapshot) throw Error('路线或承托结构已变化，请重新检查');
    if (entity.locked) throw Error('路线对象已锁定');
    let count = 0;
    for (const point of report.points) if (point.waypointIndex !== null && point.suggested && ['above', 'below'].includes(point.status)) {
        entity.path!.points[point.waypointIndex].position[1] = point.suggested[1]; count++;
    }
    if (!count) throw Error('没有可直接校正的途经点；请根据提示添加路线点或指定单个承托对象');
    return count;
}
