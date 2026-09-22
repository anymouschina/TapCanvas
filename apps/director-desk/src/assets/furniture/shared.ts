import * as T from 'three';
import { box, cylinder, material, mesh } from '../geometry.ts';
import type { Entity } from '../../model.ts';
import type { ContactAnchor } from '../contact-anchors.ts';
export type { ContactAnchor } from '../contact-anchors.ts';
import { assetParameters } from '../parameters.ts';
export function furnitureBuilder(e:Entity) {
    const root=new T.Group(),p=assetParameters(e),m=material(e.color),dark=material(new T.Color(e.color).multiplyScalar(.7)),light=material(new T.Color(e.color).lerp(new T.Color('#ffffff'),.22));
    const w=p.width,h=p.height,d=p.depth,t=Math.min(.045,w*.08,h*.08,d*.08),anchors:ContactAnchor[]=[];
    root.userData.contactAnchors=anchors;
    const b=(width:number,height:number,depth:number,x=0,y=height/2,z=0,mat:T.Material=m,parent:T.Object3D=root)=>box(parent,mat,width,height,depth,x,y,z,Math.min(.012,t/3));
    const c=(radius:number,height:number,x=0,y=height/2,z=0,mat:T.Material=m)=>cylinder(root,mat,radius,radius,height,x,y,z);
    const panel=(width:number,height:number,x:number,y:number,z:number,mat:T.Material=m)=>b(width,height,t,x,y,z,mat);
    const legs=(top:number,inset=t)=>{for(const x of [-w/2+inset,w/2-inset])for(const z of [-d/2+inset,d/2-inset])b(t,top,t,x,top/2,z);};
    const anchor=(id:string,role:ContactAnchor['role'],x:number,y:number,z:number)=>anchors.push({id,role,position:[x,y,z],normal:[0,1,0]});
    const disk=(radius:number,depth:number,x:number,y:number,z:number,mat:T.Material=dark)=>{
        const g=new T.CylinderGeometry(radius,radius,depth,32);g.rotateX(Math.PI/2);return mesh(root,g,mat,x,y,z);
    };
    return {root,p,m,dark,light,w,h,d,t,b,c,panel,legs,anchor,disk};
}
export type FurnitureBuilder=ReturnType<typeof furnitureBuilder>;
