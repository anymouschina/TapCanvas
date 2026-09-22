export const EASINGS = { linear: '匀速', smooth: '缓入缓出', 'ease-in': '加速', 'ease-out': '减速', hold: '保持后跳变', whip: '快速甩动' } as const;
export type Easing = keyof typeof EASINGS | { bezier: [number, number, number, number] };
export interface NumberKey { time: number; value: number; easing?: Easing }
export type AnimatedNumber = number | { keys: NumberKey[] };
export function assertEasing(value: unknown) {
    if (value === undefined || typeof value === 'string' && Object.hasOwn(EASINGS, value)) return;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'bezier' in value) {
        const points = value.bezier;
        if (Array.isArray(points) && points.length === 4 && points.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return;
    }
    throw Error('未知速度曲线；自定义曲线需要 bezier:[x1,y1,x2,y2]，各值为 0—1');
}
const cubic = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
export function eased(t: number, easing: Easing = 'linear') {
    t = Math.max(0, Math.min(1, t));
    if (typeof easing === 'object') {
        if (t === 0 || t === 1) return t;
        const [x1, y1, x2, y2] = easing.bezier;
        let low = 0, high = 1;
        for (let i = 0; i < 24; i++) { const mid = (low + high) / 2; if (cubic(mid, x1, x2) < t) low = mid; else high = mid; }
        return cubic((low + high) / 2, y1, y2);
    }
    if (easing === 'smooth') return t * t * (3 - 2 * t);
    if (easing === 'ease-in') return t * t;
    if (easing === 'ease-out') return 1 - (1 - t) ** 2;
    if (easing === 'hold') return t < 1 ? 0 : 1;
    if (easing === 'whip') return t < .5 ? 8 * t ** 4 : 1 - 8 * (1 - t) ** 4;
    return t;
}
export function assertAnimated(value: unknown, min: number, max: number, label: string): asserts value is AnimatedNumber {
    const valid = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
    if (valid(value)) return;
    const curve = value as { keys?: NumberKey[] } | undefined;
    if (!curve || typeof curve !== 'object' || Array.isArray(curve) || Object.keys(curve).some(k => k !== 'keys') || !Array.isArray(curve.keys) || !curve.keys.length) throw Error(`${label}需要 ${min} 至 ${max} 的数值或 keys 关键帧`);
    curve.keys.forEach((key, i) => {
        if (!key || Object.keys(key).some(k => !['time', 'value', 'easing'].includes(k)) || !Number.isFinite(key.time) || key.time < 0 || !valid(key.value) || i > 0 && key.time <= curve.keys![i - 1].time) throw Error(`${label}关键帧值无效或时间未递增`);
        assertEasing(key.easing);
    });
}
/** Random-access sampling: no frame history, clock or render rate participates. */
export function numberAt(value: AnimatedNumber | undefined, time: number, fallback = 0): number {
    if (value === undefined) return fallback;
    if (typeof value === 'number') return value;
    const keys = value.keys;
    if (time <= keys[0].time) return keys[0].value;
    for (let i = 1; i < keys.length; i++) if (time < keys[i].time) {
        const a = keys[i - 1], b = keys[i];
        return a.value + (b.value - a.value) * eased((time - a.time) / (b.time - a.time), b.easing);
    }
    return keys.at(-1)!.value;
}
export function setNumberKey(value: AnimatedNumber | undefined, time: number, next: number, fallback: number, easing: Easing = 'smooth'): AnimatedNumber {
    const keys = typeof value === 'object' ? structuredClone(value.keys) : [{ time: 0, value: value ?? fallback }];
    const index = keys.findIndex(k => Math.abs(k.time - time) < 1e-7);
    const key = { time, value: next, easing };
    if (index >= 0) keys[index] = key; else keys.push(key);
    return { keys: keys.sort((a, b) => a.time - b.time) };
}
