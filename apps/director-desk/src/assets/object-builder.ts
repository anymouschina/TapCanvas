import * as T from 'three';
import type { Entity } from '../model.ts';
import type { ContactAnchor } from './contact-anchors.ts';
import { assetParameters } from './parameters.ts';
import { box, cylinder, material } from './geometry.ts';
import { branch, fitModel } from './procedural.ts';

/** Shared white-prop construction and surface metadata. */
export function objectBuilder(e: Entity) {
    const root = new T.Group(), model = new T.Group(); root.add(model);
    const p = assetParameters(e), m = material(e.color), shade = material(new T.Color(e.color).multiplyScalar(.65));
    const anchors: ContactAnchor[] = []; root.userData.contactAnchors = anchors;
    const b = (w: number, h: number, d: number, x = 0, y = h / 2, z = 0, mat: T.Material = m, parent: T.Object3D = model) => box(parent, mat, w, h, d, x, y, z, 0);
    const c = (r: number, h: number, x = 0, y = h / 2, z = 0, mat: T.Material = m) => cylinder(model, mat, r, r, h, x, y, z);
    const link = (a: number[], end: number[], radius: number, mat: T.Material = m) => branch(model, mat, new T.Vector3(...a), new T.Vector3(...end), radius, radius);
    const anchor = (id: string, role: ContactAnchor['role'], x: number, y: number, z: number) => anchors.push({ id, role, position: [x, y, z], normal: [0, 1, 0] });
    const fit = () => {
        fitModel(model, p.width, p.height, p.depth); model.updateMatrix();
        const normal = new T.Matrix3().getNormalMatrix(model.matrix);
        anchors.forEach(a => { a.position = new T.Vector3(...a.position).applyMatrix4(model.matrix).toArray(); a.normal = new T.Vector3(...a.normal).applyNormalMatrix(normal).toArray(); });
        // Fit the complete preset first, then remove disabled parts. They must not
        // remain as invisible blockers in spatial queries, snapping or foot rays.
        const disabled: T.Object3D[] = []; model.traverse(o => { if (!o.visible) disabled.push(o); });
        disabled.forEach(o => { o.traverse(child => { if (child instanceof T.Mesh) child.geometry.dispose(); }); o.removeFromParent(); });
        return root;
    };
    return { root, model, p, m, shade, b, c, link, anchor, fit };
}
