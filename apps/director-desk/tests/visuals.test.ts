import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createScene} from '../src/scenes.ts';
import {entity,clone,assertProject} from '../src/model.ts';
import {defaultSurfaceLayer} from '../src/media/model.ts';
import {defaultDeform,DeformationRuntime} from '../src/visuals/deformation.ts';
import {VISUAL_PRESETS,FIELD_TYPES} from '../src/visuals/model.ts';
import {WARP_TYPES} from '../src/visuals/warps.ts';
import {writeChannel} from '../src/animation/write-channel.ts';
import {numberAt} from '../src/animation/channels.ts';
import {freezeVisualState} from '../src/visuals/continuity.ts';
import {sampleFields} from '../src/visuals/fields.ts';
import {SceneSession} from '../src/scenes/sequence-session.ts';
import {readSceneDocument,duplicateDocumentScene,projectForScene,updateDocumentScene} from '../src/scenes/sequence-project.ts';
import {mergeScene} from '../src/scenes/merge-project.ts';
import {modelConstructionKey} from '../src/editor/scene-render-cache.ts';
import {validateToolInput} from '../src/automation/validate.ts';
import {isDiscussionToolCall} from '../src/automation/contract.ts';
import {makeVisual,sampleVisual} from '../src/visuals/runtime.ts';

test('every visual catalog default is valid and type changes cannot silently select another asset',()=>{
    for(const asset of [...Object.keys(VISUAL_PRESETS).map(k=>'visual-'+k),...Object.keys(FIELD_TYPES).map(k=>'field-'+k),...Object.keys(WARP_TYPES).map(k=>'warp-'+k)]){
        const p=createScene('blank');p.entities.push(entity('prop',asset,asset));assertProject(p);
        const e=p.entities.at(-1)!;if(e.visual)delete e.visual;else if(e.field)delete e.field;else delete e.warp;
        assert.throws(()=>assertProject(p),/缺少/);
    }
});
test('key edits preserve fractional values, other keys and authored easing',()=>{
    const a=writeChannel(.23,.23,0,true),b=writeChannel(a,1.37,2,true);
    assert.ok(Math.abs(numberAt(b,1)-.8)<1e-10);assert.equal(numberAt(b,0),.23);
    const custom={keys:[{time:0,value:.23},{time:2,value:1.37,easing:{bezier:[.2,.1,.8,.9] as [number,number,number,number]}}]};
    assert.deepEqual((writeChannel(custom,1.6,2,true) as typeof custom).keys[1].easing,custom.keys[1].easing);
});
test('real geometry deformation is reversible, random-access and seed-sensitive without per-frame allocation',()=>{
    const e=entity('prop','cube','形变');e.deform={...defaultDeform('twist'),amount:{keys:[{time:0,value:0},{time:2,value:1}]}};
    const root=new T.Group(),original=new T.BoxGeometry(1,3,1,2,8,2),mesh=new T.Mesh(original,new T.MeshStandardMaterial());root.add(mesh);
    const models=new Map([[e.id,root]]),runtime=new DeformationRuntime();runtime.sample([e],models,0);const retained=mesh.geometry;
    const at0=Array.from(mesh.geometry.attributes.position.array);runtime.sample([e],models,2);const at2=Array.from(mesh.geometry.attributes.position.array);assert.notDeepEqual(at2,at0);assert.equal(mesh.geometry,retained);
    runtime.sample([e],models,0);assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),at0);
    e.deform={...defaultDeform('shatter'),amount:1};runtime.sample([e],models,1);const first=Array.from(mesh.geometry.attributes.position.array);e.deform.seed=77;runtime.sample([e],models,1);assert.notDeepEqual(Array.from(mesh.geometry.attributes.position.array),first);
    e.deform=null;runtime.sample([e],models,1);assert.equal(mesh.geometry,original);runtime.dispose();original.dispose();(mesh.material as T.Material).dispose();
});
test('field evaluation does not accumulate across random seeks and respects targets',()=>{
    const e=entity('prop','cube','移动'),other=entity('prop','cube','不动'),field=entity('prop','field-wind','风');field.field!.targets=[e.id];
    const roots=new Map([e,other,field].map(e=>[e.id,new T.Group()]));
    const sample=(time:number)=>{for(const item of [e,other,field])roots.get(item.id)!.position.fromArray(item.position);sampleFields([e,other,field],roots,time);return roots.get(e.id)!.position.toArray();};
    const first=sample(2);sample(8);assert.deepEqual(sample(2),first);assert.notDeepEqual(first,[0,0,0]);assert.deepEqual(roots.get(other.id)!.position.toArray(),[0,0,0]);
});

test('procedural membrane animation composes with deformation and restores on removal',()=>{
    const e=entity('prop','visual-membrane','膜');e.deform={...defaultDeform('twist'),amount:.7};const root=makeVisual(e),runtime=new DeformationRuntime(),roots=new Map([[e.id,root]]);
    const sample=(time:number)=>{runtime.prepareVisuals();sampleVisual(e,root,time,false);runtime.sample([e],roots,time);return Array.from((root.children[0] as T.Mesh).geometry.getAttribute('position').array);};
    const first=sample(0),next=sample(1);assert.notDeepEqual(first,next);assert.deepEqual(sample(0),first);e.deform=null;sample(1);
    const clean=makeVisual(e);sampleVisual(e,clean,1,false);assert.deepEqual(Array.from((root.children[0] as T.Mesh).geometry.getAttribute('position').array),Array.from((clean.children[0] as T.Mesh).geometry.getAttribute('position').array));runtime.dispose();
});
const media={id:'media-'+'b'.repeat(64),name:'共享图像',mime:'image/png',data:'data:image/png;base64,YWJj',width:2,height:2,duration:0};
test('shared media survives scene switch, undo and merge without repeating data in scene states',()=>{
    const p=createScene('blank');p.media=[media];p.entities[0].surface={layers:[defaultSurfaceLayer(media.id)]};
    const doc=duplicateDocumentScene(readSceneDocument(p),'scene-main','副本','second');assert.equal(doc.media!.length,1);assert.ok(doc.scenes.every(s=>!Object.hasOwn(s.state,'media')));
    const session=new SceneSession(doc);assert.equal(session.project().media![0].id,media.id);
    const tx=session.begin(),next=session.project();next.entities[0].surface!.layers[0].crop=[.5,0,.5,1];session.commit(tx,next);session.undo();assert.equal(session.project().entities[0].surface!.layers[0].crop[0],0);
    const changed=projectForScene(doc);changed.media![0].data='data:image/png;base64,YWJk';assert.throws(()=>updateDocumentScene(doc,'second',changed),/不可原地/);
    const merged=mergeScene(createScene('blank'),p,{offset:[2,0,0],timeOffset:1,scheduling:'keep',cuts:'keep'}).project;assert.equal(merged.media![0].id,media.id);assertProject(merged);
});
test('continuity freezes channels while preserving procedural and video phase',()=>{
    const p=createScene('blank'),e=entity('prop','visual-snow','雪');e.visual!.start=2;e.visual!.opacity={keys:[{time:0,value:0},{time:10,value:1}]};e.deform={...defaultDeform('wave'),amount:1};
    freezeVisualState(e,p,5);assert.equal(e.visual!.timeOffset,3);assert.equal(e.visual!.start,0);assert.equal(e.visual!.opacity,.5);assert.equal(e.deform.timeOffset,5);
});
test('runtime-only edits retain geometry and media tools stay read-only in discussion',()=>{
    const e=entity('prop','visual-snow','雪'),a=modelConstructionKey(e);e.visual!.size=2;e.visual!.opacity=.2;e.deform=defaultDeform('wave');assert.equal(modelConstructionKey(e),a);e.visual!.count++;assert.notEqual(modelConstructionKey(e),a);
    validateToolInput('director_media',{action:'surfaces',entityId:'a'});assert.equal(isDiscussionToolCall('director_media',{action:'surfaces',entityId:'a'}),true);assert.equal(isDiscussionToolCall('director_media',{action:'import',path:'local.mp4'}),false);
    const copy=clone({media:[media],items:[{value:1}]});copy.media[0].name='改名';assert.equal(media.name,'共享图像');
});
