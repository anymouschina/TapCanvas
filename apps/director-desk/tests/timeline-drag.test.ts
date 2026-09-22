import test from 'node:test';import assert from 'node:assert/strict';
import { demoProject, clone, assertProject } from '../src/model.ts';
import { createTimelineDrag } from '../src/editor/timeline-drag.ts';
test('drag previews use absolute deltas and preserve untouched entity, clip and source identities',()=>{
 const p=demoProject(),e=p.entities[0],other=p.entities[1],resources=p.resources;
 e.clips=[{id:'selected',start:1,end:3,action:'walk',speed:1},{id:'other',start:5,end:7,action:'idle',speed:1}];
 const clip=e.clips[0],untouched=e.clips[1],drag=createTimelineDrag(p,{kind:'action',entityId:e.id,id:clip.id});
 for(const delta of [1,8,2,0,-1,20]){drag.apply(delta,false);assert.equal(p.entities[0],e);assert.equal(p.entities[1],other);assert.equal(p.resources,resources);assert.equal(e.clips[0],clip);assert.equal(e.clips[1],untouched);assertProject(p);}
 drag.apply(0,false);assert.equal(clip.start,1);assert.equal(clip.end,3);assert.equal(p.duration,15);
});
test('path and cut previews reset only timing fields between frames',()=>{
 const p=demoProject(),e=p.entities[1],points=e.path!.points,positions=points.map(p=>p.position),initial=points.map(p=>p.time);
 const path=createTimelineDrag(p,{kind:'path',entityId:e.id,index:0});path.apply(3,false);path.apply(2,false);
 assert.deepEqual(points.map(p=>p.time),initial.map(t=>t+2));points.forEach((p,i)=>assert.equal(p.position,positions[i]));
 const cuts=clone(p.cuts),duration=p.duration;const cut=createTimelineDrag(p,{kind:'cut',index:1});cut.apply(2,true);cut.apply(1,true);
 assert.equal(p.duration,duration+1);assert.equal(p.cuts[2].time,cuts[2].time+1);cut.apply(0,true);assert.deepEqual(p.cuts,cuts);assertProject(p);
});
