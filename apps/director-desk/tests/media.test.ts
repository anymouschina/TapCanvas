import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMediaResources,assertSurface,defaultSurfaceLayer,mediaTime,type MediaResource} from '../src/media/model.ts';
import {demoProject,entity,validateProject} from '../src/model.ts';
import {readSceneDocument,projectForScene,duplicateDocumentScene} from '../src/scenes/sequence-project.ts';
import {applyOperations} from '../src/automation/edits.ts';
const resource:MediaResource={id:'media-'+'a'.repeat(64),name:'测试图片',mime:'image/png',data:'data:image/png;base64,aGVsbG8=',width:2,height:2,duration:0};
test('media fields survive project and independent scene roundtrips without repurposing legacy references',()=>{
    const p=demoProject();p.media=[resource];p.entities[0].surface={layers:[defaultSurfaceLayer(resource.id,'layer')]};
    const q=validateProject(JSON.parse(JSON.stringify(p)));assert.deepEqual(q.media,p.media);assert.deepEqual(q.entities[0].surface,p.entities[0].surface);
    const doc=duplicateDocumentScene(readSceneDocument(q),'scene-main','第二场','scene-two');const copy=projectForScene(doc);copy.entities[0].surface!.layers[0].crop=[.5,0,.5,1];assert.equal(projectForScene(doc,'scene-main').entities[0].surface!.layers[0].crop[0],0);
});
test('surface edits share atomic operations and locked object rules',()=>{
    const p=demoProject();p.media=[resource];const out=applyOperations(p,[{operation:'update',id:p.entities[0].id,patch:{surface:{layers:[defaultSurfaceLayer(resource.id)]}}}]);assert.equal(p.entities[0].surface,undefined);assert.equal(out.entities[0].surface!.layers.length,1);
    out.entities[0].locked=true;assert.throws(()=>applyOperations(out,[{operation:'update',id:out.entities[0].id,patch:{surface:{layers:[]}}}]),/锁定/);
    const camera=p.entities.find(e=>e.kind==='camera')!;assert.throws(()=>applyOperations(p,[{operation:'update',id:camera.id,patch:{surface:{layers:[]}}}]),/摄影机/);
});
test('invalid media and surface crops or references fail validation',()=>{
    const mutable={...resource};assertMediaResources([mutable]);mutable.data='https://example.invalid/changed';assert.throws(()=>assertMediaResources([mutable]),/内嵌/);
    assert.throws(()=>assertMediaResources([{...resource,data:'https://example.invalid/private.png'}]),/内嵌/);
    assert.throws(()=>assertMediaResources([resource,resource]),/元数据/);
    const layer=defaultSurfaceLayer(resource.id);assert.throws(()=>assertSurface({layers:[layer]},[]),/参数/);
    assert.throws(()=>assertSurface({layers:[{...layer,crop:[.8,0,.5,1]}]},[resource]),/参数/);
    assert.throws(()=>assertSurface({layers:[{...layer,offset:[Infinity,0]}]},[resource]),/参数/);
    assert.throws(()=>assertSurface({layers:[],transmission:2},[resource]),/transmission/);
    const p=demoProject();p.entities.push({...entity('prop','cube','测试'),surface:{layers:[layer]}});assert.throws(()=>validateProject(p),/参数/);
});
test('video clock supports offsets, looping, speed and final hold deterministically',()=>{
    const video={...resource,duration:10};const layer={...defaultSurfaceLayer(resource.id),start:3,trimIn:2,trimOut:6,speed:2};
    assert.equal(mediaTime(layer,video,2),null);assert.equal(mediaTime(layer,video,3),2);assert.equal(mediaTime(layer,video,4),4);assert.equal(mediaTime(layer,video,5),2);assert.ok(mediaTime({...layer,loop:false},video,100)!<6);
    const times=[3,8,4,5,3];assert.deepEqual(times.map(t=>mediaTime(layer,video,t)),[2,4,4,2,2]);
});
