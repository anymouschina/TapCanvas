import { Box3 } from 'three';
import type { Engine } from '../engine.ts';
import type { MotionPath } from '../model.ts';
import { activeCameraId } from '../timeline.ts';
import { frameBounds } from './geometry.ts';
import { sceneTargets, type SceneTarget } from './scene-targets.ts';
import { visibilityChecks } from './visibility.ts';

export interface SpatialRangeOptions {
    start: number; end: number; sampleFps: number; targetKey: string; compareKey?: string; cameraId?: string; occlusion?: boolean;
}
export interface SpatialFinding {
    id: string; type: 'potential-overlap' | 'out-of-frame' | 'clipped' | 'body-blocked' | 'face-blocked';
    start: number; end: number; time: number; cameraId: string;
    targetKey: string; targetEntityId: string | null; targetName: string;
    otherKey?: string; otherName?: string; description: string;
}
export interface SpatialRangeReport {
    format: 'director-spatial-range'; version: 1; projectName: string; options: SpatialRangeOptions;
    samples: number; processedSamples: number; complete: boolean; findings: SpatialFinding[]; limitations: string[];
}

/** Continuous overlap of linearly interpolated AABB bounds; returns a conservative candidate, not mesh collision. */
export function sweptBoxOverlap(a0: Box3, a1: Box3, b0: Box3, b1: Box3, tolerance = .02): [number, number] | null {
    let lo = 0, hi = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
        for (const [start, end] of [[a0.max[axis] - b0.min[axis] - tolerance, a1.max[axis] - b1.min[axis] - tolerance],
            [b0.max[axis] - a0.min[axis] - tolerance, b1.max[axis] - a1.min[axis] - tolerance]]) {
            if (start <= 0 && end <= 0) return null;
            if (start <= 0) lo = Math.max(lo, -start / (end - start));
            if (end <= 0) hi = Math.min(hi, start / (start - end));
            if (lo >= hi) return null;
        }
    }
    return [lo, hi];
}
export function rangeSampleTimes(start: number, end: number, fps: number, extra: number[] = []): number[] {
    if (![start, end, fps].every(Number.isFinite) || start < 0 || end <= start || fps < 1 || fps > 120) throw new Error('请输入有效检查区间与 1—120 的采样帧率');
    const frames = Math.ceil((end - start) * fps);
    if (frames > 20000) throw new Error('本次检查超过 20000 个采样点，请缩小区间或降低采样帧率');
    const times = new Set([start, end]);
    for (let i = 1; i < frames; i++) times.add(start + i / fps);
    extra.filter(t => t > start && t < end).forEach(t => times.add(t));
    const sorted = [...times].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1e-7);
    if (sorted.length > 22000) throw new Error('路径关键时间点过多，请缩小检查区间');
    return sorted;
}
function bounds(target: SceneTarget): { whole: Box3; parts: Box3[] } {
    target.root.updateWorldMatrix(true, true);
    const whole = new Box3(), parts = target.meshes.map(mesh => {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld); whole.union(box); return box;
    });
    return { whole, parts };
}
export function pathCheckTimes(path: MotionPath | null): number[] {
    if (!path) return [];
    if (!path.sections?.length) return path.points.map(p => p.time);
    return path.sections.flatMap(s => [s.start, s.end, ...path.points
        .filter(p => p.time > s.from && p.time < s.to)
        .map(p => s.start + (p.time - s.from) / (s.to - s.from) * (s.end - s.start))]);
}
export async function scanSpatialRange(engine: Engine, options: SpatialRangeOptions, signal?: AbortSignal, progress: (done: number, total: number) => void = () => {}) {
    if (engine.exporting || engine.dragging || engine.drawingPath || engine.disposed) throw new Error('请先结束当前导出或编辑操作');
    const project = engine.project, cameraId = options.cameraId ?? 'program';
    if (options.end > project.duration) throw new Error('检查结束时间超出场景时长');
    if (cameraId !== 'program' && !engine.cameras.has(cameraId)) throw new Error('检查摄影机不存在');
    const checkpoint = JSON.stringify(project);
    const bodies = sceneTargets(engine); // Physical walls remain obstacles even if the filming camera hides them.
    const select = (key: string) => bodies.filter(b => key === 'all-people' ? b.person : b.key === key || (key.startsWith('entity:') && b.entityId === key.slice(7)));
    const targets = select(options.targetKey), others = options.compareKey ? select(options.compareKey) : bodies;
    if (!targets.length || !others.length) throw new Error('请选择显示中的人物、群演或道具进行区间检查');
    if (options.compareKey === options.targetKey) throw new Error('区间检查需要两个不同对象，或让 B 保持“不比较”以检查全部障碍');
    const times = rangeSampleTimes(options.start, options.end, options.sampleFps, project.entities.flatMap(e => [
        ...e.clips.flatMap(c => [c.start, c.end]), ...e.poseKeys.map(k => k.time),
        ...pathCheckTimes(e.path)
    ]).concat(project.cuts.map(c => c.time)));
    const report: SpatialRangeReport = { format: 'director-spatial-range', version: 1, projectName: project.name, options: { ...options, cameraId }, samples: times.length,
        processedSamples: 0, complete: false, findings: [], limitations: [
            '碰撞结果是几何包围盒的潜在穿插提示；对方道具逐网格部件检查，可保留门窗与桌腿之间的空隙，但不是三角形精确碰撞。',
            '相邻采样点间检查线性变化包围盒的运动交叠；旋转、弯曲路径和关节运动仍可能在采样间偏离，未发现问题不代表绝对安全。',
            '小于或等于 0.02 米的边界穿入不报告，以过滤脚底支撑接触。实体隐藏墙仅影响拍摄，仍参与物理路径检查。',
            options.occlusion ? '入画与遮挡按采样时刻检查；遮挡使用 7×7 射线，不能代表逐像素可见性，采样间变化可能漏检。' : '入画按采样时刻检查；本次未启用区间遮挡检查。',
            '达到 2000 条独立问题后停止并标记 complete=false；可以缩小区间再次检查。'
        ] };
    let previous: Map<string, ReturnType<typeof bounds>> | null = null, previousTime = times[0], active = new Map<string, SpatialFinding>();
    for (let index = 0; index < times.length; index++) {
        signal?.throwIfAborted();
        if (engine.project !== project || engine.disposed) throw new Error('场景已改变，检查已停止，请重新运行');
        const at = times[index], originalTime = engine.time, nextActive = new Map<string, SpatialFinding>();
        try {
            engine.sample(at);
            const current = new Map(bodies.map(b => [b.key, bounds(b)]));
            function record(type: SpatialFinding['type'], target: SceneTarget, start: number, end: number, description: string, other?: SceneTarget) {
                const previewTime = start === end ? start : (start + end) / 2;
                const realCamera = cameraId === 'program' ? activeCameraId(project, previewTime) : cameraId;
                const key = `${type}|${target.key}|${other?.key ?? ''}|${realCamera}`;
                const old = active.get(key);
                if (old && (type === 'potential-overlap' ? start <= old.end + 1e-7 : old.end >= previousTime - 1e-7)) { old.end = end; nextActive.set(key, old); }
                else if (report.findings.length < 2000) {
                    const finding: SpatialFinding = { id: `finding-${report.findings.length + 1}`, type, targetKey: target.key, targetEntityId: target.entityId,
                        targetName: target.name, otherKey: other?.key, otherName: other?.name, start, end, time: previewTime, cameraId: realCamera, description };
                    report.findings.push(finding); nextActive.set(key, finding);
                }
            }
            const checkedPairs = new Set<string>();
            for (const target of targets) {
                const a = current.get(target.key)!, prevA = previous?.get(target.key) ?? a;
                for (const other of others) {
                    if (other.key === target.key) continue;
                    const pair = [target.key, other.key].sort().join('|'); if (checkedPairs.has(pair)) continue; checkedPairs.add(pair);
                    const b = current.get(other.key)!, prevB = previous?.get(other.key) ?? b;
                    if (!sweptBoxOverlap(prevA.whole, a.whole, prevB.whole, b.whole)) continue;
                    let hit: [number, number] | null = null;
                    for (let part = 0; part < b.parts.length; part++) {
                        const candidate = sweptBoxOverlap(prevA.whole, a.whole, prevB.parts[part], b.parts[part]);
                        if (candidate) hit = hit ? [Math.min(hit[0], candidate[0]), Math.max(hit[1], candidate[1])] : candidate;
                    }
                    if (hit) record('potential-overlap', target, previousTime + (at - previousTime) * hit[0], previousTime + (at - previousTime) * hit[1],
                        `${target.name} 与 ${other.name} 的运动包围盒可能穿插，请定位复核。`, other);
                }
                const frame = frameBounds(a.whole, engine.getShotCamera(cameraId));
                if (frame.status === 'outside') record('out-of-frame', target, at, at, '对象包围盒在机位画外。');
                else if (frame.status === 'intersecting') record('clipped', target, at, at, '对象包围盒受到画幅或远近裁切面裁切。');
            }
            if (options.occlusion) for (const [key, v] of visibilityChecks(engine, cameraId, targets.map(t => t.key))) {
                const target = targets.find(t => t.key === key)!;
                if (v.body.status === 'blocked-samples') record('body-blocked', target, at, at, `身体命中的 ${v.body.targetSamples} 个采样点均被遮挡；${v.body.blockers.map(b => b.name).join('、')}。`);
                if (v.face.status === 'blocked-samples') record('face-blocked', target, at, at, `面部区域采样点均被遮挡；${v.face.blockers.map(b => b.name).join('、')}。`);
            }
            previous = current; previousTime = at; active = nextActive; report.processedSamples++;
        } finally { engine.sample(originalTime); }
        progress(index + 1, times.length);
        if (report.findings.length >= 2000) return report;
        // Restore the live scene before yielding, so progress/cancel never renders a sampled future frame.
        if (index % 4 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (JSON.stringify(engine.project) !== checkpoint) throw new Error('检查期间工程发生修改，请重新检查');
        }
    }
    signal?.throwIfAborted();
    if (JSON.stringify(engine.project) !== checkpoint) throw new Error('检查期间工程发生修改，请重新检查');
    report.complete = true; return report;
}
