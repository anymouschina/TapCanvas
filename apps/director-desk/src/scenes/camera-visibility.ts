import type { CameraConfig, Entity, Project } from '../model.ts';

/** Shot visibility is independent of editor hiding and is also used by spatial queries. */
export function shotEntityVisible(project: Project, entity: Entity, camera?: CameraConfig | null) {
    const shown = (e: Entity) => e.visible && !camera?.hiddenEntityIds?.includes(e.id);
    if (!shown(entity)) return false;
    if (entity.handBinding) {
        const actor = project.entities.find(e => e.id === entity.handBinding!.actorId);
        return !!actor && shown(actor);
    }
    return true;
}

export function removeCameraVisibilityReference(project: Project, entityId: string) {
    for (const e of project.entities) if (e.camera?.effects?.focusTargetId === entityId) {
        if (e.locked) throw Error('锁定摄影机对焦该对象，请先解锁或解除对焦');
        e.camera.effects.focusTargetId = '';
    }
    for (const e of project.entities) if (e.camera?.hiddenEntityIds?.includes(entityId)) {
        if (e.locked) throw Error('锁定摄影机引用了该对象，请先解锁或移除本机位隐藏设置');
        e.camera.hiddenEntityIds = e.camera.hiddenEntityIds.filter(id => id !== entityId);
    }
}
