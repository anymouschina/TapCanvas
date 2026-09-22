import * as T from 'three';
import type { Entity } from '../model.ts';
import { parameterDefaults, structureBoxes } from '../parametric-props.ts';
import { material, mesh, sphere, cylinder, box } from './geometry.ts';
export function makeProp(e: Entity): T.Group {
    const g = new T.Group();
    const m = material(e.color), light = material(new T.Color(e.color).lerp(new T.Color('#ffffff'), .28)), dark = material(new T.Color(e.color).multiplyScalar(.77));
    const b = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0, mat: T.Material = m) => box(g, mat, w, h, d, x, y, z);
    if (parameterDefaults[e.asset]) {
        for (const part of structureBoxes(e)) b(part.width,part.height,part.depth,part.x,part.y,part.z,part.mark?light:m);
        return g;
    }
    switch (e.asset) {
        case 'building':
            b(4, 6, 4);
            b(4.2, .15, 4.2, 0, 6.05);
            for (const z of [-2.01, 2.01])
                for (const x of [-1.1, 1.1])
                    for (const y of [1.5, 3.2, 4.9]) b(.9, 1.05, .04, x, y, z, dark);
            break;
        case 'bench':
            g.userData.contactAnchors = [-.6, 0, .6].map((x, i) => ({ id: `seat-${i + 1}`, role: 'seat', position: [x, .49, 0], normal: [0, 1, 0] }));
            b(1.8, .08, .5, 0, .45);
            b(1.8, .4, .06, 0, .76, -.22);
            for (const x of [-.65, .65]) b(.08, .44, .44, x, .22, 0, dark);
            break;
        case 'fence':
            for (let x = -1; x <= 1; x += .25) b(.08, 1.1, .08, x);
            for (const y of [.3, .8]) b(2.1, .08, .07, 0, y);
            break;
        case 'streetlight':
            cylinder(g, m, .055, .085, 4, 0, 2);
            b(.8, .06, .06, .35, 4);
            b(.4, .07, .22, .7, 3.93, 0, light);
            break;
        case 'bed':
            g.userData.contactAnchors = [{ id: 'bed', role: 'bed', position: [0, .5425, .32], normal: [0, 1, 0] }, { id: 'bed-edge', role: 'seat', position: [.72, .5425, .32], normal: [0, 1, 0], forward: [1, 0, 0] }];
            b(1.8, .27, 2, 0, .2, 0, dark);
            b(1.78, .18, 1.98, 0, .41, 0, light);
            b(1.85, .98, .08, 0, .49, -1);
            for (const x of [-.43, .43]) {
                const pillow = b(.72, .11, .4, x, .55, -.65, light);
                pillow.rotation.x = .05;
            }
            b(1.76, .045, 1.27, 0, .52, .32);
            break;
        case 'wardrobe':
            b(1.8, 2.2, .6);
            for (const x of [-.449, .449])
                b(.883, 2.13, .025, x, 1.1, .314, light);
            for (const x of [-.055, .055])
                b(.014, .25, .024, x, 1.05, .343, dark);
            break;
        case 'nightstand':
            b(.5, .58, .46);
            b(.46, .2, .02, 0, .42, .24, light);
            b(.09, .015, .025, 0, .42, .26, dark);
            break;
        case 'desk':
        case 'table': {
            g.userData.contactAnchors = [{ id: 'top', role: 'surface', position: [0, .75, 0], normal: [0, 1, 0] }];
            const w = e.asset === 'desk' ? 1.2 : 1.8, d = e.asset === 'desk' ? .6 : .9;
            b(w, .055, d, 0, .7225, 0, light);
            for (const x of [-w / 2 + .055, w / 2 - .055])
                for (const z of [-d / 2 + .055, d / 2 - .055])
                    b(.055, .7, .055, x, .35, z);
            break;
        }
        case 'chair':
            g.userData.contactAnchors = [{ id: 'seat', role: 'seat', position: [0, .45, 0], normal: [0, 1, 0] }];
            b(.46, .055, .45, 0, .4225);
            b(.46, .48, .055, 0, .69, -.2);
            for (const x of [-.175, .175])
                for (const z of [-.16, .16])
                    b(.04, .41, .04, x, .205, z, dark);
            break;
        case 'sofa':
            g.userData.contactAnchors = [-.55, .55].map((x, i) => ({ id: `seat-${i + 1}`, role: 'seat', position: [x, .57, .08], normal: [0, 1, 0] }));
            b(2, .33, .86, 0, .255, 0, dark);
            b(1.76, .18, .72, 0, .48, .04, light);
            b(2, .55, .19, 0, .64, -.36);
            for (const x of [-.94, .94])
                b(.18, .48, .88, x, .52);
            break;
        case 'lamp':
            cylinder(g, dark, .1, .13, .025, 0, .012);
            cylinder(g, m, .013, .013, .31, 0, .18);
            cylinder(g, light, .11, .18, .22, 0, .39);
            break;
        case 'laptop':
            b(.32, .018, .22, 0, .009);
            b(.32, .22, .013, 0, .12, -.105, dark);
            b(.292, .183, .003, 0, .123, -.096, material('#596569'));
            break;
        case 'cup':
            cylinder(g, light, .044, .035, .1, 0, .05);
            {
                const handle = mesh(g, new T.TorusGeometry(.028, .007, 8, 20), m, .05, .055, 0);
                handle.rotation.y = Math.PI / 2;
            }
            break;
        case 'sword':
            b(.06, .78, .012, 0, .55, 0, light);
            b(.23, .025, .04, 0, .16, 0, dark);
            b(.035, .16, .035, 0, .08, 0, dark);
            break;
        case 'car':
            b(1.75, .58, 3.8, 0, .65);
            b(1.48, .7, 1.9, 0, 1.15, -.15, light);
            for (const x of [-.89, .89])
                for (const z of [-1.22, 1.22]) {
                    const wheel = cylinder(g, dark, .33, .33, .17, x, .33, z);
                    wheel.rotation.z = Math.PI / 2;
                }
            break;
        case 'tree':
            cylinder(g, dark, .1, .18, 2.3, 0, 1.15);
            sphere(g, m, 0, 2.45, 0, 1.0, 1.2, .95);
            sphere(g, light, .5, 2.1, .3, .65, .8, .65);
            break;
        case 'rock': {
            const r = mesh(g, new T.DodecahedronGeometry(.6, 1), m, 0, .34);
            r.scale.set(1.3, .7, 1);
            r.rotation.set(.2, .4, .1);
            break;
        }
        case 'sphere':
            sphere(g, m, 0, .5, 0, .5);
            break;
        case 'cylinder':
            cylinder(g, m, .5, .5, 1, 0, .5);
            break;
        case 'door':
            b(.88, 2.08, .042, .44, 1.04);
            b(.1, .015, .04, .78, 1, .04, dark);
            break;
        case 'cube':
            b(1, 1, 1);
            break;
        default:
            throw new Error(`不支持的道具白模：${e.asset}`);
    }
    return g;
}
