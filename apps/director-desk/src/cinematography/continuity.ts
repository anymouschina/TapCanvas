import { Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3, type Object3D } from 'three';
import type { Entity } from '../model.ts';
import { numberAt } from '../animation/channels.ts';
/** Preserve actual ending optics and pose without replaying the previous scene's animation. */
export function freezeEndingCamera(entity: Entity, camera: PerspectiveCamera, time: number, target?: Object3D) {
    const c = entity.camera!, effects = c.effects;
    if (c.aimResponse?.duration && (c.aim !== 'manual' || c.mode === 'follow' && c.targetId) && c.mode !== 'pov') {
        // A new scene has no response history. Preserve the captured view instead of
        // snapping back to the exact target when sampling its new zero-second origin.
        c.mode = 'free'; c.aim = 'manual'; c.targetPath = null; c.targetId = '';
    }
    if (!effects) return;
    const channels = effects.channels ??= {};
    for (const key of Object.keys(channels) as (keyof typeof channels)[]) channels[key] = numberAt(channels[key], time);
    c.focal = camera.getFocalLength(); channels.focal = c.focal;
    effects.shake = null; effects.dollyZoom = null;
    if (c.mode === 'free') {
        c.aim = 'manual'; c.targetPath = null;
        for (const key of ['roll', 'pan', 'tilt', 'offsetX', 'offsetY', 'offsetZ'] as const) channels[key] = 0;
    } else {
        const base = camera.userData.directorBasePose;
        const position = new Vector3().fromArray(base.position), rotation = new Quaternion().fromArray(base.quaternion);
        const offset = camera.position.clone().sub(position).applyQuaternion(rotation.clone().invert());
        const euler = new Euler().setFromQuaternion(rotation.clone().invert().multiply(camera.quaternion));
        channels.offsetX = offset.x; channels.offsetY = offset.y; channels.offsetZ = offset.z;
        channels.tilt = MathUtils.radToDeg(euler.x); channels.pan = MathUtils.radToDeg(euler.y); channels.roll = MathUtils.radToDeg(euler.z);
        if (c.mode === 'follow' && effects.followLag && target) {
            const displacement = position.sub(target.getWorldPosition(new Vector3()));
            if (c.inheritRotation) displacement.applyAxisAngle(new Vector3(0, 1, 0), -target.rotation.y);
            c.offset = displacement.toArray();
        }
    }
    effects.followLag = 0;
}
