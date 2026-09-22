import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import { ASSETS } from '../src/asset-catalog.ts';
import { entity, demoProject, assertProject } from '../src/model.ts';
import { makeProp, disposeTree } from '../src/assets.ts';
import { assetParameters } from '../src/assets/parameters.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { geometrySignature } from './geometry-signature.ts';
const assets = ASSETS.filter(a => ['shape-v1','building-v1','vehicle-v1'].includes(a.family ?? ''));
test('existing shapes, buildings and vehicles preserve captured default geometry', async () => {
    const expected = JSON.parse(await fs.readFile(new URL('./fixtures/structure-default-geometry.json', import.meta.url),'utf8'));
    for (const asset of assets) for (const explicit of [false,true]) {
        const e = entity('prop',asset.id,asset.name); if (explicit) e.assetParameters = assetParameters(e);
        const root = makeProp(e); assert.equal(geometrySignature(root),expected[asset.id],asset.id); disposeTree(root);
    }
});
test('curved shapes change actual precision while keeping exact dimensions, including odd hemisphere counts', () => {
    for (const asset of assets.filter(a => a.family === 'shape-v1' && a.parameters?.segments)) {
        const e = entity('prop',asset.id,asset.name);
        const before = makeProp(e), count = (root: T.Object3D) => { let n = 0; root.traverse(o => { if (o instanceof T.Mesh) n += o.geometry.attributes.position.count; }); return n; };
        e.assetParameters = { segments: 49, width: 2.3, height: 1.8, depth: .7 }; const after = makeProp(e);
        assert.ok(count(after)>count(before),asset.id);
        const b = new T.Box3().setFromObject(after,true), size = b.getSize(new T.Vector3());
        [2.3,1.8,.7].forEach((v,i)=>assert.ok(Math.abs(size.getComponent(i)-v)<1e-5,asset.id));
        assert.ok(Math.abs(b.min.y)<1e-5); disposeTree(before);disposeTree(after);
    }
    const e = entity('prop','shape-hemisphere','半球'); e.assetParameters={segments:7,width:3,height:2,depth:1};
    const root=makeProp(e);root.updateMatrixWorld(true);
    const a=new T.Box3().setFromObject(root.children[0],true),b=new T.Box3().setFromObject(root.children[1],true);
    assert.ok(Math.abs(a.min.x-b.min.x)<1e-6 && Math.abs(a.max.x-b.max.x)<1e-6 && Math.abs(a.min.z-b.min.z)<1e-6 && Math.abs(a.max.z-b.max.z)<1e-6);
    assert.ok(new T.Raycaster(new T.Vector3(0,-1,0),new T.Vector3(0,1,0)).intersectObject(root,true).length>0);disposeTree(root);
});
test('arc angles change actual geometry and all available roof forms keep support anchors on surfaces', () => {
    const e=entity('prop','shape-arc','弧');const signatures=new Set<string>();
    for(const angle of [45,90,180,270,360]) { e.assetParameters={angle};const root=makeProp(e);signatures.add(geometrySignature(root));disposeTree(root); }
    assert.equal(signatures.size,5);
    for(const asset of assets.filter(a=>a.family==='building-v1')) for(const roofStyle of Object.keys(asset.parameters!.roofStyle.choices!)) {
        const e=entity('prop',asset.id,asset.name);e.assetParameters={roofStyle:Number(roofStyle)};
        const p=demoProject();p.entities.push(e);assertProject(p);const root=makeProp(e);root.updateMatrixWorld(true);
        for(const anchor of root.userData.contactAnchors) {
            const point=new T.Vector3(...anchor.position); const ray=new T.Raycaster(point.clone().add(new T.Vector3(0,.01,0)),new T.Vector3(0,-1,0),0,.025);
            assert.ok(ray.intersectObject(root,true).some(hit=>hit.point.distanceTo(point)<1e-4),asset.id+' roof '+roofStyle+' '+anchor.id);
        }
        disposeTree(root);
    }
});
test('vehicle wheelbase and track alter real axle distances and mount anchors lie on their surfaces', () => {
    const centers=(root:T.Object3D)=>{root.updateMatrixWorld(true);const values:T.Vector3[]=[];root.traverse(o=>{if(o.userData.vehiclePart==='wheel')values.push(o.getWorldPosition(new T.Vector3()));});return values;};
    const span=(values:T.Vector3[],axis:'x'|'z')=>Math.max(...values.map(v=>v[axis]))-Math.min(...values.map(v=>v[axis]));
    for(const asset of assets.filter(a=>a.family==='vehicle-v1')) {
        const e=entity('prop',asset.id,asset.name),base=makeProp(e);const old=centers(base);
        e.assetParameters=asset.id==='vehicle-boat'?{}:{wheelbaseRatio:1.15,...(asset.parameters?.trackRatio?{trackRatio:1.1}:{})};const root=makeProp(e);const points=centers(root);
        if(old.length)assert.ok(span(points,'z')>span(old,'z'));if(asset.parameters?.trackRatio)assert.ok(span(points,'x')>span(old,'x'));
        const mounts=root.userData.contactAnchors.filter((a:{id:string})=>a.id.startsWith('camera-'));assert.ok(mounts.length>0,asset.id);
        for(const anchor of mounts){const point=new T.Vector3(...anchor.position);const ray=new T.Raycaster(point.clone().add(new T.Vector3(0,.01,0)),new T.Vector3(0,-1,0),0,.025);assert.ok(ray.intersectObject(root,true).some(hit=>hit.point.distanceTo(point)<1e-4),asset.id+anchor.id);}
        disposeTree(base);disposeTree(root);
    }
    const p=demoProject(),before=JSON.stringify(p);
    for(const [asset,parameters] of [['shape-arc',{angle:0}],['shape-sphere',{segments:8.5}],['building-fortwall',{roofStyle:1}],['vehicle-boat',{trackRatio:1}],['vehicle-sedan',{wheelbaseRatio:4}]] as const)assert.throws(()=>applyOperations(p,[{operation:'add',asset,patch:{assetParameters:parameters}}]));
    assert.equal(JSON.stringify(p),before);
});
