import { MathUtils, Vector3 } from 'three';
import { eased } from './animation/channels.ts';
import { continuousPathPosition } from './animation/continuous-path.ts';
import type { Entity, MotionPath, Pose, Project, Vec3 } from './model.ts';
export function pathPosition(path: MotionPath | null, base: Vec3, time: number): Vector3 {
    if (path) time=pathSourceTime(path,time);
    return sourcePathPosition(path,base,time);
}
/** Map playback time to the shared source curve without sorting or allocating sections. */
export function pathSourceTime(path: MotionPath,time:number):number {
    if (!path.sections?.length) return time;
    let first=path.sections[0], previous:typeof first|undefined, active:typeof first|undefined;
    for (const s of path.sections) {
        if(s.start<first.start) first=s;
        if(s.start<=time && time<s.end) active=s;
        if(s.end<=time && (!previous || s.end>previous.end))previous=s;
    }
    const chosen=active??previous??first;
    return MathUtils.lerp(chosen.from,chosen.to,MathUtils.clamp((time-chosen.start)/(chosen.end-chosen.start),0,1));
}
function sourcePathPosition(path:MotionPath|null,base:Vec3,time:number):Vector3 {
    if (!path || !path.points.length)
        return new Vector3(...base);
    if (path.points.length === 1)
        return new Vector3(...path.points[0].position);
    const points = path.points;
    if (time <= points[0].time)
        return new Vector3(...points[0].position);
    if (time >= points.at(-1)!.time)
        return new Vector3(...points.at(-1)!.position);
    if (path.interpolation === 'continuous') return continuousPathPosition(points, time);
    let i = 0;
    while (i < points.length - 2 && time >= points[i + 1].time)
        i++;
    const t = eased((time - points[i].time) / (points[i + 1].time - points[i].time), points[i + 1].easing);
    const a = new Vector3(...points[i].position), b = new Vector3(...points[i + 1].position);
    if (!path.smooth || points.length === 2 || a.distanceToSquared(b) < 1e-12)
        return a.lerp(b, t);
    // Repeated points represent holds; use linear interpolation on either side to avoid loops.
    if ((i > 0 && a.distanceToSquared(new Vector3(...points[i - 1].position)) < 1e-12) || (i + 2 < points.length && b.distanceToSquared(new Vector3(...points[i + 2].position)) < 1e-12))
        return a.lerp(b, t);
    // Uniform Catmull-Rom needs only this segment's four neighbours. Keep Three's tension and endpoint extrapolation.
    const out=new Vector3();
    for(let axis=0;axis<3;axis++) {
        const p1=points[i].position[axis],p2=points[i+1].position[axis];
        const p0=i>0?points[i-1].position[axis]:2*p1-p2;
        const p3=i+2<points.length?points[i+2].position[axis]:2*p2-p1;
        const v0=(p2-p0)*.3,v1=(p3-p1)*.3;
        out.setComponent(axis,p1+v0*t+(-3*p1+3*p2-2*v0-v1)*t*t+(2*p1-2*p2+v0+v1)*t*t*t);
    }
    return out;
}
export function entityPosition(e: Entity, t: number) { return pathPosition(e.path, e.position, t); }
function baseEntityYaw(e: Entity, t: number, project: Project) {
    if (e.face === 'target' && e.faceTarget) {
        const target = project.entities.find(x => x.id === e.faceTarget);
        if (target) {
            const d = entityPosition(target, t).sub(entityPosition(e, t));
            return Math.atan2(d.x, d.z);
        }
    }
    if (e.face === 'path' && e.path && e.path.points.length >= 2) {
        const first=e.path.points[0].time,last=e.path.points.at(-1)!.time;
        const at=MathUtils.clamp(pathSourceTime(e.path,t),first+.0001,last-.0001);
        const a=sourcePathPosition(e.path,e.position,at),b=sourcePathPosition(e.path,e.position,Math.min(last,at+.01));
        let d = b.sub(a);
        if (d.lengthSq() < 1e-10) {
            const points = e.path.points;
            const idx = points.findIndex(p => p.time > at);
            for (let i = Math.max(1, idx); i > 0; i--) {
                d = new Vector3(...points[i].position).sub(new Vector3(...points[i - 1].position));
                if (d.lengthSq() > 1e-10)
                    break;
            }
        }
        if (d.lengthSq() > 1e-10)
            return Math.atan2(d.x, d.z);
    }
    return e.rotation[1];
}
export function entityYaw(e: Entity, t: number, project: Project) {
    return baseEntityYaw(e, t, project) + e.clips.filter(c => c.action === 'turn' && c.end <= t).reduce((sum,c) => sum+(c.turnAmount ?? 1),0) * Math.PI;
}
export function activeClip(e: Entity, t: number) { return e.clips.find(c => t >= c.start && t < c.end); }
export function previousClip(e:Entity,time:number) {
    let previous:Entity['clips'][number]|undefined;
    for(const clip of e.clips) if(clip.end<=time && (!previous || clip.end>previous.end)) previous=clip;
    return previous;
}
export function sampledAction(e: Entity, t: number) {
    const active = activeClip(e, t);
    if (active)
        return { action: active.action, local: (t - active.start) * active.speed + (active.offset ?? 0), progress: (t - active.start + (active.progressOffset ?? 0)) / (active.sourceDuration ?? (active.end - active.start)) };
    const previous = previousClip(e,t);
    if (previous && ['sit', 'crouch', 'crawl', 'lie', 'fall'].includes(previous.action))
        return { action: previous.action === 'fall' ? 'lie' as const : previous.action, local: previous.end - previous.start, progress: 1 };
    return { action: 'idle' as const, local: t, progress: 0 };
}
export function samplePose(e: Entity, time: number): Pose {
    if (!e.poseKeys.length) return {...e.pose};
    let a:Entity['poseKeys'][number]|undefined,b:typeof a;
    for(const key of e.poseKeys) {
        if(key.time<=time && (!a || key.time>a.time))a=key;
        if(key.time>time && (!b || key.time<b.time))b=key;
    }
    if(!a)return {...e.pose,...b!.pose};
    if(!b)return {...e.pose,...a.pose};
    const u = (time - a.time) / (b.time - a.time);
    const out: Pose = { ...e.pose };
    for (const key of new Set([...Object.keys(a.pose), ...Object.keys(b.pose)])) {
        const k = key as keyof Pose;
        out[k] = MathUtils.lerp(a.pose[k] ?? 0, b.pose[k] ?? 0, u);
    }
    return out;
}
export function activeCameraId(project: Project, time: number) { let id = project.cuts[0].cameraId; for (const c of project.cuts) {
    if (c.time > time)
        break;
    id = c.cameraId;
} return id; }
export function shiftPath(e: Entity, delta: Vector3) { e.position = new Vector3(...e.position).add(delta).toArray() as Vec3; e.path?.points.forEach(w => w.position = new Vector3(...w.position).add(delta).toArray() as Vec3); }
export function addCut(project: Project, time: number, cameraId: string) {
    const t = Math.max(0, Math.round(time * project.fps) / project.fps);
    if (t >= project.duration) throw new Error('场景结束处没有可拍摄时长，请向前移动至少一帧再切镜');
    const existing = project.cuts.find(c => Math.abs(c.time - t) < 1e-7);
    if (existing)
        existing.cameraId = cameraId;
    else
        project.cuts.push({ time: t, cameraId });
    project.cuts.sort((a, b) => a.time - b.time);
}
