import type { SceneState } from './sequence-project.ts';
import { getFrameCount, type ProductionNote, type Vec3 } from '../model.ts';

export interface EndingObject { key: string; entityId: string | null; memberIndex: number | null; name: string; kind: string; position: Vec3; forward: Vec3; action: string | null; enabled: boolean; bounds: { min: Vec3; max: Vec3 } | null }
export interface ContinuityOrigin {
    version: 1; sceneId: string; sceneName: string; sourceHash: string;
    frameIndex: number; time: number; fps: number; duration: number;
    state: SceneState; notes: ProductionNote[]; objects: EndingObject[]; cameraId: string;
}
export function assertContinuityOrigin(input: unknown): asserts input is ContinuityOrigin {
    const o = input as ContinuityOrigin, finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(finite);
    const text = (v: unknown) => typeof v === 'string' && v.length <= 200;
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !['version', 'sceneId', 'sceneName', 'sourceHash', 'frameIndex', 'time', 'fps', 'duration', 'state', 'notes', 'objects', 'cameraId'].includes(k))
        || o.version !== 1 || !text(o.sceneId) || !text(o.sceneName) || !/^[\p{L}\p{N}_:.-]{1,200}$/u.test(o.sceneId) || typeof o.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(o.sourceHash)
        || !Number.isSafeInteger(o.frameIndex) || o.frameIndex < 0 || !finite(o.time) || !finite(o.fps) || o.fps <= 0 || !finite(o.duration) || o.duration <= 0
        || Math.abs(o.time - o.frameIndex / o.fps) > 1e-8 || o.frameIndex !== getFrameCount(0, o.duration, o.fps) - 1 || o.time < 0 || o.time >= o.duration || !Array.isArray(o.notes) || !Array.isArray(o.objects) || !text(o.cameraId)) throw Error('接拍来源快照格式无效');
    const keys = new Set<string>();
    for (const item of o.objects) {
        if (!item || Object.keys(item).some(k => !['key', 'entityId', 'memberIndex', 'name', 'kind', 'position', 'forward', 'action', 'enabled', 'bounds'].includes(k))
            || !text(item.key) || keys.has(item.key) || !text(item.name) || !text(item.kind) || item.entityId !== null && !text(item.entityId)
            || item.memberIndex !== null && (!Number.isSafeInteger(item.memberIndex) || item.memberIndex < 0)
            || !vec(item.position) || !vec(item.forward) || item.action !== null && !text(item.action) || typeof item.enabled !== 'boolean'
            || item.bounds !== null && (!item.bounds || !vec(item.bounds.min) || !vec(item.bounds.max))) throw Error('接拍末帧空间记录无效');
        keys.add(item.key);
    }
}
