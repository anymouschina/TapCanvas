import * as T from 'three';
import type { Rig } from './human-legacy.ts';
import type { HumanProportions } from './catalog/humans.ts';
import { box, cylinder, mesh, sphere } from './geometry.ts';

/** Species details are attached to the same body joints used by animation. */
export function addHumanDetails(r:Rig,p:HumanProportions) {
    const {head,joints,skin}=r,torso=joints.torso;
    if(p.form==='elf')for(const sign of [-1,1]){
        const ear=mesh(head,new T.ConeGeometry(.025,.15,6),skin,sign*p.head*.85,p.head*1.05,0);ear.rotation.z=-sign*Math.PI*.35;
    }
    if(p.form==='orc'){
        sphere(head,skin,0,p.head*.45,p.head*.40,p.head*.67,p.head*.42,p.head*.52);
        for(const x of [-.047,.047])mesh(head,new T.ConeGeometry(.018,.075,8),skin,x,p.head*.55,p.head*.80);
    }
    if(p.form==='robot'){
        box(torso,skin,p.shoulder*1.6,p.torso*.7,.25,0,p.torso*.48,0,.025);
        box(head,skin,p.head*1.25,p.head*1.6,p.head*1.3,0,p.head,0,.015);
        for(const side of ['left','right'])box(joints[side+'Arm'],skin,.11,p.upperArm*.7,.11,0,-p.upperArm*.4);
    }
    if(p.form==='skeleton'){
        cylinder(torso,skin,.023,.03,p.torso,0,p.torso/2);
        for(let i=0;i<6;i++){
            const rib=new T.TorusGeometry(p.shoulder*(.60+Math.sin(i/5*Math.PI)*.15),.010,6,20);rib.rotateX(Math.PI/2);
            const m=mesh(torso,rib,skin,0,p.torso*(.35+i*.095),0);m.scale.z=.75;
        }
        box(torso,skin,.026,p.torso*.50,.02,0,p.torso*.6,p.shoulder*.52,.004);
    }
}
