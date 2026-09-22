import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { Entity } from '../model.ts';
import type { Rig } from './human-legacy.ts';
import { CREATURE_SHAPES, type CreatureShape } from './catalog/creatures.ts';
import { material, sphere, cylinder, box, mesh } from './geometry.ts';
import { scaleHuman } from './humanoid.ts';
import { animalShape } from './animal-parameters.ts';

interface Builder {
    skin: T.Material; joints: Record<string, T.Group>;
    joint: (name: string, parent: T.Object3D, x: number, y: number, z: number) => T.Group;
}
/** Closed thin membrane: contributes to real shadows, raycasts and bounds. */
function membrane(parent: T.Object3D, skin: T.Material, vertices: number[][], axis: 'x' | 'y', thickness = .014) {
    const points = vertices.flatMap(v => [-1, 1].map(sign => {
        const point = new T.Vector3(v[0], v[1], v[2]); point[axis] += sign * thickness / 2; return point;
    }));
    return mesh(parent, new ConvexGeometry(points), skin);
}

function bird(b: Builder, torso: T.Group, p: CreatureShape) {
    const { skin, joint } = b;
    sphere(torso, skin, 0, 0, 0, p.width, p.width * 1.15, p.body * .55);
    sphere(torso, skin, 0, p.neck * .4, p.body * .3, p.width * .5, p.neck * .7 + .07, p.width * .52);
    const head = joint('head', torso, 0, p.neck + .07, p.body * .36);
    const h = p.width * .58;
    sphere(head, skin, 0, h * .3, 0, h, h * 1.08, h);
    if (p.species === 'duck') box(head, skin, h * 1.3, h * .3, h * 1.65, 0, 0, h * 1.22);
    else {
        const length = h * (p.species === 'pterosaur' ? 4.3 : 1.5);
        const beak = mesh(head, new T.ConeGeometry(h * .5, length, 4), skin, 0, 0, h + length / 2);
        beak.rotation.x = Math.PI / 2;
        if (p.species === 'eagle') sphere(head, skin, 0, -h * .28, h * 2.1, h * .23, h * .48, h * .26);
    }
    if (p.species === 'chicken') for (const z of [-.04, 0, .04]) sphere(head, skin, 0, h * 1.38, z, .025, .05, .035);
    if (p.species === 'pterosaur') membrane(head, skin, [[0, h, 0], [0, h * 1.7, -h * 2], [0, 0, -h]], 'x');
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
        const wing = joint(side + 'Wing', torso, sign * p.width * .82, p.width * .18, p.body * .12);
        // Wings extend sideways in the reference pose and fold with the wing control.
        membrane(wing, skin, [[0, 0, .04], [sign * p.wing, -.035, -p.body * .12], [sign * p.wing * .52, -.07, -p.body * .58], [0, -.05, -p.body * .48]], 'y', p.species === 'pterosaur' ? .012 : .03);
        sphere(wing, skin, sign * p.wing * .30, 0, -p.body * .12, p.wing * .34, .035, p.body * .18);
        const hip = joint(side + 'Hip', torso, sign * p.width * .55, -p.width * .7, 0);
        cylinder(hip, skin, .029, .023, p.leg * .5, 0, -p.leg * .25);
        const knee = joint(side + 'Knee', hip, 0, -p.leg * .5, 0);
        cylinder(knee, skin, .022, .015, p.leg * .5, 0, -p.leg * .25);
        if (p.species === 'duck') membrane(knee, skin, [[0, -p.leg * .5, -.025], [-.07, -p.leg * .5, .1], [.07, -p.leg * .5, .1]], 'y', .022);
        else for (const x of [-.035, 0, .035]) {
            const toe = box(knee, skin, .018, .024, .12, x, -p.leg * .5, .04, .007); toe.rotation.y = x * 4;
        }
    }
    const tail = joint('tail', torso, 0, 0, -p.body * .45);
    membrane(tail, skin, [[-.04, 0, 0], [.04, 0, 0], [p.width * .7, .04, -p.body * .5], [-p.width * .7, .04, -p.body * .5]], 'y', .025);
    return head;
}

function fish(b: Builder, torso: T.Group, p: CreatureShape) {
    const { skin, joint } = b, shark = p.species === 'shark';
    const tall = p.width * (shark ? .85 : 1.6);
    sphere(torso, skin, 0, 0, 0, p.width, tall, p.body * .42);
    const head = joint('head', torso, 0, 0, p.body * .30);
    sphere(head, skin, 0, 0, .02, p.width * .81, tall * .73, p.body * .20);
    membrane(torso, skin, [[0, tall * .6, p.body * .1], [0, tall + p.width * (shark ? 1.2 : .55), -p.body * .05], [0, tall * .55, -p.body * .24]], 'x', .025);
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
        const fin = joint(side + 'Fin', torso, sign * p.width * .7, -tall * .3, p.body * .1);
        membrane(fin, skin, [[0, 0, 0], [sign * p.wing, -.04, -p.body * .23], [0, -.03, -p.body * .2]], 'y');
    }
    const tail = joint('tail', torso, 0, 0, -p.body * .3);
    sphere(tail, skin, 0, 0, -p.body * .10, p.width * .55, tall * .6, p.body * .23);
    const tip = joint('tailTip', tail, 0, 0, -p.body * .25);
    membrane(tip, skin, [[0, 0, .03], [0, tall * (shark ? 1.7 : 1.2), -p.body * .19], [0, tall * .12, -p.body * .12]], 'x', .022);
    membrane(tip, skin, [[0, 0, .03], [0, -tall * 1.1, -p.body * .18], [0, -tall * .1, -p.body * .12]], 'x', .022);
    return head;
}

function serpent(b: Builder, torso: T.Group, p: CreatureShape) {
    const { skin, joint } = b, length = p.body / 3;
    let segment = torso;
    for (let i = 0; i < 3; i++) {
        if (i) segment = joint(i === 1 ? 'tail' : 'tailTip', segment, 0, 0, -length);
        const radius = p.width * (1 - i * .28);
        sphere(segment, skin, 0, 0, 0, radius);
        const bend = i % 2 ? -.14 : .14;
        const curve = new T.CatmullRomCurve3([new T.Vector3(), new T.Vector3(bend, 0, -length / 3), new T.Vector3(bend, 0, -length * 2 / 3), new T.Vector3(0, 0, -length)]);
        const shape = new T.TubeGeometry(curve, 24, radius, 10, false);
        const vertices = shape.attributes.position, uv = shape.attributes.uv;
        const endRadius = i === 2 ? .004 : p.width * (1 - (i + 1) * .28);
        for (let v = 0; v < vertices.count; v++) {
            const u = uv.getX(v), center = curve.getPointAt(u);
            const point = new T.Vector3().fromBufferAttribute(vertices, v).sub(center).multiplyScalar(T.MathUtils.lerp(radius, endRadius, u) / radius).add(center);
            vertices.setXYZ(v, point.x, point.y, point.z);
        }
        shape.computeVertexNormals();
        mesh(segment, shape, skin);
    }
    const head = joint('head', torso, 0, 0, .06);
    sphere(head, skin, 0, 0, .02, p.width * 1.25, p.width * .8, p.width * 1.8);
    return head;
}

export function makeCreature(e: Entity): Rig {
    const base = CREATURE_SHAPES[e.asset];
    if (!base) throw new Error(`未知生物白模：${e.asset}`);
    const p = animalShape(e, base);
    const root = new T.Group(), hips = new T.Group(); root.add(hips);
    const skin = material(e.color), joints: Record<string, T.Group> = {};
    const joint: Builder['joint'] = (name, parent, x, y, z) => {
        const g = new T.Group(); g.position.set(x, y, z); parent.add(g); joints[name] = g; return g;
    };
    const torso = joint('torso', hips, 0, 0, 0), builder = { skin, joints, joint };
    const head = p.rig === 'bird' ? bird(builder, torso, p) : p.rig === 'fish' ? fish(builder, torso, p) : serpent(builder, torso, p);
    root.updateMatrixWorld(true);
    hips.position.y -= new T.Box3().setFromObject(root, true).min.y;
    root.updateMatrixWorld(true);
    const rig: Rig = { root, hips, joints, skin, head,
        referenceHeight: new T.Box3().setFromObject(root, true).max.y, restHipHeight: hips.position.y,
        headRestHeight: head.getWorldPosition(new T.Vector3()).y,
        poseAxes: { leftWing: 'z', rightWing: 'z', leftFin: 'z', rightFin: 'z', tail: 'y', tailTip: 'y', ...(p.rig === 'serpent' ? { torso: 'y' as const } : {}) },
        poseSigns: { leftWing: -1, leftFin: -1 },
    };
    scaleHuman(rig, e); return rig;
}
