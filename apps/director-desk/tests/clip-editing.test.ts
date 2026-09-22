import assert from 'node:assert/strict';
import test from 'node:test';
import { demoProject, clone, validateProject } from '../src/model.ts';
import { entityPosition, sampledAction, entityYaw } from '../src/timeline.ts';
import { splitClip, setClipRange, deleteClip, dragClipRange } from '../src/clip-editing.ts';
test('splitting smooth paths preserves sampled position and supports independent move/delete/file roundtrip',()=>{
 const p=demoProject(), e=p.entities[1], before=clone(e);
 const right=splitClip(p,{kind:'path',entityId:e.id,index:0},3);
 for(let t=0;t<10;t+=.037) assert.ok(entityPosition(e,t).distanceTo(entityPosition(before,t))<1e-10);
 setClipRange(p,right,20,23); assert.equal(p.duration,23);
 assert.ok(entityPosition(e,21).distanceTo(entityPosition(before,4))<1e-10);
 assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))),p);
 deleteClip(p,{kind:'path',entityId:e.id,index:0}); assert.equal(e.path!.sections!.length,1);
});
test('splitting actions preserves phase, progress and turn accumulation',()=>{
 for(const index of [1,2]) {
  const p=demoProject(),e=p.entities[1],c=e.clips[index],before=clone(e);
  splitClip(p,{kind:'action',entityId:e.id,id:c.id},(c.start+c.end)/2);
  for(let t=0;t<15;t+=.071) {
   const a=sampledAction(e,t),b=sampledAction(before,t);
   assert.equal(a.action,b.action);assert.ok(Math.abs(a.local-b.local)<1e-10);assert.ok(Math.abs(a.progress-b.progress)<1e-10);
   assert.equal(entityYaw(e,t,p),entityYaw(before,t,p));
  }
  validateProject(p);
 }
});
test('shot duration changes boundaries without altering motion and actions',()=>{
 const p=demoProject(), entities=clone(p.entities);
 setClipRange(p,{kind:'cut',index:1},5,8);assert.equal(p.cuts[2].time,8);
 setClipRange(p,{kind:'cut',index:2},8,12);assert.equal(p.duration,12);
 assert.deepEqual(p.entities,entities);validateProject(p);
 assert.throws(()=>setClipRange(p,{kind:'cut',index:0},1,3));
});

test('dragging an action past occupied intervals appends it without altering other clips',()=>{
 const p=demoProject(),e=p.entities[0];
 e.clips=[{id:'drag',start:0,end:2,action:'walk',speed:1},{id:'next',start:3,end:6,action:'idle',speed:1},{id:'last',start:7,end:9,action:'run',speed:1}];
 const unchanged=clone(e.clips.slice(1));
 dragClipRange(p,{kind:'action',entityId:e.id,id:'drag'},4);
 assert.equal(e.clips[0].start,9);assert.equal(e.clips[0].end,11);
 assert.deepEqual(e.clips.slice(1),unchanged);validateProject(p);
 // Moving into a genuinely free gap does not force the clip to the track's end.
 dragClipRange(p,{kind:'action',entityId:e.id,id:'drag'},-9);
 assert.equal(e.clips[0].start,0);validateProject(p);
});

test('right resize stops at a following action, but a last action extends the scene',()=>{
 const p=demoProject(),e=p.entities[0];
 e.clips=[{id:'drag',start:1,end:3,action:'walk',speed:1},{id:'next',start:5,end:8,action:'idle',speed:1}];
 dragClipRange(p,{kind:'action',entityId:e.id,id:'drag'},30,true);
 assert.equal(e.clips[0].end,5);assert.equal(e.clips[1].start,5);validateProject(p);
 dragClipRange(p,{kind:'action',entityId:e.id,id:'next'},25,true);
 assert.equal(e.clips[1].end,33);assert.equal(p.duration,33);validateProject(p);
 const before=clone(p);e.locked=true;
 assert.throws(()=>dragClipRange(p,{kind:'action',entityId:e.id,id:'next'},1),/锁定/);
 assert.deepEqual(e.clips,before.entities[0].clips);
});

test('fractional clip times snap exactly to a touching boundary without skipping the gap',()=>{
 const p=demoProject(),e=p.entities[0];
 e.clips=[{id:'drag',start:1,end:1.2,action:'walk',speed:1},{id:'next',start:.3,end:.6,action:'idle',speed:1}];
 dragClipRange(p,{kind:'action',entityId:e.id,id:'drag'},-.9);
 assert.ok(Math.abs(e.clips[0].start-.1)<1e-8);assert.ok(e.clips[0].end<=.3);validateProject(p);
});

test('split path dragging and resizing use the same collision behavior, retaining source intervals',()=>{
 const p=demoProject(),e=p.entities[1],left={kind:'path' as const,entityId:e.id,index:0};
 splitClip(p,left,3);const source=clone(e.path!.sections!);
 dragClipRange(p,left,2);
 assert.equal(e.path!.sections![0].start,source[1].end);
 assert.equal(e.path!.sections![0].from,source[0].from);
 assert.equal(e.path!.sections![0].to,source[0].to);validateProject(p);
 dragClipRange(p,{...left,index:1},30,true);
 assert.equal(e.path!.sections![1].end,e.path!.sections![0].start);validateProject(p);
});

test('dragging shots reorders them while preserving all shot durations and camera paths',()=>{
 for(const [index,delta] of [[0,20],[2,-20],[1,1],[1,20],[1,-20]]) {
  const p=demoProject(),before=clone(p);
  const lengths=(p:typeof before)=>p.cuts.map((c,i)=>({id:c.cameraId,duration:(p.cuts[i+1]?.time??p.duration)-c.time})).sort((a,b)=>a.id.localeCompare(b.id));
  const s=dragClipRange(p,{kind:'cut',index},delta);
  assert.equal(s.kind,'cut');assert.equal(p.cuts[(s as {index:number}).index].cameraId,before.cuts[index].cameraId);
  assert.deepEqual(lengths(p),lengths(before));assert.equal(p.duration,before.duration);
  assert.deepEqual(p.entities,before.entities);validateProject(p);
 }
});

test('resizing a shot keeps neighboring durations, shifting only following cut times',()=>{
 for(const index of [0,1,2])for(const delta of [-2,8]) {
  const p=demoProject(),before=clone(p);
  dragClipRange(p,{kind:'cut',index},delta,true);
  assert.equal(p.duration,before.duration+delta);
  p.cuts.forEach((c,i)=>{
   const old=before.cuts[i],oldDuration=(before.cuts[i+1]?.time??before.duration)-old.time;
   assert.equal(c.time,old.time+(i>index?delta:0));
   assert.equal((p.cuts[i+1]?.time??p.duration)-c.time,oldDuration+(i===index?delta:0));
  });
  assert.deepEqual(p.entities,before.entities);validateProject(p);
 }
});

test('moving a camera path keeps its duration, other entities, and cut boundaries',()=>{
 const p=demoProject(),e=p.entities.find(e=>e.kind==='camera'&&e.path)!,before=clone(p);
 e.path!.points=[{time:1,position:[0,1,0]},{time:4,position:[1,1,0]}];
 dragClipRange(p,{kind:'path',entityId:e.id,index:0},2);
 assert.deepEqual(e.path!.points.map(p=>p.time),[3,6]);assert.deepEqual(p.cuts,before.cuts);
 assert.deepEqual(p.entities.filter(x=>x.id!==e.id),before.entities.filter(x=>x.id!==e.id));validateProject(p);
});
