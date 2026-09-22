import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
import { entity, demoProject, clone, validateProject, clip } from '../src/model.ts';
import { recordPositionKey } from '../src/editor/position-keys.ts';
import { entityPosition } from '../src/timeline.ts';
import { makeProp, makeHuman, animateHuman, disposeTree } from '../src/assets.ts';
import { structureBoxes } from '../src/parametric-props.ts';
import { fitFeetToSurface } from '../src/editor/foot-contact.ts';
import { splitClip } from '../src/clip-editing.ts';
test('manual K inserts/replaces frame-aligned waypoints, interpolates XYZ, locks and roundtrips',()=>{
 const p=demoProject(),e=p.entities[0];e.path=null;
 recordPositionKey(e,0,[1,0,1],24);validateProject(p);
 recordPositionKey(e,2,[5,2,-1],24);assert.deepEqual(entityPosition(e,1).toArray(),[3,1,0]);
 recordPositionKey(e,2,[7,4,-3],24);assert.equal(e.path!.points.length,2);assert.deepEqual(e.path!.points[0].position,[1,0,1]);
 assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))),p);
 e.locked=true;assert.throws(()=>recordPositionKey(e,3,[0,0,0],24));
});
test('parametric staircase counts, crest descent, return ascent and actual geometry heights',()=>{
 for(const layout of ['straight','crest','return'] as const){
  const e=entity('prop','stairs','Stairs');e.parameters={steps:10,rise:.2,tread:.3,width:1.5,landing:1.2,layout};
  const boxes=structureBoxes(e);assert.equal(boxes.length,layout==='straight'?10:21);
  if(layout==='crest')assert.ok(Math.abs(boxes.at(-1)!.height-.2)<1e-10);
  const g=makeProp(e),bounds=new T.Box3().setFromObject(g);assert.ok(Math.abs(bounds.max.y-(layout==='return'?4:2))<1e-5);disposeTree(g);
 }
});
test('road and wall actual dimensions respect per-axis scale',()=>{
 const e=entity('prop','road','Road');e.parameters={length:30,width:8};e.scale=[2,1,3];
 const g=makeProp(e);g.scale.fromArray(e.scale);const bounds=new T.Box3().setFromObject(g);assert.ok(Math.abs(bounds.getSize(new T.Vector3()).z-90)<1e-5);disposeTree(g);
 e.asset='wall';e.parameters={length:5,height:4,width:.2};const wall=makeProp(e);wall.scale.fromArray(e.scale);assert.ok(Math.abs(new T.Box3().setFromObject(wall).getSize(new T.Vector3()).x-10)<1e-5);disposeTree(wall);
});
const signature=(r:ReturnType<typeof makeHuman>)=>[...r.hips.position.toArray(),...r.hips.rotation.toArray().slice(0,3),...Object.values(r.joints).flatMap(j=>j.rotation.toArray().slice(0,3))] as number[];
test('action transitions are continuous, deterministic and unchanged by splitting during a blend',()=>{
 const p=demoProject(),e=p.entities[0];e.clips=[clip('idle',0,1),clip('sit',1,3)];e.pose={};e.poseKeys=[];
 const r=makeHuman(e);animateHuman(r,e,1-1e-7);const before=signature(r);animateHuman(r,e,1);const at=signature(r);assert.ok(Math.max(...at.map((v,i)=>Math.abs(v-before[i])))<1e-5);
 const original=clone(e);splitClip(p,{kind:'action',entityId:e.id,id:e.clips[1].id},1+2/24);
 for(const t of [1.02,1.1,1.15,1.3,2]){animateHuman(r,original,t);const a=signature(r);animateHuman(r,e,t);const b=signature(r);assert.ok(Math.max(...a.map((v,i)=>Math.abs(v-b[i])))<1e-6);animateHuman(r,e,0);animateHuman(r,e,t);assert.deepEqual(signature(r),b);}
 disposeTree(r.root);
});
test('foot contact lifts a sole onto a reachable step and remains deterministic',()=>{
 const e=entity('actor','person','Actor'),r=makeHuman(e);animateHuman(r,e,0);fitFeetToSurface(r,()=>.18);
 for(const side of ['left','right']){const foot=r.joints[side+'Ankle'].getWorldPosition(new T.Vector3());assert.ok(Math.abs(foot.y-.037-.18)<1e-5);}
 const a=signature(r);animateHuman(r,e,0);fitFeetToSurface(r,()=>.18);assert.deepEqual(signature(r),a);disposeTree(r.root);
});
