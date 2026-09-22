import * as T from 'three';
import type { Entity } from '../model.ts';
import type { Rig } from './human-legacy.ts';
import { samplePose, sampledAction, activeClip, previousClip, entityPosition } from '../timeline.ts';
export function sampleHumanAction(r: Rig, e: Entity, time: number, phaseOffset = 0) {
    const sampled = sampledAction(e, time), action = sampled.action, t = sampled.local + phaseOffset;
    for (const j of Object.values(r.joints))
        j.rotation.set(0, 0, 0);
    const restHeight = r.restHipHeight ?? .94, stature = restHeight / .94;
    r.hips.position.y = restHeight;
    r.hips.rotation.set(0, 0, 0);
    r.joints.leftArm.rotation.z = -.09;
    r.joints.rightArm.rotation.z = .09;
    const set = (joint: string, x: number) => { r.joints[joint].rotation.x = x; };
    if (action === 'walk' || action === 'run') {
        const rate = action === 'run' ? 10 : 6;
        const velocity=entityPosition(e,time+.04).sub(entityPosition(e,Math.max(0,time-.04)));
        const slope=T.MathUtils.clamp(Math.abs(velocity.y)/Math.max(.001,Math.hypot(velocity.x,velocity.z)),0,1);
        const a = (action === 'run' ? .8 : .48) + slope*.2;
        const ph = t * rate;
        for (const side of ['left', 'right']) {
            const s = Math.sin(ph + (side === 'left' ? 0 : Math.PI));
            set(`${side}Hip`, s * a);
            set(`${side}Knee`, Math.max(0, -s) * (a * 1.6+slope*.5));
            set(`${side}Arm`, -s * a * .7);
            set(`${side}Elbow`, -.18 - (action === 'run' ? .75 : 0));
        }
        r.hips.position.y += Math.abs(Math.cos(ph)) * .018;
        set('torso', action === 'run' ? .15 : .025);
    }
    if (action === 'sit' || action === 'standup') {
        const mix = action === 'sit' ? 1 : 1 - T.MathUtils.smoothstep(sampled.progress, 0, 1);
        r.hips.position.y -= .37 * stature * mix;
        for (const side of ['left', 'right']) {
            set(`${side}Hip`, -1.43 * mix);
            set(`${side}Knee`, 1.43 * mix);
            set(`${side}Arm`, -.34 * mix);
            set(`${side}Elbow`, -.6 * mix);
        }
        set('torso', action === 'standup' ? Math.sin(sampled.progress * Math.PI) * .35 : 0);
    }
    if (action === 'crouch') {
        r.hips.position.y = .58 * stature;
        set('torso', .3);
        for (const side of ['left', 'right']) {
            set(`${side}Hip`, -1.05);
            set(`${side}Knee`, 1.85);
            set(`${side}Arm`, -.65);
        }
    }
    if (action === 'crawl') {
        r.hips.position.y = .46 * stature;
        set('torso', 1.35);
        set('head', -.9);
        for (const side of ['left', 'right']) {
            const ph = t * 4 + (side === 'left' ? 0 : Math.PI);
            set(`${side}Hip`, -.12 + Math.sin(ph) * .18);
            set(`${side}Knee`, 1.55);
            set(`${side}Arm`, -1.25 - Math.sin(ph) * .18);
            set(`${side}Elbow`, -.15);
        }
    }
    if (action === 'jump') {
        const u = T.MathUtils.clamp(sampled.progress, 0, 1);
        r.hips.position.y += Math.sin(u * Math.PI) * .65;
        set('leftArm', -Math.sin(u * Math.PI) * 2);
        set('rightArm', -Math.sin(u * Math.PI) * 2);
    }
    if (action === 'lie' || action === 'fall') {
        const mix = action === 'lie' ? 1 : T.MathUtils.smoothstep(sampled.progress, 0, 1);
        r.hips.rotation.x = -Math.PI / 2 * mix;
        r.hips.position.y = restHeight - .78 * stature * mix;
    }
    if (action === 'wave') {
        // Right shoulder is on +X and the resting arm points down (-Y).
        // Positive Z raises it outwards; negative Z folds it across the head.
        r.joints.rightArm.rotation.z = 2.35;
        set('rightElbow', -.65 + Math.sin(t * 6) * .3);
    }
    if (action === 'point') {
        set('rightArm', -Math.PI / 2);
        set('rightElbow', -.06);
    }
    if (action === 'turn')
        r.hips.rotation.y = T.MathUtils.smoothstep(sampled.progress, 0, 1) * Math.PI;
 }
export function sampleHumanBody(r:Rig,e:Entity,time:number,phaseOffset=0) {
    const active=activeClip(e,time),duration=e.actionBlend??.2;
    const last=previousClip(e,time);
    const anchor=active ? active.start-(active.progressOffset??0) : last?.end ?? 0;
    const window=active ? Math.min(duration,active.sourceDuration??active.end-active.start) : duration;
    const previous=previousClip(e,anchor+1e-8);
    const blend=anchor>0 && window>0 && time-anchor<window;
    if(blend){
        sampleHumanAction(r,e,anchor-1e-7,phaseOffset);
        const hipPosition=r.hips.position.clone(),hipRotation=r.hips.rotation.clone();
        if(previous?.action==='turn' && Math.abs(previous.end-anchor)<1e-6) hipRotation.y-=(previous.turnAmount??1)*Math.PI;
        const rotations=Object.fromEntries(Object.entries(r.joints).map(([k,v])=>[k,v.rotation.clone()]));
        sampleHumanAction(r,e,time,phaseOffset);
        const u=T.MathUtils.smoothstep((time-anchor)/window,0,1);
        r.hips.position.lerpVectors(hipPosition,r.hips.position,u);
        for(const axis of ['x','y','z'] as const)r.hips.rotation[axis]=T.MathUtils.lerp(hipRotation[axis],r.hips.rotation[axis],u);
        for(const [key,joint] of Object.entries(r.joints))for(const axis of ['x','y','z'] as const)joint.rotation[axis]=T.MathUtils.lerp(rotations[key][axis],joint.rotation[axis],u);
    }else sampleHumanAction(r,e,time,phaseOffset);
}
export function animateHuman(r: Rig, e: Entity, time: number, phaseOffset = 0) {
    sampleHumanBody(r, e, time, phaseOffset); applyHumanPose(r, e, time);
}
export function applyHumanPose(r: Rig, e: Entity, time: number) {
    const pose = samplePose(e, time);
    for (const [joint, v] of Object.entries(pose)) {
        if (joint === 'headYaw')
            r.head.rotation.y = T.MathUtils.degToRad(v);
        else if (r.joints[joint])
            r.joints[joint].rotation.x += T.MathUtils.degToRad(v);
    }
}
