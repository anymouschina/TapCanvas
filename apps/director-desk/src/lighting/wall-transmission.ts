import { Camera, Mesh, type Material, type Object3D } from 'three';
import type { Entity } from '../model.ts';

const transmitting = new WeakSet<Camera>(), installed = new WeakSet<Mesh>();
export function setWallTransmission(camera: Camera, enabled: boolean) { if (enabled) transmitting.add(camera); else transmitting.delete(camera); }

export function isWallEntity(entity: Entity) {
    return entity.asset === 'wall' || entity.asset.startsWith('building-')
        || ['structure-wall', 'structure-doorframe', 'structure-door', 'structure-windowframe', 'structure-window', 'structure-slab', 'structure-beam'].includes(entity.asset)
        || entity.asset === 'room-part' && (entity.assetParameters?.part ?? 0) !== 0;
}

/** Skip only this wall's depth/color write for the selected light's shadow pass; the visible wall and other shadows stay intact. */
export function installWallTransmission(root: Object3D) {
    root.traverse(object => {
        if (!(object instanceof Mesh) || installed.has(object)) return;
        installed.add(object);
        const before = object.onBeforeShadow, after = object.onAfterShadow;
        let saved: { material: Material; colorWrite: boolean; depthWrite: boolean } | undefined;
        object.onBeforeShadow = function (...args) {
            before.apply(this, args);
            if (!transmitting.has(args[3])) return;
            const material = args[5]; saved = { material, colorWrite: material.colorWrite, depthWrite: material.depthWrite };
            material.colorWrite = false; material.depthWrite = false;
        };
        object.onAfterShadow = function (...args) {
            if (saved) { saved.material.colorWrite = saved.colorWrite; saved.material.depthWrite = saved.depthWrite; saved = undefined; }
            after.apply(this, args);
        };
    });
}
