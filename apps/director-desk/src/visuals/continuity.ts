import type { Entity, Project } from '../model.ts';
import { numberAt, type AnimatedNumber } from '../animation/channels.ts';
import { mediaTime, surfaceOpacity } from '../media/model.ts';

/** Preserve effect phase when an independent take starts at the preceding output frame. */
export function freezeVisualState(e:Entity,project:Project,time:number){
    for(const config of [e.visual,e.field,e.warp,e.deform,e.surface])if(config){
        for(const [key,value]of Object.entries(config))if(value&&typeof value==='object'&&!Array.isArray(value)&&'keys' in value)
            Object.assign(config,{[key]:numberAt(value as AnimatedNumber,time)});
    }
    for(const config of [e.visual,e.field])if(config){
        const active=time>=config.start&&(!config.end||time<config.end);
        if(!active)e.visible=false;
        config.timeOffset=(config.timeOffset??0)+Math.max(0,time-config.start);config.start=0;config.end=0;
    }
    if(e.warp)e.warp.timeOffset=(e.warp.timeOffset??0)+time;
    if(e.deform)e.deform.timeOffset=(e.deform.timeOffset??0)+time;
    for(const l of e.surface?.layers??[]){
        const r=project.media?.find(r=>r.id===l.resourceId);if(!r)continue;
        const at=mediaTime(l,r,time);l.opacity=surfaceOpacity(l,time);
        l.timeOffset=Math.max(0,(at??l.trimIn)-l.trimIn)/l.speed;l.start=0;
    }
}
export function receivesRootField(e:Entity,project:Project,time:number){
    return e.kind!=='camera'&&!e.field&&!e.warp&&!e.handBinding&&project.entities.some(f=>f.visible&&f.field&&time>=f.field.start&&(!f.field.end||time<f.field.end)&&
        (f.field.targets.length?f.field.targets.includes(e.id):!!e.visual));
}
