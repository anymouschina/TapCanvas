import { assertProject, clone, type Project, type Vec3 } from '../model.ts';
import { entityPosition, entityYaw } from '../timeline.ts';
import { emptyEditorView } from '../building/floors.ts';
import { portableRoom } from './portable-room.ts';
import { cameraLookAt } from '../animation/camera-look.ts';
import { numberAt } from '../animation/channels.ts';
import { lightIntensity } from '../lighting/model.ts';
import { lightColor } from '../lighting/runtime.ts';

export interface MergeSceneOptions {
    offset: Vec3;
    timeOffset: number;
    scheduling: 'keep' | 'reset';
    cuts: 'keep' | 'insert';
}
export interface MergeSceneResult {
    project: Project;
    entityIds: Record<string, string>;
    addedIds: string[];
    addedResources: number;
    reusedResources: number;
    warnings: string[];
}

/** Pure, atomic merge used by UI and offline/agent workflows. Loading GPU resources belongs to the caller. */
export function mergeScene(destination: Project, source: Project, options: MergeSceneOptions): MergeSceneResult {
    assertProject(destination); assertProject(source);
    if (!options || !Array.isArray(options.offset) || options.offset.length !== 3 || !options.offset.every(Number.isFinite)
        || !Number.isFinite(options.timeOffset) || options.timeOffset < 0 || !['keep', 'reset'].includes(options.scheduling)
        || !['keep', 'insert'].includes(options.cuts) || options.scheduling === 'reset' && options.cuts === 'insert')
        throw Error('场景插入参数无效；清空调度时不能插入原切镜');
    const p = clone(destination), incoming = portableRoom(source), { offset, timeOffset, scheduling } = options;
    const initial = scheduling === 'reset' ? new Map(incoming.entities.map(e => [e.id, { position: entityPosition(e, 0).toArray(), yaw: entityYaw(e, 0, incoming) }])) : null;
    const warnings: string[] = [];
    if (source.lighting) warnings.push('已保留目标场景的全局环境照明；源场景中的独立灯具随对象导入。');
    const reserved = new Set<string>();
    for (const data of [destination, incoming]) {
        data.entities.forEach(e => { reserved.add(e.id); e.clips.forEach(c => reserved.add(c.id)); });
        data.floors?.forEach(f => reserved.add(f.id)); data.zones?.forEach(z => reserved.add(z.id)); data.references.forEach(r => reserved.add(r.id));
        data.production?.notes.forEach(n => reserved.add(n.id));
    }
    const fresh = () => { let id: string; do { id = crypto.randomUUID(); } while (reserved.has(id)); reserved.add(id); return id; };
    const entityMap = new Map(incoming.entities.map(e => [e.id, fresh()])), floorMap = new Map((incoming.floors ?? []).map(f => [f.id, fresh()]));
    const referenceMap = new Map<string, string>();
    for (const r of incoming.references) {
        const existing = p.references.find(other => other.data === r.data);
        const id = existing?.id ?? fresh(); referenceMap.set(r.id, id);
        if (!existing) p.references.push({ ...r, id });
    }
    for(const r of incoming.media??[]){p.media??=[];const previous=p.media.find(x=>x.id===r.id);if(previous&&previous.data!==r.data)throw Error('媒体源标识冲突');if(!previous)p.media.push(r);}
    let addedResources = 0, reusedResources = 0;
    for (const r of incoming.resources ?? []) {
        p.resources ??= []; const existing = p.resources.find(other => other.id === r.id);
        if (existing) {
            if (JSON.stringify(existing.package) !== JSON.stringify(r.package)) throw Error(`模型资源标识冲突：${r.name}`);
            for (const key of ['copyright', 'license', 'source'] as const)
                if (r[key] && existing[key] !== r[key] && !existing[key].split('\n').includes(r[key])) existing[key] = [existing[key], r[key]].filter(Boolean).join('\n');
            reusedResources++;
        } else { p.resources.push(r); addedResources++; }
    }
    if (p.resources !== undefined) p.version = 2;
    const move = (position: Vec3): Vec3 => position.map((v, i) => v + offset[i]) as Vec3;
    const zoneMap = new Map((incoming.zones ?? []).map(z => [z.id, fresh()]));
    if (incoming.zones?.length) p.zones = [...(p.zones ?? []), ...incoming.zones.map(z => ({ ...z, id: zoneMap.get(z.id)!, min: move(z.min), max: move(z.max),
        ...(z.connectsTo ? { connectsTo: z.connectsTo.map(id => zoneMap.get(id)!) } : {}) }))];
    for (const e of incoming.entities) {
        const originalId = e.id;
        if(e.visual?.cameraId)e.visual.cameraId=entityMap.get(e.visual.cameraId)!;
        if(e.field)e.field.targets=e.field.targets.map(id=>entityMap.get(id)!);
        const shift=(v:import('../animation/channels.ts').AnimatedNumber)=>typeof v==='number'?v:scheduling==='reset'?numberAt(v,0):{keys:v.keys.map(k=>({...k,time:k.time+timeOffset}))};
        for(const config of [e.visual,e.field,e.warp,e.deform,e.surface])if(config)for(const [key,value]of Object.entries(config)){if(value&&typeof value==='object'&&!Array.isArray(value)&&'keys' in value)Object.assign(config,{[key]:shift(value as import('../animation/channels.ts').AnimatedNumber)});}
        for(const config of [e.visual,e.field])if(config){config.start=scheduling==='reset'?0:config.start+timeOffset;if(config.end)config.end=scheduling==='reset'?0:config.end+timeOffset;}
        for(const l of e.surface?.layers??[]){l.start=scheduling==='reset'?0:l.start+timeOffset;l.opacity=shift(l.opacity);}

        if (scheduling === 'reset') {
            e.position = initial!.get(e.id)!.position;
            if ((e.kind === 'actor' || e.kind === 'crowd') && !e.faceTarget) { e.rotation[1] = initial!.get(e.id)!.yaw; e.face = 'fixed'; }
            e.path = null; e.clips = []; e.poseKeys = [];
        } else {
            e.clips.forEach(c => { c.id = fresh(); c.start += timeOffset; c.end += timeOffset; });
            e.poseKeys.forEach(k => k.time += timeOffset);
            if (e.path) {
                e.path.points.forEach(pt => { pt.position = move(pt.position); pt.time += timeOffset; });
                e.path.sections?.forEach(s => { s.start += timeOffset; s.end += timeOffset; s.from += timeOffset; s.to += timeOffset; });
            }
        }
        e.position = move(e.position); e.id = entityMap.get(originalId)!;
        if (e.floorId) e.floorId = floorMap.get(e.floorId)!;
        if (e.faceTarget) e.faceTarget = entityMap.get(e.faceTarget)!;
        if (e.reference) e.reference = referenceMap.get(e.reference)!;
        if (e.handBinding) e.handBinding.actorId = entityMap.get(e.handBinding.actorId)!;
        if (e.structureLink) e.structureLink.parentId = entityMap.get(e.structureLink.parentId)!;
        if (e.camera) {
            const effects = e.camera.effects;
            if (effects) {
                if (effects.focusTargetId) effects.focusTargetId = entityMap.get(effects.focusTargetId)!;
                for (const key of Object.keys(effects.channels ?? {}) as (keyof NonNullable<typeof effects.channels>)[]) {
                    const value = effects.channels![key];
                    if (scheduling === 'reset') effects.channels![key] = numberAt(value, 0);
                    else if (typeof value === 'object') value.keys.forEach(k => k.time += timeOffset);
                }
                if (effects.shake) { if (scheduling === 'reset') effects.shake = null; else { effects.shake.start += timeOffset; effects.shake.end += timeOffset; } }
            }
            if (e.camera.targetPath) {
                const route = e.camera.targetPath;
                if (scheduling === 'reset') route.points = [{ time: 0, position: move(cameraLookAt(route, 0).toArray()) }];
                else route.points.forEach(point => { point.time += timeOffset; point.position = move(point.position); });
            }
            if (e.camera.targetId) e.camera.targetId = entityMap.get(e.camera.targetId)!;
            e.camera.target = move(e.camera.target);
            if (e.camera.hiddenEntityIds) e.camera.hiddenEntityIds = e.camera.hiddenEntityIds.map(id => entityMap.get(id)!);
        }
        if (e.light) {
            if (scheduling === 'reset') {
                e.color = '#' + lightColor(e, 0).getHexString(); e.light.intensity = lightIntensity(e.light, 0); delete e.light.temperature; delete e.light.colorKeys; e.light.flicker = null;
            } else {
                for (const value of [e.light.intensity, e.light.temperature]) if (typeof value === 'object') value.keys.forEach(k => k.time += timeOffset);
                e.light.colorKeys?.forEach(k => k.time += timeOffset);
                if (e.light.flicker) e.light.flicker.start = (e.light.flicker.start ?? 0) + timeOffset;
            }
        }
        p.entities.push(e);
    }
    if (incoming.floors?.length) p.floors = [...(p.floors ?? []), ...incoming.floors.map(f => ({ ...f, id: floorMap.get(f.id)!, elevation: f.elevation + offset[1] }))];
    if (incoming.editorView) {
        p.editorView ??= emptyEditorView();
        p.editorView.hiddenEntityIds.push(...incoming.editorView.hiddenEntityIds.map(id => entityMap.get(id)!));
        p.editorView.hiddenFloorIds.push(...incoming.editorView.hiddenFloorIds.map(id => floorMap.get(id)!));
    }
    if (incoming.production) {
        p.production ??= { fixedPrompt: '', sceneReferenceIds: [], notes: [] };
        if (incoming.production.fixedPrompt && incoming.production.fixedPrompt !== p.production.fixedPrompt)
            p.production.fixedPrompt = [p.production.fixedPrompt, incoming.production.fixedPrompt].filter(Boolean).join('\n\n');
        p.production.sceneReferenceIds = [...new Set([...p.production.sceneReferenceIds, ...incoming.production.sceneReferenceIds.map(id => referenceMap.get(id)!)])];
        if (scheduling === 'keep') p.production.notes.push(...incoming.production.notes.map(n => ({ ...n, id: fresh(), start: n.start + timeOffset, end: n.end + timeOffset, actorId: n.actorId ? entityMap.get(n.actorId)! : '' })));
    }
    if (scheduling === 'keep') p.duration = Math.max(p.duration, timeOffset + source.duration);
    if (options.cuts === 'insert') {
        const end = timeOffset + source.duration;
        const resume = [...destination.cuts].reverse().find(c => c.time <= end)!;
        p.cuts = [
            ...p.cuts.filter(c => c.time < timeOffset || c.time >= end),
            ...incoming.cuts.map(c => ({ time: c.time + timeOffset, cameraId: entityMap.get(c.cameraId)! })),
        ];
        if (end < p.duration && !p.cuts.some(c => c.time === end)) p.cuts.push({ time: end, cameraId: resume.cameraId });
        p.cuts.sort((a, b) => a.time - b.time);
        warnings.push('插入区间内的原切镜已替换，区间结束后恢复原工程机位。');
    }
    if (source.aspect !== destination.aspect || source.fps !== destination.fps) warnings.push('沿用当前工程画幅和帧率；站位与秒数不变，构图边缘可能变化。');
    if (scheduling === 'reset') warnings.push('已清空插入对象的路径、动作、姿态关键帧与剧情时间备注；保留初始站位、默认姿态及人物／机位绑定。');
    if (timeOffset > 0 && scheduling === 'keep') warnings.push('开始时间平移调度，不控制对象出现时间；开始前对象仍在场。');
    assertProject(p);
    return { project: p, entityIds: Object.fromEntries([...entityMap].filter(([id]) => source.entities.some(e => e.id === id))), addedIds: incoming.entities.map(e => e.id), addedResources, reusedResources, warnings };
}
