import * as T from 'three';
import type { Entity } from '../model.ts';
import { mesh, sphere } from './geometry.ts';
import { objectBuilder } from './object-builder.ts';

export function makeVehicle(e: Entity) {
    const f = objectBuilder(e), { model, p, m, shade, b, c, link, anchor } = f, style = e.asset.replace('vehicle-', '');
    const r = p.wheelRatio, wheelDepthScale = p.height / p.depth, wheelbase = p.wheelbaseRatio;
    if (style === 'bicycle' || style === 'motorcycle') {
        for (const z of [-.30*wheelbase, .30*wheelbase]) {
            const tire = mesh(model, new T.TorusGeometry(r - .025, .025, 10, 32), shade, 0, r, z); tire.rotation.y = Math.PI / 2; tire.scale.x = wheelDepthScale; tire.userData.vehiclePart = 'wheel';
            for (let i = 0; i < 8; i++) {
                const angle = i * Math.PI / 4;
                link([0, r, z], [0, r + Math.sin(angle) * (r - .025), z + Math.cos(angle) * (r - .025) * wheelDepthScale], .004, shade);
            }
        }
        const bikeLink = (a: number[], end: number[], radius: number, mat = m) => link([a[0], a[1], a[2]*wheelbase], [end[0], end[1], end[2]*wheelbase], radius, mat);
        const rear = [0, r, -.30], front = [0, r, .30], crank = [0, .28, -.04], saddle = [0, .69, -.13], stem = [0, .73, .24];
        for (const [a, end] of [[rear, crank], [rear, saddle], [crank, saddle], [saddle, stem], [crank, stem], [stem, front]]) bikeLink(a, end, style === 'bicycle' ? .015 : .025);
        bikeLink([0, .73, .24], [0, .978, .22], .022); bikeLink([-.48, .978, .22], [.48, .978, .22], .022);
        b(.3, .06, style === 'motorcycle' ? .35 : .18, 0, .72, -.13*wheelbase, shade); anchor('rider', 'seat', 0, .75, -.13*wheelbase);
        anchor('camera-handlebar', 'surface', 0, 1, .22*wheelbase);
        if (style === 'motorcycle') {
            sphere(model, m, 0, .63, .06*wheelbase, .27, .16, .16); b(.36, .23, .22, 0, .4, -.02*wheelbase, shade);
            bikeLink([.22, .28, -.3], [.22, .28, .03], .035, shade);
        } else bikeLink([-.22, .28, -.04], [.22, .28, -.04], .012, shade);
    } else if (style === 'boat') {
        const shape = new T.Shape([new T.Vector2(-.42, -.5), new T.Vector2(.42, -.5), new T.Vector2(.5, .16), new T.Vector2(0, .5), new T.Vector2(-.5, .16)]);
        const inner = new T.Path([new T.Vector2(-.35, -.42), new T.Vector2(-.42, .14), new T.Vector2(0, .4), new T.Vector2(.42, .14), new T.Vector2(.35, -.42)]); shape.holes.push(inner);
        const walls = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }); walls.rotateX(Math.PI / 2); walls.translate(0, 1, 0); mesh(model, walls, m);
        const bottom = new T.Shape(shape.getPoints()); const floor = new T.ExtrudeGeometry(bottom, { depth: .07, bevelEnabled: false }); floor.rotateX(Math.PI / 2); floor.translate(0, .07, 0); mesh(model, floor, m);
        for (let i = 0; i < p.seats; i++) {
            const z = -.28 + (i + .5) / p.seats * .58, width = .70 * (1 - Math.max(0, -z) * .6);
            b(width, .055, .08, 0, .56, z, shade); anchor('seat-' + i, 'seat', 0, .5875, z);
        }
        anchor('floor', 'surface', .12, .07, 0);
        anchor('camera-bow', 'surface', 0, 1, .45);
    } else {
        const floor = r * .7 + .12, cabinLength = style === 'bus' ? .86 : style === 'van' ? .82 : style === 'truck' ? .29 : style === 'suv' ? .67 : .58;
        const cabinZ = style === 'truck' ? .32 : style === 'van' || style === 'bus' ? .015 : -.035;
        b(.95, .14, 1, 0, floor - .07);
        for (const x of [-.455*p.trackRatio, .455*p.trackRatio]) for (const z of [-.30*wheelbase, .30*wheelbase]) {
            const tire = c(r, .09, x, r, z, shade); tire.rotation.z = Math.PI / 2; tire.scale.z = wheelDepthScale; tire.userData.vehiclePart = 'wheel';
        }
        const roofY = style === 'sedan' ? .95 : .975;
        const frontInset = style === 'sedan' ? .10 : style === 'suv' ? .06 : 0, rearInset = style === 'sedan' ? .07 : style === 'suv' ? .015 : 0;
        b(.84, 1 - roofY, cabinLength - frontInset - rearInset, 0, (1 + roofY) / 2, cabinZ + (rearInset - frontInset) / 2);
        anchor('camera-roof', 'surface', 0, 1, cabinZ + (rearInset - frontInset) / 2);
        for (const x of [-.405, .405]) {
            b(.04, .30, cabinLength, x, floor + .15, cabinZ);
            const pillars = style === 'bus' ? Math.max(4, Math.ceil(p.seats / 2)) : 3;
            for (let i = 0; i < pillars; i++) {
                const z = cabinZ - cabinLength / 2 + i * cabinLength / (pillars - 1);
                const inset = i === 0 ? rearInset : i === pillars - 1 ? -frontInset : 0;
                link([x, floor + .28, z], [x, roofY, z + inset], .014);
            }
        }
        if (style === 'truck') {
            b(.9, .055, .60, 0, floor + .02, -.18);
            for (const x of [-.43, .43]) b(.04, .3, .60, x, floor + .18, -.18);
            b(.9, .3, .03, 0, floor + .18, -.465); anchor('cargo', 'surface', 0, floor + .0475, -.20);
        } else if (!['van', 'bus'].includes(style)) {
            b(.93, .20, .22, 0, floor + .1, .39); b(.91, .15, .16, 0, floor + .075, -.42);
            anchor('camera-hood', 'surface', 0, floor + .20, .39);
        }
        const rows = Math.ceil(p.seats / 2), start = cabinZ + cabinLength * .25;
        for (let i = 0; i < p.seats; i++) {
            const x = i % 2 ? .21 : -.21, z = rows === 1 ? cabinZ : start - Math.floor(i / 2) / (rows - 1) * cabinLength * .55;
            const seatD = cabinLength / Math.max(rows, 2) * .40, y = floor + .10;
            b(.30, .04, seatD, x, y - .02, z, shade); b(.30, .23, .025, x, y + .09, z - seatD / 2, shade);
            anchor('seat-' + i, 'seat', x, y, z);
        }
        for (const x of [-.32, .32]) b(.16, .05, .012, x, floor + .08, .503, shade);
    }
    return f.fit();
}
