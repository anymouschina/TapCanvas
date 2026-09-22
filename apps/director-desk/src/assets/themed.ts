import * as T from 'three';
import type { Entity } from '../model.ts';
import { mesh } from './geometry.ts';
import { objectBuilder } from './object-builder.ts';

export function makeThemed(e: Entity) {
    const f = objectBuilder(e), { model, p, m, shade, b, c, link, anchor } = f, style = e.asset.replace('theme-', '');
    if (style === 'throne') {
        b(.85, .06, .85, 0, .36); b(.90, .6, .07, 0, .7, -.42);
        for (const x of [-.39, .39]) { b(.065, .6, .065, x, .3, .36); b(.1, .045, .85, x, .6); }
        for (const x of [-.38, .38]) b(.08, 1, .08, x, .5, -.40);
        b(.65, .04, .82, 0, .405, .01, shade); anchor('seat', 'seat', 0, .425, .04);
    } else if (style === 'table') {
        b(1, .065, 1, 0, .9675); b(.96, .12, .87, 0, .88);
        for (const x of [-.4, .4]) for (const z of [-.37, .37]) { b(.055, .9, .09, x, .45, z); b(.18, .055, .16, x, .0275, z); }
        for (const z of [-.37, .37]) b(.8, .045, .035, 0, .23, z);
        anchor('top', 'surface', 0, 1, 0);
    } else if (style === 'weaponrack') {
        for (const x of [-.45, .45]) { b(.04, 1, .06, x); b(.18, .045, 1, x); }
        for (const y of [.3, .78]) b(.94, .06, .06, 0, y);
        for (let i = 0; i < p.slots; i++) {
            const x = (i - (p.slots - 1) / 2) * .8 / Math.max(1, p.slots);
            b(.045, .08, .3, x, .79, .12); anchor('slot-' + i, 'surface', x, .83, .20);
        }
    } else if (style === 'flagpole') {
        c(.16, .04, -.32); c(.018, 1, -.32, .5);
        const flag = b(.80, .3, .009, .08, .81, 0, shade); flag.visible = !!p.flag;
    } else if (style === 'altar') {
        for (let i = 0; i < p.steps; i++) {
            const span = 1 - i / p.steps * .30, y = (i + 1) / p.steps * .45;
            b(span, .45 / p.steps, span, 0, y - .225 / p.steps); anchor('step-' + i, 'surface', span / 2 - .075 / p.steps, y, 0);
        }
        b(.4, .45, .4, 0, .675); b(.65, .1, .58, 0, .95); anchor('altar', 'surface', 0, 1, 0);
    } else if (style === 'ring') {
        b(1, .25, 1); anchor('stage', 'surface', 0, .25, 0);
        for (const x of [-.48, .48]) for (const z of [-.48, .48]) c(.015, 1, x, .5, z);
        for (const y of [.5, .72, .92]) for (const sign of [-1, 1]) {
            link([-.48, y, sign * .48], [.48, y, sign * .48], .005, shade).visible = !!p.ropes;
            link([sign * .48, y, -.48], [sign * .48, y, .48], .005, shade).visible = !!p.ropes;
        }
    } else if (style === 'tent') {
        b(1, .02, 1);
        for (const sign of [-1, 1]) {
            const slope = new T.BufferGeometry();
            slope.setAttribute('position', new T.Float32BufferAttribute([0, 1, -.5, sign * .5, 0, -.5, 0, 1, .5, sign * .5, 0, .5], 3));
            slope.setIndex(sign === 1 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2]); slope.computeVertexNormals();
            const fabric = m.clone(); fabric.side = T.DoubleSide; mesh(model, slope, fabric);
        }
        const rear = new T.Shape([new T.Vector2(-.5, 0), new T.Vector2(.5, 0), new T.Vector2(0, 1)]);
        const g = new T.ExtrudeGeometry(rear, { depth: .012, bevelEnabled: false }); mesh(model, g, m, 0, 0, -.5);
        link([0, 0, -.49], [0, 1, -.49], .008, shade); anchor('floor', 'surface', 0, .02, .15);
    } else {
        b(1, .055, .85, 0, .43); anchor('counter', 'surface', 0, .4575, .1);
        for (const x of [-.46, .46]) for (const z of [-.4, .4]) b(.035, .9, .035, x, .45, z);
        b(.96, .3, .025, 0, .25, .40);
        const shape = new T.Shape([new T.Vector2(-.55, 0), new T.Vector2(.55, 0), new T.Vector2(0, .17)]);
        const roof = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }); mesh(model, roof, shade, 0, .88, -.5).visible = !!p.canopy;
    }
    return f.fit();
}
