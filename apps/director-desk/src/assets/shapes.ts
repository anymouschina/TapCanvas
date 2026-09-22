import * as T from 'three';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { material, mesh } from './geometry.ts';

function polygon(points: number[][], depth = 1) {
    const s = new T.Shape(points.map(p => new T.Vector2(p[0], p[1])));
    const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -depth / 2); return g;
}
export function makeShape(e: Entity) {
    const root = new T.Group(), m = material(e.color), p = assetParameters(e), t = p.thickness ?? .18;
    let geometry: T.BufferGeometry | undefined;
    switch (e.asset) {
        case 'shape-box': geometry = new T.BoxGeometry(1, 1, 1); break;
        case 'shape-sphere': geometry = new T.SphereGeometry(.5, p.segments, p.crossSegments); break;
        case 'shape-cylinder': geometry = new T.CylinderGeometry(.5, .5, 1, p.segments); break;
        case 'shape-cone': geometry = new T.ConeGeometry(.5, 1, p.segments); break;
        case 'shape-capsule': geometry = new T.CapsuleGeometry(.25, .5, p.crossSegments, p.segments); break;
        case 'shape-torus': geometry = new T.TorusGeometry(.5 - t / 2, t / 2, p.crossSegments, p.segments); break;
        case 'shape-pyramid': geometry = new T.ConeGeometry(Math.SQRT1_2, 1, 4); geometry.rotateY(Math.PI / 4); break;
        case 'shape-plane': geometry = new T.BoxGeometry(1, 1, 1); break;
        case 'shape-wedge': geometry = polygon([[-.5, 0], [.5, 0], [.5, 1]]); break;
        case 'shape-ramp': geometry = polygon([[-.5, 0], [.5, 1 - t], [.5, 1], [-.5, t]]); break;
        case 'shape-hemisphere': geometry = new T.SphereGeometry(.5, p.segments, p.crossSegments, 0, Math.PI * 2, 0, Math.PI / 2); break;
        case 'shape-arch': {
            const s = new T.Shape();
            s.moveTo(-.5, 0); s.lineTo(-.5, .5); s.absarc(0, .5, .5, Math.PI, 0, true);
            s.lineTo(.5, 0); s.lineTo(.5 - t, 0); s.lineTo(.5 - t, .5);
            s.absarc(0, .5, .5 - t, 0, Math.PI, false); s.lineTo(-.5 + t, 0); s.closePath();
            geometry = new T.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: p.segments }); geometry.translate(0, 0, -.5); break;
        }
        case 'shape-tube': {
            const s = new T.Shape(); s.absarc(0, 0, .5, 0, Math.PI * 2, false);
            const hole = new T.Path(); hole.absarc(0, 0, .5 - t, 0, Math.PI * 2, true); s.holes.push(hole);
            geometry = new T.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: p.segments }); geometry.rotateX(Math.PI / 2); break;
        }
        case 'shape-l': geometry = polygon([[-.5, 0], [.5, 0], [.5, t], [-.5 + t, t], [-.5 + t, 1], [-.5, 1]]); break;
        case 'shape-u': geometry = polygon([[-.5, 0], [.5, 0], [.5, 1], [.5 - t, 1], [.5 - t, t], [-.5 + t, t], [-.5 + t, 1], [-.5, 1]]); break;
        case 'shape-arc': geometry = new T.TorusGeometry(.5 - t / 2, t / 2, p.crossSegments, p.segments, T.MathUtils.degToRad(p.angle)); break;
        default: throw new Error(`未知几何白模：${e.asset}`);
    }
    // Normalize the actual generated bounds so displayed dimensions match every shape.
    geometry.computeBoundingBox();
    const b = geometry.boundingBox!, size = b.getSize(new T.Vector3()), center = b.getCenter(new T.Vector3());
    geometry.translate(-center.x, -b.min.y, -center.z);
    geometry.scale(p.width / size.x, p.height / size.y, p.depth / size.z);
    mesh(root, geometry, m);
    if (e.asset === 'shape-hemisphere') {
        const cap = new T.CircleGeometry(.5, p.segments); cap.rotateX(Math.PI / 2);
        if (p.segments === 24) cap.scale(p.width, 1, p.depth);
        else {
            // Sphere and circle start on opposite sides. Match the actual equator,
            // including odd segment counts, before applying the body's normalization.
            cap.rotateY(Math.PI); cap.translate(-center.x, -b.min.y, -center.z);
            cap.scale(p.width / size.x, p.height / size.y, p.depth / size.z);
        }
        mesh(root, cap, m);
    }
    return root;
}
