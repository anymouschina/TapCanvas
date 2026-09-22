import * as T from 'three';
import type { Entity } from '../model.ts';
import type { ContactAnchor } from './furniture/shared.ts';
import { assetParameters } from './parameters.ts';
import { material, box, mesh } from './geometry.ts';

export function makeBuilding(e: Entity) {
    const p = assetParameters(e), root = new T.Group(), m = material(e.color), anchors: ContactAnchor[] = [];
    root.userData.contactAnchors = anchors;
    const w = p.width, d = p.depth, t = p.thickness, fh = p.floorHeight, height = fh * p.levels, slab = Math.min(.16, t);
    const style = e.asset.replace('building-', '');
    const b = (width: number, h: number, depth: number, x = 0, y = h / 2, z = 0, parent: T.Object3D = root) => box(parent, m, width, h, depth, x, y, z, 0);
    const facade = (width: number, level: number, front: boolean, parent: T.Object3D) => {
        const bay = width / p.bays;
        for (let i = 0; i < p.bays; i++) {
            const x = -width / 2 + (i + .5) * bay, doorway = front && level === 0 && i === Math.floor(p.bays / 2);
            const holeW = doorway ? Math.min(bay * .72, style === 'warehouse' ? 3 : 1.5) : bay * .56;
            const sill = doorway ? slab : fh * .32, holeH = doorway ? fh * .76 : fh * .43;
            const pier = (bay - holeW) / 2, base = level * fh;
            b(pier, fh, t, x - bay / 2 + pier / 2, base + fh / 2, 0, parent);
            b(pier, fh, t, x + bay / 2 - pier / 2, base + fh / 2, 0, parent);
            b(holeW, sill, t, x, base + sill / 2, 0, parent);
            const lintel = fh - sill - holeH;
            b(holeW, lintel, t, x, base + fh - lintel / 2, 0, parent);
        }
    };
    if (style === 'fortwall') {
        b(w, height, d); anchors.push({ id: 'wall-walk', role: 'surface', position: [0, height, 0], normal: [0, 1, 0] });
    } else {
        for (let level = 0; level < p.levels; level++) {
            b(w, slab, d, 0, level * fh + slab / 2);
            anchors.push({ id: 'floor-' + level, role: 'surface', position: [0, level * fh + slab, 0], normal: [0, 1, 0] });
        }
        if (style === 'pavilion') for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) b(t, height, t, x, height / 2, z);
        else for (const side of ['front', 'back', 'left', 'right']) {
            const wall = new T.Group(); root.add(wall);
            const across = side === 'front' || side === 'back';
            if (across) wall.position.z = (side === 'front' ? 1 : -1) * (d / 2 - t / 2);
            else { wall.position.x = (side === 'right' ? 1 : -1) * (w / 2 - t / 2); wall.rotation.y = Math.PI / 2; }
            for (let level = 0; level < p.levels; level++) facade(across ? w : d - 2 * t, level, side === 'front', wall);
        }
    }
    if (p.roofStyle === 3) {
        if (style !== 'fortwall') { b(w, slab, d, 0, height - slab / 2); anchors.push({ id: 'roof', role: 'surface', position: [0, height, 0], normal: [0, 1, 0] }); }
        if (p.roofHeight > 0) {
            const count = p.bays ?? 3;
            for (let i = 0; i < count; i++) for (const z of [-d / 2 + t / 2, d / 2 - t / 2]) b(w / count * .55, p.roofHeight, t, -w / 2 + (i + .5) * w / count, height + p.roofHeight / 2, z);
            if (style !== 'fortwall') for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) b(t, p.roofHeight * .5, d, x, height + p.roofHeight * .25);
        }
    } else if (p.roofStyle === 0 || p.roofHeight === 0) {
        b(w + .2, slab, d + .2, 0, height + slab / 2);
        if (p.roofHeight > 0) for (const z of [-d / 2, d / 2]) b(w, p.roofHeight, t, 0, height + slab + p.roofHeight / 2, z);
        if (style === 'fortwall') anchors[0].position[1] = height + slab;
        else anchors.push({ id: 'roof', role: 'surface', position: [0, height + slab, 0], normal: [0, 1, 0] });
    } else if (p.roofStyle === 2) {
        const roof = new T.ConeGeometry(1, p.roofHeight, 4); roof.rotateY(Math.PI / 4);
        const part = mesh(root, roof, m, 0, height + p.roofHeight / 2); part.scale.set((w + .4) / Math.SQRT2, 1, (d + .4) / Math.SQRT2);
    } else {
        const shape = new T.Shape([new T.Vector2(-w / 2 - .15, 0), new T.Vector2(w / 2 + .15, 0), new T.Vector2(0, p.roofHeight)]);
        const roof = new T.ExtrudeGeometry(shape, { depth: d + .3, bevelEnabled: false }); roof.translate(0, height, -d / 2 - .15); mesh(root, roof, m);
    }
    return root;
}
