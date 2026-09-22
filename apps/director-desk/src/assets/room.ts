import * as T from 'three';
import type { Project } from '../model.ts';
import { material, box as geometryBox } from './geometry.ts';
import { ROOM_PARTS } from './catalog/room-parts.ts';
export function makeRoom(project: Pick<Project, 'room'>, onlyPart?: typeof ROOM_PARTS[number]) {
    const group = new T.Group();
    const walls = new Map<string, T.Group>();
    const { width: w, depth: d, height: h } = project.room;
    const floorMat = '#b7b7b1', wallMat = '#e5e4de', trim = '#f0efea';
    const materials = new Map<string, T.Material>();
    function box(parent: T.Object3D, color: string, ...dimensions: [number, number, number, number, number, number]) {
        if (onlyPart && (parent === group ? onlyPart !== 'floor' : parent.name !== onlyPart)) return;
        if (!materials.has(color)) materials.set(color, material(color));
        geometryBox(parent, materials.get(color)!, ...dimensions);
    }
    box(group, floorMat, w + .25, .12, d + .25, 0, -.06, 0);
    for (const side of ['north', 'south', 'east', 'west', 'ceiling']) {
        const g = new T.Group();
        g.name = side;
        group.add(g);
        walls.set(side, g);
    }
    box(walls.get('north')!, wallMat, w + .24, h, .12, 0, h / 2, -d / 2 - .06);
    box(walls.get('east')!, wallMat, .12, h, d, w / 2 + .06, h / 2, 0);
    const west = walls.get('west')!;
    // A real opening: sill, lintel and jambs rather than a painted window on a solid wall.
    box(west, wallMat, .12, .95, d, -w / 2 - .06, .475, 0);
    box(west, wallMat, .12, Math.max(.1, h - 2.25), d, -w / 2 - .06, (h + 2.25) / 2, 0);
    const edge = (d - 1.5) / 2;
    for (const z of [-(d / 2 - edge / 2), d / 2 - edge / 2])
        box(west, wallMat, .12, 1.3, edge, -w / 2 - .06, 1.6, z);
    for (const z of [-.75, 0, .75])
        box(west, trim, .14, 1.3, .035, -w / 2 - .04, 1.6, z);
    box(west, trim, .14, .035, 1.5, -w / 2 - .04, 1.6, 0);
    const south = walls.get('south')!, doorCenter = w / 2 - .85, doorWidth = .9, leftWidth = doorCenter - doorWidth / 2 + w / 2, rightWidth = w / 2 - (doorCenter + doorWidth / 2);
    box(south, wallMat, leftWidth, h, .12, -w / 2 + leftWidth / 2, h / 2, d / 2 + .06);
    box(south, wallMat, rightWidth, h, .12, w / 2 - rightWidth / 2, h / 2, d / 2 + .06);
    box(south, wallMat, doorWidth, h - 2.1, .12, doorCenter, 2.1 + (h - 2.1) / 2, d / 2 + .06);
    box(walls.get('ceiling')!, wallMat, w, .1, d, 0, h + .05, 0);
    for (const [side, g] of walls) {
        if (side === 'ceiling')
            continue;
        if (side === 'north')
            box(g, trim, w, .09, .035, 0, .045, -d / 2 + .02);
        if (side === 'east' || side === 'west')
            box(g, trim, .035, .09, d, (side === 'east' ? 1 : -1) * (w / 2 - .02), .045, 0);
    }
    group.visible = project.room.enabled;
    return { group, walls };
}
