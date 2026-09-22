import * as T from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { material, sphere, cylinder, mesh } from './geometry.ts';
import { branch, fitModel, seededRandom } from './procedural.ts';

export function makePlant(e: Entity) {
    const p = assetParameters(e), root = new T.Group(), model = new T.Group(); root.add(model);
    const m = material(e.color), stem = material(new T.Color(e.color).multiplyScalar(.77)), rng = seededRandom(p.seed);
    const n = p.density, style = e.asset.replace('plant-', '');
    const leaf = (center: T.Vector3, tip: T.Vector3, width: number) => {
        const middle = center.clone().lerp(tip, .5).add(new T.Vector3(0, .04, 0));
        const across = new T.Vector3().subVectors(tip, center).cross(new T.Vector3(0, 1, 0)).normalize().multiplyScalar(width);
        const points = [center, tip, middle.clone().add(across), middle.clone().sub(across)].flatMap(v => [v.clone().add(new T.Vector3(0, .003, 0)), v.clone().add(new T.Vector3(0, -.003, 0))]);
        mesh(model, new ConvexGeometry(points), m);
    };
    if (['broadleaf', 'conifer', 'palm', 'dead'].includes(style)) {
        cylinder(model, stem, .035, .065, .86, 0, .43);
        if (style === 'conifer') {
            const layers = Math.max(3, Math.round(n / 3));
            for (let i = 0; i < layers; i++) {
                const y = .25 + i / layers * .6, r = .32 * (1 - i / layers) * (.9 + rng() * .2);
                mesh(model, new T.ConeGeometry(r, .35, 9), m, (rng() - .5) * .035, y + .175, (rng() - .5) * .035);
            }
        } else for (let i = 0; i < n; i++) {
            const a = i * 2.39996 + rng() * .2, radius = .18 + rng() * .18;
            const from = new T.Vector3(0, style === 'palm' ? .82 : .36 + rng() * .4, 0);
            const to = new T.Vector3(Math.cos(a) * radius, style === 'palm' ? .8 - rng() * .15 : .55 + rng() * .4, Math.sin(a) * radius);
            branch(model, stem, from, to, .016, .005);
            if (style === 'broadleaf') sphere(model, m, to.x, to.y, to.z, .13 + rng() * .06, .13 + rng() * .05, .14);
            else if (style === 'palm') leaf(from, to, .035);
            else {
                const tip = to.clone().add(new T.Vector3(Math.cos(a + .5) * .12, .12, Math.sin(a + .5) * .12)); branch(model, stem, to, tip, .007, .001);
            }
        }
    } else if (style === 'grass') {
        for (let i = 0; i < n; i++) {
            const base = new T.Vector3((rng() - .5) * .6, 0, (rng() - .5) * .6);
            leaf(base, base.clone().add(new T.Vector3((rng() - .5) * .3, .25 + rng() * .5, (rng() - .5) * .3)), .014 + rng() * .015);
        }
    } else if (style === 'potted') {
        const profile = [[0, 0], [.17, 0], [.24, .30], [.205, .30], [.15, .045], [0, .045]].map(v => new T.Vector2(v[0], v[1]));
        mesh(model, new T.LatheGeometry(profile, 24), stem); cylinder(model, stem, .022, .032, .55, 0, .52);
        for (let i = 0; i < n; i++) {
            const a = i * 2.39996, start = new T.Vector3(0, .38 + i / n * .42, 0);
            leaf(start, new T.Vector3(Math.cos(a) * (.2 + rng() * .08), start.y + .08, Math.sin(a) * .25), .045);
        }
    } else {
        for (let i = 0; i < n; i++) {
            const x = style === 'hedge' ? (i / Math.max(1, n - 1) - .5) * 1.4 : (rng() - .5) * .5;
            const z = (rng() - .5) * .3, y = .2 + rng() * .2;
            branch(model, stem, new T.Vector3(x, 0, z), new T.Vector3(x, y, z), .018);
            sphere(model, m, x, y, z, .16 + rng() * .1, .2 + rng() * .1, .18 + rng() * .08);
        }
    }
    fitModel(model, p.width, p.height, p.depth); return root;
}
