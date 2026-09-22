import * as T from 'three';
import type { Rig } from './human-legacy.ts';
import type { HumanProportions } from './catalog/humans.ts';
import { box, cylinder, mesh, sphere } from './geometry.ts';

/** Costume meshes use the same pose joints as the body. */
export function addHumanCostume(r: Rig, p: HumanProportions, lengthRatio = 1, thickness = 1) {
    const {head,hips,joints,skin}=r,torso=joints.torso;
    if(!p.outfit)return;
    const existing = new Set<T.Object3D>(); r.root.traverse(object => existing.add(object));
    const girth = Math.sqrt(p.girth), shoulder = p.shoulder / .19, bodyLength = p.torso / .44;
    const jacket=['casual','robe','armor','uniform'].includes(p.outfit);
    if(jacket){
        box(torso,skin,p.shoulder*1.85,p.torso*.75,.25*p.girth,0,p.torso*.43,0,.03);
        for(const side of ['left','right']){
            cylinder(joints[side+'Arm'],skin,.064*girth,.055*girth,p.upperArm*(p.outfit==='casual'?.5:.94)*lengthRatio,0,-p.upperArm*(p.outfit==='casual'?.25:.47)*lengthRatio);
            if(p.outfit==='armor')sphere(joints[side+'Arm'],skin,0,0,0,.085*girth,.06,.075*girth);
        }
    }
    if(p.outfit==='dress'||p.outfit==='robe'){
        const length=(p.thigh+p.shin)*.90*lengthRatio;
        for(const side of ['left','right']){
            // Separate overlapping panels follow each thigh; no cloth simulation is implied.
            const panel=mesh(joints[side+'Hip'],new T.CylinderGeometry(.095*girth,.18*girth,length,12,1,true),skin,0,-length/2,.015);
            panel.scale.z=1.15;
        }
        if(p.outfit==='dress')sphere(torso,skin,0,p.torso*.48,0,p.shoulder*.95,p.torso*.49,.125*p.girth);
    }
    if(p.outfit==='uniform'){
        for(const x of [-.075,.075])box(torso,skin,.08*shoulder,.08*bodyLength,.015,x*shoulder,p.torso*.55,.145*p.girth,.005);
        box(hips,skin,p.pelvis*3.2,.035,.23*p.girth,0,.065,0,.008);
    }
    if(p.outfit==='helmet'){
        mesh(head,new T.SphereGeometry(p.head*.76,20,12,0,Math.PI*2,0,Math.PI*.54),skin,0,p.head*1.35,0);
        cylinder(head,skin,p.head*.82,p.head*.82,.022,0,p.head*1.34);
    }
    if(p.outfit==='hat'){
        cylinder(head,skin,p.head*1.28,p.head*1.28,.022,0,p.head*1.70);
        cylinder(head,skin,p.head*.62,p.head*.69,p.head*.65,0,p.head*2.02);
    }
    if(p.outfit==='backpack'){
        box(torso,skin,.28*shoulder,.36*bodyLength,.17*p.girth,0,p.torso*.45,-.18*p.girth,.035);
        box(torso,skin,.22*shoulder,.16*bodyLength,.065*p.girth,0,p.torso*.20,-.29*p.girth,.025);
        for(const x of [-.11,.11])box(torso,skin,.033,p.torso*.75,.025,x*shoulder,p.torso*.48,.118*p.girth,.008);
    }
    r.root.traverse(object => {
        if (existing.has(object) || !(object instanceof T.Mesh)) return;
        object.userData.costume = p.outfit;
        // Expand the outer silhouette around each joint, preserving attachment and height.
        // Default thickness leaves the historical preset geometry untouched.
        if (thickness !== 1) {
            object.geometry.computeBoundingBox();
            const size = object.geometry.boundingBox!.getSize(new T.Vector3()), padding = .01 * (thickness - 1);
            object.geometry.scale(1 + 2 * padding / size.x, 1, 1 + 2 * padding / size.z);
        }
    });
}
