import type { Engine } from '../engine.ts';
import type { Entity, Vec3 } from '../model.ts';
import { freezeEndingCamera } from '../cinematography/continuity.ts';

/** Freeze the evaluated camera pose before removing its target or binding. */
export function freezeCamera(engine: Engine, entity: Entity) {
    if (!entity.camera) return;
    const camera = engine.getShotCamera(entity.id);
    entity.position = camera.position.toArray() as Vec3;
    entity.rotation = [camera.rotation.x, camera.rotation.y, camera.rotation.z];
    entity.path = null;
    entity.camera.mode = 'free';
    entity.camera.aim = 'manual';
    freezeEndingCamera(entity, camera, engine.time);
}
