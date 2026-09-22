import type { Entity, Project } from '../model.ts';
export interface EditLocation { entityId?: string; name: string; action: 'added' | 'updated' | 'removed'; field: string; start: number; end: number }
const labels: Record<string, string> = { position: '位置', rotation: '旋转', scale: '缩放', path: '运动路径', clips: '动作', pose: '姿态', poseKeys: '姿态关键帧', camera: '摄影机', light: '灯光', color: '颜色', visible: '显隐', handBinding: '手持绑定', name: '名称', cuts: '切镜', production: '剧情与提示词', lighting: '场景光影', room: '房间', resources: '资源', references: '参考图', duration: '时长', aspect: '画幅', fps: '帧率' };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Conservative affected intervals: key neighbours are included, static edits span the scene. */
function interval(a: unknown, b: unknown, duration: number): [number, number] {
    if (equal(a, b)) return [Infinity, -Infinity];
    if (Array.isArray(a) || Array.isArray(b)) {
        const old = Array.isArray(a) ? a : [], next = Array.isArray(b) ? b : [];
        if (!old.length && !next.length) return [0, duration];
        if ([...old, ...next].every(v => v && typeof v === 'object' && typeof v.time === 'number')) {
            let start = duration, end = 0;
            for (const [keys, other] of [[old, next], [next, old]]) keys.forEach((key, i) => {
                if (other.some(k => k.time === key.time && equal(k, key))) return;
                start = Math.min(start, keys[i - 1]?.time ?? 0); end = Math.max(end, keys[i + 1]?.time ?? duration);
            });
            return [start, end];
        }
        if ([...old, ...next].length && [...old, ...next].every(v => v && typeof v.start === 'number' && typeof v.end === 'number')) {
            const changed = [...old.filter(v => !next.some(n => equal(v, n))), ...next.filter(v => !old.some(n => equal(v, n)))];
            return [Math.min(...changed.map(v => v.start)), Math.max(...changed.map(v => v.end))];
        }
        return [0, duration];
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const old = a as Record<string, unknown>, next = b as Record<string, unknown>;
        // Continuous tangents depend on neighbouring segments; a point edit reaches beyond
        // the immediate key pair. Use the scene span instead of reporting a falsely narrow range.
        if (old.interpolation === 'continuous' || next.interpolation === 'continuous') return [0, duration];
        // Path sections remap source key times; show their scheduled span instead.
        if ((old.sections || next.sections) && !equal(old, next)) {
            const sections = [...(old.sections as { start: number; end: number }[] ?? []), ...(next.sections as { start: number; end: number }[] ?? [])];
            if (!old.sections || !next.sections) return [0, duration];
            return [Math.min(...sections.map(s => s.start)), Math.max(...sections.map(s => s.end))];
        }
        const spans = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(k => !equal(old[k], next[k])).map(k => interval(old[k], next[k], duration));
        return [Math.min(...spans.map(s => s[0])), Math.max(...spans.map(s => s[1]))];
    }
    return [0, duration];
}
export function editLocations(before: Project, after: Project): EditLocation[] {
    const rows: EditLocation[] = [], duration = Math.max(before.duration, after.duration), old = new Map(before.entities.map(e => [e.id, e])), next = new Map(after.entities.map(e => [e.id, e]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
        const a = old.get(id), b = next.get(id), e = b ?? a!;
        if (!a || !b) { rows.push({ entityId: id, name: e.name, action: b ? 'added' : 'removed', field: '对象', start: 0, end: duration }); continue; }
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const field = key as keyof Entity; if (equal(a[field], b[field])) continue;
            const [start, end] = interval(a[field], b[field], duration);
            rows.push({ entityId: id, name: b.name, action: 'updated', field: labels[key] ?? key, start, end });
        }
    }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (['entities', 'format', 'version'].includes(key)) continue;
        const field = key as keyof Project; if (equal(before[field], after[field])) continue;
        const [start, end] = interval(before[field], after[field], duration);
        rows.push({ name: '戏段', action: 'updated', field: labels[key] ?? key, start, end });
    }
    return rows;
}
