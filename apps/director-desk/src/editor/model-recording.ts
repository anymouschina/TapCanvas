import { clone, clip, type Action, type Entity, type Vec3, type Waypoint } from '../model.ts';
import { entityPosition } from '../timeline.ts';
import { sliceAction } from '../clip-editing.ts';
import { isAnimalAsset } from '../asset-catalog.ts';

export type RecordingAction = 'auto' | 'crawl' | 'keep';
export function recordingError(e: Entity | undefined): string | null {
    if (!e) return '请先选择要操控的白模';
    if (e.kind === 'camera') return '请选择人物、群演或道具白模';
    if (e.locked) return '对象已锁定，请先解锁';
    if (!e.visible) return '请先显示该白模';
    if (e.handBinding) return '手持道具跟随人物运动，请操控人物或先解除绑定';
    if (e.structureLink) return '请先解除建筑模块连接';
    return null;
}
export function canRecordActions(e: Entity) {
    return (e.kind === 'actor' || e.kind === 'crowd') && !isAnimalAsset(e.asset) && !e.external;
}
/** Keep corners and holds, but remove redundant keys on constant-speed straight segments. */
function appendPoint(points: Waypoint[], next: Waypoint, preserveThrough: number) {
    const a = points.at(-2), b = points.at(-1);
    if (a && b && b.time > preserveThrough) {
        const u = (b.time - a.time) / (next.time - a.time);
        if (b.position.every((v, i) => Math.abs(v - (a.position[i] + (next.position[i] - a.position[i]) * u)) < 1e-8)) points.pop();
    }
    points.push(next);
}
/** Camera-relative planar movement. Diagonal input has the same speed as straight input. */
export function recordingStep(position: Vec3, forward: Vec3, keys: ReadonlySet<string>, seconds: number, mode: RecordingAction) {
    const axis = (a: string, b: string) => Number(keys.has(a)) - Number(keys.has(b));
    const length = Math.hypot(forward[0], forward[2]);
    const fx = length > .001 ? forward[0] / length : 0, fz = length > .001 ? forward[2] / length : -1;
    const x = fx * axis('KeyW', 'KeyS') - fz * axis('KeyD', 'KeyA');
    const z = fz * axis('KeyW', 'KeyS') + fx * axis('KeyD', 'KeyA');
    const y = axis('KeyR', 'KeyF'), magnitude = Math.hypot(x, y, z);
    const moving = magnitude > 0, running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = mode === 'crawl' ? .65 : running ? 5 : 1.6;
    const step = moving ? Math.max(0, seconds) * speed / magnitude : 0;
    return { position: [position[0] + x * step, position[1] + y * step, position[2] + z * step] as Vec3,
        action: (mode === 'crawl' ? 'crawl' : moving ? running ? 'run' : 'walk' : 'idle') as Action };
}

/** A single take writes ordinary paths and clips; no recording data is added to project files. */
export class ModelRecording {
    readonly start: number;
    readonly mode: RecordingAction;
    readonly points: Waypoint[];
    readonly entity: Entity;
    readonly fps: number;
    private frames = 0;
    constructor(source: Entity, time: number, fps: number, mode: RecordingAction) {
        const error = recordingError(source); if (error) throw Error(error);
        if (!Number.isFinite(time) || time < 0 || !Number.isFinite(fps) || fps <= 0) throw Error('录制时间或帧率无效');
        if (!['auto', 'crawl', 'keep'].includes(mode)) throw Error('录制动作选项无效');
        this.fps = fps; this.start = Math.round(time * fps) / fps;
        this.entity = clone(source);
        this.mode = canRecordActions(source) ? mode : 'keep';
        // Bake only the retained prefix at output frames; split/retimed/smooth paths use the shared sampler.
        this.points = [];
        if (source.path) for (let f = 0; f < Math.round(this.start * fps); f++)
            this.points.push({ time: f / fps, position: entityPosition(source, f / fps).toArray() as Vec3 });
        else if (this.start > 0) this.points.push({ time: 0, position: [...source.position] });
        this.points.push({ time: this.start, position: entityPosition(source, this.start).toArray() as Vec3 });
        this.entity.path = { smooth: false, points: this.points };
        this.entity.face = 'path'; this.entity.faceTarget = '';
        if (this.mode !== 'keep') this.entity.clips = source.clips.filter(c => c.start < this.start)
            .map(c => c.end <= this.start ? clone(c) : sliceAction(c, c.start, this.start, false));
    }
    get time() { return this.start + this.frames / this.fps; }
    get position(): Vec3 { return this.points.at(-1)!.position; }
    advance(keys: ReadonlySet<string>, forward: Vec3) {
        const next = recordingStep(this.position, forward, keys, 1 / this.fps, this.mode);
        const at = this.time; this.frames++;
        appendPoint(this.points, { time: this.time, position: next.position }, this.start);
        if (this.mode !== 'keep') {
            const previous = this.entity.clips.at(-1);
            if (previous && previous.start >= this.start && previous.action === next.action && Math.abs(previous.end - at) < 1e-7) previous.end = this.time;
            else this.entity.clips.push(clip(next.action, at, this.time));
        }
    }
    get hasFrames() { return this.frames > 0; }
}
