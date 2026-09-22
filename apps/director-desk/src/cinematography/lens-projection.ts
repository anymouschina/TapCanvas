import { PerspectiveCamera, Vector2 } from 'three';
import type { CameraEffects } from './camera-effects.ts';
import { numberAt } from '../animation/channels.ts';
export interface LensProjection { type: 'barrel' | 'pincushion' | 'fisheye'; amount: number }
const lenses = new WeakMap<PerspectiveCamera, LensProjection>();
export function setLensProjection(camera: PerspectiveCamera, effects: CameraEffects | undefined, time: number) {
    const amount = numberAt(effects?.channels?.distortion, time);
    if (amount > 0) lenses.set(camera, { type: effects?.distortionType ?? 'barrel', amount }); else lenses.delete(camera);
}
export const lensProjection = (camera: PerspectiveCamera) => lenses.get(camera);
function sourceRadius(radius: number, lens: LensProjection) {
    const k = lens.amount * .6;
    if (lens.type === 'barrel') return radius * (1 + k * radius * radius);
    if (lens.type === 'pincushion') return radius / (1 + k * radius * radius);
    const angle = lens.amount * .9;
    return angle < 1e-6 ? radius : Math.tan(radius * angle) / angle;
}
export function lensOverscan(lens: LensProjection | undefined) { return lens ? Math.max(1, sourceRadius(1, lens)) : 1; }
/** Output screen coordinate -> physical pinhole ray. Keep formula identical to the fragment shader. */
export function lensSource(point: Vector2, aspect: number, lens?: LensProjection): Vector2 {
    if (!lens) return point.clone();
    const radius = Math.hypot(point.x * aspect, point.y) / Math.hypot(aspect, 1);
    return point.clone().multiplyScalar(radius < 1e-8 ? 1 : sourceRadius(radius, lens) / radius);
}
/** Physical projection -> displayed coordinate. Monotonic inside the output rectangle. */
export function lensScreen(point: Vector2, aspect: number, lens?: LensProjection): Vector2 {
    if (!lens) return point.clone();
    const radius = Math.hypot(point.x * aspect, point.y) / Math.hypot(aspect, 1);
    if (radius < 1e-8) return point.clone();
    const edge = sourceRadius(1, lens);
    if (radius > edge) return point.clone().multiplyScalar((1 + radius - edge) / radius);
    let lo = 0, hi = 1;
    for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (sourceRadius(mid, lens) < radius) lo = mid; else hi = mid; }
    return point.clone().multiplyScalar((lo + hi) / 2 / radius);
}
export function overscanCamera(camera: PerspectiveCamera, scale: number, copy = camera.clone()) {
    copy.copy(camera, false);
    for (const i of [0, 5, 8, 9]) copy.projectionMatrix.elements[i] /= scale;
    copy.projectionMatrixInverse.copy(copy.projectionMatrix).invert(); copy.updateMatrixWorld(true);
    return copy;
}
