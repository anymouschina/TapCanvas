import * as T from 'three';
import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
import { box, cylinder, material, mesh } from './geometry.ts';
import type { ContactAnchor } from './furniture/shared.ts';

export function makeCirculation(e: Entity) {
    const root = new T.Group(), p = assetParameters(e), m = material(e.color), anchors: ContactAnchor[] = [];
    root.userData.contactAnchors = anchors;
    const anchor = (id: string, x: number, y: number, z: number, normal: ContactAnchor['normal'] = [0, 1, 0]) => anchors.push({ id, role: 'surface', position: [x, y, z], normal });
    const b = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0, parent: T.Object3D = root) => box(parent, m, w, h, d, x, y, z, 0);
    if (e.asset === 'structure-ramp') {
        const shape = new T.Shape([new T.Vector2(-p.length / 2, 0), new T.Vector2(p.length / 2, 0), new T.Vector2(p.length / 2, p.height)]);
        const g = new T.ExtrudeGeometry(shape, { depth: p.width, bevelEnabled: false }); g.translate(0, 0, -p.width / 2); g.rotateY(Math.PI / 2); mesh(root, g, m);
        const normal = new T.Vector3(0, 1, p.height / p.length).normalize().toArray() as ContactAnchor['normal'];
        anchor('slope', 0, p.height / 2, 0, normal);
    } else if (e.asset === 'structure-ladder') {
        const ladder = new T.Group(); root.add(ladder);
        const t = Math.min(.055, p.width * .1);
        for (const x of [-p.width / 2 + t / 2, p.width / 2 - t / 2]) b(t, p.height, t, x, p.height / 2, 0, ladder);
        for (let i = 0; i < p.steps; i++) b(p.width - t * 2, t, t, 0, (i + 1) * p.height / (p.steps + 1), 0, ladder);
        ladder.rotation.x = -T.MathUtils.degToRad(p.tilt);
        root.updateMatrixWorld(true); ladder.position.y -= new T.Box3().setFromObject(root, true).min.y;
    } else if (e.asset === 'structure-railing') {
        const t = Math.min(.055, p.height * .08);
        b(p.length, t, t, 0, p.height - t / 2); b(p.length, t, t, 0, p.height * .38);
        for (let i = 0; i < p.posts; i++) b(t, p.height, t, -p.length / 2 + t / 2 + i * (p.length - t) / (p.posts - 1));
    } else if (e.asset === 'structure-stairs-spiral') {
        const angle = T.MathUtils.degToRad(p.turn / p.steps), inner = p.radius - p.width;
        for (let i = 0; i < p.steps; i++) {
            const start = i * angle, end = start + angle, shape = new T.Shape();
            shape.absarc(0, 0, p.radius, -end, -start, false);
            shape.absarc(0, 0, inner, -start, -end, true); shape.closePath();
            const g = new T.ExtrudeGeometry(shape, { depth: Math.min(.12, p.rise), bevelEnabled: false, curveSegments: 16 });
            g.rotateX(-Math.PI / 2); g.translate(0, (i + 1) * p.rise - Math.min(.12, p.rise), 0); mesh(root, g, m);
            const mid = (start + end) / 2, radius = inner + p.width / 2;
            anchor('step-' + i, Math.cos(mid) * radius, (i + 1) * p.rise, Math.sin(mid) * radius);
        }
        const height = p.steps * p.rise; cylinder(root, m, Math.min(.08, inner * .5), Math.min(.08, inner * .5), height, 0, height / 2);
    } else {
        const n = p.steps, h = n * p.rise, last = -(n - 1) * p.tread, style = e.asset.replace('structure-stairs-', '');
        for (let i = 0; i < n; i++) { b(p.width, (i + 1) * p.rise, p.tread, 0, (i + 1) * p.rise / 2, -i * p.tread); anchor('a-' + i, 0, (i + 1) * p.rise, -i * p.tread); }
        if (style !== 'straight') {
            const z = last - p.tread / 2 - p.landing / 2, gap = .2;
            b(style === 'u' ? p.width * 2 + gap : p.width, h, p.landing, style === 'u' ? (p.width + gap) / 2 : 0, h / 2, z);
            anchor('landing', style === 'u' ? (p.width + gap) / 2 : 0, h, z);
            for (let i = 0; i < n; i++) {
                const top = style === 'crest' ? h - i * p.rise : h + (i + 1) * p.rise;
                const x = style === 'u' ? p.width + gap : style === 'l' ? p.width / 2 + (i + .5) * p.tread : 0;
                const stepZ = style === 'u' ? last + i * p.tread : style === 'l' ? z : last - p.landing - (i + 1) * p.tread;
                b(style === 'l' ? p.tread : p.width, top, style === 'l' ? p.width : p.tread, x, top / 2, stepZ);
                anchor('b-' + i, x, top, stepZ);
            }
        }
    }
    return root;
}
