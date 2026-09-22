import * as T from 'three';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { ROOM_PARTS } from './catalog/room-parts.ts';
import { makeRoom } from './room.ts';

/** Shares the actual room geometry, including openings and trim; origin remains the room centre. */
export function makeRoomPart(e: Entity) {
    const { width, depth, height, part } = assetParameters(e), side = ROOM_PARTS[part];
    const { group, walls } = makeRoom({ room: { enabled: true, width, depth, height } }, side);
    const root = new T.Group(), piece = side === 'floor' ? group.children.find(node => node instanceof T.Mesh)! : walls.get(side)!;
    root.add(piece);
    if (e.color !== '#d5d5d0') {
        const color = new T.Color(e.color), neutral = new T.Color('#d5d5d0'), seen = new Set<T.Material>();
        root.traverse(node => { if (!(node instanceof T.Mesh)) return; for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
            if (seen.has(mat) || !(mat instanceof T.MeshStandardMaterial)) continue; seen.add(mat);
            mat.color.r *= color.r / neutral.r; mat.color.g *= color.g / neutral.g; mat.color.b *= color.b / neutral.b;
        } });
    }
    return root;
}
