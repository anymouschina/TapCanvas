import type { MotionPath } from '../model.ts';
import { pathPosition } from '../timeline.ts';

type Curve = { key: string; times: number[]; distances: number[] };
const curves = new WeakMap<MotionPath, Curve>();
const origin: [number, number, number] = [0, 0, 0];

/** Arc-length lookup of the same curve used for placement, independent of render FPS and seek order. */
function curve(path: MotionPath) {
    const key = JSON.stringify([path.smooth, path.interpolation, path.points]);
    const cached = curves.get(path); if (cached?.key === key) return cached;
    const raw = { smooth: path.smooth, interpolation: path.interpolation, points: path.points }, times: number[] = [], distances: number[] = [];
    let previous = pathPosition(raw, origin, path.points[0]?.time ?? 0), total = 0;
    if (path.points.length) { times.push(path.points[0].time); distances.push(0); }
    for (let i = 1; i < path.points.length; i++) {
        if (path.points[i].easing === 'hold') {
            times.push(path.points[i].time); distances.push(total);
            previous = pathPosition(raw, origin, path.points[i].time);
            continue;
        }
        // Linear paths are exact. Curved/time-eased segments use a deterministic arc-length approximation.
        const steps = path.interpolation === 'continuous' || path.smooth && path.points.length > 2 || path.points[i].easing && path.points[i].easing !== 'linear' ? 256 : 1;
        for (let j = 1; j <= steps; j++) {
            const time = path.points[i - 1].time + (path.points[i].time - path.points[i - 1].time) * j / steps;
            const position = pathPosition(raw, origin, time); total += position.distanceTo(previous);
            times.push(time); distances.push(total); previous = position;
        }
    }
    const result = { key, times, distances }; curves.set(path, result); return result;
}
function prefix(c: Curve, time: number) {
    const { times, distances } = c;
    if (!times.length || time <= times[0]) return 0;
    if (time >= times.at(-1)!) return distances.at(-1)!;
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
    return distances[lo] + (distances[hi] - distances[lo]) * (time - times[lo]) / (times[hi] - times[lo]);
}

/** World-space route meters, including height. Holds and discontinuous section jumps add no walking distance. */
export function pathDistance(path: MotionPath | null, from: number, to: number): number {
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw Error('路径路程采样时间无效');
    if (!path || path.points.length < 2 || from === to) return 0;
    if (to < from) return -pathDistance(path, to, from);
    const c = curve(path);
    if (!path.sections?.length) return prefix(c, to) - prefix(c, from);
    let distance = 0;
    for (const s of path.sections) {
        const a = Math.max(from, s.start), b = Math.min(to, s.end); if (b <= a) continue;
        const source = (t: number) => s.from + (s.to - s.from) * (t - s.start) / (s.end - s.start);
        distance += Math.abs(prefix(c, source(b)) - prefix(c, source(a)));
    }
    return distance;
}
