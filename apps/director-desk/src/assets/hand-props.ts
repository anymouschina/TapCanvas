import * as T from 'three';
import type { Entity } from '../model.ts';
import { HAND_PROP_SPECS } from './catalog/hand-props.ts';
import { assetParameters } from './parameters.ts';
import { box, cylinder, material, mesh } from './geometry.ts';

export function makeHandProp(e:Entity) {
    const spec=HAND_PROP_SPECS.find(s=>s.id===e.asset);
    if(!spec)throw new Error(`未实现生活道具：${e.asset}`);
    const root=new T.Group(),model=new T.Group();root.add(model);
    const m=material(e.color),dark=material(new T.Color(e.color).multiplyScalar(.72)),light=material(new T.Color(e.color).lerp(new T.Color('#ffffff'),.3));
    const b=(w:number,h:number,d:number,x=0,y=h/2,z=0,mat:T.Material=m)=>box(model,mat,w,h,d,x,y,z,.025);
    const turn=(points:number[][])=>mesh(model,new T.LatheGeometry(points.map(([x,y])=>new T.Vector2(x,y)),32),m);
    if(spec.style==='cup'){
        turn([[0,0],[.42,0],[.5,.05],[.5,1],[.43,1],[.43,.12],[0,.12]]);
        const handle=new T.TorusGeometry(.29,.055,12,24);mesh(model,handle,m,.56,.56,0);
    }else if(spec.style==='bowl')turn([[0,0],[.22,0],[.3,.04],[.43,.18],[.50,.5],[.46,.52],[.39,.20],[.23,.10],[0,.1]]);
    else if(spec.style==='plate')turn([[0,0],[.38,0],[.5,.06],[.5,.09],[.40,.045],[0,.035]]);
    else if(spec.style==='bottle'){
        turn([[0,0],[.34,0],[.38,.05],[.38,.75],[.14,.94],[.14,1.18],[.105,1.18],[.105,.95],[.31,.73],[.31,.07],[0,.07]]);
    }else if(spec.style==='book'){
        b(1,.04,1.45,0,.02,0);b(.96,.16,1.40,0,.12,0,light);b(1,.04,1.45,0,.22,0);b(.06,.24,1.45,-.47,.12,0);
        for(const y of [.075,.10,.125,.15,.175])b(.9,.003,1.40,.01,y,0,dark);
    }else if(spec.style==='phone'){
        b(.75,.06,1.55);b(.68,.008,1.4,0,.064,0,dark);b(.14,.005,.02,0,.071,-.63,light);
    }else if(spec.style==='suitcase'){
        b(1,1.25,.55,0,.74,0);b(.85,.88,.05,0,.75,.3,light);
        for(const x of [-.4,.4])for(const z of [-.18,.18]){const wheel=cylinder(model,dark,.07,.07,.075,x,.07,z);wheel.rotation.z=Math.PI/2;}
        for(const x of [-.22,.22])b(.035,.45,.035,x,1.45,-.15,dark);b(.50,.06,.08,0,1.70,-.15,dark);
    }else if(spec.style==='backpack'){
        b(.8,1.15,.48,0,.575,0);b(.62,.50,.18,0,.30,.29,light);b(.45,.12,.10,0,1.21,0);
        for(const x of [-.22,.22]){b(.10,.94,.08,x,.6,-.34);b(.10,.08,.18,x,.18,-.29);b(.10,.08,.18,x,1.02,-.29);}
    }
    model.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(model,true),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),p=assetParameters(e);
    model.scale.set(p.width/size.x,p.height/size.y,p.depth/size.z);
    model.position.set(-center.x*model.scale.x,-bounds.min.y*model.scale.y,-center.z*model.scale.z);
    return root;
}
