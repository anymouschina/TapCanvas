// Preserve original mannequin geometry for existing projects.
import * as T from 'three';
import type { Entity } from '../model.ts';
import { material, sphere, cylinder, box } from './geometry.ts';
export interface Rig {
    poseAxes?: Record<string, 'x' | 'y' | 'z'>;
    poseSigns?: Record<string, number>;
    root: T.Group;
    hips: T.Group;
    joints: Record<string, T.Group>;
    skin: T.MeshStandardMaterial;
    head: T.Group;
    referenceHeight?: number;
    restHipHeight?: number;
    headRestHeight?: number;
    legLengths?: { upper: number; lower: number };
    jointSkin?: T.MeshStandardMaterial;
}
export function makeHuman(e: Entity): Rig {
    const root = new T.Group(), hips = new T.Group();
    root.add(hips);
    hips.position.y = .94;
    const skin = material(e.color), jointMat = material(new T.Color(e.color).multiplyScalar(.91));
    const joints: Record<string, T.Group> = {};
    const makeJoint = (name: string, parent: T.Object3D, x: number, y: number, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); joints[name] = g; return g; };
    sphere(hips, skin, 0, 0, 0, .155, .12, .112);
    const torso = makeJoint('torso', hips, 0, .1);
    sphere(torso, skin, 0, .105, 0, .133, .19, .092);
    sphere(torso, skin, 0, .255, 0, e.gender === 'female' ? .157 : .174, .18, .106);
    const neck = cylinder(torso, skin, .046, .058, .12, 0, .432);
    neck.castShadow = true;
    const head = makeJoint('head', torso, 0, .49);
    sphere(head, skin, 0, .105, .006, .095, .115, .094);
    sphere(head, skin, 0, .045, .028, .077, .055, .076);
    // A small nose establishes facing direction without facial expression detail.
    sphere(head, skin, 0, .084, .096, .018, .026, .025);
    for (const side of ['left', 'right']) {
        const sign = side === 'left' ? -1 : 1;
        const arm = makeJoint(`${side}Arm`, torso, sign * (e.gender === 'female' ? .165 : .188), .31);
        sphere(arm, jointMat, 0, 0, 0, .058);
        const upper = cylinder(arm, skin, .057, .039, .26, 0, -.135);
        upper.rotation.z = sign * .04;
        const elbow = makeJoint(`${side}Elbow`, arm, 0, -.285);
        sphere(elbow, jointMat, 0, 0, 0, .039);
        cylinder(elbow, skin, .041, .027, .225, 0, -.116);
        sphere(elbow, skin, 0, -.277, .01, .033, .065, .023);
        const hip = makeJoint(`${side}Hip`, hips, sign * .09, -.015);
        cylinder(hip, skin, .085, .057, .37, 0, -.21);
        sphere(hip, skin, 0, -.04, 0, .078, .11, .079);
        const knee = makeJoint(`${side}Knee`, hip, 0, -.43);
        sphere(knee, jointMat, 0, 0, 0, .052);
        cylinder(knee, skin, .06, .032, .405, 0, -.215);
        sphere(knee, skin, 0, -.16, -.012, .055, .14, .057);
        sphere(knee, skin, 0, -.424, 0, .028, .03, .029);
        const ankle=makeJoint(`${side}Ankle`,knee,0,-.458);
        box(ankle, skin, .095, .074, .22, 0, 0, .05, .03);
    }
    scaleLegacyHuman(root, e);
    return { root, hips, joints, skin, head, jointSkin: jointMat };
}
export function scaleLegacyHuman(root: T.Group, e: Pick<Entity, 'height' | 'build'>) {
    const build = e.build === 'slim' ? .87 : e.build === 'broad' ? 1.2 : 1;
    root.scale.set(e.height / 1.75 * build, e.height / 1.75, e.height / 1.75);
}
