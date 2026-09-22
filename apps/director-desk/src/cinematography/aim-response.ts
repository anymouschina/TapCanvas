import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Entity, Project } from '../model.ts';
import { cameraLookAt } from '../animation/camera-look.ts';
import { entityPosition, entityYaw } from '../timeline.ts';

export interface CameraAimResponse { duration: number }

export function assertCameraAimResponse(value: CameraAimResponse | undefined) {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'duration')
        || !Number.isFinite(value.duration) || value.duration < 0 || value.duration > 2)
        throw Error('摄影机视线响应需包含 0 至 2 秒的 duration');
}

const RESPONSE_CELLS = 24;
const UP = new Vector3(0, 1, 0);
type TargetRoot = Pick<Object3D, 'position' | 'rotation'>;

/**
 * Causal, finite-window orientation response, sampled only from scene time. No playback
 * history, frame-rate integration, scene mutation or cross-scene cache is involved.
 * Current posed/root offsets are retained over the window. For held props we resample
 * the carrier's route/yaw while retaining the current hand offset; this does not replay
 * historical hand articulation, grounding corrections or field deformation.
 */
export function cameraAimResponseQuaternion(entity: Entity, project: Project, time: number, targetRoot?: TargetRoot): Quaternion | null {
    const c = entity.camera, duration = c?.aimResponse?.duration ?? 0;
    if (!c || duration <= 0 || c.mode === 'pov') return null;
    const target = project.entities.find(item => item.id === c.targetId);
    // Follow mode has always aimed at its bound target, even when an old manual flag remains.
    if (c.aim === 'manual' && !(c.mode === 'follow' && target)) return null;
    const targetYaw = (at: number) => target && (target.kind === 'actor' || target.kind === 'crowd') ? entityYaw(target, at, project) : target?.rotation[1] ?? 0;
    const carrier = target?.handBinding ? project.entities.find(item => item.id === target.handBinding!.actorId) : undefined;
    const carrierYaw = carrier ? entityYaw(carrier, time, project) : 0;
    const correction = target && targetRoot ? targetRoot.position.clone().sub(entityPosition(carrier ?? target, time)) : new Vector3();
    const yawCorrection = targetRoot ? targetRoot.rotation.y - targetYaw(time) : 0;
    const rootPosition = (at: number) => {
        if (!target) return new Vector3(...c.target);
        if (carrier && targetRoot)
            return entityPosition(carrier, at).add(correction.clone().applyAxisAngle(UP, entityYaw(carrier, at, project) - carrierYaw));
        return entityPosition(target, at).add(correction);
    };
    const matrix = new Matrix4();
    const orientationAt = (at: number) => {
        const look = c.targetPath ? cameraLookAt(c.targetPath, at) : target ? rootPosition(at).add(new Vector3(0, c.targetHeight, 0)) : new Vector3(...c.target);
        let position: Vector3;
        if (c.mode === 'follow' && target) {
            const lag = c.effects?.followLag ?? 0, lagTime = Math.max(0, at - lag);
            const offset = new Vector3(...c.offset);
            if (c.inheritRotation) {
                const yaw = lag ? entityYaw(target, lagTime, project) : targetYaw(at) + yawCorrection
                    + (carrier && targetRoot ? entityYaw(carrier, at, project) - carrierYaw : 0);
                offset.applyAxisAngle(UP, yaw);
            }
            // Existing followLag delays unbound route translation only; bound props retain their live root.
            position = (lag && !target.handBinding ? entityPosition(target, lagTime) : rootPosition(at)).add(offset);
        } else position = entityPosition(entity, at);
        return new Quaternion().setFromRotationMatrix(matrix.lookAt(position, look, UP));
    };
    const now = Math.max(0, time);
    // Cells are anchored to scene zero, not to the current frame. Integrate the
    // recency kernel over each cell's overlap with the moving response window;
    // a discontinuous source orientation therefore enters/leaves with zero weight.
    // Reserve one cell inside duration for the causal left-endpoint sampling lag.
    const step = duration / (RESPONSE_CELLS + 1), window = step * RESPONSE_CELLS;
    const windowStart = now - window, firstCell = Math.floor(windowStart / step), lastCell = Math.floor(now / step);
    if (!Number.isSafeInteger(firstCell) || !Number.isSafeInteger(lastCell) || lastCell - firstCell > RESPONSE_CELLS + 1)
        return orientationAt(now);
    const sum = new Quaternion(0, 0, 0, 0);
    let previous: Quaternion | undefined;
    for (let cell = firstCell; cell <= lastCell; cell++) {
        const start = cell * step, a = Math.max(start, windowStart), b = Math.min(start + step, now);
        if (b <= a) continue;
        const q = orientationAt(Math.max(0, start));
        // Align adjacent fixed samples in time, rather than to the moving current
        // orientation, so crossing a half-turn cannot flip the historical weights.
        if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        previous = q;
        const weight = ((b - windowStart) / window) ** 3 - ((a - windowStart) / window) ** 3;
        sum.x += q.x * weight; sum.y += q.y * weight; sum.z += q.z * weight; sum.w += q.w * weight;
    }
    return sum.lengthSq() > 1e-12 ? sum.normalize() : orientationAt(now);
}
