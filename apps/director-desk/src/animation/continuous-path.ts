import { Vector3 } from 'three';
import type { Waypoint } from '../model.ts';

export interface ContinuousPath { interpolation?: 'continuous'; points: Waypoint[] }

/** Optional new interpolation; legacy scenes keep their existing spatial/time curves. */
export function assertPathInterpolation(path: ContinuousPath) {
    if (path.interpolation !== undefined && path.interpolation !== 'continuous') throw Error('路径插值仅支持 continuous，省略时使用原分段曲线');
    for (const point of path.points) {
        if (point.stop !== undefined && typeof point.stop !== 'boolean') throw Error('途经点 stop 必须为布尔值');
        if (path.interpolation === 'continuous' && point.easing !== undefined && point.easing !== 'linear')
            throw Error('连贯运动使用途经点时间与 stop 控制速度；请移除分段 easing，或切回分段曲线');
    }
}

export function stopsAtPoint(points: Waypoint[], index: number) {
    return points[index].stop ?? (index === 0 || index === points.length - 1);
}

function secant(a: Waypoint, b: Waypoint) {
    return new Vector3(...b.position).sub(new Vector3(...a.position)).divideScalar(b.time - a.time);
}

/** One tangent per timed knot gives matching velocities on both adjacent segments. */
function velocity(points: Waypoint[], index: number) {
    if (stopsAtPoint(points, index)) return new Vector3();
    if (index === 0) return secant(points[0], points[1]);
    if (index === points.length - 1) return secant(points[index - 1], points[index]);
    const a = points[index - 1], b = points[index], c = points[index + 1];
    const incoming = secant(a, b), outgoing = secant(b, c);
    const before = incoming.length(), after = outgoing.length();
    // A repeated point is an intentional dwell, and a full reversal must brake.
    if (before < 1e-10 || after < 1e-10 || incoming.dot(outgoing) < -.999 * before * after) return new Vector3();
    const previousDuration = b.time - a.time, nextDuration = c.time - b.time;
    const tangent = incoming.multiplyScalar(nextDuration).addScaledVector(outgoing, previousDuration).divideScalar(previousDuration + nextDuration);
    // Bound excessive handles around very uneven spacing/timing. Shared endpoint velocities
    // and zero endpoint acceleration preserve C2 continuity across the timed knots.
    const maximum = 2 * Math.min(before, after);
    if (tangent.length() > maximum) tangent.setLength(maximum);
    return tangent;
}

/** Quintic Hermite with shared velocity and zero acceleration at knots. Stateless across FPS/seeks. */
export function continuousPathPosition(points: Waypoint[], time: number): Vector3 {
    if (points.length === 1 || time <= points[0].time) return new Vector3(...points[0].position);
    if (time >= points.at(-1)!.time) return new Vector3(...points.at(-1)!.position);
    // Dense recorded paths should not scan all preceding keys for every aim/distance sample.
    let i = 0, hi = points.length - 1;
    while (hi - i > 1) { const mid = (i + hi) >>> 1; if (points[mid].time <= time) i = mid; else hi = mid; }
    const a = points[i], b = points[i + 1], duration = b.time - a.time;
    if (a.position.every((value, axis) => value === b.position[axis])) return new Vector3(...a.position);
    const u = (time - a.time) / duration, u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
    return new Vector3(...a.position).multiplyScalar(1 - 10 * u3 + 15 * u4 - 6 * u5)
        .addScaledVector(new Vector3(...b.position), 10 * u3 - 15 * u4 + 6 * u5)
        .addScaledVector(velocity(points, i), (u - 6 * u3 + 8 * u4 - 3 * u5) * duration)
        .addScaledVector(velocity(points, i + 1), (-4 * u3 + 7 * u4 - 3 * u5) * duration);
}
