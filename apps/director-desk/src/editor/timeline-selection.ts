import { clipRange, type TimelineSelection } from '../clip-editing.ts';
import type { Project } from '../model.ts';

// Transient editor selection, shared by UI and automation; never stored in an engineering file.
let clips: TimelineSelection[] = [], entities: string[] = [];
let keys = new Set<string>();
let timeRange: { start: number; end: number } | null = null;
export const selectionKey = (s: TimelineSelection) => JSON.stringify(s.kind === 'cut' ? [s.kind, s.index] : [s.kind, s.entityId, s.kind === 'action' ? s.id : s.index]);
export const selectedClips = () => clips.map(s => ({ ...s }));
export const selectedEntities = () => [...entities];
export const selectedTimeRange = () => timeRange && { ...timeRange };
export const clipSelected = (s: TimelineSelection) => keys.has(selectionKey(s));
export function setSelectedClips(value: TimelineSelection[], keepContext = false) {
    clips = [...new Map(value.map(s => [selectionKey(s), { ...s }])).values()];
    keys = new Set(clips.map(selectionKey));
    if (!keepContext) { entities = []; timeRange = null; }
}
export function toggleSelectedClip(s: TimelineSelection) { setSelectedClips(clipSelected(s) ? clips.filter(c => selectionKey(c) !== selectionKey(s)) : [...clips, s], true); }
export function setSelectedEntities(value: string[]) { entities = [...new Set(value)]; clips = []; keys.clear(); timeRange = null; }
export function setSelectedTimeRange(value: { start: number; end: number } | null) { timeRange = value && { ...value }; }
export function clearTimelineSelection() { clips = []; keys.clear(); entities = []; timeRange = null; }
export function editorSelection(project: Project, fallbackId?: string) {
    const objects = new Map(project.entities.map(e => [e.id, e]));
    const parts = clips.flatMap(s => { try { const r = clipRange(project, s); return [{ ...s, start: r.start, end: r.end }]; } catch { return []; } });
    const ids = [...new Set([...entities, ...parts.map(s => s.kind === 'cut' ? project.cuts[s.index].cameraId : s.entityId)])].filter(id => objects.has(id));
    // A time-only selection applies to the time window, not an unrelated inspector selection.
    if (!ids.length && !parts.length && !timeRange && fallbackId && objects.has(fallbackId)) ids.push(fallbackId);
    return { entityIds: ids, objects: ids.map(id => ({ id, name: objects.get(id)!.name })), clips: parts,
        timeRange: timeRange ? { ...timeRange } : parts.length ? { start: Math.min(...parts.map(s => s.start)), end: Math.max(...parts.map(s => s.end)) } : null,
        scope: parts.length ? 'clips' : timeRange ? 'time' : 'entities',
    };
}
