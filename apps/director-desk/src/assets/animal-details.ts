import * as T from 'three';
import type { QuadrupedShape } from './catalog/animals.ts';
import { sphere,mesh,cylinder } from './geometry.ts';

export function addAnimalDetails(torso:T.Group,head:T.Group,p:QuadrupedShape,skin:T.Material) {
    if(p.species==='turtle'){
        const shell=mesh(torso,new T.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI/2),skin,0,.06,0);shell.scale.set(p.width*1.3,.28,p.body*.62);
        const rim=cylinder(torso,skin,1,1,.025,0,.06,0);rim.scale.set(p.width*1.3,1,p.body*.62);
    }
    if(p.species==='camel')for(const z of [-.24,.16])sphere(torso,skin,0,p.width*1.35,z*(p.body/.95),p.width*.75,p.width*1.0,p.body*.20);
    if(p.species==='lion')sphere(head,skin,0,p.head*.45,-p.head*.30,p.head*1.35,p.head*1.35,p.head*.8);
    if(p.species==='elephant'){
        for(const sign of [-1,1]){
            const ear = sphere(head,skin,sign*p.head*.83,p.head*.45,-.04,p.head*.60*(p.ear/.08),p.head*.95*(p.ear/.08),.05);
            ear.userData.animalPart = 'ear';
            const tusk=mesh(head,new T.ConeGeometry(.035,.32,8),skin,sign*p.head*.40,-.10,p.head*.83);tusk.rotation.x=Math.PI*.35;
        }
        const points=[new T.Vector3(0,.10,p.head),new T.Vector3(0,-.12,p.head+.13),new T.Vector3(0,-.40,p.head+.18),new T.Vector3(0,-.65,p.head+.10)];
        const ratio = p.muzzle/.08;
        if (ratio !== 1) for (const point of points) { point.y = .10+(point.y-.10)*ratio; point.z = p.head+(point.z-p.head)*ratio; }
        const trunk = mesh(head,new T.TubeGeometry(new T.CatmullRomCurve3(points),16,.065,8,false),skin); trunk.userData.animalPart = 'trunk';
    }
    if(p.species==='giraffe')for(const x of [-.07,.07]){
        cylinder(head,skin,.016,.02,.16,x,p.head*1.55,-.01);sphere(head,skin,x,p.head*1.55+.08,-.01,.027);
    }
}
