import * as T from 'three';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { material, mesh, box } from './geometry.ts';
import { fitModel } from './procedural.ts';

/** Closed heightfield: camera views and surface paths use the same top triangles. */
function heightfield(height: (x: number, z: number) => number, count = 24) {
    const positions: number[] = [], indices: number[] = [], side = count + 1;
    for (let z = 0; z <= count; z++) for (let x = 0; x <= count; x++) {
        const u = x / count - .5, v = z / count - .5; positions.push(u, height(u, v), v);
    }
    for (let z = 0; z < count; z++) for (let x = 0; x < count; x++) {
        const a = z * side + x; indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
    const boundary: number[] = [];
    for (let x = 0; x < count; x++) boundary.push(x);
    for (let z = 0; z < count; z++) boundary.push(z * side + count);
    for (let x = count; x > 0; x--) boundary.push(count * side + x);
    for (let z = count; z > 0; z--) boundary.push(z * side);
    const bottomStart = positions.length / 3;
    boundary.forEach(index => positions.push(positions[index * 3], 0, positions[index * 3 + 2]));
    for (let i = 0; i < boundary.length; i++) {
        const next = (i + 1) % boundary.length, a = boundary[i], b = boundary[next], c = bottomStart + i, d = bottomStart + next;
        indices.push(a, b, c, b, d, c);
    }
    const center = positions.length / 3; positions.push(0, 0, 0);
    for (let i = 0; i < boundary.length; i++) indices.push(center, bottomStart + i, bottomStart + (i + 1) % boundary.length);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
export function makeTerrain(e: Entity) {
    const p = assetParameters(e), root = new T.Group(), model = new T.Group(); root.add(model); const m = material(e.color), style = e.asset.replace('terrain-', '');
    const noise = (x: number, y: number, z: number) => Math.sin(x * 9.31 + y * 7.71 + z * 4.73 + p.seed * .73) * .55 + Math.sin(x * 19.19 - y * 5.4 + z * 17.17 + p.seed * .31) * .45;
    if (style === 'rock') {
        const g = new T.IcosahedronGeometry(.5, 2), v = g.attributes.position;
        for (let i = 0; i < v.count; i++) {
            const point = new T.Vector3().fromBufferAttribute(v, i); point.multiplyScalar(1 + p.roughness * noise(point.x, point.y, point.z)); v.setXYZ(i, point.x, point.y, point.z);
        }
        g.computeVertexNormals(); mesh(model, g, m);
    } else if (['ground', 'water'].includes(style)) box(model, m, 1, 1, 1, 0, .5, 0, 0);
    else {
        const top = (x: number, z: number) => {
            if (style === 'slope') return .03 + (.5 - z) * .97;
            if (style === 'hill') return .03 + Math.max(0, 1 - (x * x + z * z) * 3) * (.9 + p.roughness * noise(x, 0, z) * .12);
            if (style === 'cliff') return .65 + .25 * Math.sin(x * 4 + 1) + p.roughness * noise(x, 0, z) * .15;
            if (style === 'ditch') return Math.abs(x) < .20 ? .08 : Math.abs(x) > .35 ? 1 : .08 + (Math.abs(x) - .20) / .15 * .92;
            return .06 + Math.pow(Math.abs(x) * 2, 2) * .90 + p.roughness * (noise(x, 0, z) + 1) * .018;
        };
        mesh(model, heightfield(top), m);
    }
    fitModel(model, p.width, p.height, p.depth);
    if (style === 'water') root.userData.referenceSurface = 'static-water';
    return root;
}
