import type { Entity, Project } from '../model.ts';
export interface Floor { id: string; name: string; elevation: number }
export interface EditorView { trackOrder?: string[]; activeFloorId: string; hiddenFloorIds: string[]; hiddenEntityIds: string[]; hideWalls: boolean }
export const emptyEditorView = (): EditorView => ({ activeFloorId: '', hiddenFloorIds: [], hiddenEntityIds: [], hideWalls: false });
export function workingElevation(project: Project) { return project.floors?.find(f => f.id === project.editorView?.activeFloorId)?.elevation ?? 0; }
export function assertFloors(project: Project) {
    const floors = project.floors === undefined ? [] : project.floors;
    if (!Array.isArray(floors) || floors.length > 256) throw Error('楼层列表无效，最多 256 层');
    const ids = new Set<string>();
    for (const f of floors) {
        if (!f || typeof f.id !== 'string' || !/^[\p{L}\p{N}_:.-]{1,200}$/u.test(f.id) || ids.has(f.id) || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 80
            || !Number.isFinite(f.elevation) || f.elevation < -10000 || f.elevation > 10000) throw Error('楼层标识、名称或标高无效');
        ids.add(f.id);
    }
    for (const e of project.entities) if (e.floorId !== undefined && (typeof e.floorId !== 'string' || e.floorId && !ids.has(e.floorId))) throw Error('对象归属的楼层不存在');
    const view = project.editorView;
    if (view !== undefined) {
        if (view && view.trackOrder !== undefined && (!Array.isArray(view.trackOrder) || view.trackOrder.length > 20000 || new Set(view.trackOrder).size !== view.trackOrder.length || view.trackOrder.some(key => typeof key !== 'string' || key.length > 450 || !/^(entity|path|note):.+$/.test(key)))) throw Error('时间轴轨道顺序无效');
        const entityIds = new Set(project.entities.map(e => e.id));
        const list = (v: unknown, choices: Set<string>) => Array.isArray(v) && new Set(v).size === v.length && v.every(id => typeof id === 'string' && choices.has(id));
        if (!view || typeof view !== 'object' || Array.isArray(view) || typeof view.activeFloorId !== 'string' || view.activeFloorId && !ids.has(view.activeFloorId)
            || !list(view.hiddenFloorIds, ids) || !list(view.hiddenEntityIds, entityIds) || typeof view.hideWalls !== 'boolean') throw Error('布景显示设置包含无效楼层或对象');
    }
}
/** Changing existing floor elevation shifts existing members, not newly assigned/created objects. */
export function syncFloorElevations(project: Project, before: Project) {
    assertFloors(project);
    const oldFloors = new Map(before.floors?.map(f => [f.id, f.elevation])), oldEntities = new Map(before.entities.map(e => [e.id, e]));
    for (const e of project.entities) {
        if (!e.floorId || e.handBinding || oldEntities.get(e.id)?.floorId !== e.floorId || !oldFloors.has(e.floorId)) continue;
        const delta = project.floors!.find(f => f.id === e.floorId)!.elevation - oldFloors.get(e.floorId)!;
        if (!delta) continue;
        e.position[1] += delta; e.path?.points.forEach(point => { point.position[1] += delta; });
        if (e.camera && !e.camera.targetId && e.camera.aim === 'target') e.camera.target[1] += delta;
        e.camera?.targetPath?.points.forEach(p => { p.position[1] += delta; });
    }
}
/** Explicit organization only; does not teleport objects. Locked or already assigned objects are skipped. */
export function assignUnsortedFloors(project: Project) {
    const floors = [...(project.floors ?? [])].sort((a, b) => a.elevation - b.elevation);
    if (!floors.length) throw Error('请先创建楼层');
    let count = 0;
    for (const e of project.entities) {
        if (e.floorId || e.locked) continue;
        const y = e.path?.points[0]?.position[1] ?? e.position[1];
        e.floorId = [...floors].reverse().find(f => f.elevation <= y + .05)?.id ?? floors[0].id; count++;
    }
    return count;
}
export function removeFloor(project: Project, id: string) {
    if (!project.floors?.some(f => f.id === id)) throw Error('楼层不存在');
    for (const e of project.entities) if (e.floorId === id) { if (e.locked) throw Error('楼层内有锁定对象，请先解锁或调整归属'); e.floorId = ''; }
    project.floors = project.floors.filter(f => f.id !== id);
    if (project.editorView) { project.editorView.hiddenFloorIds = project.editorView.hiddenFloorIds.filter(f => f !== id); if (project.editorView.activeFloorId === id) project.editorView.activeFloorId = ''; }
}
export function editorEntityVisible(project: Project, entity: Entity) {
    const view = project.editorView;
    const shown = (e: Entity, ownFloor = true) => e.visible && !view?.hiddenEntityIds.includes(e.id) && (!ownFloor || !e.floorId || !view?.hiddenFloorIds.includes(e.floorId))
        && !(view?.hideWalls && (['wall', 'structure-wall'].includes(e.asset) || e.asset === 'room-part' && (e.assetParameters?.part ?? 0) !== 0));
    if (!shown(entity, !entity.handBinding)) return false;
    if (entity.handBinding) { const actor = project.entities.find(e => e.id === entity.handBinding!.actorId); return !!actor && shown(actor); }
    return true;
}
