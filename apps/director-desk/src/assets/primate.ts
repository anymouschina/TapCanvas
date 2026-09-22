import * as T from 'three';
import type { Entity } from '../model.ts';
import type { Rig } from './human-legacy.ts';
import { material, sphere, cylinder, box } from './geometry.ts';
import { scaleHuman } from './humanoid.ts';
import { assetParameters } from './parameters.ts';

/** Knuckle-supported ape proportions, using the shared front/rear limb controls. */
export function makePrimate(e: Entity): Rig {
    const { bodyRatio: body, widthRatio: width, legRatio: leg, headRatio } = assetParameters(e);
    // Lengthen both arm segments to keep the knuckles and rear feet on the same floor.
    const armLength = 1 + (.6 * (leg - 1) + .4 * (body - 1)) / .96;
    const root = new T.Group(), hips = new T.Group(); root.add(hips); hips.position.y = .63 + .6 * (leg - 1);
    const skin = material(e.color), joints: Record<string, T.Group> = {};
    const joint = (name: string, parent: T.Object3D, x: number, y: number, z = 0) => {
        const group = new T.Group(); group.position.set(x, y, z); parent.add(group); joints[name] = group; return group;
    };
    const torso = joint('torso', hips, 0, 0);
    sphere(torso, skin, 0, .26*body, .04*body, .31*width, .43*body, .23*body).rotation.x = .25;
    sphere(torso, skin, 0, .39*body, .13*body, .39*width, .29*body, .21*body);
    sphere(hips, skin, 0, .02, -.1*body, .23*width, .24, .2*body);
    const head = joint('head', torso, 0, .70*body, .26*body); head.scale.setScalar(headRatio);
    sphere(head, skin, 0, .02, 0, .18, .22, .17);
    sphere(head, skin, 0, -.065, .10, .145, .135, .13);
    sphere(head, skin, 0, .055, .14, .17, .042, .035);
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
        sphere(head, skin, sign * .177, .015, -.025, .035, .05, .024);
        const arm = joint(side + 'Arm', torso, sign * .34*width, .40*body, .12*body);
        sphere(arm, skin, 0, -.05, 0, .13*width, .18, .13);
        cylinder(arm, skin, .105, .072, .50*armLength, 0, -.25*armLength);
        const elbow = joint(side + 'Elbow', arm, 0, -.50*armLength);
        sphere(elbow, skin, 0, 0, 0, .073);
        cylinder(elbow, skin, .085, .058, .46*armLength, 0, -.23*armLength);
        box(elbow, skin, .15, .11, .18, 0, -.475 - .46*(armLength-1), .03, .03);
        const hip = joint(side + 'Hip', hips, sign * .155*width, 0, -.15*body);
        cylinder(hip, skin, .12, .075, .30*leg, 0, -.15*leg);
        const knee = joint(side + 'Knee', hip, 0, -.30*leg);
        sphere(knee, skin, 0, 0, 0, .075);
        cylinder(knee, skin, .07, .042, .30*leg, 0, -.15*leg);
        sphere(knee, skin, 0, -.30*leg, .045, .08, .03, .14);
    }
    root.updateMatrixWorld(true);
    const rig: Rig = { root, hips, joints, skin, head, referenceHeight: new T.Box3().setFromObject(root, true).max.y,
        restHipHeight: hips.position.y, headRestHeight: hips.position.y + .70*body };
    scaleHuman(rig, e); return rig;
}
