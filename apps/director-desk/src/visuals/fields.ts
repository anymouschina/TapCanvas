import * as T from 'three';
import type { Entity } from '../model.ts';
import { FIELD_TYPES } from './model.ts';
import { numberAt } from '../animation/channels.ts';
/** Directed displacement, analytically sampled from project time; never cumulative physics integration. */
export function sampleFields(entities:Entity[],models:Map<string,T.Group>,time:number){
    const fields=entities.filter(e=>e.field&&e.visible&&time>=e.field.start&&(!e.field.end||time<e.field.end));if(!fields.length)return;
    const centers=fields.map(e=>models.get(e.id)!.position.clone());const delta=new T.Vector3();
    for(const e of entities){if(e.field||e.warp||e.kind==='camera'||!e.visible)continue;const root=models.get(e.id)!;if(root.userData.visualPoints)continue;const base=root.position.clone();
        for(const [i,source]of fields.entries()){const f=source.field!;if(f.targets.length?!f.targets.includes(e.id):!e.visual)continue;delta.subVectors(base,centers[i]);const distance=delta.length();if(distance>=f.radius)continue;
            const k=numberAt(f.strength,time)*Math.pow(1-distance/f.radius,f.falloff),age=time-f.start+(f.timeOffset??0);
            if(f.type==='attract'||f.type==='repel')root.position.addScaledVector(delta.normalize(),Math.min(distance,Math.abs(k))*Math.sign(k)*(f.type==='attract'?-1:1));
            else if(f.type==='wind'){delta.set(0,0,1).applyEuler(new T.Euler(...source.rotation));root.position.addScaledVector(delta,k*age);}
            else if(f.type==='vortex'){delta.applyAxisAngle(new T.Vector3(0,1,0),k*age);root.position.add(delta.add(centers[i]).sub(base));}
            else if(f.type==='wave')root.position.y+=Math.sin(distance*2-age*2)*k;
            else root.position.add(new T.Vector3(Math.sin(age*1.7+base.x),Math.sin(age*2.3+base.y),Math.cos(age*1.3+base.z)).multiplyScalar(k));
        }
    }
}

export function sampleParticleFields(entities:Entity[],models:Map<string,T.Group>,time:number){
 const fields=entities.filter(e=>e.field&&e.visible&&time>=e.field.start&&(!e.field.end||time<e.field.end));
 for(const e of entities){const material=models.get(e.id)?.userData.visualMaterial as T.ShaderMaterial|undefined;if(!material)continue;const selected=fields.filter(f=>!f.field!.targets.length||f.field!.targets.includes(e.id)).slice(0,8),u=material.uniforms;u.fieldCount.value=selected.length;
 selected.forEach((f,i)=>{const config=f.field!,pos=models.get(f.id)!.position,dir=new T.Vector3(0,0,1).applyEuler(new T.Euler(...f.rotation));u.fieldCenters.value[i].set(pos.x,pos.y,pos.z,config.radius);u.fieldSettings.value[i].set(Object.keys(FIELD_TYPES).indexOf(config.type),numberAt(config.strength,time),config.falloff,time-config.start+(config.timeOffset??0));u.fieldDirections.value[i].set(dir.x,dir.y,dir.z,0);});}
}
