import { Vector3 } from 'three';
import type { Vec3, Waypoint } from '../model.ts';
import { assertEasing, eased } from './channels.ts';
import { assertPathInterpolation, continuousPathPosition } from './continuous-path.ts';
export interface CameraLookPath { smooth: boolean; interpolation?: 'continuous'; points: Waypoint[] }
export function assertCameraLookPath(path: CameraLookPath | null | undefined) {
    if (path == null) return;
    if (!path || typeof path !== 'object' || Array.isArray(path) || Object.keys(path).some(k => !['smooth', 'points', 'interpolation'].includes(k))
        || typeof path.smooth !== 'boolean' || !Array.isArray(path.points) || !path.points.length) throw Error('摄影机视线需要 smooth 和至少一个关键帧');
    path.points.forEach((p, i) => {
        if (!p || Object.keys(p).some(k => !['time', 'position', 'easing', 'stop'].includes(k)) || !Number.isFinite(p.time) || p.time < 0
            || !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(Number.isFinite)
            || i > 0 && p.time <= path.points[i - 1].time) throw Error('摄影机视线关键帧需有效坐标与严格递增的时间');
        assertEasing(p.easing);
    });
    assertPathInterpolation(path);
}
/** World-space targets. Legacy smooth eases time on straight segments; continuous uses timed tangents. */
export function cameraLookAt(path: CameraLookPath, time: number): Vector3 {
    const pts = path.points;
    if (path.interpolation === 'continuous') return continuousPathPosition(pts, time);
    if (time <= pts[0].time) return new Vector3(...pts[0].position);
    for (let i = 1; i < pts.length; i++) if (time < pts[i].time) {
        let t = (time - pts[i - 1].time) / (pts[i].time - pts[i - 1].time);
        t = eased(t, pts[i].easing ?? (path.smooth ? 'smooth' : 'linear'));
        return new Vector3(...pts[i - 1].position).lerp(new Vector3(...pts[i].position), t);
    }
    return new Vector3(...pts.at(-1)!.position);
}
export function recordCameraLook(path: CameraLookPath | null | undefined, time: number, position: Vec3, fps: number): CameraLookPath {
    const next = structuredClone(path ?? { smooth: true, points: [] });
    const at = Math.max(0, Math.round(time * fps) / fps), point = next.points.find(p => Math.abs(p.time - at) < 1e-7);
    if (point) point.position = [...position]; else next.points.push({ time: at, position: [...position] });
    next.points.sort((a, b) => a.time - b.time); assertCameraLookPath(next); return next;
}
