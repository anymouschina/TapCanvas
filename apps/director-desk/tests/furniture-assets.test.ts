import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { FURNITURE_ASSETS } from '../src/assets/catalog/furniture.ts';
import { makeProp, disposeTree } from '../src/assets.ts';
import { entity, demoProject, assertProject } from '../src/model.ts';
import { assetParameters } from '../src/assets/parameters.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { HAND_PROP_ASSETS } from '../src/assets/catalog/hand-props.ts';

test('every furniture preset creates finite grounded geometry and survives project import',()=>{
    for(const a of FURNITURE_ASSETS){
        const e=entity('prop',a.id,a.name),p=demoProject();p.entities.push(e);assertProject(p);
        const root=makeProp(e),bounds=new T.Box3().setFromObject(root,true),size=bounds.getSize(new T.Vector3());
        assert.ok(!bounds.isEmpty()&&size.toArray().every(n=>Number.isFinite(n)&&n>0),a.id);
        assert.ok(Math.abs(bounds.min.y)<1e-6,`${a.id} floor ${bounds.min.y}`);
        let vertices=0;root.traverse(o=>{if(o instanceof T.Mesh){const positions=o.geometry.attributes.position.array;assert.ok([...positions].every(Number.isFinite),a.id);vertices+=positions.length;}});
        assert.ok(vertices>0);assertProject(JSON.parse(JSON.stringify(p)));disposeTree(root);
    }
});

test('chair height and width edits change real geometry and the seat support point',()=>{
    const e=entity('prop','furniture-chair','chair');e.assetParameters={width:.8,depth:.7,height:1.2,surfaceHeight:.6};
    const root=makeProp(e);root.updateMatrixWorld(true);
    const point=root.userData.contactAnchors[0];assert.deepEqual(point.position,[0,.6,0]);
    const ray=new T.Raycaster(new T.Vector3(0,.65,0),new T.Vector3(0,-1,0));
    assert.ok(Math.abs(ray.intersectObject(root,true)[0].point.y-.6)<1e-6);
    const b=new T.Box3().setFromObject(root,true);assert.ok(Math.abs(b.max.x-b.min.x-.8)<1e-6);disposeTree(root);
});

test('shelf levels change actual support surfaces and reject fractional or conflicting parameters atomically',()=>{
    const e=entity('prop','furniture-bookshelf','shelf');e.assetParameters={layers:7};
    const root=makeProp(e);root.updateMatrixWorld(true);
    assert.equal(root.userData.contactAnchors.length,7);
    for(const a of root.userData.contactAnchors){
        const ray=new T.Raycaster(new T.Vector3(0,a.position[1]+.005,0),new T.Vector3(0,-1,0));
        assert.ok(Math.abs(ray.intersectObject(root,true)[0].point.y-a.position[1])<1e-6);
    }
    disposeTree(root);
    assert.throws(()=>applyOperations(demoProject(),[{operation:'add',asset:e.asset,patch:{assetParameters:{layers:3.5}}}]));
    assert.throws(()=>applyOperations(demoProject(),[{operation:'add',asset:'furniture-chair',patch:{assetParameters:{surfaceHeight:1,height:.8}}}]));
});

test('opening wardrobe leaves the interior accessible and changes the true outer bounds',()=>{
    const e=entity('prop','furniture-wardrobe','cabinet'),closed=makeProp(e);closed.updateMatrixWorld(true);
    e.assetParameters={opening:95};const open=makeProp(e);open.updateMatrixWorld(true);
    const ray=new T.Raycaster(new T.Vector3(.2,1,3),new T.Vector3(0,0,-1));
    const front=ray.intersectObject(closed,true)[0].point.z,back=ray.intersectObject(open,true)[0].point.z;
    assert.ok(front>0&&back<0,'open doors must expose actual inside back panel');
    assert.ok(new T.Box3().setFromObject(open,true).max.z>new T.Box3().setFromObject(closed,true).max.z+.3);
    disposeTree(open);disposeTree(closed);
});

test('sink and bathtub are recessed and beds provide distinct upper and lower support anchors',()=>{
    for(const id of ['furniture-sink','furniture-bathtub']){
        const e=entity('prop',id,id),root=makeProp(e);root.updateMatrixWorld(true);
        const h=assetParameters(e).height,hit=new T.Raycaster(new T.Vector3(0,h+1,0),new T.Vector3(0,-1,0)).intersectObject(root,true)[0];
        assert.ok(hit.point.y<h*.7,id);disposeTree(root);
    }
    const root=makeProp(entity('prop','furniture-bunk','bunk'));
    const [low,high]=root.userData.contactAnchors;assert.ok(high.position[1]-low.position[1]>.8);disposeTree(root);
});

test('life props keep their requested dimensions, including thin phone and hollow vessels',()=>{
    for(const a of HAND_PROP_ASSETS){
        const e=entity('prop',a.id,a.name),p=demoProject();p.entities.push(e);assertProject(p);
        const root=makeProp(e),bounds=new T.Box3().setFromObject(root,true),size=bounds.getSize(new T.Vector3()),params=assetParameters(e);
        [params.width,params.height,params.depth].forEach((v,i)=>assert.ok(Math.abs(size.getComponent(i)-v)<1e-6,a.id));
        assert.ok(Math.abs(bounds.min.y)<1e-6,a.id);
        if(['prop-cup','prop-bowl','prop-bottle'].includes(a.id)){
            const hit=new T.Raycaster(new T.Vector3(0,params.height+.1,0),new T.Vector3(0,-1,0)).intersectObject(root,true)[0];
            assert.ok(hit&&hit.point.y<params.height*.4,`${a.id} opening must remain hollow`);
        }
        disposeTree(root);
    }
});

test('every furniture support anchor lies on an actual surface, including each sofa cushion',()=>{
    for(const a of FURNITURE_ASSETS){
        const root=makeProp(entity('prop',a.id,a.name));root.updateMatrixWorld(true);
        for(const point of root.userData.contactAnchors){
            const [x,y,z]=point.position;
            const hit=new T.Raycaster(new T.Vector3(x,y+.0001,z),new T.Vector3(0,-1,0)).intersectObject(root,true)[0];
            assert.ok(hit&&Math.abs(hit.point.y-y)<1e-5,`${a.id} ${point.id} ${hit?.point.y} != ${y}`);
        }
        disposeTree(root);
    }
});
