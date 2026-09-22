import * as T from 'three';
import type { Entity } from '../model.ts';
import { mesh, cylinder } from './geometry.ts';
import { objectBuilder } from './object-builder.ts';

export function makeIndustrial(e: Entity) {
    const f = objectBuilder(e), { model, p, m, shade, b, c, link, anchor } = f, hinges: Array<{ group: T.Group; sign: number }> = [];
    const style = e.asset.replace('industrial-', '');
    if (style === 'container') {
        b(1, .025, 1); b(1, .025, 1, 0, .9875); b(1, 1, .025, 0, .5, -.4875);
        for (const x of [-.4875, .4875]) {
            b(.025, 1, 1, x);
            for (let i = 0; i < 16; i++) b(.012, .93, .015, x, .5, -.46 + i * .92 / 15, shade);
        }
        for (const sign of [-1, 1]) {
            const hinge = new T.Group(); hinge.position.set(sign * .4875, 0, .4875); model.add(hinge);
            b(.4875, .95, .025, -sign * .24375, .5, 0, m, hinge);
            b(.014, .70, .02, -sign * .12, .5, .022, shade, hinge); hinges.push({ group: hinge, sign });
        }
        anchor('floor', 'surface', 0, .025, 0);
    } else if (style === 'pallet') {
        for (const x of [-.4, 0, .4]) b(.14, .6, 1, x, .3);
        for (let i = 0; i < 7; i++) b(1, .2, .12, 0, .9, -.44 + i * .88 / 6);
        for (const z of [-.44, 0, .44]) b(1, .2, .12, 0, .1, z);
        anchor('top', 'surface', 0, 1, 0);
    } else if (style === 'barrel') {
        c(.46, 1); for (const y of [.05, .32, .68, .95]) c(.5, .035, 0, y, 0, shade);
        c(.07, .015, .16, 1, 0, shade); anchor('lid', 'surface', -.15, 1, 0);
    } else if (style === 'pipeline') {
        const shape = new T.Shape(); shape.absarc(0, 0, .5, 0, Math.PI * 2, false);
        const hole = new T.Path(); hole.absarc(0, 0, .37, 0, Math.PI * 2, true); shape.holes.push(hole);
        const g = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 24 }); g.translate(0, 0, -.5); g.rotateY(Math.PI / 2); mesh(model, g, m);
        for (const x of [-.46, .46]) { const ring = new T.TorusGeometry(.465, .035, 8, 32); ring.rotateY(Math.PI / 2); mesh(model, ring, shade, x); }
    } else if (style === 'scaffold') {
        for (const x of [-.48, .48]) for (const z of [-.48, .48]) b(.035, 1, .035, x, .5, z);
        for (let i = 0; i < p.levels; i++) {
            const y = (i + 1) / (p.levels + 1); b(.94, .025, .94, 0, y - .0125); anchor('deck-' + i, 'surface', 0, y, 0);
            for (const z of [-.48, .48]) { link([-.48, i / (p.levels + 1), z], [.48, y, z], .012); link([.48, i / (p.levels + 1), z], [-.48, y, z], .012); }
        }
    } else if (style === 'barrier') {
        b(1, .82, .12, 0, .57); for (const x of [-.45, .45]) { b(.05, 1, .14, x); b(.16, .04, 1, x); }
        for (let i = 0; i < 14; i++) b(.008, .8, .012, -.46 + i * .92 / 13, .57, .07, shade);
    } else if (style === 'cone') {
        b(1, .1, 1); mesh(model, new T.ConeGeometry(.40, .9, 24), m, 0, .55);
        cylinder(model, shade, .18, .24, .12, 0, .51);
    } else {
        b(.9, .06, 1, 0, .22); anchor('platform', 'surface', 0, .25, 0);
        for (const x of [-.38, .38]) for (const z of [-.38, .38]) { const wheel = c(.09, .08, x, .09, z, shade); wheel.rotation.z = Math.PI / 2; }
        for (const x of [-.38, .38]) link([x, .22, -.42], [x, .94, -.42], .025);
        link([-.38, .94, -.42], [.38, .94, -.42], .03);
    }
    const root = f.fit();
    if (hinges.length) {
        // Bake the unrotated layout before opening: a long container must not
        // stretch a door when its width rotates into the container's depth axis.
        const scale = model.scale.clone();
        model.traverse(o => { if (o !== model) o.position.multiply(scale); if (o instanceof T.Mesh) o.geometry.scale(scale.x, scale.y, scale.z); });
        model.scale.set(1, 1, 1);
        hinges.forEach(h => h.group.rotation.y = h.sign * T.MathUtils.degToRad(p.opening));
    }
    return root;
}
