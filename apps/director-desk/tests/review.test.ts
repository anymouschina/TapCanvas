import test from 'node:test';
import assert from 'node:assert/strict';
import {CatmullRomCurve3,Vector3} from 'three';
import {assertProject,clone,demoProject,entity,clip,validateProject} from '../src/model.ts';
import {pathPosition,entityYaw,sampledAction} from '../src/timeline.ts';
import {sliceAction,clipRange} from '../src/clip-editing.ts';
test('local cubic evaluation matches Three Catmull-Rom including endpoint extrapolation',()=>{
 for(const count of [3,4,20,100]){
  const points=Array.from({length:count},(_,i)=>({time:i,position:[i,Math.sin(i),Math.cos(i*2)] as [number,number,number]}));
  const curve=new CatmullRomCurve3(points.map(p=>new Vector3(...p.position)),false,'catmullrom',.3);
  for(let i=0;i<=200;i++){const time=(count-1)*i/200;assert.ok(pathPosition({smooth:true,points},[0,0,0],time).distanceTo(curve.getPoint(i/200))<1e-10);}
 }
});
test('retimed path sections retain source facing during playback and holds',()=>{
 const p=demoProject(),e=p.entities[0];e.clips=[];e.path={smooth:false,points:[{time:0,position:[0,0,0]},{time:1,position:[2,0,0]},{time:2,position:[2,0,2]}],sections:[{start:20,end:22,from:1,to:2}]};
 for(const t of [20,21,22,30])assert.ok(Math.abs(entityYaw(e,t,p))<1e-5);
});
test('retained action fragments preserve source phase and completion ownership',()=>{
 const original=entity('actor','person','Actor'),edited=clone(original),c=clip('walk',0,10);c.speed=1.5;original.clips=[c];edited.clips=[sliceAction(c,0,3,false),clip('wave',3,5),sliceAction(c,5,10)];
 for(const time of [1,2.9,5,8,9.9])assert.deepEqual(sampledAction(edited,time),sampledAction(original,time));
 assert.equal(edited.clips[0].turnAmount,0);assert.equal(edited.clips[2].turnAmount,1);
});
test('validation rejects ambiguous and unsafe imported identifiers, references and times',()=>{
 const baseline=demoProject();
 const cases:Array<(p:any)=>void>=[p=>p.entities[0].id='bad" onclick="oops',p=>p.entities[0].asset='unsupported',p=>p.entities[0].clips[0].action='constructor',p=>p.entities[0].clips.push(clone(p.entities[0].clips[0])),p=>p.entities[0].reference='missing',p=>p.cuts[2].time=p.duration,p=>p.entities[0].poseKeys=[{time:1,pose:{}},{time:1,pose:{}}]];
 for(const change of cases){const p=clone(baseline);change(p);assert.throws(()=>assertProject(p));}
 assertProject(baseline);assert.notEqual(validateProject(baseline),baseline);
 assert.throws(()=>clipRange(baseline,{kind:'cut',index:99}),/重新选择/);
});
