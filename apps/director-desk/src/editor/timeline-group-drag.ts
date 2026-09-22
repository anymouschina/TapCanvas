import { clipRange, pathSections, setClipRange, type TimelineSelection } from '../clip-editing.ts';
import type { Project } from '../model.ts';
import { selectionKey } from './timeline-selection.ts';

/** Capture timing only once. Keep group offsets intact and clamp the entire group at stationary neighbours. */
export function createTimelineGroupDrag(project: Project, selections: TimelineSelection[], anchor: TimelineSelection) {
    const selected = [...new Map(selections.map(s => [selectionKey(s), s])).values()];
    if (selected.some(s => s.kind === 'cut') && selected.some(s => s.kind !== 'cut')) throw Error('切镜是连续序列，请单独拖动切镜组；混合选择仍可交给 AI');
    const duration = project.duration, frame = 1 / project.fps;
    if (selected.every(s => s.kind === 'cut')) {
        const shots = project.cuts.map((c, i) => ({ ...c, index: i, duration: (project.cuts[i + 1]?.time ?? duration) - c.time }));
        const indices = new Set(selected.map(s => (s as { index: number }).index));
        const picked = shots.filter(s => indices.has(s.index)), rest = shots.filter(s => !indices.has(s.index));
        return { apply(delta: number, resize: boolean) {
            if (!Number.isFinite(delta)) throw Error('拖动时间无效');
            let order = shots;
            if (resize) {
                const shift = Math.max(delta, ...picked.map(s => frame - s.duration));
                order = shots.map(s => ({ ...s, duration: s.duration + (indices.has(s.index) ? shift : 0) }));
            } else if (delta !== 0) {
                const a = shots[(anchor as { index: number }).index];
                const target = a.time + (delta > 0 ? a.duration : 0) + delta;
                let index = rest.findIndex(s => target < s.time + s.duration / 2);
                if (index < 0) index = rest.length;
                order = [...rest.slice(0, index), ...picked, ...rest.slice(index)];
            }
            let time = 0;
            project.cuts = order.map(s => { const c = { cameraId: s.cameraId, time }; time += s.duration; return c; });
            project.duration = time;
            return order.flatMap((s, index) => indices.has(s.index) ? [{ kind: 'cut' as const, index }] : []);
        } };
    }
    const keys = new Set(selected.map(selectionKey));
    const ranges = selected.map(s => {
        if (s.kind === 'cut') throw Error('切镜需单独调整');
        const entity = project.entities.find(e => e.id === s.entityId)!;
        if (entity.locked) throw Error('选中对象已锁定');
        const range = clipRange(project, s);
        const neighbours = s.kind === 'action' ? entity.clips.map(c => ({ selection: { kind: 'action' as const, entityId: entity.id, id: c.id }, start: c.start, end: c.end })) : pathSections(entity.path!).map((c, index) => ({ ...c, selection: { kind: 'path' as const, entityId: entity.id, index } }));
        return { s, start: range.start, end: range.end, neighbours };
    });
    let minMove = -Infinity, maxMove = Infinity, minResize = -Infinity, maxResize = Infinity;
    for (const r of ranges) {
        minMove = Math.max(minMove, -r.start); minResize = Math.max(minResize, frame - (r.end - r.start));
        for (const n of r.neighbours) {
            if (selectionKey(n.selection) === selectionKey(r.s)) continue;
            if (n.start >= r.end - 1e-8) maxResize = Math.min(maxResize, n.start - r.end);
            if (keys.has(selectionKey(n.selection))) continue;
            if (n.end <= r.start + 1e-8) minMove = Math.max(minMove, n.end - r.start);
            if (n.start >= r.end - 1e-8) maxMove = Math.min(maxMove, n.start - r.end);
        }
    }
    return { apply(delta: number, resize: boolean) {
        if (!Number.isFinite(delta)) throw Error('拖动时间无效');
        const d = resize ? Math.max(minResize, Math.min(maxResize, delta)) : Math.max(minMove, Math.min(maxMove, delta));
        project.duration = duration;
        for (const r of ranges) setClipRange(project, r.s, r.start + (resize ? 0 : d), r.end + d);
        return selected.map(s => ({ ...s }));
    } };
}
