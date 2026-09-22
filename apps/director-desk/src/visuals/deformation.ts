import * as T from 'three';
import type { Entity } from '../model.ts';
import { numberAt } from '../animation/channels.ts';
import { seeded, type DeformConfig } from './model.ts';

interface Part {mesh:T.Mesh;original:T.BufferGeometry;geometry:T.BufferGeometry;positions:Float32Array;direction?:Float32Array}
interface State {root:T.Group;shatter:boolean;seed:number;parts:Part[];key:string}
/** Only opted-in objects own editable buffers. No per-frame geometry/material allocations. */
export class DeformationRuntime {
    private states=new Map<string,State>();
    /** Let procedural visuals update their source buffer before applying retained deformation. */
    prepareVisuals(){for(const state of this.states.values())if(state.root.userData.visualBase)for(const p of state.parts)p.mesh.geometry=p.original;}
    remove(id:string){const state=this.states.get(id);if(!state)return;for(const p of state.parts){p.mesh.geometry=p.original;p.geometry.dispose();}this.states.delete(id);}
    sample(entities:Entity[],models:Map<string,T.Group>,time:number){const live=new Set<string>();
        for(const e of entities){const d=e.deform,root=models.get(e.id);if(!d||!root||!e.visible)continue;live.add(e.id);let s=this.states.get(e.id);const shatter=d.type==='shatter';
            if(!s||s.root!==root||s.shatter!==shatter||shatter&&s.seed!==d.seed){this.remove(e.id);s={root,shatter,seed:d.seed,parts:[],key:''};root.traverse(o=>{if(!(o as T.Mesh).isMesh)return;const mesh=o as T.Mesh,original=mesh.geometry;const geometry=shatter&&original.index?original.toNonIndexed():original.clone();const attribute=geometry.getAttribute('position');if(!attribute){geometry.dispose();return;}const positions=new Float32Array(attribute.count*3);for(let i=0;i<attribute.count;i++){positions[i*3]=attribute.getX(i);positions[i*3+1]=attribute.getY(i);positions[i*3+2]=attribute.getZ(i);}const part:Part={mesh,original,geometry,positions};
                if(shatter){part.direction=new Float32Array(positions.length);for(let i=0;i<attribute.count;i+=3){for(let j=0;j<3;j++){for(let k=0;k<3;k++){part.direction[(i+k)*3+j]=seeded(i+j,d.seed)-.5;}}}}
                mesh.geometry=geometry;s!.parts.push(part);});this.states.set(e.id,s);}
            for(const part of s.parts)part.mesh.geometry=part.geometry;
            const amount=numberAt(d.amount,time),clock=d.type==='wave'?(time+(d.timeOffset??0))*d.speed:0,key=JSON.stringify([d.type,d.axis,amount,clock,d.frequency,d.seed,root.userData.visualSample]);if(s.key===key)continue;s.key=key;
            for(const part of s.parts){const out=part.geometry.getAttribute('position') as T.BufferAttribute,a=part.positions;
                if(root.userData.visualBase){const source=part.original.getAttribute('position'),index=shatter?part.original.index:null;for(let i=0;i<out.count;i++){const n=index?index.getX(i):i;a[i*3]=source.getX(n);a[i*3+1]=source.getY(n);a[i*3+2]=source.getZ(n);}}
                for(let i=0;i<out.count;i++){const at=i*3;let x=a[at],y=a[at+1],z=a[at+2];const axis=d.axis==='x'?x:d.axis==='z'?z:y;
                    if(d.type==='collapse'){const scale=Math.max(.001,1-amount);x*=scale;y*=scale;z*=scale;}
                    else if(d.type==='inflate'){const scale=Math.max(.001,1+amount);x*=scale;y*=scale;z*=scale;}
                    else if(d.type==='stretch'||d.type==='squeeze'){const scale=Math.max(.001,1+amount),other=d.type==='squeeze'?1/Math.sqrt(scale):1;if(d.axis==='x'){x*=scale;y*=other;z*=other;}else if(d.axis==='z'){z*=scale;x*=other;y*=other;}else{y*=scale;x*=other;z*=other;}}
                    else if(d.type==='twist'){const c=Math.cos(axis*amount),sin=Math.sin(axis*amount);if(d.axis==='x'){const old=y;y=c*y-sin*z;z=sin*old+c*z;}else if(d.axis==='z'){const old=x;x=c*x-sin*y;y=sin*old+c*y;}else{const old=x;x=c*x-sin*z;z=sin*old+c*z;}}
                    else if(d.type==='bend'){const offset=amount*axis*axis*.2;if(d.axis==='x')y+=offset;else x+=offset;}
                    else if(d.type==='wave'){const delta=Math.sin(axis*d.frequency+clock)*amount;if(d.axis==='y')x+=delta;else y+=delta;}
                    else if(d.type==='shatter'){x+=part.direction![at]*amount;y+=part.direction![at+1]*amount;z+=part.direction![at+2]*amount;}
                    out.setXYZ(i,x,y,z);
                }out.needsUpdate=true;part.geometry.computeVertexNormals();part.geometry.computeBoundingBox();part.geometry.computeBoundingSphere();
            }
        }for(const id of this.states.keys())if(!live.has(id))this.remove(id);
    }
    dispose(){for(const id of this.states.keys())this.remove(id);}
}
export function defaultDeform(type:DeformConfig['type']):DeformConfig{return {type,amount:0,axis:'y',frequency:2,speed:1,seed:42};}
