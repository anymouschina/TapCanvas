import { createHash } from 'node:crypto';
import * as T from 'three';
/** Compare actual geometry and placement, excluding random object/material IDs. */
export function geometrySignature(root: T.Object3D) {
    root.updateMatrixWorld(true);
    const hash = createHash('sha256');
    root.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        hash.update(JSON.stringify({ positions: [...object.geometry.attributes.position.array].map(n => Math.round(n * 1e8)),
            indices: object.geometry.index ? [...object.geometry.index.array] : [], matrix: object.matrixWorld.toArray().map(n => Math.round(n * 1e8)) }));
    });
    return hash.digest('hex');
}
